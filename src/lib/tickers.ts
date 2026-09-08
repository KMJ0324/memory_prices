import tickers from "../../data/tickers.json";
import dramexchange from "../../scripts/dramexchange-map.json";
import cfm from "../../scripts/cfm-map.json";
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

interface MemoryItem {
  id: string;
  label?: string;
  color?: string;
}

/**
 * 현물가 계열의 라벨·색상은 수집 매핑(scripts/*-map.json)에 있다. 앱과 수집
 * 스크립트가 같은 파일을 읽으므로 계열을 추가해도 한쪽만 갱신되는 일이 없다.
 */
const MEMORY_ITEMS: MemoryItem[] = [...dramexchange.items, ...cfm.items];

export const MEMORY_COLORS: Record<string, string> = Object.fromEntries(
  MEMORY_ITEMS.filter((i) => i.color).map((i) => [i.id, i.color as string]),
);

export const MEMORY_LABELS: Record<string, string> = Object.fromEntries(
  MEMORY_ITEMS.filter((i) => i.label).map((i) => [i.id, i.label as string]),
);

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
