import type { Series } from "./types";

export interface TickerDef {
  /** Yahoo Finance symbol. */
  symbol: string;
  id: string;
  label: string;
  currency: string;
  color: string;
}

export const TICKERS: TickerDef[] = [
  { symbol: "005930.KS", id: "samsung", label: "삼성전자", currency: "KRW", color: "#4c8dff" },
  { symbol: "005935.KS", id: "samsung-pref", label: "삼성전자우", currency: "KRW", color: "#8fb8ff" },
  { symbol: "000660.KS", id: "hynix", label: "SK하이닉스", currency: "KRW", color: "#e0426b" },
  { symbol: "MU", id: "micron", label: "마이크론", currency: "USD", color: "#4cd1a1" },
];

export const MEMORY_COLORS: Record<string, string> = {
  DRAM_DDR4_8Gb: "#f2c14e",
  DRAM_DDR5_16Gb: "#f28f3b",
  NAND_512Gb_TLC: "#c05dd6",
  NAND_128Gb_MLC: "#9b6bd6",
};

export const MEMORY_LABELS: Record<string, string> = {
  DRAM_DDR4_8Gb: "DRAM DDR4 8Gb 현물가",
  DRAM_DDR5_16Gb: "DRAM DDR5 16Gb 현물가",
  NAND_512Gb_TLC: "NAND 512Gb TLC 현물가",
  NAND_128Gb_MLC: "NAND 128Gb MLC 현물가",
};

export function colorFor(s: Series): string {
  if (s.kind === "stock") {
    return TICKERS.find((t) => t.id === s.id)?.color ?? "#888";
  }
  return MEMORY_COLORS[s.id] ?? "#888";
}
