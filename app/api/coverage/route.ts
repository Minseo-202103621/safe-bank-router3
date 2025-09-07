import { NextResponse } from "next/server";
import { headers } from "next/headers";

/* ---- 런타임/캐시 플래그: 정적화 방지 ---- */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ===== types ===== */
type Account = {
  id: string;
  institution: string;
  license: string;
  type: "demand"|"term"|"fx_deposit"|"trust_protected"|"investment";
  currency: "KRW"|"USD"|string;
  balance: number;
  fxRate?: number;
  term?: number;
  product_name?: string;
};
type CoverageRow = {
  license: string;
  institutions: string;
  products: string[];
  tier: "제1금융권"|"제2금융권"|"기타";
  eligible: number;
  protected: number;
  excess: number;
  nonProtected: number;
  accounts: Account[];
};
type CoverageTotals = { eligible:number; protected:number; excess:number; nonProtected:number; tier1:number; tier2:number };

/* ===== helpers ===== */
const stripBOM = (s:string)=>s.replace(/^\uFEFF/,"");
const key = (s:string)=>String(s||"").toLowerCase().replace(/\s+/g,"").replace(/[(){}\[\]·,\-_/]/g,"");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "", row: string[] = [], inQuote = false;
  const t = stripBOM(text);
  for (let i = 0; i < t.length; i++) {
    const c = t[i], n = t[i + 1];
    if (c === '"') {
      if (inQuote && n === '"') { cur += '"'; i++; } else { inQuote = !inQuote; }
    } else if (c === "," && !inQuote) {
      row.push(cur); cur = "";
    } else if ((c === "\n" || c === "\r") && !inQuote) {
      if (cur.length || row.length) { row.push(cur); rows.push(row); row = []; cur = ""; }
      if (c === "\r" && n === "\n") i++;
    } else {
      cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function loadKDIC(origin: string) {
  const csvUrl = `${origin}/data/kdic_products.csv`;
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch CSV from ${csvUrl}: ${res.status}`);

  const raw = await res.text();
  const rows = parseCsv(raw);
  const header = rows[0]?.map(h=>h.trim()) ?? [];
  const idxInst = header.findIndex(h=>/금융회사명/.test(h));
  const idxProd = header.findIndex(h=>/금융상품명/.test(h));

  const set = new Set<string>();
  for (let i=1;i<rows.length;i++){
    const cols = rows[i];
    const inst = (cols[idxInst]??"").trim();
    const prod = (cols[idxProd]??"").trim();
    if (inst && prod) set.add(`${key(inst)}|${key(prod)}`);
  }
  return set;
}

function classifyTier(inst:string): "제1금융권"|"제2금융권"|"기타" {
  const s = inst || "";
  if (/저축은행|상호저축|신협|수협|새마을금고|농축협|상호금융/.test(s)) return "제2금융권";
  if (/은행/.test(s) && !/저축은행/.test(s)) return "제1금융권";
  return "기타";
}

function toKRW(a: Account) {
  if (a.currency === "USD") return Math.round((a.balance ?? 0) * (a.fxRate ?? 1400));
  return a.balance ?? 0;
}

/* ===== handler ===== */
export async function GET(req: Request) {
  try {
    const limit = Number(process.env.COVERAGE_LIMIT ?? 50_000_000); // 기본 5천만

    // ✅ 현재 배포의 origin 계산 (프록시/커스텀도메인 대응)
    const h = headers();
    const proto = h.get("x-forwarded-proto") ?? "https";
    const host  = h.get("x-forwarded-host") ?? h.get("host");
    const origin = `${proto}://${host}`;

    // 1) KDIC 카탈로그
    const kd = await loadKDIC(origin);

    // 2) mydata는 동일 배포의 라우트를 직접 호출 (하드코딩/ENV 제거)
    const r = await fetch(`${origin}/api/mydata`, { cache: "no-store" });
    if (!r.ok) throw new Error(`/api/mydata failed: ${r.status}`);
    const accounts: Account[] = (await r.json()) ?? [];

    // 3) 보호/비보호 라벨링 집계
    const byLicense = new Map<string, CoverageRow>();
    for (const a of accounts) {
      const lic = a.license || `${a.institution} 라이선스`;
      if (!byLicense.has(lic)) {
        byLicense.set(lic, {
          license: lic,
          institutions: a.institution,
          products: [],
          tier: classifyTier(a.institution),
          eligible: 0, protected: 0, excess: 0, nonProtected: 0,
          accounts: [],
        });
      }
      const row = byLicense.get(lic)!;
      row.accounts.push(a);
      if (a.product_name && !row.products.includes(a.product_name)) row.products.push(a.product_name);

      const isProtectedType = ["demand","term","fx_deposit","trust_protected"].includes(a.type);
      const matched = kd.has(`${key(a.institution)}|${key(a.product_name ?? "")}`);
      const amt = toKRW(a);

      if (isProtectedType && matched) row.eligible += amt;
      else row.nonProtected += amt;
    }

    // 4) 한도 적용
    for (const row of byLicense.values()) {
      row.protected = Math.min(row.eligible, limit);
      row.excess = Math.max(0, row.eligible - limit);
    }

    // 5) totals
    const totals: CoverageTotals = { eligible:0, protected:0, excess:0, nonProtected:0, tier1:0, tier2:0 };
    for (const r of byLicense.values()) {
      totals.eligible += r.eligible;
      totals.protected += r.protected;
      totals.excess += r.excess;
      totals.nonProtected += r.nonProtected;
      if (r.tier === "제1금융권") totals.tier1 += r.eligible;
      else if (r.tier === "제2금융권") totals.tier2 += r.eligible;
    }

    return NextResponse.json({ rows: [...byLicense.values()], totals }, { status: 200 });
  } catch (e) {
    console.error("Error in coverage route:", e);
    return NextResponse.json(
      { rows: [], totals: { eligible:0, protected:0, excess:0, nonProtected:0, tier1:0, tier2:0 } },
      { status: 500 }
    );
  }
}
