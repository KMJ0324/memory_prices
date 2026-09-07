#!/usr/bin/env node
/**
 * 사이트가 읽을 정적 데이터 파일을 만든다.
 *
 *   public/data/stocks.json   Yahoo Finance 수정종가 (10년)
 *   public/data/memory.json   data/memory-spot.csv 또는 MEMORY_API_URL
 *
 * GitHub Actions 러너에서 하루 한 번 돌린다. 브라우저는 같은 오리진의 JSON만
 * 읽으므로 CORS 문제가 없고, 사이트 자체는 완전한 정적 파일이 된다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "data");
const CSV_PATH = path.join(ROOT, "data", "memory-spot.csv");

const MEMORY_LABELS = {
  DRAM_DDR4_8Gb: "DRAM DDR4 8Gb 현물가",
  DRAM_DDR5_16Gb: "DRAM DDR5 16Gb 현물가",
  NAND_512Gb_TLC: "NAND 512Gb TLC 현물가",
  NAND_128Gb_MLC: "NAND 128Gb MLC 현물가",
};

const RANGE = process.env.STOCK_RANGE ?? "10y";

// ---------------------------------------------------------------- 주가

async function fetchTicker(ticker) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.symbol)}` +
    `?range=${RANGE}&interval=1d`;

  const res = await fetch(url, {
    // Yahoo rejects the default fetch UA outright.
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Yahoo Finance ${res.status} ${res.statusText}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description ?? "빈 응답");

  const stamps = result.timestamp ?? [];
  // Adjusted close keeps splits from showing up as fake crashes in the overlay.
  const closes =
    result.indicators?.adjclose?.[0]?.adjclose ?? result.indicators?.quote?.[0]?.close ?? [];

  const points = [];
  for (let i = 0; i < stamps.length; i++) {
    const v = closes[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    points.push({
      date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
      value: Math.round(v * 100) / 100,
    });
  }
  if (points.length === 0) throw new Error("유효한 종가가 없습니다");

  const currency = result.meta?.currency ?? ticker.currency;
  return {
    id: ticker.id,
    label: ticker.label,
    kind: "stock",
    currency,
    unit: currency === "KRW" ? "원" : "달러",
    source: `Yahoo Finance (${ticker.symbol})`,
    points,
  };
}

async function buildStocks(tickers) {
  const warnings = [];
  const settled = await Promise.allSettled(tickers.map(fetchTicker));
  const series = [];

  settled.forEach((outcome, i) => {
    const t = tickers[i];
    if (outcome.status === "fulfilled") {
      series.push(outcome.value);
      console.log(`  ${t.label} (${t.symbol}): ${outcome.value.points.length}일`);
    } else {
      const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      warnings.push(`${t.label}(${t.symbol}) 주가를 불러오지 못했습니다: ${msg}`);
      console.warn(`  ${t.label} (${t.symbol}): 실패 — ${msg}`);
    }
  });

  return { series, warnings };
}

// -------------------------------------------------------------- 현물가

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.startsWith("#"));
  const cols = (lines.shift() ?? "").split(",").map((c) => c.trim());
  const at = (name) => cols.indexOf(name);
  const iDate = at("date");
  const iSeries = at("series");
  const iPrice = at("price");
  const iUnit = at("unit");
  const iSource = at("source");
  if (iDate < 0 || iSeries < 0 || iPrice < 0) {
    throw new Error("memory-spot.csv 에 date, series, price 컬럼이 필요합니다");
  }

  const rows = [];
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

async function buildMemory() {
  const warnings = [];
  const remote = process.env.MEMORY_API_URL;

  if (remote) {
    try {
      const res = await fetch(remote, {
        headers: process.env.MEMORY_API_KEY
          ? { Authorization: `Bearer ${process.env.MEMORY_API_KEY}` }
          : undefined,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      if (!Array.isArray(json.series)) throw new Error("응답에 series 배열이 없습니다");
      console.log(`  외부 엔드포인트에서 ${json.series.length}개 계열`);
      return { series: json.series, warnings };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`MEMORY_API_URL 호출 실패로 CSV로 대체했습니다: ${msg}`);
      console.warn(`  외부 엔드포인트 실패 — ${msg}`);
    }
  }

  const rows = parseCsv(await readFile(CSV_PATH, "utf8"));
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.series);
    if (list) list.push(row);
    else grouped.set(row.series, [row]);
  }

  const series = [];
  for (const [id, list] of grouped) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    // A series is only as trustworthy as its least-verified row.
    const sources = [...new Set(list.map((r) => r.source).filter(Boolean))];
    series.push({
      id,
      label: MEMORY_LABELS[id] ?? id,
      kind: "memory",
      currency: "USD",
      unit: list[0]?.unit ?? "",
      source: sources.includes("PLACEHOLDER") ? "PLACEHOLDER" : sources.join(", ") || "unknown",
      points: list.map((r) => ({ date: r.date, value: r.price })),
    });
    console.log(`  ${id}: ${list.length}행 (${list[0].date} ~ ${list.at(-1).date})`);
  }

  if (series.some((s) => s.source === "PLACEHOLDER")) {
    warnings.push(
      "DRAM/NAND 현물가가 검증되지 않은 샘플(PLACEHOLDER) 값입니다. data/memory-spot.csv 를 실제 시세로 교체하세요.",
    );
  }
  return { series, warnings };
}

// ---------------------------------------------------------------- main

async function main() {
  const tickers = JSON.parse(await readFile(path.join(ROOT, "data", "tickers.json"), "utf8"));
  const generatedAt = new Date().toISOString();

  console.log("주가 수집:");
  const stocks = await buildStocks(tickers);
  console.log("현물가 수집:");
  const memory = await buildMemory();

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "stocks.json"), JSON.stringify({ ...stocks, generatedAt }));
  await writeFile(path.join(OUT_DIR, "memory.json"), JSON.stringify({ ...memory, generatedAt }));

  console.log(`\npublic/data/*.json 생성 완료 (${generatedAt})`);

  // 전부 실패했으면 배포할 게 없다 — 조용히 빈 사이트를 올리지 않는다.
  if (stocks.series.length === 0 && memory.series.length === 0) {
    console.error("주가·현물가 모두 비어 있습니다.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
