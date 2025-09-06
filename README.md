# SafeBank Router — Demo (Next.js + Vercel)

예금자보호 커버리지 계산 + 제1/제2금융권 분포 + KDIC 예보상품 연동(API/CSV fallback).

## 빠른 시작

```bash
pnpm i # 또는 npm i / yarn
pnpm dev
```

브라우저에서 `http://localhost:3000` 열기.

## 환경변수

- `KDIC_SERVICE_KEY` : 공공데이터포털 KDIC 예금자보호 금융상품 API 키

로컬에서는 `.env.local` 파일을 만들고 아래처럼 넣으세요:

```
KDIC_SERVICE_KEY=YOUR_KEY
```

Vercel 배포 시: Project → Settings → Environment Variables 에 같은 키로 등록.

## 데이터 소스

- **실시간**: `/app/api/products/route.ts` 가 KDIC API를 호출합니다.
- **대체**: `data/KDIC_예금자보호_금융상품_전체목록.csv` 가 존재하면 API 실패 시 CSV를 사용합니다.

## 참고

- App Router(Next 14), TypeScript, Tailwind, Recharts, Framer Motion, Lucide React
- 데모는 목데이터 계좌를 사용하며, 마이데이터 연동은 추후 스위치로 연결
