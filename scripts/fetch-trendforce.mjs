#!/usr/bin/env node
/**
 * TrendForce 고정거래가(contract price)를 긁어 data/memory-contract.csv 에
 * 월별 행으로 반영한다. 현물가와 달리 월 단위로 결정되는 값이라 CSV도 별도다.
 *
 *   node scripts/fetch-trendforce.mjs --dry-run
 *   node scripts/fetch-trendforce.mjs --dump-dir debug/
 *   node scripts/fetch-trendforce.mjs --html debug/dram_contract.html
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_PATH = path.join(ROOT, "scripts", "trendforce-map.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? true : undefined;
}

export async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`TrendForce ${res.status} ${res.statusText}`);
  return res.text();
}

/** 구조 파악용 덤프. 파서를 쓰기 전에 실제 표가 어떻게 생겼는지 봐야 한다. */
async function dumpAll(config, dir) {
  await mkdir(dir, { recursive: true });
  for (const page of config.pages) {
    try {
      const html = await fetchPage(page.url);
      const file = path.join(dir, `${page.id}.html`);
      await writeFile(file, html, "utf8");
      console.log(`  OK   ${page.url} → ${file} (${html.length}바이트)`);
    } catch (err) {
      console.warn(`  FAIL ${page.url} — ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main() {
  const config = JSON.parse(await readFile(MAP_PATH, "utf8"));
  const dumpDir = arg("--dump-dir");
  if (typeof dumpDir === "string") {
    await dumpAll(config, path.resolve(ROOT, dumpDir));
    return;
  }
  console.log("파서는 아직 준비 중입니다. --dump-dir 로 구조를 먼저 확인하세요.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
