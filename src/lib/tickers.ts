import tickers from "../../data/tickers.json";
import type { Series } from "./types";

export interface TickerDef {
  id: string;
  /** 소스별 심볼. 후보를 순차 시도할 수 있게 배열도 받는다. */
  symbol: string | string[];
  stooq?: string | string[];
  naver?: string | string[];
  label: string;
  currency: string;
  color: string;
  /** 못 받아와도 화면 경고를 띄우지 않는 종목. */
  optional?: boolean;
}

/** Shared with `scripts/build-data.mjs` so the app and the cron job can't drift. */
export const TICKERS: TickerDef[] = tickers as TickerDef[];

export const MEMORY_COLORS: Record<string, string> = {
  DRAM_DDR5_16Gb_4800: "#f28f3b",
  DRAM_DDR5_16Gb_eTT: "#f7b267",
  DRAM_DDR4_16Gb_3200: "#e8743b",
  DRAM_DDR4_16Gb_eTT: "#ffab7a",
  DRAM_DDR4_8Gb_3200: "#f2c14e",
  DRAM_DDR4_8Gb_eTT: "#ffd97d",
  NAND_512Gb_TLC: "#c05dd6",
  NAND_128Gb_TLC: "#9b6bd6",
  NAND_1Tb_TLC_CFM: "#7c5cd6",
  NAND_1Tb_QLC_CFM: "#a78bfa",
};

/** DRAMeXchange 품목명 그대로. eTT 는 미검사 커모디티 다이, 숫자는 스펙 등급. */
export const MEMORY_LABELS: Record<string, string> = {
  DRAM_DDR5_16Gb_4800: "DDR5 16Gb 4800/5600",
  DRAM_DDR5_16Gb_eTT: "DDR5 16Gb eTT",
  DRAM_DDR4_16Gb_3200: "DDR4 16Gb 3200",
  DRAM_DDR4_16Gb_eTT: "DDR4 16Gb eTT",
  DRAM_DDR4_8Gb_3200: "DDR4 8Gb 3200",
  DRAM_DDR4_8Gb_eTT: "DDR4 8Gb eTT",
  NAND_512Gb_TLC: "NAND 512Gb TLC Wafer",
  NAND_128Gb_TLC: "NAND 128Gb TLC Wafer",
  NAND_1Tb_TLC_CFM: "NAND 1Tb TLC Wafer (CFM)",
  NAND_1Tb_QLC_CFM: "NAND 1Tb QLC Wafer (CFM)",
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
