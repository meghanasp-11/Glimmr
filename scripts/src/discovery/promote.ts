/**
 * Production-promotion workflow: reviewed places → production readiness.
 *
 * A reviewed place is human work product: every production Place field
 * carries an explicit value plus a status of `verified` (checked against a
 * cited source), `curated` (Glimmr judgment entered by hand, e.g. vibe),
 * `missing` (not yet known, with a reason), or `rejected` (unverifiable or
 * wrong, with a reason). Curated attributes stay empty until a human
 * supplies them here — this module never fills defaults and never fetches
 * anything.
 *
 * Promotion assembles a Place-shaped candidate from verified/curated
 * values only and runs it through the EXISTING production validator
 * (PlaceSchema + production profile). Records that fail stay in review
 * with their blocking problems listed. Nothing is written to production
 * data by this module.
 */

import { productionPlaceProblems } from "../place-import";
import {
  PlaceSchema,
  type Place,
  type ServiceArea,
} from "../../../artifacts/glimmr/src/schemas/glimmr.schema";
import { evaluateRecommendationReadiness } from "./readiness";

export type ReviewStatus = "verified" | "curated" | "missing" | "rejected";

export interface ReviewedField {
  value: unknown;
  status: ReviewStatus;
  /** URL or source description the value was checked against (verified/curated). */
  source?: string;
  /** Why the field is missing or rejected. */
  reason?: string;
}

export interface ReviewedPlace {
  overture_id: string;
  service_area: string;
  reviewer?: string;
  reviewed_at?: string;
  /** Record-level exclusion (e.g. permanently closed) with its reason. */
  rejected?: boolean;
  rejection_reason?: string;
  fields: Record<string, ReviewedField>;
}

/** All production Place keys a review may carry. */
export const REVIEWED_KEYS = [
  "id", "name", "serviceArea", "category", "subcategory", "address",
  "lat", "lng", "description", "priceMin", "priceMax", "priceBasis",
  "openingHours", "typicalVisitDuration", "suitableFor", "activities",
  "vibe", "rating", "reviewCount", "experienceScore", "websiteUrl",
  "mapsUrl", "source", "sourceUrl", "verificationStatus", "confidence",
  "lastVerified",
] as const;

/** Schema-optional keys: explicit nulls are stripped so safeParse sees them as absent. */
const OPTIONAL_KEYS = new Set(["description", "subcategory", "websiteUrl", "mapsUrl", "sourceUrl"]);

export interface PromotionResult {
  overture_id: string;
  ready: boolean;
  /** True for record-level rejections (closed, duplicate, wrong entity). */
  rejected: boolean;
  /** Assembled Place candidate (nulls kept for required keys so errors name them). */
  place: Record<string, unknown> | null;
  /** Blocking problems, empty when ready. */
  problems: string[];
  /** Every reviewed field with its tracked status. */
  field_status: Record<string, ReviewStatus>;
}

function fieldStatus(reviewed: ReviewedPlace, field: string): ReviewStatus {
  const entry = reviewed.fields[field];
  if (!entry) return "missing";
  if (entry.status === "verified" || entry.status === "curated") return entry.status;
  if (entry.status === "rejected") return "rejected";
  return "missing";
}

/**
 * Assemble a Place-shaped candidate from verified/curated values only.
 * Missing/rejected fields become null (kept for required keys so schema
 * errors name them; stripped for schema-optional keys).
 */
export function assemblePlace(reviewed: ReviewedPlace): Record<string, unknown> {
  const place: Record<string, unknown> = {};
  for (const key of REVIEWED_KEYS) {
    const entry = reviewed.fields[key];
    const usable = entry !== undefined && (entry.status === "verified" || entry.status === "curated");
    const value = usable ? entry.value : null;
    if (value === null && OPTIONAL_KEYS.has(key)) continue;
    place[key] = value;
  }
  return place;
}

export function evaluatePromotion(
  reviewed: ReviewedPlace,
  areaById: Map<string, ServiceArea>,
): PromotionResult {
  const field_status: Record<string, ReviewStatus> = {};
  for (const key of REVIEWED_KEYS) {
    field_status[key] = fieldStatus(reviewed, key);
  }

  if (reviewed.rejected === true) {
    const reason = reviewed.rejection_reason ?? "Record rejected in review.";
    return { overture_id: reviewed.overture_id, ready: false, rejected: true, place: null, problems: [reason], field_status };
  }

  const place = assemblePlace(reviewed);
  const problems: string[] = [];
  const parsed = PlaceSchema.safeParse(place);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const at = issue.path.length > 0 ? issue.path.join(".") : "(record)";
      problems.push(`${at}: ${issue.message}`);
    }
    return { overture_id: reviewed.overture_id, ready: false, rejected: false, place, problems, field_status };
  }

  const candidate: Place = parsed.data;
  if (!areaById.has(candidate.serviceArea)) {
    problems.push(`serviceArea: unknown "${candidate.serviceArea}" (not in the areas file).`);
    return { overture_id: reviewed.overture_id, ready: false, rejected: false, place, problems, field_status };
  }
  for (const problem of productionPlaceProblems(candidate, areaById)) {
    problems.push(problem);
  }
  return {
    overture_id: reviewed.overture_id,
    ready: problems.length === 0,
    rejected: false,
    place: problems.length === 0 ? candidate : place,
    problems,
    field_status,
  };
}

/**
 * Production-candidate selection: only records passing BOTH recommendation
 * readiness (the engine can plan with them) and promotion (schema +
 * production profile). Record-level rejections never qualify. Deterministic
 * id order so repeated runs diff cleanly.
 */
export function selectProductionCandidates(
  reviewed: ReviewedPlace[],
  areaById: Map<string, ServiceArea>,
): Place[] {
  const records: Place[] = [];
  for (const place of reviewed) {
    if (place.rejected === true) continue;
    if (!evaluateRecommendationReadiness(place, areaById).ready) continue;
    const promotion = evaluatePromotion(place, areaById);
    if (!promotion.ready || promotion.place === null) continue;
    records.push(promotion.place as Place);
  }
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return records;
}

export interface ProductionCandidatesFile {
  generated_at_utc: string;
  source: "glimmr-promotion-dry-run";
  readiness: "recommendation";
  count: number;
  records: Place[];
}

/** Labeled candidate file body; count always matches records. */
export function formatCandidatesFile(records: Place[], generatedAtUtc: string): string {
  const file: ProductionCandidatesFile = {
    generated_at_utc: generatedAtUtc,
    source: "glimmr-promotion-dry-run",
    readiness: "recommendation",
    count: records.length,
    records,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Human-readable dry-run report: exactly which places are ready and why (not). */
export function promotionReport(results: PromotionResult[]): string {
  const ready = results.filter((result) => result.ready);
  const rejected = results.filter((result) => !result.ready && result.rejected);
  const pending = results.filter((result) => !result.ready && !result.rejected);
  const lines = [
    "# Promotion dry-run report",
    "",
    `${ready.length} of ${results.length} reviewed place(s) production-ready` +
      (rejected.length > 0 ? `, ${rejected.length} rejected and excluded` : "") +
      ".",
    "",
  ];
  if (ready.length > 0) {
    lines.push("## Production-ready", "");
    for (const result of ready) {
      lines.push(`- ${result.overture_id}: passes schema + production profile.`);
    }
    lines.push("");
  }
  if (rejected.length > 0) {
    lines.push("## Rejected — excluded from promotion", "");
    for (const result of rejected) {
      lines.push(`- ${result.overture_id}:`);
      for (const problem of result.problems) {
        lines.push(`  - ${problem}`);
      }
    }
    lines.push("");
  }
  if (pending.length > 0) {
    lines.push("## Still in review", "");
    for (const result of pending) {
      lines.push(`- ${result.overture_id}:`);
      for (const problem of result.problems) {
        lines.push(`  - ${problem}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
