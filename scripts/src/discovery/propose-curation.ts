#!/usr/bin/env node
/**
 * Validate curated proposals through the enrichment rubric and emit them.
 *
 * Reads nothing but the proposal table (judgment already recorded there);
 * every bundle must pass curateAttributes or the command fails with the
 * rubric errors. Writes:
 * - data/discovery/curation-proposals.json (machine-readable proposals)
 * - data/discovery/curation-report.md (value, reason, basis, blockers)
 * Review files are only read (for remaining blockers), never modified.
 * Nothing is promoted; curated values enter review files by human hand.
 *
 * Usage:
 *   npm run discovery:propose -w @glimmr/scripts -- [--reviews-dir <path>] [--out <path>] [--report <path>] [--dry-run]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROPOSALS } from "./curation-proposals";
import { curateAttributes } from "./rubric";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_REVIEWS = path.join(REPO_ROOT, "data", "discovery", "reviews");
const DEFAULT_OUT = path.join(REPO_ROOT, "data", "discovery", "curation-proposals.json");
const DEFAULT_REPORT = path.join(REPO_ROOT, "data", "discovery", "curation-report.md");

function parseArgs(argv: string[]): { reviewsDir: string; out: string; report: string; dryRun: boolean } {
  let reviewsDir = DEFAULT_REVIEWS;
  let out = DEFAULT_OUT;
  let report = DEFAULT_REPORT;
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
    } else if (arg === "--reviews-dir") {
      reviewsDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--out") {
      out = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--report") {
      report = path.resolve(takeValue(arg, i)); i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}".`);
    }
  }
  return { reviewsDir, out, report, dryRun };
}

interface ReviewFile {
  overture_id: string;
  fields: Record<string, { value: unknown; status: string }>;
}

async function main(): Promise<void> {
  const { reviewsDir, out, report, dryRun } = parseArgs(process.argv.slice(2));

  const reviews = new Map<string, ReviewFile>();
  const areaDirs = await readdir(reviewsDir, { withFileTypes: true }).catch((err: unknown) => {
    throw new Error(
      `Could not read reviews dir "${reviewsDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  for (const areaDir of areaDirs) {
    if (!areaDir.isDirectory()) continue;
    for (const file of await readdir(path.join(reviewsDir, areaDir.name))) {
      if (!file.endsWith(".json")) continue;
      const raw = JSON.parse(
        await readFile(path.join(reviewsDir, areaDir.name, file), "utf8"),
      ) as ReviewFile;
      if (typeof raw.overture_id === "string") reviews.set(raw.overture_id, raw);
    }
  }

  const emitted: Record<string, unknown>[] = [];
  const lines = [
    "# Glimmr curation proposals (Batch-01)",
    "",
    "Rubric-validated curated attributes with reasons and evidence basis.",
    "Nothing here is verified yet: a human enters these into review files by hand.",
    "",
  ];
  for (const proposal of PROPOSALS) {
    const result = curateAttributes(proposal.bundle, proposal.category);
    if (!result.ok) {
      throw new Error(`Proposal for ${proposal.overture_id} failed the rubric:\n- ${result.errors.join("\n- ")}`);
    }
    const review = reviews.get(proposal.overture_id);
    const blockers = review
      ? Object.entries(review.fields)
          .filter(([, field]) => field.status === "missing" || field.status === "rejected")
          .map(([name]) => name)
      : ["review file not found"];
    emitted.push({ ...proposal, validated: result.curated });
    lines.push(
      `## ${proposal.name} (${proposal.service_area}, ${proposal.category})`,
      "",
      ...Object.entries(result.curated).flatMap(([field, entry]) => [
        `- ${field}: ${JSON.stringify(entry.value)} — ${entry.source}`,
      ]),
      `- Remaining blockers: ${blockers.join(", ") || "none"}`,
      "",
    );
  }

  console.log(`proposals: ${emitted.length} validated, 0 rubric failures.`);
  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await writeFile(out, `${JSON.stringify({ source: "glimmr_curation_proposals", proposals: emitted }, null, 2)}\n`);
  await writeFile(report, `${lines.join("\n")}\n`);
  console.log(`  wrote ${out}`);
  console.log(`  wrote ${report}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
