import { NextResponse } from "next/server";
import { TICKERS } from "@/lib/tickers";
import type { Point, Series, SeriesResponse } from "@/lib/types";

export const revalidate = 900;

const RANGES = new Set(["1y", "2y", "3y", "5y", "10y", "max"]);

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: { currency?: string };
      timestamp?: number[];
      indicators?: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote?: Array<{ close?: (number | null)[] }> };
    }>;
    error?: { description?: string } | null;
  };
}

function toIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

async function fetchOne(symbol: string, range: string): Promise<{ points: Point[]; currency?: string }> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=1d&events=div%2Csplit`;

  const res = await fetch(url, {
    // Yahoo rejects the default fetch UA outright.
    headers: { "User-Agent": "Mozilla/5.0 (compatible; memory-prices/0.1)" },
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`Yahoo Finance ${res.status}`);

  const json = (await res.json()) as YahooChart;
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(json.chart?.error?.description ?? "빈 응답");

  const stamps = result.timestamp ?? [];
  // Adjusted close keeps splits from showing up as fake crashes in the overlay.
  const closes = result.indicators?.adjclose?.[0]?.adjclose ?? result.indicators?.quote?.[0]?.close ?? [];

  const points: Point[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const value = closes[i];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    points.push({ date: toIsoDate(stamps[i]), value });
  }
  return { points, currency: result.meta?.currency };
}

export async function GET(request: Request): Promise<NextResponse<SeriesResponse>> {
  const rangeParam = new URL(request.url).searchParams.get("range") ?? "5y";
  const range = RANGES.has(rangeParam) ? rangeParam : "5y";

  const warnings: string[] = [];
  const settled = await Promise.allSettled(TICKERS.map((t) => fetchOne(t.symbol, range)));

  const series: Series[] = [];
  settled.forEach((outcome, i) => {
    const ticker = TICKERS[i];
    if (outcome.status === "rejected") {
      warnings.push(
        `${ticker.label}(${ticker.symbol}) 주가를 불러오지 못했습니다: ` +
          (outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)),
      );
      return;
    }
    if (outcome.value.points.length === 0) {
      warnings.push(`${ticker.label}(${ticker.symbol}) 응답에 유효한 종가가 없습니다.`);
      return;
    }
    const currency = outcome.value.currency ?? ticker.currency;
    series.push({
      id: ticker.id,
      label: ticker.label,
      kind: "stock",
      currency,
      unit: currency === "KRW" ? "원" : "달러",
      source: `Yahoo Finance (${ticker.symbol})`,
      points: outcome.value.points,
    });
  });

  return NextResponse.json({ series, warnings });
}
