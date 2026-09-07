import type { Point, Series } from "./types";

export type Mode = "normalized" | "actual";

export function cutoffFor(range: string): string | null {
  const now = new Date();
  const years: Record<string, number> = { "1y": 1, "2y": 2, "3y": 3, "5y": 5 };
  const n = years[range];
  if (!n) return null;
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - n);
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
  const digits = series.kind === "memory" ? 2 : 2;
  return `$${value.toFixed(digits)}`;
}
