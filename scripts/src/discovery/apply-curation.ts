#!/usr/bin/env node
/**
 * Hand-apply rubric-validated curation into review files ("human hand" step).
 *
 * Reads the curated proposal table plus the review files; every bundle is
 * re-validated through curateAttributes (the rubric gate — table drift fails
 * loudly). Only fields currently marked `missing` receive values, written as
 * status "curated" with the rubric source. Verified, already-curated, and
 * human-rejected values are never overwritten; verification-gated keys are
 * refused even if proposed; record-level rejected reviews are left alone.
 * Raw discovery and evidence files are never touched — only review files.
 *
 * Usage:
 *   npm run discovery:apply -w @glimmr/scripts -- [--reviews-dir <path>] [--dry-run|--apply]
 * (dry-run is the default; --apply writes review files.)
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROPOSALS, type PlaceProposal } from "./curation-proposals";
import { CURATED_FIELD_NAMES, curateAttributes } from "./rubric";

export interface ReviewFieldLike {
  value: unknown;
  status: string;
  source?: string;
  reason?: string;
}

export interface ReviewLike {
  overture_id: string;
  service_area: string;
  rejected?: boolean;
  fields: Record<string, ReviewFieldLike>;
}

export interface CuratedEntryInput {
  value: unknown;
  source: string;
}

export interface SkippedField {
  field: string;
  reason: string;
}

export interface ApplyOutcome {
  overture_id: string;
  applied: string[];
  skipped: SkippedField[];
}

/**
 * Apply validated curated entries to one review. Pure except for mutating
 * the passed review object; returns exactly what changed and what did not.
 */
export function applyCuratedEntries(
  review: ReviewLike,
  curated: Record<string, CuratedEntryInput>,
): ApplyOutcome {
  const applied: string[] = [];
  const skipped: SkippedField[] = [];
  if (review.rejected === true) {
    for (const field of Object.keys(curated)) {
      skipped.push({ field, reason: "record rejected — excluded from curation" });
    }
    return { overture_id: review.overture_id, applied, skipped };
  }
  for (const [field, entry] of Object.entries(curated)) {
    if (!CURATED_FIELD_NAMES.has(field)) {
      skipped.push({ field, reason: "verification-gated or unknown — curation refused" });
      continue;
    }
    const current = review.fields[field];
    if (current === undefined) {
      skipped.push({ field, reason: "field absent from review — left alone" });
      continue;
    }
    if (current.status !== "missing") {
      skipped.push({ field, reason: `already ${current.status} — never overwritten` });
      continue;
    }
    review.fields[field] = { value: entry.value, status: "curated", source: entry.source };
    applied.push(field);
  }
  return { overture_id: review.overture_id, applied, skipped };
}

function parseArgs(argv: string[]): { reviewsDir: string; apply: boolean } {
  let reviewsDir = path.join(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."),
    "data",
    "discovery",
    "reviews",
  );
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      apply = false;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--reviews-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--reviews-dir requires a value.");
      reviewsDir = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}". Usage: apply-curation [--reviews-dir <path>] [--dry-run|--apply]`);
    }
  }
  return { reviewsDir, apply };
}

async function main(): Promise<void> {
  const { reviewsDir, apply } = parseArgs(process.argv.slice(2));

  const filesByOverture = new Map<string, string>();
  const areaDirs = await readdir(reviewsDir, { withFileTypes: true }).catch((err: unknown) => {
    throw new Error(
      `Could not read reviews dir "${reviewsDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  for (const areaDir of areaDirs) {
    if (!areaDir.isDirectory()) continue;
    for (const file of await readdir(path.join(reviewsDir, areaDir.name))) {
      if (!file.endsWith(".json")) continue;
      const full = path.join(reviewsDir, areaDir.name, file);
      const raw = JSON.parse(await readFile(full, "utf8")) as { overture_id?: unknown };
      if (typeof raw.overture_id === "string") filesByOverture.set(raw.overture_id, full);
    }
  }

  const report = (proposal: PlaceProposal): string => {
    const lines = [`## ${proposal.name} (${proposal.overture_id})`];
    return lines.join("\n");
  };

  let wrote = 0;
  for (const proposal of PROPOSALS) {
    const validated = curateAttributes(proposal.bundle, proposal.category);
    if (!validated.ok) {
      throw new Error(`Proposal for ${proposal.overture_id} failed the rubric:\n- ${validated.errors.join("\n- ")}`);
    }
    const file = filesByOverture.get(proposal.overture_id);
    if (file === undefined) {
      console.log(`${report(proposal)}\n- skipped: no review file found.`);
      continue;
    }
    const review = JSON.parse(await readFile(file, "utf8")) as ReviewLike;
    const outcome = applyCuratedEntries(review, validated.curated as Record<string, CuratedEntryInput>);
    console.log(
      `${report(proposal)}\n` +
        `- applied: ${outcome.applied.join(", ") || "none"}\n` +
        outcome.skipped.map((s) => `  - skipped ${s.field}: ${s.reason}`).join("\n"),
    );
    if (apply && outcome.applied.length > 0) {
      await writeFile(file, `${JSON.stringify(review, null, 2)}\n`);
      wrote += 1;
    }
  }
  console.log(apply ? `Wrote ${wrote} review file(s).` : "Dry run: wrote nothing (pass --apply to write).");
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
