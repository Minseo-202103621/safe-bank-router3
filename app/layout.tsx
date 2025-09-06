import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SafeBank Router — Demo",
  description: "예금자보호 커버리지 계산 + AI 라우팅 데모",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
