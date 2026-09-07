#!/usr/bin/env node
/**
 * TrendForce 고정거래가(contract price)를 긁어 data/memory-contract.csv 에
 * 반영한다. 현물가와 달리 반월/월 단위로 결정되는 값이라 CSV도 별도다.
 *
 *   node scripts/fetch-trendforce.mjs               # 수집 후 CSV 갱신
 *   node scripts/fetch-trendforce.mjs --dry-run     # 파싱 결과만 출력
 *   node scripts/fetch-trendforce.mjs --dump-dir debug/   # 원본 HTML 저장
 *   node scripts/fetch-trendforce.mjs --html debug/dram.html --category DRAM
 *
 * 페이지 구조 (2026-09 기준):
 *   한 페이지에 현물가·고정거래가 표가 함께 있고, 각 표 바로 앞에
 *   "DRAM Contract Price (2H Jul) ... Last Update 2026-07-31 15:00 (GMT+8)"
 *   형태의 제목과 기준일이 붙는다. 대표값은 spot 과 마찬가지로
 *   **Session Average** 열이다.
 *
 * 품목명을 미리 열거하지 않고 'Contract Price' 섹션의 모든 행을 가져온다.
 * TrendForce 가 품목을 추가해도 자동으로 따라간다.
 *
 * 상세 표(회원 전용)는 공개되지 않으므로, 공개 표가 보여주는 기간까지만
 * 수집한다. 공개 표는 최신 확정치보다 한 주기 뒤처져 있을 수 있다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = path.join(ROOT, "data", "memory-contract.csv");
const MAP_PATH = path.join(ROOT, "scripts", "trendforce-map.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? true : undefined;
}
const DRY_RUN = process.argv.includes("--dry-run");

function cellText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleText(html) {
  return cellText(html.replace(/<script[\s\S]*?<\/script>/gi, " "));
}

/** "DDR4 8Gb 1Gx8" → "CONTRACT_DRAM_DDR4_8Gb_1Gx8" */
export function slugify(category, item) {
  const body = item
    .replace(/[()]/g, " ")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `CONTRACT_${category}_${body}`;
}

export function parse(html, category) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  const found = [];
  const sections = [];

  for (const table of tables) {
    // 표 바로 앞 구간에 제목과 기준일이 있다. 다만 이 구간은 사이드바 메뉴까지
    // 닿을 수 있어서 "Contract Price 가 어딘가 있다"만으로는 현물가 표를 고정
    // 거래가로 오인한다. 표에 **가장 가까운** 제목이 이기게 한다.
    const lead = visibleText(html.slice(Math.max(0, table.index - 1400), table.index));
    const headings = [...lead.matchAll(/([A-Za-z0-9 ]{0,24}?)(Spot|Contract)\s+Price(?:\s*\(([^)]{1,24})\))?/gi)];
    const nearest = headings.at(-1);
    if (!nearest || !/contract/i.test(nearest[2])) continue;

    const title = `${nearest[1].trim()} ${nearest[2]} Price`.trim();
    // 기간 표기는 제목에 붙는다: "DRAM Contract Price (2H Jul)".
    const period = headings.map((h) => h[3]).filter(Boolean).at(-1)?.trim() ?? "";

    const dateMatch = [...lead.matchAll(/Last Update\s*(\d{4})-(\d{2})-(\d{2})/gi)].pop();
    if (!dateMatch) continue;
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

    const rows = (table[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [])
      .map((tr) => (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText))
      .filter((cells) => cells.length > 1);

    const header = rows.find((r) => /^item$/i.test(r[0]));
    if (!header) continue;

    // 열 위치를 상수로 박지 않는다. High 를 대표값으로 착각하는 사고를 막는다.
    let priceIdx = header.findIndex((h) => /^session average$/i.test(h));
    if (priceIdx < 0) priceIdx = header.findIndex((h) => /average/i.test(h) && !/change/i.test(h));
    if (priceIdx < 0) continue;

    let n = 0;
    for (const cells of rows) {
      if (cells === header) continue;
      const item = cells[0];
      const price = Number(String(cells[priceIdx] ?? "").replace(/[$,\s]/g, ""));
      if (!item || !Number.isFinite(price) || price <= 0) continue;
      found.push({ date, series: slugify(category, item), price, unit: "USD", source: "trendforce", period, item });
      n++;
    }
    sections.push(`${title}${period ? ` (${period})` : ""} · ${date} · ${n}건`);
  }
  return { found, sections };
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines.shift() ?? "date,series,price,unit,source,period";
  const cols = header.split(",").map((c) => c.trim());
  const rows = lines.map((l) => {
    const c = l.split(",").map((v) => v.trim());
    const row = {};
    cols.forEach((name, i) => (row[name] = c[i] ?? ""));
    row.price = Number(row.price);
    return row;
  });
  return { header, cols, rows };
}

function serializeCsv(header, cols, rows) {
  const body = rows
    .map((r) => cols.map((c) => (c === "price" ? Number(r.price).toFixed(3) : (r[c] ?? ""))).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

async function main() {
  const config = JSON.parse(await readFile(MAP_PATH, "utf8"));
  const dumpDir = arg("--dump-dir");
  const htmlFile = arg("--html");

  const pages =
    typeof htmlFile === "string"
      ? [{ id: path.basename(htmlFile, ".html"), category: arg("--category") ?? "DRAM", file: htmlFile }]
      : config.pages;

  const all = [];
  const problems = [];

  for (const page of pages) {
    let html;
    try {
      if (page.file) {
        html = await readFile(page.file, "utf8");
      } else {
        const res = await fetch(page.url, {
          headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        html = await res.text();
      }
    } catch (err) {
      problems.push(`${page.url ?? page.file}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    if (typeof dumpDir === "string") {
      const dir = path.resolve(ROOT, dumpDir);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${page.id}.html`), html, "utf8");
    }

    const { found, sections } = parse(html, page.category);
    console.log(`${page.id} (${page.category}):`);
    for (const s of sections) console.log(`  · ${s}`);
    if (found.length === 0) problems.push(`${page.url ?? page.file}: Contract Price 표를 찾지 못했습니다`);
    all.push(...found);
  }

  for (const p of problems) console.warn(`  (문제) ${p}`);

  if (all.length === 0) {
    console.error("고정거래가를 한 건도 수집하지 못했습니다.");
    process.exitCode = 1;
    return;
  }

  for (const f of all) console.log(`  ${f.date}  ${f.series}  ${f.price}  ← "${f.item}"`);

  if (DRY_RUN || typeof dumpDir === "string") return;

  const { header, cols, rows } = parseCsv(await readFile(CSV_PATH, "utf8"));
  const index = new Map(rows.map((r, i) => [`${r.date}|${r.series}`, i]));
  for (const f of all) {
    const row = { date: f.date, series: f.series, price: f.price, unit: f.unit, source: f.source, period: f.period };
    const at = index.get(`${f.date}|${f.series}`);
    if (at === undefined) {
      index.set(`${f.date}|${f.series}`, rows.length);
      rows.push(row);
    } else {
      rows[at] = row;
    }
  }

  rows.sort((a, b) => a.series.localeCompare(b.series) || a.date.localeCompare(b.date));
  await writeFile(CSV_PATH, serializeCsv(header, cols, rows), "utf8");
  console.log(`data/memory-contract.csv 갱신 (총 ${rows.length}행)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
