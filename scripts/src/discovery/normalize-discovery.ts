#!/usr/bin/env node
/**
 * Normalize raw Overture snapshots (data/discovery/raw/*.overture.json)
 * into reviewable discovery files (data/discovery/<area>.json).
 *
 * Pure local step: no network, no Firestore. Closed and clearly irrelevant
 * POIs are dropped with counts; everything kept is faithful Overture
 * content — never converted to production Place records here.
 *
 * Usage:
 *   npm run discovery:normalize -w @glimmr/scripts -- [--raw-dir <path>] [--out-dir <path>] [--dry-run]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOvertureSnapshot } from "./overture";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_RAW_DIR = path.join(REPO_ROOT, "data", "discovery", "raw");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "data", "discovery");

function parseArgs(argv: string[]): { rawDir: string; outDir: string; dryRun: boolean } {
  let rawDir = DEFAULT_RAW_DIR;
  let outDir = DEFAULT_OUT_DIR;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--raw-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--raw-dir requires a path argument.");
      rawDir = path.resolve(value);
      i += 1;
    } else if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a path argument.");
      outDir = path.resolve(value);
      i += 1;
    } else {
      throw new Error(
        `Unknown argument: "${arg}". Usage: normalize-discovery [--raw-dir <path>] [--out-dir <path>] [--dry-run]`,
      );
    }
  }
  return { rawDir, outDir, dryRun };
}

async function main(): Promise<void> {
  const { rawDir, outDir, dryRun } = parseArgs(process.argv.slice(2));

  let names: string[];
  try {
    names = (await readdir(rawDir)).filter((name) => name.endsWith(".overture.json")).sort();
  } catch (err) {
    throw new Error(
      `Could not read raw dir "${rawDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (names.length === 0) {
    throw new Error(`No *.overture.json snapshots found in "${rawDir}". Run discovery:download first.`);
  }

  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(rawDir, name), "utf8")) as unknown;
    const { places, counts } = normalizeOvertureSnapshot(
      raw as Parameters<typeof normalizeOvertureSnapshot>[0],
    );
    const snapshot = raw as { service_area?: unknown; overture_release?: unknown; fetched_at_utc?: unknown };
    const output = {
      source: "overture_places_discovery",
      overture_release: snapshot.overture_release ?? "unknown",
      service_area: snapshot.service_area ?? name.replace(/\.overture\.json$/, ""),
      fetched_at_utc: snapshot.fetched_at_utc ?? null,
      counts,
      place_count: places.length,
      places,
    };
    console.log(
      `${String(output.service_area)}: ${counts.kept} kept / ${counts.fetched} fetched ` +
        `(closed ${counts.dropped_closed}, irrelevant ${counts.dropped_irrelevant}, unusable ${counts.dropped_unusable})`,
    );
    if (dryRun) continue;
    const outPath = path.join(outDir, `${String(output.service_area)}.json`);
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`  wrote ${outPath}`);
  }
  if (dryRun) console.log("Dry run: wrote nothing.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
