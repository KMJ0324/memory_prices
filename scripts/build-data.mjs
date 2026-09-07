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
const CONTRACT_CSV_PATH = path.join(ROOT, "data", "memory-contract.csv");
const TRENDFORCE_MAP = path.join(ROOT, "scripts", "trendforce-map.json");

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

/**
 * 네이버 금융(해외). 마이크론 같은 미국 상장 종목용.
 * 접미사가 거래소마다 달라(.O 나스닥, .N 뉴욕 …) 심볼을 배열로 줄 수 있다.
 */
async function fromNaverForeign(ticker) {
  const candidates = [ticker.naver].flat().filter(Boolean);
  if (candidates.length === 0) throw new Error("네이버 해외 심볼이 없습니다");

  const errors = [];
  for (const symbol of candidates) {
    try {
      return await naverForeignOnce(ticker, symbol);
    } catch (err) {
      errors.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(errors.join("; "));
}

async function naverForeignOnce(ticker, symbol) {
  const url =
    `https://api.stock.naver.com/chart/foreign/item/${encodeURIComponent(symbol)}/day` +
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
  return { points, currency: "USD", via: `네이버 금융 ${symbol}` };
}

/**
 * Stooq: 키 없는 무료 CSV. 데이터센터 IP에서는 봇 차단 HTML을 주는 일이 있어
 * 네이버 다음 순번이다. 응답은 Date,Open,High,Low,Close,Volume 형식이다.
 */
async function fromStooq(ticker) {
  const candidates = [ticker.stooq].flat().filter(Boolean);
  if (candidates.length === 0) throw new Error("stooq 심볼이 없습니다");

  const errors = [];
  for (const symbol of candidates) {
    try {
      return await stooqOnce(ticker, symbol);
    } catch (err) {
      errors.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(errors.join("; "));
}

async function stooqOnce(ticker, symbol) {
  const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`, {
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
  return { points, currency: ticker.currency, via: `Stooq ${symbol}` };
}

/**
 * Yahoo 는 러너 IP에 429 를 자주 낸다. 호스트를 바꿔가며 몇 번 시도한다 —
 * 네이버가 커버하지 않는 OTC ADR 같은 종목에는 이쪽이 유일한 통로다.
 */
async function fromYahoo(ticker) {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  const symbols = [ticker.symbol].flat().filter(Boolean);
  const errors = [];

  for (const symbol of symbols) {
    for (let attempt = 0; attempt < hosts.length * 2; attempt++) {
      const host = hosts[attempt % hosts.length];
      try {
        return await yahooOnce(ticker, host, symbol);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${symbol}@${host}: ${msg}`);
        if (!/429/.test(msg)) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw new Error(errors.join("; "));
}

async function yahooOnce(ticker, host, symbol) {
  const url =
    `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
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
  return { points, currency: result.meta?.currency ?? ticker.currency, via: `Yahoo Finance ${symbol}` };
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
        source: `${via} (${[ticker.symbol].flat()[0]})`,
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
  const optionalFailures = [];
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
      // optional 종목(현재 무료 소스로 못 받는 OTC ADR 등)은 화면 경고를 띄우지
      // 않는다. 상시 경고가 붙은 페이지를 남에게 공유하게 되기 때문이다.
      // 사유는 data/last-build.json 에 그대로 남는다.
      if (!t.optional) warnings.push(`${t.label}(${t.symbol}) 주가를 불러오지 못했습니다: ${msg}`);
      else optionalFailures.push(`${t.label}(${[t.symbol].flat()[0]}): ${msg}`);
      console.warn(`  ${t.label} (${t.symbol}): 실패 — ${msg}`);
    }
  });

  return { series, warnings, optionalFailures };
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

// ---------------------------------------------------- 고정거래가

/** "CONTRACT_DRAM_DDR4_8Gb_1Gx8" → "고정 DDR4 8Gb 1Gx8" */
function contractLabel(id, labels) {
  if (labels[id]) return labels[id];
  const body = id.replace(/^CONTRACT_(DRAM|NAND)_/, "").replace(/_/g, " ");
  return `고정 ${body}`;
}

async function buildContract() {
  const warnings = [];
  let config = { featured: [], labels: {} };
  try {
    config = JSON.parse(await readFile(TRENDFORCE_MAP, "utf8"));
  } catch {
    /* 매핑이 없으면 라벨만 자동 생성된다 */
  }

  let rows;
  try {
    rows = parseCsv(await readFile(CONTRACT_CSV_PATH, "utf8"));
  } catch (err) {
    warnings.push(
      `data/memory-contract.csv 를 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { series: [], warnings };
  }

  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.series);
    if (list) list.push(row);
    else grouped.set(row.series, [row]);
  }

  const featured = new Set(config.featured ?? []);
  const series = [];
  for (const [id, list] of grouped) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    series.push({
      id,
      label: contractLabel(id, config.labels ?? {}),
      kind: "contract",
      currency: "USD",
      unit: list[0]?.unit ?? "USD",
      source: "TrendForce",
      featured: featured.has(id),
      points: list.map((r) => ({ date: r.date, value: r.price })),
    });
    console.log(`  ${id}: ${list.length}행 (${list[0].date} ~ ${list.at(-1).date})`);
  }

  // featured 가 하나도 없으면 아무것도 안 보이는 화면이 된다 — 앞의 몇 개를 켠다.
  if (series.length > 0 && !series.some((s) => s.featured)) {
    for (const s of series.slice(0, 3)) s.featured = true;
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
  console.log("고정거래가 수집:");
  const contract = await buildContract();

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
        contract: contract.series.map(summarize),
        warnings: [...stocks.warnings, ...memory.warnings, ...contract.warnings],
        optionalFailures: stocks.optionalFailures ?? [],
      },
      null,
      2,
    ) + "\n",
  );


  // 한 종목이라도 실패하는 건 화면에 경고로 뜨면 되지만, 한 축이 통째로 비면
  // 겹쳐 볼 게 없다. 반쪽짜리를 새로 배포하느니 직전 배포를 그대로 두는 게 낫다.
  // 로컬에서는 주가 소스가 막혀 있을 수 있다. 화면만 확인할 때 쓰는 우회.
  const skipGuard = process.env.SKIP_DATA_GUARD === "1";
  if (stocks.series.length === 0 && !skipGuard) {
    console.error("주가를 한 종목도 받지 못했습니다. 배포를 중단합니다.");
    process.exit(1);
  }
  if (memory.series.length === 0 && contract.series.length === 0 && !skipGuard) {
    console.error("현물가·고정거래가가 모두 비었습니다. 배포를 중단합니다.");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "stocks.json"), JSON.stringify({ ...stocks, generatedAt }));
  await writeFile(
    path.join(OUT_DIR, "memory.json"),
    JSON.stringify({
      series: [...memory.series, ...contract.series],
      warnings: [...memory.warnings, ...contract.warnings],
      generatedAt,
    }),
  );

  console.log(`\npublic/data/*.json 생성 완료 (${generatedAt})`);

}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
