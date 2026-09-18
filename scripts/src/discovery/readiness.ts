/**
 * Recommendation-ready validation profile (additive — the existing
 * production profile in place-import.ts is untouched and unweakened).
 *
 * A place is recommendation-ready when the engine can actually plan with
 * it. Required fields follow real engine needs, mapped per field:
 * - identity: id (step ids, dedup), name (titles)
 * - serviceArea (area filter), category (plan buckets)
 * - address (displayed on every stop; required by contract)
 * - lat/lng (Haversine travel legs)
 * - priceMin/priceMax (budget scoring via midpoint) + priceBasis (so the
 *   range is interpreted correctly)
 * - openingHours (must parse: the engine filters visits by open windows)
 * - typicalVisitDuration (scheduling math)
 * - activities (preference + activity-fit scoring)
 * - suitableFor (group-fit scoring)
 * - vibe (plan header display)
 * - experienceScore (quality scoring)
 * - sourceUrl + verificationStatus === "verified" + confidence +
 *   lastVerified (provenance: only checked-in facts may plan)
 *
 * Always optional (never blockers): rating, reviewCount (the engine never
 * reads them), description, subcategory, mapsUrl.
 *
 * Each field is judged on its review status (verified/curated count;
 * missing/rejected do not) AND its value (present, correctly shaped).
 * Nothing is auto-filled: a missing value stays a blocker.
 */

import { isParseableOpeningHours } from "../place-import";
import type { ServiceArea } from "../../../artifacts/glimmr/src/schemas/glimmr.schema";

export type ReadinessStatus = "ready" | "blocked" | "optional";

export interface ReadinessField {
  field: string;
  status: ReadinessStatus;
  /** verified (source fact) or curated (rubric judgment) — never invented here. */
  origin: "verified" | "curated" | null;
  detail: string;
}

export interface ReadinessResult {
  overture_id: string;
  ready: boolean;
  blockers: string[];
  fields: Record<string, ReadinessField>;
}

/** Engine-critical fields: every one must be verified-or-curated AND valid. */
export const REQUIRED_FIELDS = [
  "id",
  "name",
  "serviceArea",
  "category",
  "address",
  "lat",
  "lng",
  "priceMin",
  "priceMax",
  "priceBasis",
  "openingHours",
  "typicalVisitDuration",
  "activities",
  "suitableFor",
  "vibe",
  "experienceScore",
  "sourceUrl",
  "verificationStatus",
  "confidence",
  "lastVerified",
] as const;

/** Never blockers, reported for information only. */
export const OPTIONAL_FIELDS = [
  "rating",
  "reviewCount",
  "description",
  "subcategory",
  "mapsUrl",
] as const;

export interface ReviewFieldInput {
  value: unknown;
  status: "verified" | "curated" | "missing" | "rejected";
  source?: string;
  reason?: string;
}

export interface ReviewInput {
  overture_id: string;
  service_area: string;
  rejected?: boolean;
  fields: Record<string, ReviewFieldInput>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function checkValue(field: string, value: unknown): string | null {
  switch (field) {
    case "id":
    case "name":
    case "serviceArea":
    case "category":
    case "address":
    case "vibe":
      return isNonEmptyString(value) ? null : "must be a non-empty string";
    case "lat":
      if (!isFiniteNumber(value)) return "must be a finite number";
      if (value < -90 || value > 90) return "must be a valid latitude (-90..90)";
      return null;
    case "lng":
      if (!isFiniteNumber(value)) return "must be a finite number";
      if (value < -180 || value > 180) return "must be a valid longitude (-180..180)";
      return null;
    case "priceMin":
    case "priceMax":
      return isFiniteNumber(value) && value >= 0 ? null : "must be a non-negative number";
    case "priceBasis":
      return value === "per_person" || value === "per_group" || value === "flat"
        ? null
        : "must be per_person, per_group, or flat";
    case "openingHours":
      return isNonEmptyString(value) && isParseableOpeningHours(value)
        ? null
        : 'must use a parseable range (e.g. "9:00 AM - 9:00 PM", "12:00 PM - 1:00 AM", "Always open")';
    case "typicalVisitDuration":
      return typeof value === "number" && Number.isInteger(value) && value > 0
        ? null
        : "must be a positive whole number of minutes";
    case "activities":
    case "suitableFor":
      return Array.isArray(value) && value.length > 0 && value.every((item) => isNonEmptyString(item))
        ? null
        : "must be a non-empty list of tags";
    case "experienceScore":
    case "confidence":
      return isFiniteNumber(value) && value >= 0 && value <= 1
        ? null
        : "must be a number from 0 to 1";
    case "sourceUrl":
      return isValidUrl(value) ? null : "must be an http(s) URL proving the facts";
    case "verificationStatus":
      return value === "verified" ? null : 'must be "verified"';
    case "lastVerified":
      return isNonEmptyString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? null
        : "must be a YYYY-MM-DD date";
    default:
      return null;
  }
}

export function evaluateRecommendationReadiness(
  reviewed: ReviewInput,
  areaById: Map<string, ServiceArea> = new Map(),
): ReadinessResult {
  const fields: Record<string, ReadinessField> = {};
  const blockers: string[] = [];

  const lat = reviewed.fields["lat"];
  const lng = reviewed.fields["lng"];
  const latValue = lat !== undefined && isFiniteNumber(lat.value) ? lat.value : null;
  const lngValue = lng !== undefined && isFiniteNumber(lng.value) ? lng.value : null;

  for (const field of REQUIRED_FIELDS) {
    const entry = reviewed.fields[field];
    const origin =
      entry !== undefined && (entry.status === "verified" || entry.status === "curated")
        ? entry.status
        : null;
    if (origin === null) {
      fields[field] = {
        field,
        status: "blocked",
        origin: null,
        detail: `no verified or curated value (status: ${entry?.status ?? "absent"})`,
      };
      blockers.push(`${field}: ${fields[field].detail}`);
      continue;
    }
    const problem = checkValue(field, entry.value);
    if (problem !== null) {
      fields[field] = { field, status: "blocked", origin, detail: problem };
      blockers.push(`${field}: ${problem}`);
      continue;
    }
    fields[field] = { field, status: "ready", origin, detail: "verified input, valid value" };
  }

  // Cross-field rules the engine depends on (still no auto-fill).
  const priceMin = reviewed.fields["priceMin"];
  const priceMax = reviewed.fields["priceMax"];
  if (
    priceMin !== undefined && priceMax !== undefined &&
    isFiniteNumber(priceMin.value) && isFiniteNumber(priceMax.value) &&
    (priceMin.status === "verified" || priceMin.status === "curated") &&
    (priceMax.status === "verified" || priceMax.status === "curated") &&
    priceMax.value < priceMin.value
  ) {
    fields["priceMax"] = { field: "priceMax", status: "blocked", origin: fields["priceMax"].origin, detail: "priceMax must be >= priceMin" };
    blockers.push("priceMax: must be >= priceMin");
  }

  const area = areaById.get(reviewed.service_area);
  if (
    area?.bounds !== undefined && latValue !== null && lngValue !== null &&
    (latValue < area.bounds.south || latValue > area.bounds.north ||
      lngValue < area.bounds.west || lngValue > area.bounds.east)
  ) {
    fields["lng"] = {
      field: "lng",
      status: "blocked",
      origin: fields["lng"].origin,
      detail: `(${latValue}, ${lngValue}) fall outside the "${area.id}" bounds`,
    };
    blockers.push(`coordinates: fall outside the "${area.id}" bounds`);
  }

  for (const field of OPTIONAL_FIELDS) {
    const entry = reviewed.fields[field];
    const usable =
      entry !== undefined && (entry.status === "verified" || entry.status === "curated") &&
      entry.value !== null && entry.value !== undefined && entry.value !== "";
    fields[field] = {
      field,
      status: "optional",
      origin: usable && entry.status === "verified" ? "verified" : usable ? "curated" : null,
      detail: usable ? "present (informational only)" : "absent (never blocks readiness)",
    };
  }

  return { overture_id: reviewed.overture_id, ready: blockers.length === 0, blockers, fields };
}

/** Machine + human-readable readiness report for a batch of results. */
export function readinessReport(results: ReadinessResult[]): string {
  const ready = results.filter((result) => result.ready);
  const lines = [
    "# Recommendation-readiness report",
    "",
    `${ready.length} of ${results.length} place(s) recommendation-ready.`,
    "",
  ];
  for (const result of results) {
    lines.push(`## ${result.overture_id} — ${result.ready ? "READY" : "NOT READY"}`);
    if (result.ready) {
      const origins = [...new Set(
        Object.values(result.fields)
          .filter((field) => field.status === "ready")
          .map((field) => field.origin),
      )].join(", ");
      lines.push(`All required fields present (${origins}).`);
    } else {
      for (const blocker of result.blockers) {
        lines.push(`- ${blocker}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
