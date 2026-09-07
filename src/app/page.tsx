"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { colorFor } from "@/lib/tickers";
import { cutoffFor, prepare, type Mode } from "@/lib/normalize";
import type { Series, SeriesResponse } from "@/lib/types";

// ECharts touches `window` at import time, so it must not run during SSR.
const Chart = dynamic(() => import("@/components/Chart"), {
  ssr: false,
  loading: () => <div className="chart chart--loading">차트를 불러오는 중…</div>,
});

const RANGES = [
  { id: "1y", label: "1년" },
  { id: "3y", label: "3년" },
  { id: "5y", label: "5년" },
  { id: "10y", label: "10년" },
  { id: "max", label: "전체" },
];

export default function Home() {
  const [range, setRange] = useState("5y");
  const [mode, setMode] = useState<Mode>("normalized");
  const [all, setAll] = useState<Series[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    Promise.all([
      fetch(`/api/stocks?range=${range}`).then((r) => r.json() as Promise<SeriesResponse>),
      fetch("/api/memory").then((r) => r.json() as Promise<SeriesResponse>),
    ])
      .then(([stocks, memory]) => {
        if (cancelled) return;
        setAll([...memory.series, ...stocks.series]);
        setWarnings([...memory.warnings, ...stocks.warnings]);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [range]);

  const visible = useMemo(
    () => prepare(all.filter((s) => !hidden.has(s.id)), cutoffFor(range), mode),
    [all, hidden, range, mode],
  );

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const latest = useMemo(() => {
    const dates = all
      .filter((s) => s.kind === "memory")
      .map((s) => s.points.at(-1)?.date)
      .filter((d): d is string => Boolean(d));
    return dates.length > 0 ? dates.sort().at(-1) : undefined;
  }, [all]);

  const memorySeries = all.filter((s) => s.kind === "memory");
  const stockSeries = all.filter((s) => s.kind === "stock");

  return (
    <main className="page">
      <header className="header">
        <h1>메모리 현물가 &amp; 반도체 주가</h1>
        <p className="sub">
          DRAM · NAND 현물가와 삼성전자 · 삼성전자우 · SK하이닉스 · 마이크론 주가를 한 차트에서 비교합니다.
        </p>
      </header>

      {warnings.length > 0 && (
        <div className="banner banner--warn" role="status">
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {status === "error" && (
        <div className="banner banner--error" role="alert">
          데이터를 불러오지 못했습니다: {error}
        </div>
      )}

      <section className="controls">
        <div className="control-group" role="group" aria-label="기간 선택">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`chip ${range === r.id ? "chip--on" : ""}`}
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="control-group" role="group" aria-label="표시 방식">
          <button
            type="button"
            className={`chip ${mode === "normalized" ? "chip--on" : ""}`}
            onClick={() => setMode("normalized")}
            aria-pressed={mode === "normalized"}
          >
            기준일 = 100
          </button>
          <button
            type="button"
            className={`chip ${mode === "actual" ? "chip--on" : ""}`}
            onClick={() => setMode("actual")}
            aria-pressed={mode === "actual"}
          >
            실제 가격
          </button>
        </div>
      </section>

      <section className="legend">
        <SeriesToggles title="현물가" items={memorySeries} hidden={hidden} onToggle={toggle} />
        <SeriesToggles title="주가" items={stockSeries} hidden={hidden} onToggle={toggle} />
      </section>

      {status === "ready" && visible.every((s) => s.points.length === 0) ? (
        <div className="chart chart--loading">
          이 기간에 표시할 데이터가 없습니다. 기간을 늘리거나 data/memory-spot.csv 를 최신 시세로 갱신하세요.
        </div>
      ) : (
        <Chart series={visible} mode={mode} />
      )}

      <footer className="footer">
        <p>
          주가: Yahoo Finance 수정종가 · 현물가:{" "}
          {memorySeries.some((s) => s.source === "PLACEHOLDER")
            ? "data/memory-spot.csv (샘플 값, 점선으로 표시)"
            : memorySeries.map((s) => s.source).join(", ") || "-"}
        </p>
        <p className="muted">
          {latest && `최신 현물가 기준일: ${latest}. `}
          {mode === "actual"
            ? "실제 가격 모드에서는 통화·단위가 달라 축이 분리됩니다. 시계열 모양 비교에는 기준일=100 모드가 적합합니다."
            : "각 계열의 화면 내 첫 값을 100으로 환산한 상대 지수입니다."}
        </p>
      </footer>
    </main>
  );
}

function SeriesToggles({
  title,
  items,
  hidden,
  onToggle,
}: {
  title: string;
  items: Series[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="legend-group">
      <span className="legend-title">{title}</span>
      {items.map((s) => {
        const off = hidden.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            className={`swatch ${off ? "swatch--off" : ""}`}
            onClick={() => onToggle(s.id)}
            aria-pressed={!off}
            title={s.source === "PLACEHOLDER" ? "검증되지 않은 샘플 데이터" : s.source}
          >
            <i style={{ background: colorFor(s) }} />
            {s.label}
            {s.source === "PLACEHOLDER" && <sup aria-label="샘플 데이터">*</sup>}
          </button>
        );
      })}
    </div>
  );
}
