import { NextResponse } from "next/server";

// CSV 문자열을 파싱하여 객체 배열로 변환하는 함수
function parseCsvToObjects(raw: string): any[] {
  const lines = raw.split(/[\r\n]+/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",");
  const idx = {
    금융회사명: headers.indexOf("금융회사명"),
    금융상품명: headers.indexOf("금융상품명"),
    상품판매중단일자: headers.indexOf("상품판매중단일자"),
    등록일: headers.indexOf("등록일"),
  };

  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(","); // 간단한 split 사용, 복잡한 CSV는 라이브러리 필요
    rows.push({
      금융회사명: idx.금융회사명 >= 0 ? cols[idx.금융회사명] : null,
      금융상품명: idx.금융상품명 >= 0 ? cols[idx.금융상품명] : null,
      상품판매중단일자: idx.상품판매중단일자 >= 0 ? cols[idx.상품판매중단일자] : null,
      등록일: idx.등록일 >= 0 ? cols[idx.등록일] : null,
    });
  }
  return rows;
}

export async function GET(req: Request) {
  try {
    // 요청 URL에서 origin (https://...)을 가져옵니다.
    const origin = new URL(req.url).origin;
    const csvUrl = `${origin}/data/kdic_products.csv`;

    const res = await fetch(csvUrl, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`Failed to fetch CSV: ${res.status}`);
    }

    const rawCsv = await res.text();
    const data = parseCsvToObjects(rawCsv);
    
    return NextResponse.json(data, { status: 200 });

  } catch (e: any) {
    console.error("Error in products route:", e);
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}