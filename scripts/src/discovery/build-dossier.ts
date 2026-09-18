#!/usr/bin/env node
/**
 * Build the verification dossier from drafts + evidence.
 *
 * Reads data/discovery/verification/<area>/*.json drafts and
 * data/discovery/evidence.json — all stay unchanged — and writes one
 * ranked review record per queued place to data/discovery/dossier.json.
 * Only the 40 verification-queue members are included. Nothing is
 * converted into curated facts; unknowns stay explicit.
 *
 * Usage:
 *   npm run discovery:dossier -w @glimmr/scripts -- [--queue <path>] [--drafts-dir <path>] [--evidence <path>] [--out <path>] [--dry-run]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossierRecord, rankDossier, type DraftInput, type EvidenceInput } from "./dossier";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_QUEUE = path.join(REPO_ROOT, "data", "discovery", "verification-queue.json");
const DEFAULT_DRAFTS = path.join(REPO_ROOT, "data", "discovery", "verification");
const DEFAULT_EVIDENCE = path.join(REPO_ROOT, "data", "discovery", "evidence.json");
const DEFAULT_OUT = path.join(REPO_ROOT, "data", "discovery", "dossier.json");

function parseArgs(argv: string[]): { queue: string; draftsDir: string; evidence: string; out: string; dryRun: boolean } {
  let queue = DEFAULT_QUEUE;
  let draftsDir = DEFAULT_DRAFTS;
  let evidence = DEFAULT_EVIDENCE;
  let out = DEFAULT_OUT;
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
    } else if (arg === "--queue") {
      queue = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--drafts-dir") {
      draftsDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--evidence") {
      evidence = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--out") {
      out = path.resolve(takeValue(arg, i)); i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}".`);
    }
  }
  return { queue, draftsDir, evidence, out, dryRun };
}

const EMPTY_EVIDENCE: EvidenceInput = {
  source_url: null,
  fetched_at_utc: null,
  page_title: null,
  website_reachable: false,
  snippets: { hours: [], pricing: [], address: [], status: [] },
  failure: { reason: "no-url" },
};

async function main(): Promise<void> {
  const { queue, draftsDir, evidence: evidencePath, out, dryRun } = parseArgs(process.argv.slice(2));

  const queueRaw = JSON.parse(await readFile(queue, "utf8")) as { queue?: { overture_id?: unknown }[] };
  if (!Array.isArray(queueRaw.queue)) throw new Error(`"${queue}" is not a verification queue file.`);
  const queuedIds = new Set(
    queueRaw.queue.filter((item) => typeof item.overture_id === "string").map((item) => item.overture_id as string),
  );

  const evidenceRaw = JSON.parse(await readFile(evidencePath, "utf8")) as {
    overture_release?: unknown;
    evidence?: ({ overture_id?: unknown } & Partial<EvidenceInput>)[];
  };
  if (!Array.isArray(evidenceRaw.evidence)) throw new Error(`"${evidencePath}" is not an evidence file.`);
  const release = typeof evidenceRaw.overture_release === "string" ? evidenceRaw.overture_release : "unknown";
  const evidenceById = new Map<string, EvidenceInput>();
  for (const item of evidenceRaw.evidence) {
    if (typeof item.overture_id !== "string") continue;
    evidenceById.set(item.overture_id, {
      source_url: item.source_url ?? null,
      fetched_at_utc: item.fetched_at_utc ?? null,
      page_title: item.page_title ?? null,
      website_reachable: item.website_reachable ?? false,
      snippets: item.snippets ?? { hours: [], pricing: [], address: [], status: [] },
      failure: item.failure ?? null,
    });
  }

  const areaDirs = await readdir(draftsDir, { withFileTypes: true }).catch((err: unknown) => {
    throw new Error(
      `Could not read drafts dir "${draftsDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  const drafts: DraftInput[] = [];
  for (const areaDir of areaDirs) {
    if (!areaDir.isDirectory()) continue;
    const files = await readdir(path.join(draftsDir, areaDir.name));
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const draft = JSON.parse(await readFile(path.join(draftsDir, areaDir.name, file), "utf8")) as DraftInput;
      if (typeof draft.overture_id === "string" && queuedIds.has(draft.overture_id)) drafts.push(draft);
    }
  }
  if (drafts.length === 0) throw new Error(`No queued drafts found in "${draftsDir}". Run discovery:verify first.`);
  const missingDrafts = [...queuedIds].filter((id) => !drafts.some((draft) => draft.overture_id === id));
  if (missingDrafts.length > 0) {
    console.warn(`warning: ${missingDrafts.length} queued place(s) have no draft and are skipped.`);
  }

  const nowMs = Date.now();
  const ranked = rankDossier(
    drafts.map((draft) => buildDossierRecord(draft, evidenceById.get(draft.overture_id) ?? EMPTY_EVIDENCE, nowMs)),
  );

  const statusTotals = { verified: 0, missing: 0, conflicting: 0, needs_manual_review: 0 };
  const flagTotals: Record<string, number> = {};
  for (const record of ranked) {
    for (const status of Object.keys(statusTotals) as (keyof typeof statusTotals)[]) {
      statusTotals[status] += record.counts[status];
    }
    for (const flag of record.flags) flagTotals[flag] = (flagTotals[flag] ?? 0) + 1;
  }
  console.log(`dossier: ${ranked.length} records (release ${release})`);
  console.log(`field statuses: ${JSON.stringify(statusTotals)}`);
  console.log(`flags: ${JSON.stringify(flagTotals)}`);
  console.log(`top record: ${ranked[0].name} (completeness ${ranked[0].completeness.toFixed(2)})`);

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await writeFile(
    out,
    `${JSON.stringify({ source: "glimmr_verification_dossier", overture_release: release, records: ranked.length, status_totals: statusTotals, flag_totals: flagTotals, records_ranked: ranked }, null, 2)}\n`,
  );
  console.log(`  wrote ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
