/**
 * First manual-verification batch: top dossier records → review files.
 *
 * Takes the highest-priority dossier records by verification completeness
 * and writes one review file per place in the existing reviewed-place
 * format (data/discovery/reviews/<area>/<overture_id>.json). Status mapping
 * is strict:
 * - dossier `verified` → review `verified`, source cited (evidence URL when
 *   corroboration came from a fetch, else the Overture release label);
 * - dossier `needs_manual_review` / `conflicting` / `missing` → review
 *   `missing` with a reason naming the dossier status and where to check
 *   (values are NOT carried as facts; leads stay in reason text only).
 * - Curated attributes (price, hours, duration, activities, suitability,
 *   vibe, scores) stay missing unless a draft already holds an explicitly
 *   verified value — drafts never do, so the batch never invents them.
 *
 * Each review file also carries the official/secondary URL, the evidence
 * summary, dossier flags, and its dossier rank; together the per-field
 * statuses form the field-by-field checklist. Pure functions (no network,
 * no Firestore). Inputs are never mutated.
 */

export type DossierStatus = "verified" | "missing" | "conflicting" | "needs_manual_review";

export interface DossierFieldInput {
  value: unknown;
  status: DossierStatus;
  flags: string[];
  note: string;
  evidence: {
    website: { url: string | null; reachable: boolean; page_title: string | null };
    [bucket: string]: unknown;
  };
}

export interface DossierRecordInput {
  overture_id: string;
  service_area: string;
  name: string;
  dossier_rank: number;
  completeness: number;
  flags: string[];
  fields: Record<string, DossierFieldInput>;
  provenance: {
    overture_release: string;
    sources: unknown[];
    evidence_source_url: string | null;
    evidence_fetched_at: string | null;
  };
}

export type ReviewStatus = "verified" | "curated" | "missing" | "rejected";

export interface ReviewField {
  value: unknown;
  status: ReviewStatus;
  source?: string;
  reason?: string;
}

export interface BatchReviewFile {
  overture_id: string;
  service_area: string;
  dossier_rank: number;
  dossier_completeness: number;
  dossier_flags: string[];
  evidence: {
    source_url: string | null;
    fetched_at_utc: string | null;
    page_title: string | null;
    website_reachable: boolean;
  };
  fields: Record<string, ReviewField>;
}

export const BATCH_SIZE = 10;

/** Top records by dossier rank (ties broken by Overture id, deterministic). */
export function selectBatch(
  records: DossierRecordInput[],
  size: number = BATCH_SIZE,
): BatchReviewFile[] {
  return [...records]
    .sort((a, b) => a.dossier_rank - b.dossier_rank || (a.overture_id < b.overture_id ? -1 : 1))
    .slice(0, Math.max(0, size))
    .map((record) => dossierToReview(record));
}

/** Human-readable ranked review report for a batch. */
export function renderBatchReport(batch: BatchReviewFile[], overtureRelease: string): string {
  const lines = [
    "# Glimmr manual verification batch",
    "",
    `Top ${batch.length} dossier records by verification completeness (Overture release ${overtureRelease}).`,
    "Verify each field against its cited source; fill curated attributes by hand.",
    "Never invent a fact that is not on the cited source.",
    "",
  ];
  for (const file of batch) {
    const missing = Object.entries(file.fields)
      .filter(([, field]) => field.status === "missing")
      .map(([name]) => name);
    lines.push(
      `## #${file.dossier_rank} ${file.fields["name"]?.value ?? file.overture_id}`,
      "",
      `- Area: ${file.service_area} · Dossier completeness: ${(file.dossier_completeness * 100).toFixed(0)}%` +
        (file.dossier_flags.length > 0 ? ` · Flags: ${file.dossier_flags.join(", ")}` : ""),
      `- Official URL: ${file.evidence.source_url ?? "none on file"}` +
        (file.evidence.page_title ? ` · "${file.evidence.page_title}"` : ""),
      `- Verified carried over: ${Object.entries(file.fields)
        .filter(([, field]) => field.status === "verified")
        .map(([name]) => name)
        .join(", ") || "none"}`,
      `- Still to verify (${missing.length}): ${missing.join(", ") || "none"}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Curated attributes: only ever carried when explicitly verified already. */
const CURATED_FIELDS = new Set([
  "priceMin", "priceMax", "priceBasis", "openingHours", "typicalVisitDuration",
  "suitableFor", "activities", "vibe", "experienceScore", "rating", "reviewCount",
]);

function reviewSource(
  record: DossierRecordInput,
  field: string,
  dossierStatus: DossierStatus,
): string {
  const evidenceUrl = record.provenance.evidence_source_url;
  if (dossierStatus === "verified" && evidenceUrl && ["name", "address", "websiteUrl"].includes(field)) {
    return evidenceUrl;
  }
  return `overture:${record.provenance.overture_release}`;
}

function missingReason(record: DossierRecordInput, field: string, dossierStatus: DossierStatus): string {
  const where = record.provenance.evidence_source_url
    ? `check ${record.provenance.evidence_source_url}`
    : `check overture:${record.provenance.overture_release}`;
  if (dossierStatus === "conflicting") {
    const flags = (record.fields[field]?.flags ?? []).join(", ");
    return `Dossier flagged this field conflicting${flags ? ` (${flags})` : ""} — resolve before verifying; ${where}.`;
  }
  const current = record.fields[field]?.value;
  const lead =
    current !== null && current !== undefined && current !== "" && !(Array.isArray(current) && current.length === 0)
      ? ` Overture reports ${JSON.stringify(current)} — confirm, do not assume.`
      : "";
  return `Not verified yet.${lead} ${where}.`.replace("  ", " ");
}

/**
 * Map one dossier record into a review file. Verified values are preserved
 * with cited sources; everything else becomes missing-with-reason.
 */
export function dossierToReview(record: DossierRecordInput): BatchReviewFile {
  const fields: Record<string, ReviewField> = {};
  for (const [field, dossierField] of Object.entries(record.fields)) {
    if (dossierField.status === "verified") {
      fields[field] = { value: dossierField.value, status: "verified", source: reviewSource(record, field, "verified") };
    } else {
      fields[field] = { value: null, status: "missing", reason: missingReason(record, field, dossierField.status) };
    }
  }
  const websiteEvidence = record.fields["websiteUrl"]?.evidence?.website;
  return {
    overture_id: record.overture_id,
    service_area: record.service_area,
    dossier_rank: record.dossier_rank,
    dossier_completeness: record.completeness,
    dossier_flags: [...record.flags],
    evidence: {
      source_url: record.provenance.evidence_source_url,
      fetched_at_utc: record.provenance.evidence_fetched_at,
      page_title: websiteEvidence?.page_title ?? null,
      website_reachable: websiteEvidence?.reachable ?? false,
    },
    fields,
  };
}
