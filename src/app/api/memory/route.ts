import { NextResponse } from "next/server";
import { readMemoryCsv } from "@/lib/csv";
import type { Series, SeriesResponse } from "@/lib/types";

export const revalidate = 3600;

/**
 * DRAM/NAND spot prices.
 *
 * There is no free public feed for these, so the route has two backends:
 *  1. `MEMORY_API_URL` — an external endpoint (paid or in-house) that returns
 *     the same `{ series: Series[] }` shape. Used when the env var is set.
 *  2. `data/memory-spot.csv` — the hand-maintained fallback that ships with the repo.
 */
export async function GET(): Promise<NextResponse<SeriesResponse>> {
  const warnings: string[] = [];
  const remote = process.env.MEMORY_API_URL;

  if (remote) {
    try {
      const res = await fetch(remote, {
        headers: process.env.MEMORY_API_KEY
          ? { Authorization: `Bearer ${process.env.MEMORY_API_KEY}` }
          : undefined,
        next: { revalidate: 3600 },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as { series?: Series[] };
      if (!Array.isArray(json.series)) throw new Error("응답에 series 배열이 없습니다");
      return NextResponse.json({ series: json.series, warnings });
    } catch (err) {
      warnings.push(
        `MEMORY_API_URL 호출 실패로 CSV로 대체했습니다: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  try {
    const series = await readMemoryCsv();
    if (series.some((s) => s.source === "PLACEHOLDER")) {
      warnings.push(
        "DRAM/NAND 현물가가 검증되지 않은 샘플(PLACEHOLDER) 값입니다. data/memory-spot.csv 를 실제 시세로 교체하세요.",
      );
    }
    return NextResponse.json({ series, warnings });
  } catch (err) {
    warnings.push(
      `data/memory-spot.csv 를 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json({ series: [], warnings }, { status: 200 });
  }
}
