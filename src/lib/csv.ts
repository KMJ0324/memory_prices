import { readFile } from "node:fs/promises";
import path from "node:path";
import { MEMORY_LABELS } from "./tickers";
import type { Point, Series } from "./types";

const CSV_PATH = path.join(process.cwd(), "data", "memory-spot.csv");

interface Row {
  date: string;
  series: string;
  price: number;
  unit: string;
  source: string;
}

/**
 * Minimal CSV reader for `data/memory-spot.csv`. The file is hand-maintained,
 * so it stays a plain `date,series,price,unit,source` sheet with no quoting.
 */
function parse(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.startsWith("#"));
  const header = lines.shift();
  if (!header) return [];

  const cols = header.split(",").map((c) => c.trim());
  const idx = (name: string) => cols.indexOf(name);
  const iDate = idx("date");
  const iSeries = idx("series");
  const iPrice = idx("price");
  const iUnit = idx("unit");
  const iSource = idx("source");
  if (iDate < 0 || iSeries < 0 || iPrice < 0) {
    throw new Error("memory-spot.csv must have date, series and price columns");
  }

  const rows: Row[] = [];
  for (const line of lines) {
    const c = line.split(",").map((v) => v.trim());
    const price = Number(c[iPrice]);
    if (!c[iDate] || !c[iSeries] || !Number.isFinite(price)) continue;
    rows.push({
      date: c[iDate],
      series: c[iSeries],
      price,
      unit: iUnit >= 0 ? c[iUnit] ?? "" : "",
      source: iSource >= 0 ? c[iSource] ?? "" : "",
    });
  }
  return rows;
}

export async function readMemoryCsv(): Promise<Series[]> {
  const text = await readFile(CSV_PATH, "utf8");
  const rows = parse(text);

  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const list = grouped.get(row.series);
    if (list) list.push(row);
    else grouped.set(row.series, [row]);
  }

  const out: Series[] = [];
  for (const [id, list] of grouped) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const points: Point[] = list.map((r) => ({ date: r.date, value: r.price }));
    // A series is only as trustworthy as its least-verified row.
    const sources = [...new Set(list.map((r) => r.source).filter(Boolean))];
    out.push({
      id,
      label: MEMORY_LABELS[id] ?? id,
      kind: "memory",
      currency: "USD",
      unit: list[0]?.unit ?? "",
      source: sources.includes("PLACEHOLDER") ? "PLACEHOLDER" : sources.join(", ") || "unknown",
      points,
    });
  }
  return out;
}
