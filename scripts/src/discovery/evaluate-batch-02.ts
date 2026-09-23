#!/usr/bin/env node
/**
 * Evaluate Batch-02 readiness from its dossier (dry-run report only).
 *
 * Reads data/discovery/batch-02/dossier.json plus the V1 area bounds — all
 * stay unchanged — maps each dossier record to review shape with the same
 * strict mapping as the batch builder (verified stays verified with cited
 * source; everything else missing-with-reason, never invented), runs
 * recommendation-readiness evaluation, ranks by production-readiness
 * likelihood, and writes batch-02/readiness.json + readiness.md.
 * Nothing is auto-filled and nothing is written except those two files.
 *
 * Usage:
 *   npm run discovery:evaluate-batch-02 -w @glimmr/scripts -- [--dossier <path>] [--areas-dir <path>] [--selection <path>] [--out <path>] [--report <path>] [--dry-run]
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dossierToReview } from "./batch";
import type { DossierRecordInput } from "./batch";
import { evaluateRecommendationReadiness } from "./readiness";
import {
  rankByReadinessPotential,
  renderFollowUpReport,
  type PlaceBlockers,
  type ReadinessRanked,
  type ReportSelection,
} from "./followup";
import type { ServiceArea } from "../../../artifacts/glimmr/src/schemas/glimmr.schema";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_BATCH_DIR = path.join(REPO_ROOT, "data", "discovery", "batch-02");
const DEFAULT_DOSSIER = path.join(DEFAULT_BATCH_DIR, "dossier.json");
const DEFAULT_AREAS = path.join(REPO_ROOT, "data", "production");
const DEFAULT_SELECTION = path.join(DEFAULT_BATCH_DIR, "selection.json");
const DEFAULT_OUT = path.join(DEFAULT_BATCH_DIR, "readiness.json");
const DEFAULT_REPORT = path.join(DEFAULT_BATCH_DIR, "readiness.md");

function parseArgs(argv: string[]): {
  dossier: string;
  areasDir: string;
  selection: string;
  out: string;
  report: string;
  dryRun: boolean;
} {
  let dossier = DEFAULT_DOSSIER;
  let areasDir = DEFAULT_AREAS;
  let selection = DEFAULT_SELECTION;
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
    } else if (arg === "--dossier") {
      dossier = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--areas-dir") {
      areasDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--selection") {
      selection = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--out") {
      out = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--report") {
      report = path.resolve(takeValue(arg, i)); i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}".`);
    }
  }
  return { dossier, areasDir, selection, out, report, dryRun };
}

function snippetCount(field: { evidence?: { pricing?: unknown; hours?: unknown } } | undefined, bucket: "pricing" | "hours"): boolean {
  const list = field?.evidence?.[bucket];
  return Array.isArray(list) && list.length > 0;
}

async function main(): Promise<void> {
  const { dossier, areasDir, selection, out, report, dryRun } = parseArgs(process.argv.slice(2));

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

  const dossierRaw = JSON.parse(await readFile(dossier, "utf8")) as {
    overture_release?: unknown;
    records_ranked?: DossierRecordInput[];
  };
  if (!Array.isArray(dossierRaw.records_ranked)) throw new Error(`"${dossier}" is not a dossier file.`);
  const release = typeof dossierRaw.overture_release === "string" ? dossierRaw.overture_release : "unknown";

  const selectionRaw = JSON.parse(await readFile(selection, "utf8")) as {
    picked?: { overture_id?: unknown; name?: unknown; service_area?: unknown; glimmr_category?: unknown; evidence_score?: unknown }[];
    counts?: ReportSelection["counts"];
  };
  const pickedMeta = (selectionRaw.picked ?? [])
    .filter((p) => typeof p.overture_id === "string")
    .map((p) => ({
      overture_id: p.overture_id as string,
      name: typeof p.name === "string" ? p.name : (p.overture_id as string),
      service_area: typeof p.service_area === "string" ? p.service_area : "unknown",
      glimmr_category: typeof p.glimmr_category === "string" ? p.glimmr_category : "unknown",
      evidence_score: typeof p.evidence_score === "number" ? p.evidence_score : undefined,
    }));
  const reportSelection: ReportSelection = {
    picked: pickedMeta,
    counts: selectionRaw.counts ?? { pool: 0, excluded: 0, picked: pickedMeta.length, areas: {}, categories: {} },
  };

  const ranked: ReadinessRanked[] = [];
  const blockers: PlaceBlockers[] = [];
  const evaluated: Record<string, unknown>[] = [];
  for (const record of dossierRaw.records_ranked) {
    const review = dossierToReview(record);
    const result = evaluateRecommendationReadiness(review, areaById);
    const fields = record.fields as Record<string, { evidence?: { pricing?: unknown; hours?: unknown; website?: { reachable?: unknown } } }>;
    const websiteReachable = fields["websiteUrl"]?.evidence?.website?.reachable === true;
    const category =
      typeof record.fields?.["category"]?.value === "string"
        ? (record.fields["category"].value as string)
        : (pickedMeta.find((p) => p.overture_id === record.overture_id)?.glimmr_category ?? "unknown");
    ranked.push({
      overture_id: record.overture_id,
      name: record.name,
      service_area: record.service_area,
      glimmr_category: category,
      blockerCount: result.blockers.length,
      blockers: [...result.blockers],
      hasPricingEvidence:
        snippetCount(fields["priceMin"], "pricing") ||
        snippetCount(fields["priceMax"], "pricing") ||
        snippetCount(fields["priceBasis"], "pricing"),
      hasHoursEvidence: snippetCount(fields["openingHours"], "hours"),
      websiteReachable,
      completeness: record.completeness,
      flags: [...record.flags],
    });
    blockers.push({ overture_id: record.overture_id, ready: result.ready, blockers: [...result.blockers] });
    evaluated.push({
      overture_id: record.overture_id,
      ready: result.ready,
      blockerCount: result.blockers.length,
      blockers: [...result.blockers],
    });
  }

  const ordered = rankByReadinessPotential(ranked);
  const top10 = ordered.slice(0, 10).map((r) => r.overture_id);
  const readyCount = evaluated.filter((e) => (e as { ready?: unknown }).ready === true).length;
  console.log(`readiness: ${readyCount} of ${evaluated.length} batch-02 place(s) recommendation-ready.`);
  console.log(`top 10: ${top10.join(", ")}`);

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify({ source: "glimmr_batch_02_readiness", overture_release: release, evaluated: evaluated.length, ready: readyCount, top10, results: evaluated }, null, 2)}\n`,
  );
  await writeFile(report, renderFollowUpReport(reportSelection, blockers, top10, release));
  console.log(`  wrote ${out}`);
  console.log(`  wrote ${report}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
