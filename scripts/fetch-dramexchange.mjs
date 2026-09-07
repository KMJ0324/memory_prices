#!/usr/bin/env node
/**
 * DRAMeXchange 현물가를 긁어 data/memory-spot.csv 에 하루치 행으로 반영한다.
 *
 *   node scripts/fetch-dramexchange.mjs                # 수집 후 CSV 갱신
 *   node scripts/fetch-dramexchange.mjs --dry-run      # 파싱 결과만 출력
 *   node scripts/fetch-dramexchange.mjs --html page.html   # 저장해둔 HTML로 파싱 (오프라인 디버깅)
 *   node scripts/fetch-dramexchange.mjs --dump raw.html    # 받아온 HTML을 파일로 저장
 *   node scripts/fetch-dramexchange.mjs --drop-placeholders # 시드 샘플(PLACEHOLDER) 행 제거
 *
 * 품목명이 하나도 매칭되지 않으면 0이 아닌 코드로 종료한다. 조용히 빈 커밋을
 * 남기는 것보다 CI가 빨간 게 낫다.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = path.join(ROOT, "data", "memory-spot.csv");
const MAP_PATH = path.join(ROOT, "scripts", "dramexchange-map.json");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? true : undefined;
}
const DRY_RUN = process.argv.includes("--dry-run");
const DROP_PLACEHOLDERS = process.argv.includes("--drop-placeholders");

/** Cheap tag-stripper: the page is plain server-rendered HTML tables. */
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

/** Every <tr> on the page, as arrays of cell strings. */
function extractRows(html) {
  const rows = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText);
    if (cells.length > 1) rows.push(cells);
  }
  return rows;
}

/**
 * Spot tables put the item name first and several numeric columns after it
 * (price, change, high/low). The first plain number in a sane price range is
 * the one we want; percentages and signed changes are skipped.
 */
function priceFrom(cells) {
  for (const cell of cells.slice(1)) {
    if (/%/.test(cell)) continue;
    if (/^[+-]/.test(cell)) continue;
    const m = cell.match(/^\$?\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 10000) return n;
  }
  return null;
}

/** DRAMeXchange stamps the quote date on the page; fall back to today (UTC). */
function pageDate(html) {
  const m = html.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }
  return new Date().toISOString().slice(0, 10);
}

export function parse(html, items) {
  const rows = extractRows(html);
  const date = pageDate(html);
  const found = [];
  const seen = new Set();

  for (const item of items) {
    const re = new RegExp(item.match, "i");
    for (const cells of rows) {
      if (!re.test(cells[0])) continue;
      const price = priceFrom(cells);
      if (price == null) continue;
      if (seen.has(item.id)) break;
      seen.add(item.id);
      found.push({ date, series: item.id, price, unit: item.unit, source: "dramexchange" });
      break;
    }
  }
  return { date, found, labels: rows.map((r) => r[0]).filter(Boolean) };
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
    .map((r) => [r.date, r.series, Number(r.price).toFixed(2), r.unit, r.source].join(","))
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

  const { date, found, labels } = parse(html, config.items);

  if (found.length === 0) {
    console.error("품목을 하나도 찾지 못했습니다. scripts/dramexchange-map.json 의 match 를 확인하세요.");
    console.error("페이지에서 발견한 첫 열 값 (상위 40개):");
    for (const l of [...new Set(labels)].slice(0, 40)) console.error(`  - ${l}`);
    process.exitCode = 1;
    return;
  }

  console.log(`기준일 ${date} · ${found.length}개 품목 수집`);
  for (const f of found) console.log(`  ${f.series}: ${f.price} ${f.unit}`);

  const missing = config.items.filter((i) => !found.some((f) => f.series === i.id));
  for (const m of missing) console.warn(`  (미수집) ${m.id}`);

  if (DRY_RUN) return;

  const { header, rows } = parseCsv(await readFile(CSV_PATH, "utf8"));
  const kept = DROP_PLACEHOLDERS ? rows.filter((r) => r.source !== "PLACEHOLDER") : rows;

  // Upsert on (date, series) so re-running the job the same day is idempotent.
  const index = new Map(kept.map((r, i) => [`${r.date}|${r.series}`, i]));
  for (const f of found) {
    const key = `${f.date}|${f.series}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, kept.length);
      kept.push(f);
    } else {
      kept[at] = f;
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
