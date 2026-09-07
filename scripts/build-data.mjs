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
  DRAM_DDR5_16Gb_4800: "DDR5 16Gb 4800/5600",
  DRAM_DDR5_16Gb_eTT: "DDR5 16Gb eTT",
  DRAM_DDR4_8Gb_3200: "DDR4 8Gb 3200",
  DRAM_DDR4_8Gb_eTT: "DDR4 8Gb eTT",
  NAND_512Gb_TLC: "NAND 512Gb TLC",
  NAND_128Gb_TLC: "NAND 128Gb TLC",
};

const YEARS = Number(process.env.STOCK_YEARS ?? 6);

// ---------------------------------------------------------------- 주가

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function cutoff() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - YEARS);
  return d;
}

function cutoffDate() {
  return cutoff().toISOString().slice(0, 10);
}

function ymd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * 네이버 금융(국내). GitHub Actions 러너 IP에서도 열려 있어 1순위로 쓴다.
 * 응답은 작은따옴표를 쓰는 JS 배열 리터럴이라 그대로는 JSON.parse 가 안 된다.
 *   [['날짜','시가','고가','저가','종가','거래량','외국인소진율'],
 *    ["20260904", 55700, 56400, 55600, 56100, 12993228, 55.77], ...]
 */
async function fromNaverDomestic(ticker) {
  const code = ticker.symbol.split(".")[0];
  const url =
    `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1` +
    `&startTime=${ymd(cutoff())}&endTime=${ymd(new Date())}&timeframe=day`;

  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://finance.naver.com/" } });
  if (!res.ok) throw new Error(`네이버 ${res.status} ${res.statusText}`);

  const text = (await res.text()).trim();
  let rows;
  try {
    rows = JSON.parse(text.replace(/'/g, '"'));
  } catch {
    throw new Error(`예상 밖 응답: ${text.slice(0, 60)}`);
  }
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("데이터 없음");

  const header = rows[0].map(String);
  const iDate = header.findIndex((h) => h.includes("날짜"));
  const iClose = header.findIndex((h) => h.includes("종가"));
  if (iDate < 0 || iClose < 0) throw new Error(`헤더를 알 수 없습니다: ${header.join(",")}`);

  const points = [];
  for (const row of rows.slice(1)) {
    const raw = String(row[iDate] ?? "");
    const value = Number(row[iClose]);
    if (!/^\d{8}$/.test(raw) || !Number.isFinite(value) || value <= 0) continue;
    points.push({ date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`, value });
  }
  if (points.length === 0) throw new Error("유효한 종가가 없습니다");
  return { points, currency: "KRW", via: "네이버 금융" };
}

/** 네이버 금융(해외). 마이크론 같은 미국 상장 종목용. */
async function fromNaverForeign(ticker) {
  if (!ticker.naver) throw new Error("네이버 해외 심볼이 없습니다");

  const url =
    `https://api.stock.naver.com/chart/foreign/item/${encodeURIComponent(ticker.naver)}/day` +
    `?startDateTime=${ymd(cutoff())}0000&endDateTime=${ymd(new Date())}0000`;

  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://m.stock.naver.com/" } });
  if (!res.ok) throw new Error(`네이버 해외 ${res.status} ${res.statusText}`);

  const json = await res.json();
  const rows = Array.isArray(json) ? json : (json?.priceInfos ?? json?.result ?? []);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`예상 밖 응답: ${JSON.stringify(json).slice(0, 80)}`);
  }

  const points = [];
  for (const row of rows) {
    const raw = String(row.localDate ?? row.localDateTime ?? row.date ?? "").slice(0, 8);
    const value = Number(row.closePrice ?? row.close ?? row.tradePrice);
    if (!/^\d{8}$/.test(raw) || !Number.isFinite(value) || value <= 0) continue;
    points.push({ date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`, value });
  }
  if (points.length === 0) throw new Error("유효한 종가가 없습니다");
  return { points, currency: "USD", via: "네이버 금융" };
}

/**
 * Stooq: 키 없는 무료 CSV. 데이터센터 IP에서는 봇 차단 HTML을 주는 일이 있어
 * 네이버 다음 순번이다. 응답은 Date,Open,High,Low,Close,Volume 형식이다.
 */
async function fromStooq(ticker) {
  if (!ticker.stooq) throw new Error("stooq 심볼이 없습니다");

  const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker.stooq)}&i=d`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Stooq ${res.status} ${res.statusText}`);

  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const header = (lines.shift() ?? "").split(",").map((h) => h.trim().toLowerCase());
  const iDate = header.indexOf("date");
  const iClose = header.indexOf("close");
  // 심볼이 없으면 Stooq 는 200 에 "No data" 본문을 준다.
  if (iDate < 0 || iClose < 0) throw new Error(`예상 밖 응답: ${text.slice(0, 60)}`);

  const from = cutoffDate();
  const points = [];
  for (const line of lines) {
    const c = line.split(",");
    const date = c[iDate];
    const value = Number(c[iClose]);
    if (!date || date < from || !Number.isFinite(value) || value <= 0) continue;
    points.push({ date, value: Math.round(value * 100) / 100 });
  }
  if (points.length === 0) throw new Error("기간 내 유효한 종가가 없습니다");
  return { points, currency: ticker.currency, via: "Stooq" };
}

async function fromYahoo(ticker) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.symbol)}` +
    `?range=${YEARS}y&interval=1d`;

  const res = await fetch(url, { headers: { "User-Agent": UA } });
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
  return { points, currency: result.meta?.currency ?? ticker.currency, via: "Yahoo Finance" };
}

async function fetchTicker(ticker) {
  const errors = [];
  // 순서가 곧 신뢰도 순. 앞의 소스가 러너 IP에서 막히면 다음으로 넘어간다.
  const chain =
    ticker.currency === "KRW"
      ? [fromNaverDomestic, fromStooq, fromYahoo]
      : [fromNaverForeign, fromStooq, fromYahoo];

  for (const source of chain) {
    try {
      const { points, currency, via } = await source(ticker);
      return {
        id: ticker.id,
        label: ticker.label,
        kind: "stock",
        currency,
        unit: currency === "KRW" ? "원" : "달러",
        source: `${via} (${ticker.symbol})`,
        points,
      };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors.join(" / "));
}

async function buildStocks(tickers) {
  const warnings = [];
  const settled = await Promise.allSettled(tickers.map(fetchTicker));
  const series = [];

  settled.forEach((outcome, i) => {
    const t = tickers[i];
    if (outcome.status === "fulfilled") {
      series.push(outcome.value);
      const p = outcome.value.points;
      console.log(
        `  ${t.label}: ${p.length}일  ${p[0].date}~${p.at(-1).date}  ` +
          `${p[0].value}→${p.at(-1).value}  via ${outcome.value.source}`,
      );
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

  // 실패했을 때가 오히려 더 알아야 할 때이므로 가드보다 먼저 쓴다. 배포된 데이터가 무엇이었는지 리포에서 되짚을 수 있게 남기는 작은 감사 로그.
  const summarize = (s) => ({
    id: s.id,
    source: s.source,
    count: s.points.length,
    first: s.points[0],
    last: s.points.at(-1),
  });
  await writeFile(
    path.join(ROOT, "data", "last-build.json"),
    JSON.stringify(
      {
        generatedAt,
        stocks: stocks.series.map(summarize),
        memory: memory.series.map(summarize),
        warnings: [...stocks.warnings, ...memory.warnings],
      },
      null,
      2,
    ) + "\n",
  );


  // 한 종목이라도 실패하는 건 화면에 경고로 뜨면 되지만, 한 축이 통째로 비면
  // 겹쳐 볼 게 없다. 반쪽짜리를 새로 배포하느니 직전 배포를 그대로 두는 게 낫다.
  if (stocks.series.length === 0) {
    console.error("주가를 한 종목도 받지 못했습니다. 배포를 중단합니다.");
    process.exit(1);
  }
  if (memory.series.length === 0) {
    console.error("현물가 계열이 하나도 없습니다. 배포를 중단합니다.");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "stocks.json"), JSON.stringify({ ...stocks, generatedAt }));
  await writeFile(path.join(OUT_DIR, "memory.json"), JSON.stringify({ ...memory, generatedAt }));

  console.log(`\npublic/data/*.json 생성 완료 (${generatedAt})`);

}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
