import tickers from "../../data/tickers.json";
import type { Series } from "./types";

export interface TickerDef {
  id: string;
  /** Yahoo Finance symbol. */
  symbol: string;
  label: string;
  currency: string;
  color: string;
}

/** Shared with `scripts/build-data.mjs` so the app and the cron job can't drift. */
export const TICKERS: TickerDef[] = tickers;

export const MEMORY_COLORS: Record<string, string> = {
  DRAM_DDR5_16Gb_4800: "#f28f3b",
  DRAM_DDR5_16Gb_eTT: "#f7b267",
  DRAM_DDR4_8Gb_3200: "#f2c14e",
  DRAM_DDR4_8Gb_eTT: "#ffd97d",
  NAND_512Gb_TLC: "#c05dd6",
  NAND_128Gb_TLC: "#9b6bd6",
};

/** DRAMeXchange 품목명 그대로. eTT 는 미검사 커모디티 다이, 숫자는 스펙 등급. */
export const MEMORY_LABELS: Record<string, string> = {
  DRAM_DDR5_16Gb_4800: "DDR5 16Gb 4800/5600",
  DRAM_DDR5_16Gb_eTT: "DDR5 16Gb eTT",
  DRAM_DDR4_8Gb_3200: "DDR4 8Gb 3200",
  DRAM_DDR4_8Gb_eTT: "DDR4 8Gb eTT",
  NAND_512Gb_TLC: "NAND 512Gb TLC",
  NAND_128Gb_TLC: "NAND 128Gb TLC",
};

/** 고정거래가는 품목이 자동 발견되므로 팔레트를 순서대로 돌려 쓴다. */
export const CONTRACT_PALETTE = [
  "#2ec4b6",
  "#22a1c4",
  "#6fd8cf",
  "#1b7f9e",
  "#86e3d8",
  "#0e7490",
  "#3fb0c9",
];

export function colorFor(s: Series, contractOrder: string[] = []): string {
  if (s.kind === "stock") {
    return TICKERS.find((t) => t.id === s.id)?.color ?? "#888";
  }
  if (s.kind === "contract") {
    const i = contractOrder.indexOf(s.id);
    return CONTRACT_PALETTE[(i < 0 ? 0 : i) % CONTRACT_PALETTE.length];
  }
  return MEMORY_COLORS[s.id] ?? "#888";
}
