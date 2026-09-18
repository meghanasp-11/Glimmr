#!/usr/bin/env node
/**
 * Generate per-place verification drafts for the shortlist
 * (data/discovery/verification/<area>/<overture_id>.json) plus a rollup
 * summary tracking incomplete fields across all drafts.
 *
 * Reads the shortlist only — raw discovery data and candidate files are
 * never modified. Drafts map every record into the production Place shape
 * with explicit nulls for anything unverified; nothing here invents facts.
 *
 * Usage:
 *   npm run discovery:verify -w @glimmr/scripts -- [--shortlist <path>] [--out-dir <path>] [--dry-run]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { draftVerification, type ShortlistRecord } from "./verify";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_SHORTLIST = path.join(REPO_ROOT, "data", "discovery", "shortlist.json");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "data", "discovery", "verification");

function parseArgs(argv: string[]): { shortlist: string; outDir: string; dryRun: boolean } {
  let shortlist = DEFAULT_SHORTLIST;
  let outDir = DEFAULT_OUT_DIR;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--shortlist") {
      const value = argv[i + 1];
      if (!value) throw new Error("--shortlist requires a path argument.");
      shortlist = path.resolve(value);
      i += 1;
    } else if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a path argument.");
      outDir = path.resolve(value);
      i += 1;
    } else {
      throw new Error(
        `Unknown argument: "${arg}". Usage: verify-candidates [--shortlist <path>] [--out-dir <path>] [--dry-run]`,
      );
    }
  }
  return { shortlist, outDir, dryRun };
}

async function main(): Promise<void> {
  const { shortlist, outDir, dryRun } = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(await readFile(shortlist, "utf8")) as {
    overture_release?: unknown;
    shortlist?: unknown;
  };
  if (!Array.isArray(raw.shortlist)) throw new Error(`"${shortlist}" is not a shortlist file.`);
  const records = raw.shortlist as ShortlistRecord[];
  const release = typeof raw.overture_release === "string" ? raw.overture_release : "unknown";

  const drafts = records.map((record) => draftVerification(record));
  const missingHistogram: Record<string, number> = {};
  for (const draft of drafts) {
    for (const field of draft.incomplete_fields) {
      missingHistogram[field] = (missingHistogram[field] ?? 0) + 1;
    }
  }
  const ready = drafts.filter((draft) => draft.production_ready).length;

  console.log(`drafts: ${drafts.length} (production-ready ${ready}, pending ${drafts.length - ready})`);
  console.log(`most-missing fields: ${JSON.stringify(missingHistogram)}`);

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  for (const draft of drafts) {
    const areaDir = path.join(outDir, draft.service_area);
    await mkdir(areaDir, { recursive: true });
    await writeFile(path.join(areaDir, `${draft.overture_id}.json`), `${JSON.stringify(draft, null, 2)}\n`);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "summary.json"),
    `${JSON.stringify({ overture_release: release, drafts: drafts.length, production_ready: ready, missing_histogram: missingHistogram }, null, 2)}\n`,
  );
  console.log(`  wrote ${drafts.length} drafts + summary to ${outDir}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
