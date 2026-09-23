#!/usr/bin/env node
/**
 * Select the Batch-02 follow-up verification candidates.
 *
 * Reads data/discovery/shortlist.json plus the Batch-01 review files (for
 * exclusion by overture_id) — both stay unchanged — and writes to a new
 * data/discovery/batch-02/ directory:
 * - queue.json (verification-queue shape for the evidence/dossier CLIs)
 * - selection.json (picked ids, evidence scores, counts)
 * - selection.md (human-readable picked list)
 *
 * No facts are invented or scraped; selection reorders existing shortlist
 * records only.
 *
 * Usage:
 *   npm run discovery:select-batch-02 -w @glimmr/scripts -- [--shortlist <path>] [--reviews-dir <path>] [--drafts-dir <path>] [--out-dir <path>] [--size N] [--dry-run]
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildQueue, type QueueInput } from "./queue";
import { FOLLOW_UP_SIZE, evidencePriorityScore, selectFollowUpBatch, type FollowUpInput } from "./followup";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_SHORTLIST = path.join(REPO_ROOT, "data", "discovery", "shortlist.json");
const DEFAULT_REVIEWS = path.join(REPO_ROOT, "data", "discovery", "reviews");
const DEFAULT_DRAFTS = path.join(REPO_ROOT, "data", "discovery", "verification");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "data", "discovery", "batch-02");

function parseArgs(argv: string[]): {
  shortlist: string;
  reviewsDir: string;
  draftsDir: string;
  outDir: string;
  size: number;
  dryRun: boolean;
} {
  let shortlist = DEFAULT_SHORTLIST;
  let reviewsDir = DEFAULT_REVIEWS;
  let draftsDir = DEFAULT_DRAFTS;
  let outDir = DEFAULT_OUT_DIR;
  let size = FOLLOW_UP_SIZE;
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
    } else if (arg === "--reviews-dir") {
      reviewsDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--drafts-dir") {
      draftsDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--out-dir") {
      outDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--size") {
      size = Number(takeValue(arg, i));
      if (!Number.isInteger(size) || size < 0) throw new Error("--size must be a non-negative integer.");
      i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}".`);
    }
  }
  return { shortlist, reviewsDir, draftsDir, outDir, size, dryRun };
}

interface ShortlistEntry {
  overture_id: string;
  service_area: string;
  name: string;
  address_freeform: string | null;
  lat: number;
  lng: number;
  glimmr_category: string | null;
  websites: string[];
  operating_status: string | null;
  confidence: number | null;
  provenance: { sources: unknown[]; overture_release: string };
  verification_rank: number;
  verification_score: number;
  verification_reasons: string[];
}

function toFollowUpInput(entry: ShortlistEntry): FollowUpInput {
  return {
    overture_id: entry.overture_id,
    service_area: entry.service_area,
    name: entry.name,
    lat: entry.lat,
    lng: entry.lng,
    glimmr_category: entry.glimmr_category,
    websites: Array.isArray(entry.websites) ? entry.websites.filter((w): w is string => typeof w === "string") : [],
    address_freeform: entry.address_freeform,
    confidence: entry.confidence,
    sourceCount: Array.isArray(entry.provenance?.sources) ? entry.provenance.sources.length : 0,
    verification_rank: entry.verification_rank,
  };
}

function toQueueInput(entry: ShortlistEntry): QueueInput {
  return {
    overture_id: entry.overture_id,
    service_area: entry.service_area,
    name: entry.name,
    lat: entry.lat,
    lng: entry.lng,
    glimmr_category: entry.glimmr_category,
    websites: Array.isArray(entry.websites) ? entry.websites : [],
    operating_status: entry.operating_status,
    confidence: entry.confidence,
    provenance: {
      sources: Array.isArray(entry.provenance?.sources) ? entry.provenance.sources : [],
      overture_release: entry.provenance?.overture_release ?? "unknown",
    },
    verification_rank: entry.verification_rank,
    verification_score: entry.verification_score,
    verification_reasons: Array.isArray(entry.verification_reasons) ? entry.verification_reasons : [],
  };
}

async function main(): Promise<void> {
  const { shortlist, reviewsDir, draftsDir, outDir, size, dryRun } = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(await readFile(shortlist, "utf8")) as {
    overture_release?: unknown;
    shortlist?: unknown;
  };
  if (!Array.isArray(raw.shortlist)) throw new Error(`"${shortlist}" is not a shortlist file.`);
  const release = typeof raw.overture_release === "string" ? raw.overture_release : "unknown";
  const entries = raw.shortlist as ShortlistEntry[];

  // Batch-01 ids = existing review files (read only, never modified).
  const processed = new Set<string>();
  const reviewAreas = await readdir(reviewsDir, { withFileTypes: true }).catch(() => null);
  if (reviewAreas !== null) {
    for (const areaDir of reviewAreas) {
      if (!areaDir.isDirectory()) continue;
      for (const file of await readdir(path.join(reviewsDir, areaDir.name))) {
        if (file.endsWith(".json")) processed.add(file.slice(0, -".json".length));
      }
    }
  }

  const selection = selectFollowUpBatch(entries.map(toFollowUpInput), processed, size);
  console.log(`selected ${selection.picked.length} of ${selection.counts.pool} shortlisted (${selection.counts.excluded} excluded or ineligible)`);
  console.log(`areas: ${JSON.stringify(selection.counts.areas)} | categories: ${JSON.stringify(selection.counts.categories)}`);

  // Map overture_id -> incomplete fields from the per-place drafts (read only).
  const drafts = new Map<string, string[]>();
  const areaDirs = await readdir(draftsDir, { withFileTypes: true }).catch((err: unknown) => {
    throw new Error(
      `Could not read drafts dir "${draftsDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  for (const areaDir of areaDirs) {
    if (!areaDir.isDirectory()) continue;
    for (const file of await readdir(path.join(draftsDir, areaDir.name))) {
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

  const byId = new Map(entries.map((entry) => [entry.overture_id, entry]));
  const pickedEntries = selection.picked
    .map((picked) => byId.get(picked.overture_id))
    .filter((entry): entry is ShortlistEntry => entry !== undefined);
  const { queue, counts } = buildQueue(pickedEntries.map(toQueueInput), drafts, pickedEntries.length);

  const pickedMeta = selection.picked.map((picked) => ({
    overture_id: picked.overture_id,
    name: picked.name,
    service_area: picked.service_area,
    glimmr_category: picked.glimmr_category,
    evidence_score: evidencePriorityScore(picked),
    verification_rank: picked.verification_rank,
  }));
  const selectionMd = [
    "# Glimmr follow-up selection (Batch-02)",
    "",
    `Next ${pickedMeta.length} verification candidates after Batch-01 (Overture release ${release}).`,
    `Coverage — areas: ${JSON.stringify(counts.areas)}; categories: ${JSON.stringify(counts.categories)}.`,
    "",
    ...pickedMeta.map(
      (p) => `- ${p.overture_id} — ${p.name} (${p.glimmr_category} in ${p.service_area}, evidence score ${p.evidence_score})`,
    ),
    "",
  ].join("\n");

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    console.log(selectionMd);
    return;
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "queue.json"),
    `${JSON.stringify({ source: "glimmr_verification_queue_batch_02", overture_release: release, size: queue.length, counts, queue }, null, 2)}\n`,
  );
  await writeFile(
    path.join(outDir, "selection.json"),
    `${JSON.stringify({ source: "glimmr_follow_up_selection", overture_release: release, size: pickedMeta.length, counts: selection.counts, picked: pickedMeta }, null, 2)}\n`,
  );
  await writeFile(path.join(outDir, "selection.md"), selectionMd);
  console.log(`  wrote ${path.join(outDir, "queue.json")}`);
  console.log(`  wrote ${path.join(outDir, "selection.json")}`);
  console.log(`  wrote ${path.join(outDir, "selection.md")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
