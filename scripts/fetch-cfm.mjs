#!/usr/bin/env node
/**
 * ChinaFlashMarket(CFM) NAND 웨이퍼 현물가를 data/memory-spot.csv 에 반영한다.
 * DRAMeXchange 와 다른 출처이므로 source 열이 "cfm" 으로 구분되고, 같은 품목이라도
 * 시세가 다르다(예: 512Gb TLC — DRAMeXchange $20.71 vs CFM $22.00).
 *
 *   node scripts/fetch-cfm.mjs                    # 수집 후 CSV 갱신
 *   node scripts/fetch-cfm.mjs --dry-run          # 파싱 결과만 출력
 *   node scripts/fetch-cfm.mjs --dump-dir debug/  # 원본 HTML 저장
 *   node scripts/fetch-cfm.mjs --html debug/cfm_nandflash.html --dry-run
 *
 * 페이지 구조 (2026-09 기준):
 *   표 헤더가 产品 | 当前价 | 涨跌额 | 涨跌幅 | 前收盘 | 日高点 | 日低点 | 走势
 *   이고 대표값은 **当前价**(현재가). 표 바로 앞에 "$ 美元 2026-09-07 14:30"
 *   형태로 기준일이 붙는다. 로그인해야 보이는 표가 따로 있으나 공개 표만 쓴다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = path.join(ROOT, "data", "memory-spot.csv");
const MAP_PATH = path.join(ROOT, "scripts", "cfm-map.json");

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
    .replace(/\s+/g, " ")
    .trim();
}

function visibleText(html) {
  return cellText(html.replace(/<script[\s\S]*?<\/script>/gi, " "));
}

export function parse(html, items) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  const found = [];
  const labels = [];
  const rejected = [];
  const taken = new Set();

  for (const table of tables) {
    const rows = (table[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [])
      .map((tr) => (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText))
      .filter((cells) => cells.length > 1);

    const header = rows.find((r) => r.some((c) => /产品|Product/i.test(c)));
    if (!header) continue;

    // 열 위치를 상수로 박지 않는다. 前收盘(전일종가)이나 日高点(고가)을
    // 현재가로 착각하면 조용히 틀린 값이 들어간다.
    let priceIdx = header.findIndex((h) => /当前价|Current/i.test(h));
    if (priceIdx < 0) continue;

    const lead = visibleText(html.slice(Math.max(0, table.index - 800), table.index));
    const dateMatch = [...lead.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].pop();
    if (!dateMatch) {
      rejected.push("표 앞에서 기준일을 찾지 못했습니다");
      continue;
    }
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

    for (const cells of rows) {
      if (cells === header) continue;
      labels.push(cells[0]);

      for (const item of items) {
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
        found.push({ date, series: item.id, price, unit: "USD", source: "cfm", item: cells[0] });
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
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!res.ok) throw new Error(`CFM ${res.status} ${res.statusText}`);
    html = await res.text();
  }

  const dumpDir = arg("--dump-dir");
  if (typeof dumpDir === "string") {
    const dir = path.resolve(ROOT, dumpDir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "cfm_nandflash.html"), html, "utf8");
  }

  const { found, labels, rejected } = parse(html, config.items);
  for (const r of rejected) console.warn(`  (버림) ${r}`);

  if (found.length === 0) {
    console.error("CFM 품목을 하나도 찾지 못했습니다. scripts/cfm-map.json 을 확인하세요.");
    console.error("페이지에서 발견한 품목명:");
    for (const l of [...new Set(labels)].slice(0, 30)) console.error(`  - ${l}`);
    process.exitCode = 1;
    return;
  }

  for (const f of found) console.log(`  ${f.date}  ${f.series}  ${f.price}  ← "${f.item}"`);
  for (const m of config.items.filter((i) => !found.some((f) => f.series === i.id))) {
    console.warn(`  (미수집) ${m.id}`);
  }

  if (DRY_RUN) return;

  const { header, rows } = parseCsv(await readFile(CSV_PATH, "utf8"));
  const index = new Map(rows.map((r, i) => [`${r.date}|${r.series}`, i]));
  for (const f of found) {
    const row = { date: f.date, series: f.series, price: f.price, unit: f.unit, source: f.source };
    const at = index.get(`${f.date}|${f.series}`);
    if (at === undefined) {
      index.set(`${f.date}|${f.series}`, rows.length);
      rows.push(row);
    } else {
      rows[at] = row;
    }
  }

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
