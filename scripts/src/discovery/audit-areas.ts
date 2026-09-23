/**
 * V1 service-area audit for verification batches.
 *
 * Validates each record's on-file coordinates against its ASSIGNED area's
 * bounds from data/production (math, never labels), cross-checks the stored
 * address against known V1 area names, and — only when a record falls
 * outside its assigned bounds — selects a same-area/category replacement
 * from rank order. Coordinates here are unverified Overture leads, so an
 * out-of-bounds verdict means "reject from this batch pending verification",
 * never "the place is definitively elsewhere". Nothing is auto-filled and
 * nothing outside the audit report files is written by this module.
 *
 * Pure functions (no network, no Firestore). Inputs are never mutated.
 */

import { dedupKey } from "./curate";
import { rankByReadinessPotential, type ReadinessRanked } from "./followup";

export interface AreaBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface AreaInfo {
  id: string;
  name: string;
  bounds?: AreaBounds;
}

export type AreaVerdict = "in-bounds" | "out-of-bounds" | "unverifiable" | "area-unknown";

export interface AuditRecordInput {
  overture_id: string;
  name: string;
  service_area: string;
  lat: unknown;
  lng: unknown;
  address: unknown;
}

export interface AreaAuditFinding {
  overture_id: string;
  name: string;
  assigned_area: string;
  lat: unknown;
  lng: unknown;
  address: unknown;
  verdict: AreaVerdict;
  detail: string;
  address_note: string;
  explicit_review: boolean;
}

export interface RankedPoolEntry {
  overture_id: string;
  name: string;
  service_area: string;
  glimmr_category: string;
  lat: unknown;
  lng: unknown;
}

export interface ReplacementPick {
  rejected_id: string;
  rejected_name: string;
  reason: string;
  replacement_id: string;
  replacement_name: string;
  replacement_area: string;
  replacement_category: string;
}

export interface RankDossierField {
  value?: unknown;
  evidence?: { pricing?: unknown; hours?: unknown; website?: { reachable?: unknown } };
}

export interface RankDossierInput {
  overture_id: string;
  name: string;
  service_area: string;
  completeness: number;
  flags: string[];
  fields: Record<string, RankDossierField>;
}

export interface AuditCoverage {
  areas: Record<string, number>;
  categories: Record<string, number>;
}

export interface AreaAuditReport {
  overture_release: string;
  findings: AreaAuditFinding[];
  replacements: ReplacementPick[];
  coverage: AuditCoverage;
  duplicates: { idA: string; idB: string; key: string }[];
}

/** Strict inclusive bounds check; non-finite inputs never pass. */
export function pointInBounds(lat: number, lng: number, bounds: AreaBounds): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

function normalizeAreaToken(value: string): string {
  return value.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Mechanical cross-check: does the address name a KNOWN V1 area (from the
 * production area files, never an invented list)? Returns that area's id,
 * or null when the address names no V1 area.
 */
export function addressNamesArea(address: unknown, areas: AreaInfo[]): string | null {
  if (typeof address !== "string" || address.trim().length === 0) return null;
  const text = normalizeAreaToken(address);
  for (const area of areas) {
    const token = normalizeAreaToken(area.name);
    if (token.length > 0 && text.includes(token)) return area.id;
  }
  return null;
}

/**
 * Audit one record against its assigned area's bounds. The verdict comes
 * from bounds math on the on-file coordinate values; the assigned label is
 * never trusted. `explicitReview` only annotates the finding for cases
 * that need human eyes regardless of the math.
 */
export function auditRecord(
  record: AuditRecordInput,
  areaById: Map<string, AreaInfo>,
  areas: AreaInfo[],
  explicitReview: boolean,
): AreaAuditFinding {
  const base = {
    overture_id: record.overture_id,
    name: record.name,
    assigned_area: record.service_area,
    lat: record.lat,
    lng: record.lng,
    address: record.address,
    explicit_review: explicitReview,
  };
  const namedArea = addressNamesArea(record.address, areas);
  const address_note =
    namedArea === null
      ? "address names no V1 area"
      : namedArea === record.service_area
        ? "address names its assigned area"
        : `address-area mismatch: names "${namedArea}" but assigned "${record.service_area}"`;
  const prefix = explicitReview ? "Explicit review case. " : "";

  const area = areaById.get(record.service_area);
  if (area === undefined || area.bounds === undefined) {
    return {
      ...base,
      verdict: "area-unknown",
      detail: `${prefix}assigned area "${record.service_area}" has no V1 bounds on file; cannot check coordinates.`,
      address_note,
    };
  }
  if (typeof record.lat !== "number" || typeof record.lng !== "number" ||
    !Number.isFinite(record.lat) || !Number.isFinite(record.lng)) {
    return {
      ...base,
      verdict: "unverifiable",
      detail: `${prefix}no finite on-file coordinates to check against "${area.id}" bounds.`,
      address_note,
    };
  }
  const { north, south, east, west } = area.bounds;
  if (pointInBounds(record.lat, record.lng, area.bounds)) {
    return {
      ...base,
      verdict: "in-bounds",
      detail: `${prefix}(${record.lat}, ${record.lng}) fall inside "${area.id}" bounds (lat ${south}..${north}, lng ${west}..${east}).`,
      address_note,
    };
  }
  return {
    ...base,
    verdict: "out-of-bounds",
    detail: `${prefix}(${record.lat}, ${record.lng}) fall outside "${area.id}" bounds (lat ${south}..${north}, lng ${west}..${east}); reject from this batch pending verification.`,
    address_note,
  };
}

/**
 * Replacement from rank order: first record AFTER the rejected one that
 * matches area+category, has finite in-bounds coordinates, and is not
 * excluded. Returns null when the pool offers nothing valid.
 */
export function selectReplacement(
  rejectedId: string,
  area: string,
  category: string,
  rankedPool: RankedPoolEntry[],
  areaById: Map<string, AreaInfo>,
  excludedIds: Set<string>,
): { overture_id: string; name: string } | null {
  const bounds = areaById.get(area)?.bounds;
  if (bounds === undefined) return null;
  for (const candidate of rankedPool) {
    if (candidate.overture_id === rejectedId || excludedIds.has(candidate.overture_id)) continue;
    if (candidate.service_area !== area || candidate.glimmr_category !== category) continue;
    if (typeof candidate.lat !== "number" || typeof candidate.lng !== "number") continue;
    if (!pointInBounds(candidate.lat, candidate.lng, bounds)) continue;
    return { overture_id: candidate.overture_id, name: candidate.name };
  }
  return null;
}

/** Area/category tallies over a batch (post-replacement re-check). */
export function coverageCounts(batch: { service_area: string; glimmr_category: string }[]): AuditCoverage {
  const areas: Record<string, number> = {};
  const categories: Record<string, number> = {};
  for (const entry of batch) {
    areas[entry.service_area] = (areas[entry.service_area] ?? 0) + 1;
    categories[entry.glimmr_category] = (categories[entry.glimmr_category] ?? 0) + 1;
  }
  return { areas, categories };
}

/** Pairwise duplicate scan with the existing stable dedup key. Records
 *  without finite coordinates are skipped (a key needs a pin). */
export function findDuplicatePairs(
  records: { overture_id: string; name: string; address: string | null; lat: unknown; lng: unknown }[],
): { idA: string; idB: string; key: string }[] {
  const keyed = new Map<string, string>();
  const pairs: { idA: string; idB: string; key: string }[] = [];
  for (const record of records) {
    if (typeof record.lat !== "number" || typeof record.lng !== "number" ||
      !Number.isFinite(record.lat) || !Number.isFinite(record.lng)) {
      continue;
    }
    const key = dedupKey(record.name, record.address, record.lat, record.lng);
    const first = keyed.get(key);
    if (first !== undefined) {
      pairs.push({ idA: first, idB: record.overture_id, key });
    } else {
      keyed.set(key, record.overture_id);
    }
  }
  return pairs;
}

function hasSnippets(field: RankDossierField | undefined, bucket: "pricing" | "hours"): boolean {
  const list = field?.evidence?.[bucket];
  return Array.isArray(list) && list.length > 0;
}

/**
 * Rebuild the full readiness ranking over dossier records (same ordering
 * rule the batch evaluation uses), so replacements come from the existing
 * ranking rather than a new one. Records without a readiness result are
 * left out; inputs are never mutated.
 */
export function buildRankedList(
  records: RankDossierInput[],
  readinessById: Map<string, { blockerCount: number; blockers: string[] }>,
): ReadinessRanked[] {
  const items: ReadinessRanked[] = [];
  for (const record of records) {
    const result = readinessById.get(record.overture_id);
    if (result === undefined) continue;
    const category = typeof record.fields["category"]?.value === "string"
      ? (record.fields["category"].value as string)
      : "unknown";
    items.push({
      overture_id: record.overture_id,
      name: record.name,
      service_area: record.service_area,
      glimmr_category: category,
      blockerCount: result.blockerCount,
      blockers: [...result.blockers],
      hasPricingEvidence:
        hasSnippets(record.fields["priceMin"], "pricing") ||
        hasSnippets(record.fields["priceMax"], "pricing") ||
        hasSnippets(record.fields["priceBasis"], "pricing"),
      hasHoursEvidence: hasSnippets(record.fields["openingHours"], "hours"),
      websiteReachable: record.fields["websiteUrl"]?.evidence?.website?.reachable === true,
      completeness: record.completeness,
      flags: [...record.flags],
    });
  }
  return rankByReadinessPotential(items);
}

/** Human-readable audit report: verdicts, replacements, coverage, duplicates. */
export function renderAreaAuditReport(report: AreaAuditReport, finalTop10: string[]): string {
  const lines = [
    "# Batch-02 service-area audit",
    "",
    `V1 bounds check on on-file coordinates for the top-10 batch (Overture release ${report.overture_release}).`,
    "Verdicts come from bounds math, never from assigned labels. Coordinates are unverified Overture leads: out-of-bounds means reject-from-batch pending verification, not a definitive relocation.",
    "",
    "## Findings",
    "",
  ];
  for (const finding of report.findings) {
    lines.push(
      `## ${finding.overture_id} — ${finding.name}`,
      "",
      `- Assigned area: ${finding.assigned_area} · Coords on file: ${String(finding.lat)}, ${String(finding.lng)}`,
      `- Address on file: ${typeof finding.address === "string" && finding.address.length > 0 ? finding.address : "none"}`,
      `- Verdict: ${finding.verdict}${finding.explicit_review ? " · Explicit review case" : ""}`,
      `- Detail: ${finding.detail}`,
      `- Address check: ${finding.address_note}`,
      "",
    );
  }
  lines.push("## Replacements", "");
  if (report.replacements.length === 0) {
    lines.push("None — no record was rejected from this batch.", "");
  } else {
    for (const replacement of report.replacements) {
      lines.push(
        `- ${replacement.rejected_id} (${replacement.rejected_name}): ${replacement.reason}`,
        `  → replaced by ${replacement.replacement_id} (${replacement.replacement_name}, ${replacement.replacement_area} / ${replacement.replacement_category})`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Coverage after audit",
    "",
    `- Areas: ${JSON.stringify(report.coverage.areas)}`,
    `- Categories: ${JSON.stringify(report.coverage.categories)}`,
    "",
    "## Duplicates after audit",
    "",
    report.duplicates.length === 0
      ? "None — no shared dedup keys in the final batch."
      : report.duplicates.map((d) => `- ${d.idA} ↔ ${d.idB} (key ${d.key})`).join("\n"),
    "",
    "## Final top 10",
    "",
    ...finalTop10.map((id, index) => `## #${index + 1} ${id}`),
    "",
  );
  return `${lines.join("\n")}\n`;
}
