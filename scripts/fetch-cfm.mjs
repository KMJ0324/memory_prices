#!/usr/bin/env node
/**
 * ChinaFlashMarket(CFM) NAND 웨이퍼 현물가를 data/memory-spot.csv 에 반영한다.
 * DRAMeXchange 와는 별개 출처이므로 source 열이 "cfm" 으로 구분된다.
 *
 *   node scripts/fetch-cfm.mjs --dump-dir debug/
 *   node scripts/fetch-cfm.mjs --dry-run
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_PATH = path.join(ROOT, "scripts", "cfm-map.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? true : undefined;
}

async function main() {
  const config = JSON.parse(await readFile(MAP_PATH, "utf8"));
  const res = await fetch(config.source, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`CFM ${res.status} ${res.statusText}`);
  const html = await res.text();

  const dumpDir = arg("--dump-dir");
  if (typeof dumpDir === "string") {
    const dir = path.resolve(ROOT, dumpDir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "cfm_nandflash.html"), html, "utf8");
    console.log(`저장: ${dir}/cfm_nandflash.html (${html.length}바이트)`);
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
