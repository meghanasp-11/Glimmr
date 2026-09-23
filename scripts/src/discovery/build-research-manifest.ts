#!/usr/bin/env node
/**
 * Build the Batch-02 top-10 research manifest (read-only report).
 *
 * Reads data/discovery/batch-02/readiness.json (top-10 order),
 * dossier.json, queue.json, and evidence.json — all stay unchanged — and
 * writes batch-02/research-manifest.json + research-manifest.md. No
 * fetching, no invented facts, no promotion, no Firestore.
 *
 * Usage:
 *   npm run discovery:research-manifest -w @glimmr/scripts -- [--batch-dir <path>] [--out <path>] [--report <path>] [--dry-run]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildResearchManifest,
  renderResearchManifestMd,
  type DossierLike,
  type EvidenceLike,
  type QueueLike,
} from "./research-manifest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_BATCH_DIR = path.join(REPO_ROOT, "data", "discovery", "batch-02");
const DEFAULT_OUT = path.join(DEFAULT_BATCH_DIR, "research-manifest.json");
const DEFAULT_REPORT = path.join(DEFAULT_BATCH_DIR, "research-manifest.md");

function parseArgs(argv: string[]): { batchDir: string; out: string; report: string; dryRun: boolean } {
  let batchDir = DEFAULT_BATCH_DIR;
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
    } else if (arg === "--batch-dir") {
      batchDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--out") {
      out = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--report") {
      report = path.resolve(takeValue(arg, i)); i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}".`);
    }
  }
  return { batchDir, out, report, dryRun };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

async function main(): Promise<void> {
  const { batchDir, out, report, dryRun } = parseArgs(process.argv.slice(2));

  const readiness = (await readJson(path.join(batchDir, "readiness.json"))) as {
    overture_release?: unknown;
    top10?: unknown;
  };
  if (!Array.isArray(readiness.top10) || !readiness.top10.every((id) => typeof id === "string")) {
    throw new Error(`"${path.join(batchDir, "readiness.json")}" has no string top-10 list.`);
  }
  const top10 = readiness.top10 as string[];
  const release = typeof readiness.overture_release === "string" ? readiness.overture_release : "unknown";

  const dossier = (await readJson(path.join(batchDir, "dossier.json"))) as {
    records_ranked?: DossierLike[];
  };
  if (!Array.isArray(dossier.records_ranked)) throw new Error("dossier.json has no records_ranked list.");
  const dossiers: Record<string, DossierLike> = {};
  for (const record of dossier.records_ranked) {
    dossiers[record.overture_id] = record;
  }

  const queue = (await readJson(path.join(batchDir, "queue.json"))) as {
    queue?: QueueLike[];
  };
  const queues: Record<string, QueueLike> = {};
  for (const entry of queue.queue ?? []) {
    queues[entry.overture_id] = entry;
  }

  const evidence = (await readJson(path.join(batchDir, "evidence.json"))) as {
    evidence?: EvidenceLike[];
  };
  const evidences: Record<string, EvidenceLike> = {};
  for (const entry of evidence.evidence ?? []) {
    evidences[entry.overture_id] = entry;
  }

  const manifest = buildResearchManifest(top10, dossiers, queues, evidences, release);
  console.log(`research manifest: ${manifest.count} place(s), ${manifest.places.flatMap((p) => p.missing_fields).length} field targets.`);
  for (const place of manifest.places) {
    const shared = place.ambiguity_flags.filter((f) => f.type === "shared-chain").length;
    console.log(
      `  #${place.rank} ${place.name} — ${place.missing_fields.length} targets` +
        (shared > 0 ? `, SHARED-CHAIN (${shared})` : "") +
        (place.ambiguity_flags.some((f) => f.type === "rename-history") ? ", RENAME" : "") +
        (place.source_urls.website_reachable ? "" : ", site-unreachable"),
    );
  }

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(report, renderResearchManifestMd(manifest));
  console.log(`  wrote ${out}`);
  console.log(`  wrote ${report}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
