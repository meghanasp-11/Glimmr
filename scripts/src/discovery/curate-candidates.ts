#!/usr/bin/env node
/**
 * Curate normalized discovery files (data/discovery/<area>.json) into per-area
 * Glimmr candidate files (data/discovery/candidates/<area>.json) plus a
 * counts-by-area-and-category summary.
 *
 * Deduplication is global across areas (stable Overture id, then normalized
 * name+address+coordinates), while outputs stay per area. Raw discovery
 * files are only read, never modified. No network, no Firestore, no invented
 * fields — candidates awaiting real verification carry no prices, hours, or
 * scores.
 *
 * Usage:
 *   npm run discovery:curate -w @glimmr/scripts -- [--in-dir <path>] [--out-dir <path>] [--dry-run]
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { curateRecords, type CurateCounts } from "./curate";
import type { RawDiscoveryPlace } from "./overture";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_IN_DIR = path.join(REPO_ROOT, "data", "discovery");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "data", "discovery", "candidates");

function parseArgs(argv: string[]): { inDir: string; outDir: string; dryRun: boolean } {
  let inDir = DEFAULT_IN_DIR;
  let outDir = DEFAULT_OUT_DIR;
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
    } else if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out-dir requires a path argument.");
      outDir = path.resolve(value);
      i += 1;
    } else {
      throw new Error(
        `Unknown argument: "${arg}". Usage: curate-candidates [--in-dir <path>] [--out-dir <path>] [--dry-run]`,
      );
    }
  }
  return { inDir, outDir, dryRun };
}

interface AreaInput {
  area: string;
  release: string;
  records: RawDiscoveryPlace[];
}

async function main(): Promise<void> {
  const { inDir, outDir, dryRun } = parseArgs(process.argv.slice(2));

  let names: string[];
  try {
    const entries = await readdir(inDir, { withFileTypes: true });
    names = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .filter((name) => {
        if (name === "summary.json") return false;
        // Never read our own output back as input.
        return path.resolve(inDir, name) !== path.resolve(outDir, name) &&
          !path.resolve(inDir, name).startsWith(`${path.resolve(outDir)}${path.sep}`);
      })
      .sort();
  } catch (err) {
    throw new Error(
      `Could not read discovery dir "${inDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (names.length === 0) {
    throw new Error(`No discovery files found in "${inDir}". Run discovery:normalize first.`);
  }

  const inputs: AreaInput[] = [];
  for (const name of names) {
    const raw = JSON.parse(await readFile(path.join(inDir, name), "utf8")) as {
      service_area?: unknown;
      overture_release?: unknown;
      places?: unknown;
    };
    if (typeof raw.service_area !== "string" || !Array.isArray(raw.places)) {
      throw new Error(`"${name}" is not a discovery file (needs service_area + places).`);
    }
    inputs.push({
      area: raw.service_area,
      release: typeof raw.overture_release === "string" ? raw.overture_release : "unknown",
      records: raw.places as RawDiscoveryPlace[],
    });
  }

  // Global pass: duplicates collapse across areas, first file order wins.
  const all = inputs.flatMap((input) => input.records);
  const { candidates, counts } = curateRecords(all);

  const byArea = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const list = byArea.get(candidate.service_area) ?? [];
    list.push(candidate);
    byArea.set(candidate.service_area, list);
  }

  const summary: {
    overture_release: string;
    totals: CurateCounts;
    byCategory: Record<string, number>;
    areas: Record<string, { candidates: number; byCategory: Record<string, number> }>;
  } = {
    overture_release: inputs[0].release,
    totals: counts,
    byCategory: {},
    areas: {},
  };
  for (const candidate of candidates) {
    const bucket = candidate.glimmr_category ?? "unmapped";
    summary.byCategory[bucket] = (summary.byCategory[bucket] ?? 0) + 1;
  }
  for (const input of inputs) {
    const list = byArea.get(input.area) ?? [];
    const areaCats: Record<string, number> = {};
    for (const candidate of list) {
      const bucket = candidate.glimmr_category ?? "unmapped";
      areaCats[bucket] = (areaCats[bucket] ?? 0) + 1;
    }
    summary.areas[input.area] = { candidates: list.length, byCategory: areaCats };
  }

  for (const [area, list] of [...byArea.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    console.log(`${area}: ${list.length} candidates`);
  }
  console.log(
    `totals: ${counts.kept} kept / ${counts.fetched} fetched ` +
      `(mapped ${counts.mapped}, unmapped ${counts.unmapped}, ` +
      `duplicates ${counts.dropped_duplicates}, non-outing ${counts.dropped_non_outing})`,
  );
  console.log(`by category: ${JSON.stringify(summary.byCategory)}`);

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [area, list] of byArea) {
    const outPath = path.join(outDir, `${area}.json`);
    await writeFile(
      outPath,
      `${JSON.stringify({ source: "glimmr_candidates", overture_release: inputs[0].release, service_area: area, candidate_count: list.length, candidates: list }, null, 2)}\n`,
    );
    console.log(`  wrote ${outPath}`);
  }
  const summaryPath = path.join(outDir, "summary.json");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`  wrote ${summaryPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
