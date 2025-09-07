import { NextResponse } from "next/server";

/* ============== 타입 ============== */
type Account = {
  id: string;
  institution: string;              // 실제 은행/기관명
  license: string;                  // 동일 보호그룹 키(기관명 + " 라이선스")
  type: "demand" | "term" | "fx_deposit" | "trust_protected" | "investment";
  currency: "KRW" | "USD" | string;
  balance: number;                  // 금액(랜덤 생성)
  fxRate?: number;                   // USD일 때 환율
  term?: number;                     // 정기예금 등 만기(월)
  product_name?: string;             // 실제 상품명(또는 비보호 가짜명)
};

/* ============== 유틸 ============== */
const rnd = (min: number, max: number) =>
  Math.floor(min + Math.random() * (max - min + 1));

const toLicense = (inst: string) => `${inst} 라이선스`;
const stripBOM = (s: string) => s.replace(/^\uFEFF/, "");

/** 따옴표 포함 콤마 대응 간단 CSV 파서 */
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

function inferTypeFromProduct(name: string): Exclude<Account["type"], "investment"> {
  const n = name || "";
  if (/(정기예금|예치|만기|적금|월복리|단리)/.test(n)) return "term";
  if (/(입출금|보통예금|보통|자유입출금|수시입출금|통장|급여|월급|체크)/.test(n)) return "demand";
  if (/(외화|달러|USD|미국달러)/i.test(n)) return "fx_deposit";
  if (/(금전신탁|원본보전|신탁)/.test(n)) return "trust_protected";
  return "demand";
}
function inferCurrency(name: string): "KRW" | "USD" {
  return /(외화|달러|USD|미국달러)/i.test(name) ? "USD" : "KRW";
}

/* ============== KDIC 카탈로그 로딩 (fs -> fetch로 변경) ============== */
async function loadCatalogFromCsv(origin: string): Promise<{ institution: string; product_name: string }[]> {
  const csvUrl = `${origin}/data/kdic_products.csv`;
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) {
    console.error(`Failed to fetch CSV: ${res.status}`);
    return [];
  }

  const raw = await res.text();
  const rows = parseCsv(raw);
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  const idxInst = header.findIndex((h) => /금융회사명/.test(h));
  const idxProd = header.findIndex((h) => /금융상품명/.test(h));
  if (idxInst < 0 || idxProd < 0) return [];

  const out: { institution: string; product_name: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const institution = (cols[idxInst] ?? "").trim();
    const product_name = (cols[idxProd] ?? "").trim();
    if (institution && product_name) out.push({ institution, product_name });
  }
  return out;
}

/* ============== 비보호(가짜) 상품 고정 리스트 ============== */
const NON_PROTECTED_FIXED: { institution: string; product_name: string }[] = [
  { institution: "메리츠증권", product_name: "메리츠 SMART 초단기 하이일드 랩 6M" },
  { institution: "신한투자증권", product_name: "글로벌 테크 인컴랩 12M" },
  { institution: "KB증권", product_name: "KB 해외채권 DLS 9M" },
];

/* ============== 모의 계좌 생성기 (기존 로직 유지) ============== */
function generateProtectedFromCatalog(
  catalog: { institution: string; product_name: string }[],
  count: number
): Account[] {
  const KR = {
    demand: [2_000_000, 8_000_000],
    term: [10_000_000, 60_000_000],
    trust_protected: [8_000_000, 40_000_000],
  } as const;
  const USD = { fx_deposit: [1_000, 20_000] } as const;

  const pick = () => catalog[rnd(0, catalog.length - 1)];
  const arr: Account[] = [];
  for (let i = 0; i < count; i++) {
    const { institution, product_name } = pick();
    const type = inferTypeFromProduct(product_name);
    const currency = inferCurrency(product_name);
    let balance: number, fxRate: number | undefined, term: number | undefined;

    if (type === "fx_deposit" || currency === "USD") {
      balance = rnd(USD.fx_deposit[0], USD.fx_deposit[1]);
      fxRate = 1400;
    } else if (type === "term") {
      balance = rnd(KR.term[0], KR.term[1]);
      term = Math.random() > 0.5 ? 12 : 6;
    } else if (type === "trust_protected") {
      balance = rnd(KR.trust_protected[0], KR.trust_protected[1]);
    } else {
      balance = rnd(KR.demand[0], KR.demand[1]);
    }

    arr.push({
      id: `P${i + 1}`,
      institution,
      license: toLicense(institution),
      type,
      currency,
      balance,
      fxRate,
      term,
      product_name,
    });
  }
  return arr;
}

function generateNonProtectedFixed(count = 3): Account[] {
  const KR = { investment: [5_000_000, 25_000_000] } as const;
  const arr: Account[] = [];
  for (let i = 0; i < count; i++) {
    const src = NON_PROTECTED_FIXED[i % NON_PROTECTED_FIXED.length];
    arr.push({
      id: `N${i + 1}`,
      institution: src.institution,
      license: toLicense(src.institution),
      type: "investment",
      currency: "KRW",
      balance: rnd(KR.investment[0], KR.investment[1]),
      product_name: src.product_name,
    });
  }
  return arr;
}

/* ============== 핸들러 (수정된 loadCatalogFromCsv 호출) ============== */
export async function GET(req: Request) {
  try {
    const useMock = (process.env.USE_MOCK_MYDATA ?? "true").toLowerCase() === "true";

    if (!useMock) {
      const url = process.env.MYDATA_API_URL;
      if (!url) return NextResponse.json([], { status: 200 });
      const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!r.ok) throw new Error(`mydata ${r.status}`);
      const j = await r.json();
      return NextResponse.json(Array.isArray(j) ? j : (Array.isArray(j?.accounts) ? j.accounts : []), { status: 200 });
    }

    const origin = new URL(req.url).origin;
    const catalog = await loadCatalogFromCsv(origin); // origin 전달
    if (!catalog.length) return NextResponse.json([], { status: 200 });

    const protectedCnt = Math.max(0, Number(process.env.MOCK_PROTECTED_COUNT ?? 10));
    const nonProtectedCnt = Math.max(0, Number(process.env.MOCK_NONPROTECTED_COUNT ?? 2));
    const protectedAcc = generateProtectedFromCatalog(catalog, protectedCnt);
    const nonProtectedAcc = generateNonProtectedFixed(nonProtectedCnt);

    return NextResponse.json([...protectedAcc, ...nonProtectedAcc], { status: 200 });
  } catch (e) {
    console.error("Error in mydata route:", e);
    return NextResponse.json([], { status: 200 });
  }
}