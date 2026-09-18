/**
 * Glimmr enrichment rubric v1: deterministic rules for curated attributes.
 *
 * Curated attributes (typicalVisitDuration, activities, suitableFor, vibe,
 * experienceScore) are Glimmr judgment — never source facts, never scraped,
 * never inferred from ratings. Every curated value needs an explicit reason,
 * must satisfy the existing Place schema bounds, and must use controlled
 * vocabularies drawn from what the recommendation engine actually scores on.
 *
 * Hard guarantees, enforced structurally:
 * - experienceScore can never be justified with ratings, review counts, or
 *   popularity: any basis/reason mentioning them is rejected.
 * - Duration is a realistic planning estimate within the per-category band
 *   unless an official figure is cited with its source URL.
 * - Verification-gated fields (identity, verificationStatus, sourceUrl,
 *   lastVerified, …) are rejected here — curation can never bypass the
 *   verification workflow in promote.ts.
 */

export type CuratedField =
  | "typicalVisitDuration"
  | "activities"
  | "suitableFor"
  | "vibe"
  | "experienceScore";

const CURATED_FIELDS: ReadonlySet<string> = new Set([
  "typicalVisitDuration",
  "activities",
  "suitableFor",
  "vibe",
  "experienceScore",
]);

/** Verification-gated keys curation must never touch: identity, verification
 * workflow fields, and source-verified facts (prices, hours, coordinates).
 * Curated attributes are only the five in CURATED_FIELDS. */
const GATED_KEYS = new Set([
  "id", "name", "serviceArea", "category", "address", "lat", "lng",
  "verificationStatus", "sourceUrl", "lastVerified", "confidence", "source",
  "priceMin", "priceMax", "priceBasis", "openingHours",
]);
/** Group labels the engine's group-fit scoring reads. */
export const SUITABLE_FOR_SET: ReadonlySet<string> = new Set([
  "solo",
  "couple",
  "friends",
  "family",
]);

/**
 * Canonical activity tags — exactly the tags the engine scores preference
 * and activity fit against. Using only these keeps curated places matchable
 * to user preferences instead of drifting into free text.
 */
export const ACTIVITY_TAG_SET: ReadonlySet<string> = new Set([
  "peaceful",
  "food",
  "photography",
  "coffee",
  "outdoor",
  "drinks",
  "culture",
  "active",
  "chill",
  "art",
]);

/** Planning-estimate bands (minutes) per Glimmr category. */
export const DURATION_BANDS: Readonly<Record<string, { min: number; max: number; typical: number }>> = {
  Cafe: { min: 20, max: 45, typical: 35 },
  Dessert: { min: 15, max: 30, typical: 20 },
  Dinner: { min: 45, max: 90, typical: 70 },
  Drinks: { min: 45, max: 90, typical: 75 },
  Activity: { min: 45, max: 120, typical: 75 },
  Culture: { min: 30, max: 90, typical: 60 },
  Outdoor: { min: 20, max: 60, typical: 30 },
};

const MIN_REASON_LENGTH = 10;
const MAX_VIBE_LENGTH = 140;

/** Signals that must never justify an experience score. */
const FORBIDDEN_SCORE_BASIS = /rating|rated|review|popular|stars|ranked|trending/i;

export interface DurationProposal {
  value: number;
  reason: string;
  /** Official figure URL (e.g. a 60-minute game format page). Required outside the band. */
  officialSource?: string;
}

export interface ExperienceScoreProposal {
  value: number;
  reason: string;
  /** Named quality signals (craft, ambience, uniqueness, …) — never ratings. */
  basis: string[];
}

export interface CuratedBundle {
  typicalVisitDuration?: DurationProposal;
  activities?: { values: string[]; reason: string };
  suitableFor?: { values: string[]; reason: string };
  vibe?: { value: string; reason: string };
  experienceScore?: ExperienceScoreProposal;
}

export interface CuratedFieldEntry {
  value: unknown;
  status: "curated";
  source: string;
}

export type CurateResult =
  | { ok: true; curated: Partial<Record<CuratedField, CuratedFieldEntry>> }
  | { ok: false; errors: string[] };

function validReason(reason: unknown): boolean {
  return typeof reason === "string" && reason.trim().length >= MIN_REASON_LENGTH;
}

function validUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Planning estimate for a category (the band midpoint default). */
export function estimateDuration(category: string): number | null {
  return DURATION_BANDS[category]?.typical ?? null;
}

/**
 * Validate a curated bundle for one place category. Unknown keys —
 * especially verification-gated ones — are rejected outright.
 */
export function curateAttributes(
  bundle: Record<string, unknown>,
  category: string,
): CurateResult {
  const errors: string[] = [];
  for (const key of Object.keys(bundle)) {
    if (!CURATED_FIELDS.has(key)) {
      errors.push(
        GATED_KEYS.has(key)
          ? `${key}: verification-gated and cannot be curated — use the verification workflow.`
          : `${key}: not a curated attribute (allowed: ${[...CURATED_FIELDS].join(", ")}).`,
      );
    }
  }

  const curated: Partial<Record<CuratedField, CuratedFieldEntry>> = {};
  const input = bundle as Partial<Record<CuratedField, unknown>>;

  const duration = input.typicalVisitDuration as DurationProposal | undefined;
  if (duration !== undefined) {
    const band = DURATION_BANDS[category];
    if (band === undefined) {
      errors.push(`typicalVisitDuration: unknown category "${category}" — no planning band.`);
    } else if (!Number.isInteger(duration.value) || duration.value <= 0) {
      errors.push("typicalVisitDuration: must be a positive whole number of minutes (Place schema).");
    } else if (!validReason(duration.reason)) {
      errors.push("typicalVisitDuration: an explicit curation reason is required.");
    } else if (
      (duration.value < band.min || duration.value > band.max) &&
      !validUrl(duration.officialSource)
    ) {
      errors.push(
        `typicalVisitDuration: ${duration.value} min is outside the ${category} planning band ` +
          `(${band.min}–${band.max}); cite an official figure URL or stay inside the band.`,
      );
    } else {
      curated.typicalVisitDuration = {
        value: duration.value,
        status: "curated",
        source: `rubric v1 — ${duration.reason.trim()}`,
      };
    }
  }

  const activities = input.activities as { values: unknown; reason: unknown } | undefined;
  if (activities !== undefined) {
    if (!Array.isArray(activities.values) || activities.values.length === 0) {
      errors.push("activities: at least one tag is required.");
    } else if (activities.values.some((tag) => !ACTIVITY_TAG_SET.has(String(tag)))) {
      errors.push(
        `activities: tags must come from the engine set (${[...ACTIVITY_TAG_SET].join(", ")}).`,
      );
    } else if (!validReason(activities.reason)) {
      errors.push("activities: an explicit curation reason is required.");
    } else {
      curated.activities = {
        value: [...activities.values],
        status: "curated",
        source: `rubric v1 — ${String(activities.reason).trim()}`,
      };
    }
  }

  const suitableFor = input.suitableFor as { values: unknown; reason: unknown } | undefined;
  if (suitableFor !== undefined) {
    if (!Array.isArray(suitableFor.values) || suitableFor.values.length === 0) {
      errors.push("suitableFor: at least one group is required (Place schema).");
    } else if (suitableFor.values.some((group) => !SUITABLE_FOR_SET.has(String(group)))) {
      errors.push(
        `suitableFor: groups must come from (${[...SUITABLE_FOR_SET].join(", ")}).`,
      );
    } else if (!validReason(suitableFor.reason)) {
      errors.push("suitableFor: an explicit curation reason is required.");
    } else {
      curated.suitableFor = {
        value: [...suitableFor.values],
        status: "curated",
        source: `rubric v1 — ${String(suitableFor.reason).trim()}`,
      };
    }
  }

  const vibe = input.vibe as { value: unknown; reason: unknown } | undefined;
  if (vibe !== undefined) {
    if (typeof vibe.value !== "string" || vibe.value.trim().length === 0) {
      errors.push("vibe: must be a non-empty string (Place schema).");
    } else if (vibe.value.trim().length > MAX_VIBE_LENGTH) {
      errors.push(`vibe: keep it to ${MAX_VIBE_LENGTH} characters or fewer.`);
    } else if (!validReason(vibe.reason)) {
      errors.push("vibe: an explicit curation reason is required.");
    } else {
      curated.vibe = {
        value: vibe.value.trim(),
        status: "curated",
        source: `rubric v1 — ${String(vibe.reason).trim()}`,
      };
    }
  }

  const score = input.experienceScore as ExperienceScoreProposal | undefined;
  if (score !== undefined) {
    if (typeof score.value !== "number" || !Number.isFinite(score.value) || score.value < 0 || score.value > 1) {
      errors.push("experienceScore: must be a number from 0 to 1 (Place schema).");
    } else if (!validReason(score.reason)) {
      errors.push("experienceScore: an explicit curation reason is required.");
    } else if (!Array.isArray(score.basis) || score.basis.length === 0) {
      errors.push("experienceScore: name at least one quality signal as its basis.");
    } else if (
      score.basis.some((signal) => typeof signal !== "string" || signal.trim().length === 0) ||
      FORBIDDEN_SCORE_BASIS.test(score.basis.join(" ") + " " + String(score.reason))
    ) {
      errors.push(
        "experienceScore: ratings, review counts, and popularity must never justify a score — use craft signals only.",
      );
    } else {
      curated.experienceScore = {
        value: score.value,
        status: "curated",
        source: `rubric v1 — ${String(score.reason).trim()} (basis: ${score.basis.join(", ")})`,
      };
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, curated };
}
