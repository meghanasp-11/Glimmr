#!/usr/bin/env node
/**
 * Build the manual verification queue from the shortlist.
 *
 * Reads data/discovery/shortlist.json plus the per-place verification
 * drafts (for incomplete fields) — both stay unchanged — and writes:
 * - data/discovery/verification-queue.json (machine-readable queue)
 * - data/discovery/verification-queue.md (human-readable report)
 *
 * No facts are invented or scraped; curated attributes stay empty until a
 * human verifies them against the source guidance in each entry.
 *
 * Usage:
 *   npm run discovery:queue -w @glimmr/scripts -- [--shortlist <path>] [--drafts-dir <path>] [--out <path>] [--report <path>] [--size N] [--dry-run]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildQueue, QUEUE_SIZE, type QueueInput } from "./queue";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_SHORTLIST = path.join(REPO_ROOT, "data", "discovery", "shortlist.json");
const DEFAULT_DRAFTS = path.join(REPO_ROOT, "data", "discovery", "verification");
const DEFAULT_OUT = path.join(REPO_ROOT, "data", "discovery", "verification-queue.json");
const DEFAULT_REPORT = path.join(REPO_ROOT, "data", "discovery", "verification-queue.md");

function parseArgs(argv: string[]): {
  shortlist: string;
  draftsDir: string;
  out: string;
  report: string;
  size: number;
  dryRun: boolean;
} {
  let shortlist = DEFAULT_SHORTLIST;
  let draftsDir = DEFAULT_DRAFTS;
  let out = DEFAULT_OUT;
  let report = DEFAULT_REPORT;
  let size = QUEUE_SIZE;
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
    } else if (arg === "--shortlist") {
      shortlist = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--drafts-dir") {
      draftsDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--out") {
      out = path.resolve(takeValue(arg, i)); i += 1;
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
  return { shortlist, draftsDir, out, report, size, dryRun };
}

function renderReport(
  queue: ReturnType<typeof buildQueue>["queue"],
  counts: ReturnType<typeof buildQueue>["counts"],
  release: string,
): string {
  const lines = [
    "# Glimmr verification queue",
    "",
    `Top ${queue.length} shortlisted places for manual verification (Overture release ${release}).`,
    "Verify each place against its source guidance, fill the listed fields,",
    "and never invent a fact that is not on the cited source.",
    "",
    `Coverage — areas: ${JSON.stringify(counts.areas)}; categories: ${JSON.stringify(counts.categories)}.`,
    "",
  ];
  for (const entry of queue) {
    lines.push(
      `## #${entry.queue_rank} ${entry.name}`,
      "",
      `- Area: ${entry.service_area} · Category: ${entry.glimmr_category} · Coordinates: ${entry.lat}, ${entry.lng}`,
      `- Website: ${entry.website ?? "none on file"} · Overture confidence: ${entry.confidence ?? "unknown"}`,
      `- Priority: ${entry.priority_reason}`,
      `- Source guidance [${entry.source_guidance}]: ${entry.source_guidance_detail}`,
      `- Still to verify: ${entry.needs_verification.length > 0 ? entry.needs_verification.join(", ") : "none"}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const { shortlist, draftsDir, out, report, size, dryRun } = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(await readFile(shortlist, "utf8")) as {
    overture_release?: unknown;
    shortlist?: unknown;
  };
  if (!Array.isArray(raw.shortlist)) throw new Error(`"${shortlist}" is not a shortlist file.`);
  const release = typeof raw.overture_release === "string" ? raw.overture_release : "unknown";

  // Map overture_id -> incomplete fields from the per-place drafts.
  const drafts = new Map<string, string[]>();
  const areaDirs = await readdir(draftsDir, { withFileTypes: true }).catch((err: unknown) => {
    throw new Error(
      `Could not read drafts dir "${draftsDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  for (const areaDir of areaDirs) {
    if (!areaDir.isDirectory()) continue;
    const files = await readdir(path.join(draftsDir, areaDir.name));
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const draft = JSON.parse(await readFile(path.join(draftsDir, areaDir.name, file), "utf8")) as {
        overture_id?: unknown;
        incomplete_fields?: unknown;
      };
      if (typeof draft.overture_id === "string" && Array.isArray(draft.incomplete_fields)) {
        drafts.set(draft.overture_id, draft.incomplete_fields.filter((f): f is string => typeof f === "string"));
      }
    }
  }

  const { queue, counts } = buildQueue(raw.shortlist as QueueInput[], drafts, size);
  console.log(`queue: ${counts.queued} of ${counts.pool} shortlisted`);
  console.log(`areas: ${JSON.stringify(counts.areas)} | categories: ${JSON.stringify(counts.categories)}`);

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await writeFile(
    out,
    `${JSON.stringify({ source: "glimmr_verification_queue", overture_release: release, size: queue.length, counts, queue }, null, 2)}\n`,
  );
  await writeFile(report, renderReport(queue, counts, release));
  console.log(`  wrote ${out}`);
  console.log(`  wrote ${report}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
