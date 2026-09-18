#!/usr/bin/env node
/**
 * Collect public evidence for the verification queue.
 *
 * Fetches ONLY URLs already on file (official website first, then secondary
 * URLs) with politeness delay, timeout, and retries. Blocked hosts (Google
 * Maps, Zomato, Swiggy, Instagram) are never fetched. Every outcome —
 * including failures — becomes a record; the pipeline never crashes on a
 * bad fetch. Evidence is stored as raw snippets only, never converted into
 * curated facts.
 *
 * Reads data/discovery/verification-queue.json (unchanged). Writes:
 * - data/discovery/evidence.json (machine-readable per-place evidence)
 * - data/discovery/evidence-report.md (verified vs missing per place)
 *
 * Usage:
 *   npm run discovery:evidence -w @glimmr/scripts -- [--queue <path>] [--out <path>] [--report <path>] [--limit N] [--delay-ms N] [--dry-run]
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectEvidence, type PlaceEvidence } from "./evidence";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_QUEUE = path.join(REPO_ROOT, "data", "discovery", "verification-queue.json");
const DEFAULT_OUT = path.join(REPO_ROOT, "data", "discovery", "evidence.json");
const DEFAULT_REPORT = path.join(REPO_ROOT, "data", "discovery", "evidence-report.md");
const DEFAULT_DELAY_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv: string[]): {
  queue: string;
  out: string;
  report: string;
  limit: number;
  delayMs: number;
  dryRun: boolean;
} {
  let queue = DEFAULT_QUEUE;
  let out = DEFAULT_OUT;
  let report = DEFAULT_REPORT;
  let limit = Number.POSITIVE_INFINITY;
  let delayMs = DEFAULT_DELAY_MS;
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
    } else if (arg === "--out") {
      out = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--report") {
      report = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--limit") {
      limit = Number(takeValue(arg, i));
      if (!Number.isInteger(limit) || limit < 0) throw new Error("--limit must be a non-negative integer.");
      i += 1;
    } else if (arg === "--delay-ms") {
      delayMs = Number(takeValue(arg, i));
      if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("--delay-ms must be non-negative.");
      i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}".`);
    }
  }
  return { queue, out, report, limit, delayMs, dryRun };
}

function renderReport(
  results: { name: string; service_area: string; evidence: PlaceEvidence }[],
  release: string,
): string {
  const ok = results.filter((r) => r.evidence.failure === null);
  const failed = results.filter((r) => r.evidence.failure !== null);
  const lines = [
    "# Glimmr evidence report",
    "",
    `${ok.length} of ${results.length} places have fetched evidence (Overture release ${release}).`,
    "Snippets are raw page excerpts — verification against them is still a human step.",
    "",
    "## Evidence on file",
    "",
  ];
  for (const { name, service_area, evidence } of ok) {
    const counts = (Object.entries(evidence.snippets) as [string, string[]][])
      .map(([kind, list]) => `${kind} ${list.length}`)
      .join(", ");
    lines.push(
      `- ${name} (${service_area}) — ${evidence.source_url} · "${evidence.page_title ?? "untitled"}" · ${counts}`,
    );
  }
  lines.push("", "## Missing evidence", "");
  if (failed.length === 0) {
    lines.push("None — every place returned evidence.");
  }
  for (const { name, service_area, evidence } of failed) {
    lines.push(
      `- ${name} (${service_area}) — ${evidence.source_url ?? "no URL"} · ${evidence.failure?.reason}: ${evidence.failure?.detail ?? ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const { queue, out, report, limit, delayMs, dryRun } = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(await readFile(queue, "utf8")) as {
    overture_release?: unknown;
    queue?: { overture_id?: unknown; name?: unknown; service_area?: unknown; website?: unknown }[];
  };
  if (!Array.isArray(raw.queue)) throw new Error(`"${queue}" is not a verification queue file.`);
  const release = typeof raw.overture_release === "string" ? raw.overture_release : "unknown";
  const places = raw.queue.slice(0, limit);

  const results: { name: string; service_area: string; evidence: PlaceEvidence }[] = [];
  for (const [index, place] of places.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    const overtureId = typeof place.overture_id === "string" ? place.overture_id : `unknown-${index}`;
    try {
      const evidence = await collectEvidence(overtureId, {
        official: typeof place.website === "string" ? place.website : null,
      });
      results.push({
        name: typeof place.name === "string" ? place.name : overtureId,
        service_area: typeof place.service_area === "string" ? place.service_area : "unknown",
        evidence,
      });
    } catch (err) {
      results.push({
        name: typeof place.name === "string" ? place.name : overtureId,
        service_area: typeof place.service_area === "string" ? place.service_area : "unknown",
        evidence: {
          overture_id: overtureId,
          url_type: "none",
          source_url: null,
          fetched_at_utc: new Date().toISOString(),
          http_status: null,
          page_title: null,
          website_reachable: false,
          snippets: { hours: [], pricing: [], address: [], status: [] },
          failure: {
            reason: "network-error",
            detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
            attempts: 0,
          },
        },
      });
    }
    const done = results[results.length - 1];
    console.log(
      `[${index + 1}/${places.length}] ${done.name} — ` +
        (done.evidence.failure === null
          ? `ok (${done.evidence.source_url})`
          : `FAILED (${done.evidence.failure.reason})`),
    );
  }

  const okCount = results.filter((r) => r.evidence.failure === null).length;
  console.log(`evidence: ${okCount}/${results.length} fetched, ${results.length - okCount} failed.`);

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await writeFile(
    out,
    `${JSON.stringify({ source: "glimmr_place_evidence", overture_release: release, fetched: results.length, evidence: results.map((r) => ({ name: r.name, service_area: r.service_area, ...r.evidence })) }, null, 2)}\n`,
  );
  await writeFile(report, renderReport(results, release));
  console.log(`  wrote ${out}`);
  console.log(`  wrote ${report}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
