import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "메모리 가격 & 메모리 주가 비교",
  description:
    "DRAM·NAND 현물가·고정거래가와 삼성전자·삼성전자우·SK하이닉스·SK하이닉스 ADR·마이크론 주가를 한 차트에서 비교합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
