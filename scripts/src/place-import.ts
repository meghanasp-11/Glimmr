/**
 * Shared validation for Glimmr place import files.
 *
 * An import file is `{ serviceAreas: [...], places: [...] }`. Every record is
 * validated against the existing Glimmr Zod schemas; service areas are
 * resolved from the file itself, so supporting a new area never needs a code
 * branch — it only needs a row in `serviceAreas`.
 *
 * Two profiles:
 * - Standard (default): schema + duplicate-id + known-serviceArea checks.
 *   Sample seed records (source "sample-seed", unverified) are accepted.
 * - Production (`--production`): additionally requires every
 *   recommendation-critical field, parseable opening hours, coordinates
 *   inside the area bounds, verified provenance, and rejects anything
 *   marked as sample data. See scripts/PLACES_IMPORT_FORMAT.md.
 */

import {
  PlaceSchema,
  ServiceAreaSchema,
  type Place,
  type ServiceArea,
} from "../../artifacts/glimmr/src/schemas/glimmr.schema";

export interface ValidatedSeed {
  areas: ServiceArea[];
  places: Place[];
}

export type SeedValidation =
  | { ok: true; data: ValidatedSeed }
  | { ok: false; errors: string[] };

/** Fields the recommender needs; most are already required by PlaceSchema. */
const PRODUCTION_STRING_FIELDS = [
  "id",
  "name",
  "serviceArea",
  "category",
  "address",
  "openingHours",
  "vibe",
] as const;

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(record)"}: ${issue.message}`)
    .join("; ");
}

function recordLabel(candidate: unknown, index: number): string {
  return typeof candidate === "object" && candidate !== null
    ? String((candidate as { id?: unknown }).id ?? `#${index}`)
    : `#${index}`;
}

/**
 * Opening-hours grammar mirror: the recommendation engine only understands
 * AM/PM ranges ("8:00 AM - 9:00 PM", en dash accepted), overnight ranges
 * ("12:00 PM - 1:00 AM"), and always-open markers. Production records must
 * use one of these so their hours are actually respected in planning.
 */
export function isParseableOpeningHours(openingHours: string): boolean {
  const text = openingHours.trim().toLowerCase();
  if (/always\s+open|24\s*hours?|24\s*\/\s*7|open\s*24/.test(text)) return true;
  return /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/.test(text);
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

/**
 * Production-only checks on an already schema-valid place. Returns a list of
 * human-readable problems (empty when the record is production-ready).
 */
export function productionPlaceProblems(
  place: Place,
  areaById: Map<string, ServiceArea>,
): string[] {
  const problems: string[] = [];

  for (const field of PRODUCTION_STRING_FIELDS) {
    if (place[field].trim().length === 0) {
      problems.push(`${field}: required for production (must be a non-empty string)`);
    }
  }
  for (const field of ["priceMin", "priceMax", "experienceScore", "confidence"] as const) {
    if (!Number.isFinite(place[field])) {
      problems.push(`${field}: required for production (must be a finite number)`);
    }
  }
  if (!Array.isArray(place.suitableFor) || place.suitableFor.length === 0) {
    problems.push("suitableFor: required for production (at least one group)");
  }
  if (!Array.isArray(place.activities) || place.activities.length === 0) {
    problems.push("activities: required for production (at least one activity tag)");
  }

  if (!isValidUrl(place.sourceUrl)) {
    problems.push("sourceUrl: required for production (must be an http(s) URL proving the facts)");
  }

  if (place.verificationStatus !== "verified") {
    problems.push(
      `verificationStatus: must be "verified" for production (got "${place.verificationStatus}")`,
    );
  }

  if (!isParseableOpeningHours(place.openingHours)) {
    problems.push(
      `openingHours: must use a parseable range for production (e.g. "9:00 AM - 9:00 PM", "12:00 PM - 1:00 AM", or "Always open"; got "${place.openingHours}")`,
    );
  }

  const area = areaById.get(place.serviceArea);
  if (area?.bounds) {
    const { north, south, east, west } = area.bounds;
    if (place.lat < south || place.lat > north || place.lng < west || place.lng > east) {
      problems.push(
        `coordinates: (${place.lat}, ${place.lng}) fall outside the "${area.id}" bounds ` +
          `(lat ${south}..${north}, lng ${west}..${east})`,
      );
    }
  }

  if (place.source === "sample-seed" || place.name.startsWith("[SAMPLE]")) {
    problems.push("record is marked as sample data and is not production-ready");
  }

  return problems;
}

export function validateSeedFile(raw: unknown, opts?: { production?: boolean }): SeedValidation {
  const production = opts?.production ?? false;
  const errors: string[] = [];
  const seed = raw as Partial<{ serviceAreas: unknown; places: unknown }>;
  const rawAreas = Array.isArray(seed.serviceAreas) ? seed.serviceAreas : null;
  const rawPlaces = Array.isArray(seed.places) ? seed.places : null;
  if (!rawAreas) errors.push("import file: 'serviceAreas' must be an array.");
  if (!rawPlaces) errors.push("import file: 'places' must be an array.");
  if (errors.length > 0) return { ok: false, errors };

  const areas: ServiceArea[] = [];
  for (const [index, candidate] of (rawAreas as unknown[]).entries()) {
    const parsed = ServiceAreaSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push(`serviceAreas[${recordLabel(candidate, index)}]: ${formatIssues(parsed.error.issues)}`);
    } else {
      areas.push(parsed.data);
    }
  }

  const areaById = new Map(areas.map((area) => [area.id, area]));
  const seenPlaceIds = new Set<string>();
  const seenNameAddress = new Set<string>();
  const places: Place[] = [];
  for (const [index, candidate] of (rawPlaces as unknown[]).entries()) {
    const label = recordLabel(candidate, index);
    const parsed = PlaceSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push(`places[${label}]: ${formatIssues(parsed.error.issues)}`);
      continue;
    }
    const place = parsed.data;
    if (seenPlaceIds.has(place.id)) {
      errors.push(`places[${label}]: duplicate place id "${place.id}".`);
      continue;
    }
    seenPlaceIds.add(place.id);
    const nameAddress = `${place.name.trim().toLowerCase()}|${place.address.trim().toLowerCase()}`;
    if (seenNameAddress.has(nameAddress)) {
      errors.push(`places[${label}]: duplicate name+address "${place.name}" / "${place.address}".`);
      continue;
    }
    seenNameAddress.add(nameAddress);
    if (!areaById.has(place.serviceArea)) {
      errors.push(
        `places[${label}]: unknown serviceArea "${place.serviceArea}" (not in this file's serviceAreas).`,
      );
      continue;
    }
    if (production) {
      const problems = productionPlaceProblems(place, areaById);
      if (problems.length > 0) {
        errors.push(`places[${label}]: not production-ready: ${problems.join("; ")}`);
        continue;
      }
    }
    places.push(place);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: { areas, places } };
}
