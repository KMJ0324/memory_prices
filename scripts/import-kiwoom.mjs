#!/usr/bin/env node
/**
 * 텔레그램 '키움 반도체' 채널 내보내기(HTML)에서 일별 메모리 스팟 가격을 뽑아
 * data/memory-spot.csv 에 과거 시계열로 백필한다.
 *
 *   node scripts/import-kiwoom.mjs <export.html>
 *   node scripts/import-kiwoom.mjs <export.html> --dry-run
 *
 * 채널은 매일 아침 이런 형태로 올린다:
 *   ▶ DRAM Spot Market Today
 *   2)주요 제품 가격
 *    DDR4 16Gb $67.5(1D +0.7%, 2W +7.8%, 1M +15.9%)
 *
 * 일별 자동 수집 대상이 아니라 **수동 백필용**이다. 채널 내보내기를 다시 받으면
 * 같은 명령으로 최신분까지 채울 수 있다.
 *
 * 합치기 규칙: 이미 다른 출처(dramexchange/cfm)의 행이 있는 (날짜, 계열)은
 * 건드리지 않는다. 1차 출처가 항상 우선이고, 키움 행은 빈 과거를 메울 뿐이다.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = path.join(ROOT, "data", "memory-spot.csv");
const MAP_PATH = path.join(ROOT, "scripts", "kiwoom-map.json");

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const DRY_RUN = process.argv.includes("--dry-run");

function unescapeHtml(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** "16 June 2026, 07:33:57" → "2026-06-16" */
function parseDate(title) {
  const m = title.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function parse(html, items) {
  // 메시지 단위로 잘라야 날짜와 가격이 엇갈리지 않는다.
  const blocks = html.split(/(?=<div class="message default)/).slice(1);
  const found = [];
  const seen = new Set();

  for (const block of blocks) {
    const titleMatch = block.match(/<div class="pull_right date details" title="([^"]+)"/);
    if (!titleMatch) continue;
    const date = parseDate(titleMatch[1]);
    if (!date) continue;

    const text = unescapeHtml(block.replace(/<[^>]+>/g, "\n")).replace(/[ \t]+/g, " ");

    for (const item of items) {
      // 품목명 바로 뒤의 "$숫자(" 만 잡는다. "Spot Premium +69%" 같은 줄은 걸린다.
      const re = new RegExp(`^\\s*${item.match}\\s*\\$\\s*([0-9]+(?:\\.[0-9]+)?)\\s*\\(`, "m");
      const m = text.match(re);
      if (!m) continue;

      const price = Number(m[1]);
      if (!Number.isFinite(price) || price <= 0) continue;

      const key = `${date}|${item.id}`;
      if (seen.has(key)) continue; // 하루에 여러 번 올라오면 첫 포스트만
      seen.add(key);
      found.push({ date, series: item.id, price });
    }
  }
  return found;
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
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("사용법: node scripts/import-kiwoom.mjs <export.html> [--dry-run]");
    process.exit(1);
  }

  const config = JSON.parse(await readFile(MAP_PATH, "utf8"));
  const html = await readFile(file, "utf8");
  const found = parse(html, config.items);

  if (found.length === 0) {
    console.error("가격을 하나도 찾지 못했습니다. scripts/kiwoom-map.json 의 match 를 확인하세요.");
    process.exit(1);
  }

  const { header, rows } = parseCsv(await readFile(CSV_PATH, "utf8"));
  const existing = new Map(rows.map((r, i) => [`${r.date}|${r.series}`, i]));

  let added = 0;
  let keptPrimary = 0;
  let replaced = 0;

  for (const f of found) {
    const key = `${f.date}|${f.series}`;
    const at = existing.get(key);
    const row = { date: f.date, series: f.series, price: f.price, unit: "USD", source: "kiwoom" };

    if (at === undefined) {
      existing.set(key, rows.length);
      rows.push(row);
      added++;
    } else if (rows[at].source === "kiwoom") {
      rows[at] = row; // 같은 내보내기를 다시 돌려도 결과가 같도록
      replaced++;
    } else {
      keptPrimary++; // 1차 출처가 이미 있으면 그대로 둔다
    }
  }

  const stats = new Map();
  for (const f of found) stats.set(f.series, (stats.get(f.series) ?? 0) + 1);
  for (const [series, n] of stats) {
    const dates = found.filter((f) => f.series === series).map((f) => f.date).sort();
    console.log(`  ${series}: ${n}행 (${dates[0]} ~ ${dates.at(-1)})`);
  }
  console.log(`\n신규 ${added}행, 갱신 ${replaced}행, 1차 출처 우선으로 건너뜀 ${keptPrimary}행`);

  if (DRY_RUN) return;

  rows.sort((a, b) => a.series.localeCompare(b.series) || a.date.localeCompare(b.date));
  await writeFile(CSV_PATH, serializeCsv(header, rows), "utf8");
  console.log(`data/memory-spot.csv 갱신 (총 ${rows.length}행)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
