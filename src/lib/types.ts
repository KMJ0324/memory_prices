export type SeriesKind = "memory" | "stock";

/** A single point on a time series. `date` is an ISO `YYYY-MM-DD` string. */
export interface Point {
  date: string;
  value: number;
}

export interface Series {
  /** Stable id used in URLs, toggles and chart state. */
  id: string;
  label: string;
  kind: SeriesKind;
  /** "USD" | "KRW" — decides which axis group and which tooltip suffix is used. */
  currency: string;
  unit: string;
  /** Where the numbers came from. `PLACEHOLDER` marks unverified demo data. */
  source: string;
  points: Point[];
}

export interface SeriesResponse {
  series: Series[];
  /** Non-fatal problems (a ticker that failed, a missing CSV) surfaced in the UI. */
  warnings: string[];
}
