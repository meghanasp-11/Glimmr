#!/usr/bin/env node
/**
 * Dry-run production promotion for reviewed places.
 *
 * Reads human-reviewed place files (data/discovery/reviews/<area>/*.json —
 * see the reviewed-place format in scripts/PLACES_IMPORT_FORMAT.md) plus
 * the V1 area bounds, assembles each Place candidate from verified/curated
 * values only, and runs it through the existing production validator.
 * Nothing is written to production data: this command only reports exactly
 * which places are production-ready and why the rest wait.
 *
 * Usage:
 *   npm run discovery:promote -w @glimmr/scripts -- [--reviews-dir <path>] [--areas-dir <path>] [--dry-run] [--candidates-out <path>]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluatePromotion,
  formatCandidatesFile,
  promotionReport,
  selectProductionCandidates,
  type ReviewedPlace,
} from "./promote";
import {
  PlaceSchema,
  type ServiceArea,
} from "../../../artifacts/glimmr/src/schemas/glimmr.schema";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_REVIEWS = path.join(REPO_ROOT, "data", "discovery", "reviews");
const DEFAULT_AREAS = path.join(REPO_ROOT, "data", "production");

function parseArgs(argv: string[]): { reviewsDir: string; areasDir: string; dryRun: boolean; candidatesOut: string | null } {
  let reviewsDir = DEFAULT_REVIEWS;
  let areasDir = DEFAULT_AREAS;
  let dryRun = true;
  let candidatesOut: string | null = null;
  const takeValue = (flag: string, i: number): string => {
    const value = argv[i + 1];
    if (!value) throw new Error(`${flag} requires a value.`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--reviews-dir") {
      reviewsDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--areas-dir") {
      areasDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--candidates-out") {
      candidatesOut = path.resolve(takeValue(arg, i)); i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}". This command is dry-run only.`);
    }
  }
  return { reviewsDir, areasDir, dryRun, candidatesOut };
}

async function main(): Promise<void> {
  const { reviewsDir, areasDir, candidatesOut } = parseArgs(process.argv.slice(2));

  const areaById = new Map<string, ServiceArea>();
  const areaFiles = await readdir(areasDir).catch((err: unknown) => {
    throw new Error(
      `Could not read areas dir "${areasDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  for (const name of areaFiles.filter((file) => file.endsWith(".json")).sort()) {
    const raw = JSON.parse(await readFile(path.join(areasDir, name), "utf8")) as {
      serviceArea?: ServiceArea;
    };
    if (raw.serviceArea && typeof raw.serviceArea.id === "string") {
      areaById.set(raw.serviceArea.id, raw.serviceArea);
    }
  }

  const reviewed: ReviewedPlace[] = [];
  const entries = await readdir(reviewsDir, { withFileTypes: true }).catch(() => null);
  if (entries !== null) {
    const files: { dir: string; file: string }[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        for (const file of await readdir(path.join(reviewsDir, entry.name))) {
          if (file.endsWith(".json")) files.push({ dir: entry.name, file });
        }
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push({ dir: "", file: entry.name });
      }
    }
    files.sort((a, b) => `${a.dir}/${a.file}` < `${b.dir}/${b.file}` ? -1 : 1);
    for (const { dir, file } of files) {
      const raw = JSON.parse(await readFile(path.join(reviewsDir, dir, file), "utf8")) as ReviewedPlace;
      if (typeof raw.overture_id === "string" && typeof raw.fields === "object" && raw.fields !== null) {
        reviewed.push(raw);
      } else {
        console.warn(`warning: skipping "${path.join(dir, file)}" (not a reviewed-place file).`);
      }
    }
  }

  if (reviewed.length === 0) {
    console.log(promotionReport([]));
    console.log(`(No reviewed places in "${reviewsDir}" yet — see the reviewed-place format in scripts/PLACES_IMPORT_FORMAT.md.)`);
    return;
  }

  const results = reviewed.map((place) => evaluatePromotion(place, areaById));
  console.log(promotionReport(results));
  if (candidatesOut !== null) {
    // Candidate output only: ready records that passed recommendation
    // readiness AND promotion. Never touches Firestore or production data.
    const records = selectProductionCandidates(reviewed, areaById);
    const generatedAt = new Date().toISOString();
    await writeFile(candidatesOut, formatCandidatesFile(records, generatedAt));
    // Verify what was written: re-read and re-validate every record.
    const written = JSON.parse(await readFile(candidatesOut, "utf8")) as { records?: unknown[] };
    if (!Array.isArray(written.records) || written.records.length !== records.length) {
      throw new Error(`Candidate file verification failed: record count mismatch in "${candidatesOut}".`);
    }
    for (const record of written.records) {
      const parsed = PlaceSchema.safeParse(record);
      if (!parsed.success) {
        throw new Error(
          `Candidate file verification failed: a record fails PlaceSchema in "${candidatesOut}".`,
        );
      }
    }
    console.log(`  wrote ${candidatesOut} (${records.length} candidate record(s), schema-verified).`);
  }
  console.log("Dry run: nothing was written to production data.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
