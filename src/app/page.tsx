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
  { id: "3m", label: "3개월" },
  { id: "6m", label: "6개월" },
  { id: "1y", label: "1년" },
  { id: "2y", label: "2년" },
  { id: "3y", label: "3년" },
  { id: "5y", label: "5년" },
  { id: "max", label: "전체" },
];

export default function Home() {
  const [range, setRange] = useState("3m");
  const [mode, setMode] = useState<Mode>("normalized");
  const [all, setAll] = useState<Series[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    // Static JSON built daily by scripts/build-data.mjs, served from the same
    // origin — no CORS, and the page keeps working with no backend.
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const load = (name: string) =>
      fetch(`${base}/data/${name}.json`).then((r) => {
        if (!r.ok) throw new Error(`${name}.json ${r.status}`);
        return r.json() as Promise<SeriesResponse & { generatedAt?: string }>;
      });

    Promise.all([load("stocks"), load("memory")])
      .then(([stocks, memory]) => {
        if (cancelled) return;
        const merged = [...memory.series, ...stocks.series];
        setAll(merged);
        // 품목이 많아 전부 켜면 읽을 수 없다. featured 로 지정된 것만 켠다.
        // 주가는 종목 수가 적으므로 항상 켜둔다.
        setHidden(
          new Set(merged.filter((s) => s.kind !== "stock" && !s.featured).map((s) => s.id)),
        );
        setWarnings([...memory.warnings, ...stocks.warnings]);
        setGeneratedAt(stocks.generatedAt ?? memory.generatedAt);
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
  }, []);

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
  const contractSeries = all.filter((s) => s.kind === "contract");
  const stockSeries = all.filter((s) => s.kind === "stock");
  const contractOrder = contractSeries.map((s) => s.id);

  // 같은 제공처를 종목 수만큼 늘어놓지 않는다: "네이버 금융 (005930.KS)" → "네이버 금융".
  const providers = (list: Series[]) => [
    ...new Set(list.map((s) => s.source.replace(/\s*\(.*\)\s*$/, "").trim()).filter(Boolean)),
  ];
  const stockSource = providers(stockSeries).join(", ");
  const memorySource = providers(memorySeries).join(", ");
  const contractSource = providers(contractSeries).join(", ");

  // 수집을 막 시작해 점이 몇 개뿐이면 그 사실을 화면에서 밝힌다.
  const memoryStart =
    memorySeries.length > 0 && Math.max(...memorySeries.map((s) => s.points.length)) < 20
      ? memorySeries.map((s) => s.points[0]?.date).filter(Boolean).sort()[0]
      : undefined;

  return (
    <main className="page">
      <header className="header">
        <h1>메모리 가격 &amp; 메모리 주가 비교</h1>
        <p className="sub">
          DRAM · NAND 현물가와 고정거래가를 삼성전자 · 삼성전자우 · SK하이닉스 · SK하이닉스 ADR · 마이크론 주가와 한 차트에서 비교합니다.
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
        <SeriesToggles
          title="현물가"
          items={memorySeries}
          hidden={hidden}
          onToggle={toggle}
          contractOrder={contractOrder}
        />
        <SeriesToggles
          title="고정거래가"
          items={contractSeries}
          hidden={hidden}
          onToggle={toggle}
          contractOrder={contractOrder}
        />
        <SeriesToggles
          title="주가"
          items={stockSeries}
          hidden={hidden}
          onToggle={toggle}
          contractOrder={contractOrder}
        />
      </section>

      {status === "ready" && visible.every((s) => s.points.length === 0) ? (
        <div className="chart chart--loading">
          이 기간에 표시할 데이터가 없습니다. 기간을 늘리거나 data/memory-spot.csv 를 최신 시세로 갱신하세요.
        </div>
      ) : (
          <Chart series={visible} mode={mode} contractOrder={contractOrder} />
      )}

      <footer className="footer">
        <p>
          {generatedAt && (
            <>
              데이터 갱신: {new Date(generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST) · 매일 자동 갱신
              <br />
            </>
          )}
          {stockSource && `주가: ${stockSource}`}
          {stockSource && memorySource && " · "}
          {memorySource && `현물가: ${memorySource}`}
          {memorySource && contractSource && " · "}
          {contractSource && `고정거래가: ${contractSource}`}
        </p>
        {memoryStart && (
          <p className="muted">
            현물가는 {memoryStart}부터 수집을 시작해 하루씩 쌓입니다. DRAMeXchange 는 당일
            시세만 공개하고 과거 시계열을 제공하지 않습니다.
          </p>
        )}
        <p className="muted">
          현물가(점선)는 매일 거래되는 시장가, 고정거래가(실선)는 공급사와 고객이
          기간 단위로 정하는 계약가입니다. TrendForce 공개 표는 상세가 회원 전용이라
          최신 확정치보다 한 주기 뒤처질 수 있습니다.
        </p>
        <p className="muted">
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
  contractOrder,
}: {
  title: string;
  items: Series[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  contractOrder: string[];
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
            <i style={{ background: colorFor(s, contractOrder) }} />
            {s.label}
            {s.source === "PLACEHOLDER" && <sup aria-label="샘플 데이터">*</sup>}
          </button>
        );
      })}
    </div>
  );
}
