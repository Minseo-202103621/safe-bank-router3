import { NextResponse } from "next/server";

const SERVICE_KEY = process.env.KDIC_SERVICE_KEY ?? "";
const PRODUCT_URL = "https://apis.data.go.kr/B190017/service/GetInsuredProductService202008/getProductList202008";

type Item = { [k: string]: any };

function extractFromJson(j: any): { items: Item[]; total?: number } {
  const ok = (header: any) => String(header?.resultCode) === "00";

  if (j?.response) {
    const header = j.response.header ?? {};
    if (!ok(header)) throw new Error(`API error ${header.resultCode} ${header.resultMsg}`);
    const body = j.response.body ?? {};
    let items = body?.items?.item ?? [];
    if (items && !Array.isArray(items)) items = [items];
    const total = body?.totalCount != null ? Number(body.totalCount) : undefined;
    return { items, total };
  }
  if (j?.getProductList202008) {
    const root = j.getProductList202008;
    const header = root.header ?? {};
    if (!ok(header)) throw new Error(`API error ${header.resultCode} ${header.resultMsg}`);
    const body = root.body ?? {};
    let items = body?.items?.item ?? [];
    if (items && !Array.isArray(items)) items = [items];
    const total = body?.totalCount != null ? Number(body.totalCount) : undefined;
    return { items, total };
  }
  if (j?.getProductList) {
    const root = j.getProductList;
    const header = root.header ?? {};
    if (!ok(header)) throw new Error(`API error ${header.resultCode} ${header.resultMsg}`);
    let items = root?.item ?? [];
    if (items && !Array.isArray(items)) items = [items];
    const total = root?.totalCount && /^\d+$/.test(String(root.totalCount)) ? Number(root.totalCount) : undefined;
    return { items, total };
  }
  throw new Error(`Unexpected JSON root keys: ${Object.keys(j ?? {})}`);
}

async function fetchPage(pageNo = 1, numOfRows = 500) {
  const params = new URLSearchParams({
    pageNo: String(pageNo),
    numOfRows: String(numOfRows),
    resultType: "json",
    ServiceKey: SERVICE_KEY,
  });
  const url = `${PRODUCT_URL}?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
  const j = await res.json();
  const { items } = extractFromJson(j);
  return items.map((it: any) => ({
    금융회사명: it?.fncIstNm ?? null,
    금융상품명: it?.prdNm ?? null,
    상품판매중단일자: it?.prdSalDscnDt ?? null,
    등록일: it?.regDate ?? null,
  }));
}

async function fetchAll() {
  if (!SERVICE_KEY) throw new Error("Missing KDIC_SERVICE_KEY");
  const all: any[] = [];
  let page = 1;
  const rows = 500;
  for (let i = 0; i < 50; i++) { // safety cap
    const items = await fetchPage(page, rows);
    if (!items.length) break;
    all.push(...items);
    if (items.length < rows) break;
    page++;
  }
  return all;
}

export async function GET(req: Request) {
  try {
    let data: any[] = [];
    try {
      data = await fetchAll();
    } catch {
      // fallback to CSV if API or key is missing/failed (fs -> fetch)
      const origin = new URL(req.url).origin;
      const csvUrl = `${origin}/data/kdic_products.csv`;
      const res = await fetch(csvUrl, { cache: "no-store" });
      
      if (res.ok) {
        const raw = await res.text();
        const lines = raw.split(/[\r\n]+/).filter(Boolean);
        if (lines.length > 1) {
          const headers = lines[0].split(",");
          const idx = {
            금융회사명: headers.indexOf("금융회사명"),
            금융상품명: headers.indexOf("금융상품명"),
            상품판매중단일자: headers.indexOf("상품판매중단일자"),
            등록일: headers.indexOf("등록일"),
          };
          const rows: any[] = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",");
            rows.push({
              금융회사명: idx.금융회사명 >= 0 ? cols[idx.금융회사명] : null,
              금융상품명: idx.금융상품명 >= 0 ? cols[idx.금융상품명] : null,
              상품판매중단일자: idx.상품판매중단일자 >= 0 ? cols[idx.상품판매중단일자] : null,
              등록일: idx.등록일 >= 0 ? cols[idx.등록일] : null,
            });
          }
          data = rows;
        }
      }
    }
    return NextResponse.json(data, { status: 200 });
  } catch (e: any) {
    console.error("Error in products route:", e);
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}