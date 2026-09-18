#!/usr/bin/env node
/**
 * Rank curated candidates into a verification shortlist
 * (data/discovery/shortlist.json).
 *
 * Reads the per-area candidate files (full dataset stays unchanged),
 * applies verification-priority ranking with per-area quotas, and writes a
 * single ranked shortlist of ~180 records, each carrying the reasons it was
 * prioritized. Unmapped/review records are excluded from the shortlist and
 * stay in the candidate files.
 *
 * Usage:
 *   npm run discovery:shortlist -w @glimmr/scripts -- [--in-dir <path>] [--out <path>] [--target N] [--dry-run]
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHORTLIST_TARGET, rankCandidates } from "./shortlist";
import type { CandidatePlace } from "./curate";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_IN_DIR = path.join(REPO_ROOT, "data", "discovery", "candidates");
const DEFAULT_OUT = path.join(REPO_ROOT, "data", "discovery", "shortlist.json");

function parseArgs(argv: string[]): { inDir: string; out: string; target: number; dryRun: boolean } {
  let inDir = DEFAULT_IN_DIR;
  let out = DEFAULT_OUT;
  let target = SHORTLIST_TARGET;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--in-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--in-dir requires a path argument.");
      inDir = path.resolve(value);
      i += 1;
    } else if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out requires a path argument.");
      out = path.resolve(value);
      i += 1;
    } else if (arg === "--target") {
      const value = argv[i + 1];
      if (!value) throw new Error("--target requires a number argument.");
      target = Number(value);
      if (!Number.isInteger(target) || target < 0) throw new Error("--target must be a non-negative integer.");
      i += 1;
    } else {
      throw new Error(
        `Unknown argument: "${arg}". Usage: shortlist-candidates [--in-dir <path>] [--out <path>] [--target N] [--dry-run]`,
      );
    }
  }
  return { inDir, out, target, dryRun };
}

async function main(): Promise<void> {
  const { inDir, out, target, dryRun } = parseArgs(process.argv.slice(2));

  const { readdir } = await import("node:fs/promises");
  const names = (
    await readdir(inDir, { withFileTypes: true }).catch((err: unknown) => {
      throw new Error(
        `Could not read candidates dir "${inDir}": ${err instanceof Error ? err.message : String(err)}`,
      );
    })
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "summary.json")
    .map((entry) => entry.name)
    .filter((name) => path.resolve(inDir, name) !== path.resolve(out))
    .sort();
  if (names.length === 0) {
    throw new Error(`No candidate files found in "${inDir}". Run discovery:curate first.`);
  }

  const all: CandidatePlace[] = [];
  let release = "unknown";
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(inDir, name), "utf8")) as {
      overture_release?: unknown;
      candidates?: unknown;
    };
    if (!Array.isArray(raw.candidates)) throw new Error(`"${name}" is not a candidate file.`);
    if (typeof raw.overture_release === "string") release = raw.overture_release;
    all.push(...(raw.candidates as CandidatePlace[]));
  }

  const { shortlisted, counts, quotas } = rankCandidates(all, target);

  const byArea: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const pick of shortlisted) {
    byArea[pick.service_area] = (byArea[pick.service_area] ?? 0) + 1;
    const bucket = pick.glimmr_category ?? "unmapped";
    byCategory[bucket] = (byCategory[bucket] ?? 0) + 1;
  }

  console.log(
    `shortlist: ${counts.shortlisted} of ${counts.pool} candidates ` +
      `(unmapped excluded ${counts.unmapped_excluded}, clustered skipped ${counts.skipped_clustered})`,
  );
  console.log(`quotas: ${JSON.stringify(quotas)} | by area: ${JSON.stringify(byArea)}`);
  console.log(`by category: ${JSON.stringify(byCategory)}`);

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await writeFile(
    out,
    `${JSON.stringify({ source: "glimmr_verification_shortlist", overture_release: release, target, counts, quotas, by_area: byArea, by_category: byCategory, shortlist: shortlisted }, null, 2)}\n`,
  );
  console.log(`  wrote ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
