#!/usr/bin/env node
/**
 * Check recommendation-readiness of reviewed places (dry-run report only).
 *
 * Reads human-reviewed place files plus the V1 area bounds — all stay
 * unchanged — and reports which places are recommendation-ready and why
 * the rest wait. Record-level rejections are excluded with their reason.
 * Nothing is auto-filled and nothing is written except stdout.
 *
 * Usage:
 *   npm run discovery:readiness -w @glimmr/scripts -- [--reviews-dir <path>] [--areas-dir <path>]
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRecommendationReadiness, readinessReport, type ReviewInput } from "./readiness";
import type { ServiceArea } from "../../../artifacts/glimmr/src/schemas/glimmr.schema";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_REVIEWS = path.join(REPO_ROOT, "data", "discovery", "reviews");
const DEFAULT_AREAS = path.join(REPO_ROOT, "data", "production");

function parseArgs(argv: string[]): { reviewsDir: string; areasDir: string } {
  let reviewsDir = DEFAULT_REVIEWS;
  let areasDir = DEFAULT_AREAS;
  const takeValue = (flag: string, i: number): string => {
    const value = argv[i + 1];
    if (!value) throw new Error(`${flag} requires a value.`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--reviews-dir") {
      reviewsDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--areas-dir") {
      areasDir = path.resolve(takeValue(arg, i)); i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}". Usage: readiness-check [--reviews-dir <path>] [--areas-dir <path>]`);
    }
  }
  return { reviewsDir, areasDir };
}

async function main(): Promise<void> {
  const { reviewsDir, areasDir } = parseArgs(process.argv.slice(2));

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

  const entries = await readdir(reviewsDir, { withFileTypes: true }).catch(() => null);
  const reviewed: ReviewInput[] = [];
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
    files.sort((a, b) => (`${a.dir}/${a.file}` < `${b.dir}/${b.file}` ? -1 : 1));
    for (const { dir, file } of files) {
      const raw = JSON.parse(await readFile(path.join(reviewsDir, dir, file), "utf8")) as ReviewInput & {
        rejected?: boolean;
        rejection_reason?: string;
      };
      if (typeof raw.overture_id !== "string" || typeof raw.fields !== "object" || raw.fields === null) {
        console.warn(`warning: skipping "${path.join(dir, file)}" (not a reviewed-place file).`);
        continue;
      }
      if (raw.rejected === true) {
        console.log(`- ${raw.overture_id}: REJECTED and excluded (${raw.rejection_reason ?? "no reason given"}).`);
        continue;
      }
      reviewed.push(raw);
    }
  }

  if (reviewed.length === 0) {
    console.log("No reviewable places found.");
    return;
  }
  console.log(readinessReport(reviewed.map((place) => evaluateRecommendationReadiness(place, areaById))));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
