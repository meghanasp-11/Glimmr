#!/usr/bin/env node
/**
 * Audit Batch-02 top-10 service-area assignments against V1 bounds.
 *
 * Reads data/discovery/batch-02/{dossier,queue,readiness}.json plus the V1
 * area bounds — all stay unchanged — and checks every top-10 record's
 * on-file coordinates with bounds math (never the assigned label),
 * cross-checks the stored address against known V1 area names, and marks
 * explicit review cases without changing their verdict math. Records
 * falling outside their assigned bounds are rejected from the batch with a
 * same-area/category replacement named from the existing ranking; the
 * report re-runs area/category coverage and duplicate checks over the final
 * set. Writes only batch-02/area-audit.json + area-audit.md. Nothing is
 * auto-filled, nothing is verified here, and no existing file is modified.
 *
 * Usage:
 *   npm run discovery:audit-batch-areas -w @glimmr/scripts -- [--batch-dir <path>] [--areas-dir <path>] [--focus <id,...>] [--out <path>] [--report <path>] [--dry-run]
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditRecord,
  buildRankedList,
  coverageCounts,
  findDuplicatePairs,
  renderAreaAuditReport,
  selectReplacement,
  type AreaAuditFinding,
  type AreaInfo,
  type RankedPoolEntry,
  type ReplacementPick,
} from "./audit-areas";
import type { ServiceArea } from "../../../artifacts/glimmr/src/schemas/glimmr.schema";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_BATCH_DIR = path.join(REPO_ROOT, "data", "discovery", "batch-02");
const DEFAULT_AREAS = path.join(REPO_ROOT, "data", "production");
const DEFAULT_OUT = path.join(DEFAULT_BATCH_DIR, "area-audit.json");
const DEFAULT_REPORT = path.join(DEFAULT_BATCH_DIR, "area-audit.md");

function parseArgs(argv: string[]): {
  batchDir: string;
  areasDir: string;
  focus: string[];
  out: string;
  report: string;
  dryRun: boolean;
} {
  let batchDir = DEFAULT_BATCH_DIR;
  let areasDir = DEFAULT_AREAS;
  let focus: string[] = [];
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
    } else if (arg === "--areas-dir") {
      areasDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--focus") {
      focus = takeValue(arg, i).split(",").map((id) => id.trim()).filter((id) => id.length > 0); i += 1;
    } else if (arg === "--out") {
      out = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--report") {
      report = path.resolve(takeValue(arg, i)); i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}".`);
    }
  }
  return { batchDir, areasDir, focus, out, report, dryRun };
}

interface DossierField {
  value?: unknown;
  status?: unknown;
}

interface DossierRecord {
  overture_id: string;
  name: string;
  service_area: string;
  completeness: number;
  flags: string[];
  fields: Record<string, DossierField>;
}

async function main(): Promise<void> {
  const { batchDir, areasDir, focus, out, report, dryRun } = parseArgs(process.argv.slice(2));
  const focusSet = new Set(focus);

  const areaById = new Map<string, AreaInfo>();
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
      areaById.set(raw.serviceArea.id, {
        id: raw.serviceArea.id,
        name: raw.serviceArea.name,
        bounds: raw.serviceArea.bounds,
      });
    }
  }
  const areas = [...areaById.values()].sort((a, b) => (a.id < b.id ? -1 : 1));

  const dossierRaw = JSON.parse(await readFile(path.join(batchDir, "dossier.json"), "utf8")) as {
    overture_release?: unknown;
    records_ranked?: DossierRecord[];
  };
  if (!Array.isArray(dossierRaw.records_ranked)) throw new Error(`"${path.join(batchDir, "dossier.json")}" is not a dossier file.`);
  const release = typeof dossierRaw.overture_release === "string" ? dossierRaw.overture_release : "unknown";
  const dossierById = new Map(dossierRaw.records_ranked.map((record) => [record.overture_id, record]));

  const queueRaw = JSON.parse(await readFile(path.join(batchDir, "queue.json"), "utf8")) as {
    queue?: { overture_id?: unknown; name?: unknown; service_area?: unknown; glimmr_category?: unknown }[];
  };
  const queueMeta = new Map<string, { name: string; service_area: string; glimmr_category: string }>();
  for (const entry of queueRaw.queue ?? []) {
    if (typeof entry.overture_id !== "string") continue;
    queueMeta.set(entry.overture_id, {
      name: typeof entry.name === "string" ? entry.name : entry.overture_id,
      service_area: typeof entry.service_area === "string" ? entry.service_area : "unknown",
      glimmr_category: typeof entry.glimmr_category === "string" ? entry.glimmr_category : "unknown",
    });
  }

  const readinessRaw = JSON.parse(await readFile(path.join(batchDir, "readiness.json"), "utf8")) as {
    top10?: unknown;
    results?: { overture_id?: unknown; blockerCount?: unknown; blockers?: unknown }[];
  };
  if (!Array.isArray(readinessRaw.top10) || !readinessRaw.top10.every((id) => typeof id === "string")) {
    throw new Error(`"${path.join(batchDir, "readiness.json")}" has no string top-10 list.`);
  }
  const top10 = readinessRaw.top10 as string[];
  const readinessById = new Map<string, { blockerCount: number; blockers: string[] }>();
  for (const result of readinessRaw.results ?? []) {
    if (typeof result.overture_id !== "string" || typeof result.blockerCount !== "number" || !Array.isArray(result.blockers)) {
      continue;
    }
    readinessById.set(result.overture_id, {
      blockerCount: result.blockerCount,
      blockers: result.blockers.filter((b): b is string => typeof b === "string"),
    });
  }

  // Full ranking recomputed with the existing rule, so replacements come
  // from the established order rather than a new one.
  const ranked = buildRankedList(
    dossierRaw.records_ranked.map((record) => ({
      overture_id: record.overture_id,
      name: record.name,
      service_area: record.service_area,
      completeness: record.completeness,
      flags: record.flags,
      fields: record.fields,
    })),
    readinessById,
  );
  const rankedPool: RankedPoolEntry[] = ranked.map((item) => {
    const dossier = dossierById.get(item.overture_id);
    const meta = queueMeta.get(item.overture_id);
    return {
      overture_id: item.overture_id,
      name: item.name,
      service_area: dossier?.service_area ?? meta?.service_area ?? "unknown",
      glimmr_category: item.glimmr_category,
      lat: dossier?.fields["lat"]?.value,
      lng: dossier?.fields["lng"]?.value,
    };
  });
  const recomputedTop10 = ranked.slice(0, 10).map((item) => item.overture_id);
  const rankingMatches =
    recomputedTop10.length === top10.length && recomputedTop10.every((id, index) => id === top10[index]);
  if (!rankingMatches) {
    throw new Error(
      `Recomputed ranking differs from readiness.json top-10; refusing to audit against a drifted order. ` +
        `Re-run discovery:evaluate-batch-02 first.`,
    );
  }

  const findings: AreaAuditFinding[] = [];
  for (const id of top10) {
    const dossier = dossierById.get(id);
    if (dossier === undefined) throw new Error(`Top-10 record "${id}" has no dossier entry.`);
    findings.push(
      auditRecord(
        {
          overture_id: id,
          name: dossier.name,
          service_area: dossier.service_area,
          lat: dossier.fields["lat"]?.value,
          lng: dossier.fields["lng"]?.value,
          address: dossier.fields["address"]?.value,
        },
        areaById,
        areas,
        focusSet.has(id),
      ),
    );
  }

  const replacements: ReplacementPick[] = [];
  const rejectedIds = new Set<string>();
  const excluded = new Set<string>(top10);
  for (const finding of findings) {
    if (finding.verdict !== "out-of-bounds") continue;
    const meta = queueMeta.get(finding.overture_id);
    const area = finding.assigned_area;
    const category = meta?.glimmr_category ?? "unknown";
    const pick = selectReplacement(finding.overture_id, area, category, rankedPool, areaById, excluded);
    if (pick === null) {
      throw new Error(
        `No valid same-area/category replacement for rejected "${finding.overture_id}" (${area} / ${category}).`,
      );
    }
    rejectedIds.add(finding.overture_id);
    excluded.add(pick.overture_id);
    replacements.push({
      rejected_id: finding.overture_id,
      rejected_name: finding.name,
      reason: finding.detail,
      replacement_id: pick.overture_id,
      replacement_name: pick.name,
      replacement_area: area,
      replacement_category: category,
    });
  }
  const replacementByRejected = new Map(replacements.map((r) => [r.rejected_id, r]));
  const finalTop10 = top10.map((id) => replacementByRejected.get(id)?.replacement_id ?? id);

  const coverage = coverageCounts(
    finalTop10.map((id) => {
      const dossier = dossierById.get(id);
      const meta = queueMeta.get(id);
      return {
        service_area: dossier?.service_area ?? meta?.service_area ?? "unknown",
        glimmr_category: meta?.glimmr_category ?? "unknown",
      };
    }),
  );
  const duplicates = findDuplicatePairs(
    finalTop10.map((id) => {
      const dossier = dossierById.get(id);
      const meta = queueMeta.get(id);
      return {
        overture_id: id,
        name: dossier?.name ?? meta?.name ?? id,
        address: typeof dossier?.fields["address"]?.value === "string" ? (dossier.fields["address"].value as string) : null,
        lat: dossier?.fields["lat"]?.value,
        lng: dossier?.fields["lng"]?.value,
      };
    }),
  );

  const inBounds = findings.filter((f) => f.verdict === "in-bounds").length;
  console.log(`area audit: ${inBounds} of ${findings.length} top-10 in-bounds, ${replacements.length} rejected/replaced.`);
  for (const finding of findings) {
    console.log(`- ${finding.overture_id.slice(0, 8)} ${finding.name.slice(0, 40)}: ${finding.verdict}${finding.explicit_review ? " [explicit review]" : ""}`);
  }

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify({ source: "glimmr_batch_02_area_audit", overture_release: release, findings, replacements, coverage, duplicates, final_top10: finalTop10 }, null, 2)}\n`,
  );
  await writeFile(report, renderAreaAuditReport({ overture_release: release, findings, replacements, coverage, duplicates }, finalTop10));
  console.log(`  wrote ${out}`);
  console.log(`  wrote ${report}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
