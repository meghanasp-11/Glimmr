#!/usr/bin/env node
/**
 * Build the first manual-verification batch from the dossier.
 *
 * Reads data/discovery/dossier.json (unchanged) and writes one review file
 * per top-ranked place to data/discovery/reviews/<area>/<overture_id>.json
 * plus a ranked human-readable report. No fetching, no invention, no
 * promotion — verified values are carried with sources, everything else
 * stays missing-with-reason.
 *
 * Usage:
 *   npm run discovery:batch -w @glimmr/scripts -- [--dossier <path>] [--out-dir <path>] [--report <path>] [--size N] [--dry-run]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BATCH_SIZE, renderBatchReport, selectBatch, type DossierRecordInput } from "./batch";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_DOSSIER = path.join(REPO_ROOT, "data", "discovery", "dossier.json");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "data", "discovery", "reviews");
const DEFAULT_REPORT = path.join(REPO_ROOT, "data", "discovery", "review-batch.md");

function parseArgs(argv: string[]): {
  dossier: string;
  outDir: string;
  report: string;
  size: number;
  dryRun: boolean;
} {
  let dossier = DEFAULT_DOSSIER;
  let outDir = DEFAULT_OUT_DIR;
  let report = DEFAULT_REPORT;
  let size = BATCH_SIZE;
  let dryRun = false;
  const takeValue = (flag: string, i: number): string => {
    const value = argv[i + 1];
    if (!value) throw new Error(`${flag} requires a value.`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--dossier") {
      dossier = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--out-dir") {
      outDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--report") {
      report = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--size") {
      size = Number(takeValue(arg, i));
      if (!Number.isInteger(size) || size < 0) throw new Error("--size must be a non-negative integer.");
      i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}".`);
    }
  }
  return { dossier, outDir, report, size, dryRun };
}

async function main(): Promise<void> {
  const { dossier, outDir, report, size, dryRun } = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(await readFile(dossier, "utf8")) as {
    overture_release?: unknown;
    records_ranked?: unknown;
  };
  if (!Array.isArray(raw.records_ranked)) throw new Error(`"${dossier}" is not a dossier file.`);
  const release = typeof raw.overture_release === "string" ? raw.overture_release : "unknown";

  const batch = selectBatch(raw.records_ranked as DossierRecordInput[], size);
  const areas = [...new Set(batch.map((file) => file.service_area))].sort();
  console.log(`batch: top ${batch.length} of ${raw.records_ranked.length} dossier records`);
  console.log(`areas: ${areas.join(", ")}`);

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  for (const file of batch) {
    const areaDir = path.join(outDir, file.service_area);
    await mkdir(areaDir, { recursive: true });
    await writeFile(path.join(areaDir, `${file.overture_id}.json`), `${JSON.stringify(file, null, 2)}\n`);
  }
  await writeFile(report, renderBatchReport(batch, release));
  console.log(`  wrote ${batch.length} review files to ${outDir}`);
  console.log(`  wrote ${report}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
