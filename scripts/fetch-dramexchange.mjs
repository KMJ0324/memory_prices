#!/usr/bin/env node
/**
 * DRAMeXchange 현물가를 긁어 data/memory-spot.csv 에 하루치 행으로 반영한다.
 *
 *   node scripts/fetch-dramexchange.mjs                # 수집 후 CSV 갱신
 *   node scripts/fetch-dramexchange.mjs --dry-run      # 파싱 결과만 출력
 *   node scripts/fetch-dramexchange.mjs --html page.html   # 저장해둔 HTML로 파싱 (오프라인 디버깅)
 *   node scripts/fetch-dramexchange.mjs --dump raw.html    # 받아온 HTML을 파일로 저장
 *
 * 페이지 구조 (2026-09 기준):
 *   각 현물가 표는 헤더행이
 *     Item | Daily/Weekly High | Low | Session High | Session Low | Session Average | Change | History
 *   이고, 대표 시세는 **Session Average** 열이다. 표 바로 앞에
 *   "Last Update: Sep.7 2026 11:00 (GMT+8)" 형태로 기준일이 붙는다.
 *
 * 열 위치를 상수로 박지 않고 헤더 이름으로 찾고, 값이 상식적인 범위를 벗어나면
 * 버린다. 아무것도 못 찾으면 0이 아닌 코드로 종료한다 — 조용히 틀린 값을
 * 커밋하는 것이 가장 나쁜 실패 모드이기 때문이다.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = path.join(ROOT, "data", "memory-spot.csv");
const MAP_PATH = path.join(ROOT, "scripts", "dramexchange-map.json");

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? true : undefined;
}
const DRY_RUN = process.argv.includes("--dry-run");
const DROP_PLACEHOLDERS = process.argv.includes("--drop-placeholders");

function cellText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function rowsOf(tableHtml) {
  return (tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [])
    .map((tr) => (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText))
    .filter((cells) => cells.length > 1);
}

/** "Last Update: Sep.7 2026 11:00 (GMT+8)" → "2026-09-07". */
function parseLastUpdate(text) {
  const m = text.match(/Last Update:?\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2}),?\s*(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

export function parse(html, config) {
  // 표마다 기준일이 다르다(예: GDDR/LPDDR 표는 며칠 묵어 있음). 표 바로 앞의
  // "Last Update" 를 그 표의 기준일로 쓴다.
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  const wanted = config.priceColumn ?? "Session Average";
  const found = [];
  const labels = [];
  const rejected = [];
  const taken = new Set();

  for (const table of tables) {
    const rows = rowsOf(table[0]);
    if (rows.length === 0) continue;

    const header = rows.find((r) => /^item$/i.test(r[0]));
    if (!header) continue;

    let priceIdx = header.findIndex((h) => h.toLowerCase() === wanted.toLowerCase());
    if (priceIdx < 0) priceIdx = header.findIndex((h) => /average/i.test(h) && !/change/i.test(h));
    if (priceIdx < 0) continue;

    const date = parseLastUpdate(html.slice(0, table.index).slice(-2000)) ?? parseLastUpdate(html);

    for (const cells of rows) {
      if (cells === header) continue;
      labels.push(cells[0]);

      for (const item of config.items) {
        if (taken.has(item.id)) continue;
        if (!new RegExp(item.match, "i").test(cells[0])) continue;

        const price = Number(String(cells[priceIdx] ?? "").replace(/[$,\s]/g, ""));
        if (!Number.isFinite(price) || price <= 0) {
          rejected.push(`${item.id}: "${cells[priceIdx]}" 는 숫자가 아닙니다`);
          continue;
        }
        if ((item.min != null && price < item.min) || (item.max != null && price > item.max)) {
          rejected.push(`${item.id}: ${price} 가 허용 범위(${item.min}~${item.max})를 벗어납니다`);
          continue;
        }
        taken.add(item.id);
        found.push({ date, series: item.id, price, unit: "USD", source: "dramexchange", label: cells[0] });
      }
    }
  }
  return { found, labels, rejected };
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines.shift() ?? "date,series,price,unit,source";
  const rows = lines.map((l) => {
    const [date, series, price, unit, source] = l.split(",").map((v) => v.trim());
    return { date, series, price: Number(price), unit, source };
  });
  return { header, rows };
}

function serializeCsv(header, rows) {
  const body = rows
    .map((r) => [r.date, r.series, Number(r.price).toFixed(3), r.unit, r.source].join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

async function main() {
  const config = JSON.parse(await readFile(MAP_PATH, "utf8"));
  const htmlFile = arg("--html");

  let html;
  if (typeof htmlFile === "string") {
    html = await readFile(htmlFile, "utf8");
  } else {
    const res = await fetch(config.source, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`DRAMeXchange ${res.status} ${res.statusText}`);
    html = await res.text();
  }

  const dumpFile = arg("--dump");
  if (typeof dumpFile === "string") await writeFile(dumpFile, html, "utf8");

  const { found, labels, rejected } = parse(html, config);

  for (const r of rejected) console.warn(`  (버림) ${r}`);

  if (found.length === 0) {
    console.error("품목을 하나도 찾지 못했습니다. scripts/dramexchange-map.json 을 확인하세요.");
    console.error("페이지에서 발견한 품목명 (상위 40개):");
    for (const l of [...new Set(labels)].slice(0, 40)) console.error(`  - ${l}`);
    process.exitCode = 1;
    return;
  }

  for (const f of found) console.log(`  ${f.date}  ${f.series}  ${f.price}  ← "${f.label}"`);
  for (const m of config.items.filter((i) => !found.some((f) => f.series === i.id))) {
    console.warn(`  (미수집) ${m.id}`);
  }

  if (DRY_RUN) return;

  const { header, rows } = parseCsv(await readFile(CSV_PATH, "utf8"));
  const kept = DROP_PLACEHOLDERS ? rows.filter((r) => r.source !== "PLACEHOLDER") : rows;

  // Upsert on (date, series) so re-running the job the same day is idempotent.
  const index = new Map(kept.map((r, i) => [`${r.date}|${r.series}`, i]));
  for (const f of found) {
    const row = { date: f.date, series: f.series, price: f.price, unit: f.unit, source: f.source };
    const at = index.get(`${f.date}|${f.series}`);
    if (at === undefined) {
      index.set(`${f.date}|${f.series}`, kept.length);
      kept.push(row);
    } else {
      kept[at] = row;
    }
  }

  kept.sort((a, b) => a.series.localeCompare(b.series) || a.date.localeCompare(b.date));
  await writeFile(CSV_PATH, serializeCsv(header, kept), "utf8");
  console.log(`data/memory-spot.csv 갱신 (총 ${kept.length}행)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
