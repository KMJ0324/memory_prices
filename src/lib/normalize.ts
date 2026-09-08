import type { Point, Series } from "./types";

export type Mode = "normalized" | "actual";

const MONTHS_BACK: Record<string, number> = {
  "3m": 3,
  "6m": 6,
  "1y": 12,
  "2y": 24,
  "3y": 36,
  "5y": 60,
};

export function cutoffFor(range: string): string | null {
  const n = MONTHS_BACK[range];
  if (!n) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export function clip(points: Point[], cutoff: string | null): Point[] {
  if (!cutoff) return points;
  return points.filter((p) => p.date >= cutoff);
}

/**
 * Rebase a series so its first visible point is 100. This is what makes a KRW
 * share price, a USD share price and a USD chip price comparable on one axis.
 */
export function rebase(points: Point[]): Point[] {
  const base = points.find((p) => Number.isFinite(p.value) && p.value !== 0)?.value;
  if (base === undefined) return points;
  return points.map((p) => ({ date: p.date, value: (p.value / base) * 100 }));
}

export function prepare(series: Series[], cutoff: string | null, mode: Mode): Series[] {
  return series.map((s) => {
    const points = clip(s.points, cutoff);
    return { ...s, points: mode === "normalized" ? rebase(points) : points };
  });
}

export function formatValue(value: number, series: Series, mode: Mode): string {
  if (mode === "normalized") return value.toFixed(1);
  if (series.currency === "KRW") return `${Math.round(value).toLocaleString("ko-KR")}원`;
  if (series.currency === "JPY") return `${Math.round(value).toLocaleString("ko-KR")}엔`;
  return `$${value.toFixed(2)}`;
}
