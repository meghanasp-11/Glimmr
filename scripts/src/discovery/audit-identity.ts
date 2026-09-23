#!/usr/bin/env node
/**
 * Audit Batch-02 top-10 exact venue identity before enrichment.
 *
 * Reads data/discovery/batch-02/{readiness,dossier,queue}.json plus the V1
 * area bounds — all stay unchanged — and compares each record's Overture
 * name/address/coordinates against its cited website/source identity. Chain
 * peers sharing a normalized base name are treated as separate branch
 * entities citing only their own source; renames are preserved verbatim
 * and flagged; explicit `--separate A:B` pairs stay separate unless A's own
 * source proves identity. Marks are verified/conflicting/needs_manual_review
 * and nothing is corrected here. Writes only batch-02/identity-audit.json +
 * identity-audit.md. No fetching, no invented facts, no enrichment fields.
 *
 * Usage:
 *   npm run discovery:audit-identity -w @glimmr/scripts -- [--batch-dir <path>] [--areas-dir <path>] [--reviews-dir <path>] [--focus <id,...>] [--separate <a:b,...>] [--note <id:text>...] [--out <path>] [--report <path>] [--dry-run]
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIdentityAudit,
  renderIdentityAuditMd,
  toIdentityInput,
  type DossierLike,
  type IdentityRecordInput,
} from "./identity-audit";
import { chainBase } from "./research-manifest";
import type { AreaBounds } from "./audit-areas";
import type { ServiceArea } from "../../../artifacts/glimmr/src/schemas/glimmr.schema";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_BATCH_DIR = path.join(REPO_ROOT, "data", "discovery", "batch-02");
const DEFAULT_AREAS = path.join(REPO_ROOT, "data", "production");
const DEFAULT_OUT = path.join(DEFAULT_BATCH_DIR, "identity-audit.json");
const DEFAULT_REPORT = path.join(DEFAULT_BATCH_DIR, "identity-audit.md");

function parseArgs(argv: string[]): {
  batchDir: string;
  areasDir: string;
  reviewsDir: string | null;
  focus: string[];
  separate: [string, string][];
  notes: [string, string][];
  out: string;
  report: string;
  dryRun: boolean;
} {
  let batchDir = DEFAULT_BATCH_DIR;
  let areasDir = DEFAULT_AREAS;
  let reviewsDir: string | null = path.join(REPO_ROOT, "data", "discovery", "reviews");
  let focus: string[] = [];
  let separate: [string, string][] = [];
  let notes: [string, string][] = [];
  let out = DEFAULT_OUT;
  let report = DEFAULT_REPORT;
  let dryRun = false;
  const takeValue = (flag: string, i: number): string => {
    const value = argv[i + 1];
    if (!value) throw new Error(`${flag} requires a value.`);
    return value;
  };
  const takeIds = (flag: string, i: number): string[] =>
    takeValue(flag, i).split(",").map((id) => id.trim()).filter((id) => id.length > 0);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--batch-dir") {
      batchDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--areas-dir") {
      areasDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--reviews-dir") {
      reviewsDir = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--focus") {
      focus = takeIds(arg, i); i += 1;
    } else if (arg === "--separate") {
      separate = takeIds(arg, i).map((pair) => {
        const [a, b] = pair.split(":").map((id) => id.trim());
        if (!a || !b) throw new Error(`--separate expects "A:B" pairs, got "${pair}".`);
        return [a, b];
      });
      i += 1;
    } else if (arg === "--note") {
      const raw = takeValue(arg, i);
      const colon = raw.indexOf(":");
      if (colon < 0) throw new Error(`--note expects "id:text", got "${raw}".`);
      const id = raw.slice(0, colon).trim();
      const text = raw.slice(colon + 1).trim();
      if (!id || !text) throw new Error(`--note expects "id:text", got "${raw}".`);
      notes.push([id, text]);
      i += 1;
    } else if (arg === "--out") {
      out = path.resolve(takeValue(arg, i)); i += 1;
    } else if (arg === "--report") {
      report = path.resolve(takeValue(arg, i)); i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}".`);
    }
  }
  return { batchDir, areasDir, reviewsDir, focus, separate, notes, out, report, dryRun };
}

interface WebsiteEvidence {
  url: string | null;
  reachable: boolean;
  title: string | null;
}

function websiteEvidence(record: DossierLike): WebsiteEvidence {
  const fields = [record.fields["name"], record.fields["websiteUrl"]];
  for (const field of [...fields, ...Object.values(record.fields)]) {
    const site = (field as { evidence?: { website?: { url?: unknown; reachable?: unknown; page_title?: unknown } } } | undefined)?.evidence?.website;
    if (site && typeof site.url === "string") {
      return {
        url: site.url,
        reachable: site.reachable === true,
        title: typeof site.page_title === "string" ? site.page_title : null,
      };
    }
  }
  return { url: null, reachable: false, title: null };
}

async function main(): Promise<void> {
  const { batchDir, areasDir, reviewsDir, focus, separate, notes, out, report, dryRun } = parseArgs(process.argv.slice(2));
  const focusSet = new Set(focus);
  const notesById = new Map<string, string[]>();
  for (const [id, text] of notes) {
    const list = notesById.get(id) ?? [];
    list.push(text);
    notesById.set(id, list);
  }

  // Review-file lookup for --separate targets living outside this batch
  // (e.g. a Batch-01 entity). Read-only; names come from fields.name.value.
  const reviewNames = new Map<string, { name: string; service_area: string }>();
  if (reviewsDir !== null) {
    const areaDirs = await readdir(reviewsDir, { withFileTypes: true }).catch(() => null);
    if (areaDirs !== null) {
      for (const areaDir of areaDirs) {
        if (!areaDir.isDirectory()) continue;
        for (const file of await readdir(path.join(reviewsDir, areaDir.name))) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = JSON.parse(await readFile(path.join(reviewsDir, areaDir.name, file), "utf8")) as {
              overture_id?: unknown;
              service_area?: unknown;
              fields?: { name?: { value?: unknown } };
            };
            if (typeof raw.overture_id === "string") {
              reviewNames.set(raw.overture_id, {
                name: typeof raw.fields?.name?.value === "string" ? raw.fields.name.value : raw.overture_id,
                service_area: typeof raw.service_area === "string" ? raw.service_area : "unknown",
              });
            }
          } catch {
            continue;
          }
        }
      }
    }
  }

  const boundsByArea: Record<string, AreaBounds> = {};
  const areaFiles = await readdir(areasDir).catch((err: unknown) => {
    throw new Error(
      `Could not read areas dir "${areasDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  for (const name of areaFiles.filter((file) => file.endsWith(".json")).sort()) {
    const raw = JSON.parse(await readFile(path.join(areasDir, name), "utf8")) as {
      serviceArea?: ServiceArea;
    };
    if (raw.serviceArea && typeof raw.serviceArea.id === "string" && raw.serviceArea.bounds !== undefined) {
      boundsByArea[raw.serviceArea.id] = raw.serviceArea.bounds;
    }
  }

  const readinessRaw = JSON.parse(await readFile(path.join(batchDir, "readiness.json"), "utf8")) as {
    overture_release?: unknown;
    top10?: unknown;
  };
  if (!Array.isArray(readinessRaw.top10) || !readinessRaw.top10.every((id) => typeof id === "string")) {
    throw new Error(`"${path.join(batchDir, "readiness.json")}" has no string top-10 list.`);
  }
  const top10 = readinessRaw.top10 as string[];
  const release = typeof readinessRaw.overture_release === "string" ? readinessRaw.overture_release : "unknown";

  const dossierRaw = JSON.parse(await readFile(path.join(batchDir, "dossier.json"), "utf8")) as {
    records_ranked?: DossierLike[];
  };
  if (!Array.isArray(dossierRaw.records_ranked)) throw new Error(`"${path.join(batchDir, "dossier.json")}" is not a dossier file.`);
  const dossierById = new Map(dossierRaw.records_ranked.map((record) => [record.overture_id, record]));

  // Chain peers share a normalized base name with a different record id.
  // Evidence is never merged: each finding cites only its own source.
  const peersById = new Map<string, { overture_id: string; name: string }[]>();
  for (const id of top10) {
    const record = dossierById.get(id);
    if (record === undefined) throw new Error(`Top-10 record "${id}" has no dossier entry.`);
    peersById.set(
      id,
      top10
        .filter((peer) => peer !== id)
        .map((peer) => dossierById.get(peer))
        .filter((peer): peer is DossierLike => peer !== undefined)
        .filter((peer) => chainBase(peer.name) === chainBase(record.name))
        .map((peer) => ({ overture_id: peer.overture_id, name: peer.name })),
    );
  }

  const separateById = new Map<string, { overture_id: string; name: string }[]>();
  for (const [a, b] of separate) {
    const dossierOther = dossierById.get(b);
    const reviewOther = reviewNames.get(b);
    const otherName = dossierOther?.name ?? reviewOther?.name;
    if (otherName === undefined) {
      throw new Error(`--separate target "${b}" found in neither the batch dossier nor the reviews dir.`);
    }
    const list = separateById.get(a) ?? [];
    list.push({ overture_id: b, name: otherName });
    separateById.set(a, list);
  }

  const records: Record<string, IdentityRecordInput> = {};
  for (const id of top10) {
    const dossier = dossierById.get(id);
    if (dossier === undefined) throw new Error(`Top-10 record "${id}" has no dossier entry.`);
    records[id] = toIdentityInput(dossier, websiteEvidence(dossier));
  }

  const audit = buildIdentityAudit(
    top10,
    records,
    {
      boundsByArea,
      peersById: Object.fromEntries(peersById),
      separateById: Object.fromEntries(separateById),
      explicitIds: focusSet,
      notesById: Object.fromEntries(notesById),
    },
    undefined,
  );
  // Re-stamp release from the readiness file (buildIdentityAudit leaves it blank).
  const stamped = { ...audit, overture_release: release };

  console.log(
    `identity audit: ${stamped.counts.verified} verified, ${stamped.counts.conflicting} conflicting, ${stamped.counts.needs_manual_review} needs_manual_review of ${stamped.counts.total}.`,
  );
  for (const place of stamped.places) {
    console.log(`- ${place.overture_id.slice(0, 8)} ${place.overture_name.slice(0, 40)}: ${place.verdict}${place.explicit_review ? " [explicit review]" : ""}`);
  }

  if (dryRun) {
    console.log("Dry run: wrote nothing.");
    return;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(stamped, null, 2)}\n`);
  await writeFile(report, renderIdentityAuditMd(stamped, release));
  console.log(`  wrote ${out}`);
  console.log(`  wrote ${report}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
