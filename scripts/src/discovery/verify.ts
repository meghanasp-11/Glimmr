/**
 * Verification/enrichment pipeline for shortlisted candidates.
 *
 * Maps every shortlisted record into the shape of the production Place
 * schema WITHOUT inventing anything: each draft field carries its value
 * plus its source (`overture` = source-verified fact, `glimmr` = our own
 * stable derivation/mapping, `unknown` = must be verified or curated by a
 * human). Price, hours, duration, activities, suitability, vibe, scores,
 * and ratings are always `unknown` at draft stage.
 *
 * A draft also carries a per-place checklist and the list of incomplete
 * fields blocking production readiness. `evaluateDraft` recomputes both, so
 * future enrichment (filling values, flipping statuses) reuses the same
 * readiness logic. Drafts are never valid Places and can never be imported
 * until every required field is resolved — see place-import.ts.
 *
 * Pure functions (no network, no Firestore). Raw discovery data is only
 * read, never written.
 */

export type FieldSource = "overture" | "glimmr" | "unknown";

export interface ChecklistItem {
  field: string;
  status: "sourced" | "unknown";
  /** False for nice-to-haves (description, subcategory, links). */
  required: boolean;
  /** What a verifier must do. Static instructions, never facts. */
  action: string;
}

export interface VerificationDraft {
  overture_id: string;
  service_area: string;
  verification_status: "pending";
  /** Every production Place key; unknown values are null (never invented). */
  place_draft: Record<string, unknown>;
  field_sources: Record<string, FieldSource>;
  checklist: ChecklistItem[];
  /** Required fields still unknown — the production blockers. */
  incomplete_fields: string[];
  production_ready: boolean;
  provenance: {
    overture_release: string;
    overture_confidence: number | null;
    sources: unknown[];
  };
}

/** Production-blocking fields (mirrors the production import profile). */
export const REQUIRED_DRAFT_FIELDS = [
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
  "suitableFor",
  "activities",
  "vibe",
  "experienceScore",
  "sourceUrl",
  "verificationStatus",
  "confidence",
  "lastVerified",
] as const;

const CHECKLIST_ACTIONS: Record<string, { required: boolean; action: string }> = {
  id: { required: true, action: "Stable derived id — no action needed." },
  name: { required: true, action: "Confirm the Overture name against the source." },
  serviceArea: { required: true, action: "Confirm the record sits in this area." },
  category: { required: true, action: "Confirm the mapped Glimmr category fits the real place." },
  address: { required: true, action: "Verify the street address on a map or the venue site." },
  lat: { required: true, action: "Verify the pin location." },
  lng: { required: true, action: "Verify the pin location." },
  priceMin: { required: true, action: "Check a menu or guide for the per-person price band." },
  priceMax: { required: true, action: "Check a menu or guide for the per-person price band." },
  priceBasis: { required: true, action: "Confirm per_person, per_group, or flat pricing." },
  openingHours: { required: true, action: "Verify hours in engine format, e.g. 9:00 AM - 9:00 PM." },
  typicalVisitDuration: { required: true, action: "Estimate a typical visit length in minutes." },
  suitableFor: { required: true, action: "Record who the place suits (solo, couple, friends, family)." },
  activities: { required: true, action: "Record at least one activity tag (coffee, food, art, …)." },
  vibe: { required: true, action: "Summarize the vibe in a few words after verification." },
  experienceScore: { required: true, action: "Score 0–1 only after verifying quality signals." },
  rating: { required: false, action: "Record a verified rating 0–5 if available." },
  reviewCount: { required: false, action: "Record a verified review count if available." },
  websiteUrl: { required: false, action: "Confirm the venue website." },
  mapsUrl: { required: false, action: "Add a map link if useful." },
  description: { required: false, action: "Write a one-line description after verification." },
  subcategory: { required: false, action: "Add a subcategory if useful." },
  source: { required: true, action: "Provenance label — no action needed." },
  sourceUrl: { required: true, action: "Add the URL the facts were verified against." },
  verificationStatus: { required: true, action: "Flip to verified only after checking every required field." },
  confidence: { required: true, action: "Re-score 0–1 based on verification strength." },
  lastVerified: { required: true, action: "Stamp the verification date (YYYY-MM-DD)." },
};

export interface ShortlistRecord {
  overture_id: string;
  service_area: string;
  name: string;
  address_freeform: string | null;
  locality: string | null;
  lat: number;
  lng: number;
  glimmr_category: string | null;
  overture_primary: string | null;
  overture_basic: string | null;
  taxonomy_primary: string | null;
  websites: string[];
  operating_status: string | null;
  confidence: number | null;
  provenance: { sources: unknown[]; overture_release: string };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Build a verification draft from a shortlisted candidate. Every value is
 * either Overture content, a stable Glimmr derivation, or null — unknowns
 * are always explicit nulls, never plausible-looking fabrications.
 */
export function draftVerification(record: ShortlistRecord): VerificationDraft {
  const draft: Record<string, unknown> = {};
  const sources: Record<string, FieldSource> = {};
  const set = (field: string, value: unknown, source: FieldSource): void => {
    draft[field] = value;
    sources[field] = source;
  };

  set("id", `ov-${record.overture_id}`, "glimmr");
  set("name", nonEmpty(record.name) ? record.name : null, nonEmpty(record.name) ? "overture" : "unknown");
  set("serviceArea", record.service_area, "overture");
  set("category", record.glimmr_category, record.glimmr_category === null ? "unknown" : "glimmr");
  const address = nonEmpty(record.address_freeform)
    ? record.address_freeform
    : nonEmpty(record.locality)
      ? record.locality
      : null;
  set("address", address, address === null ? "unknown" : "overture");
  set("lat", Number.isFinite(record.lat) ? record.lat : null, Number.isFinite(record.lat) ? "overture" : "unknown");
  set("lng", Number.isFinite(record.lng) ? record.lng : null, Number.isFinite(record.lng) ? "overture" : "unknown");
  set("description", null, "unknown");
  set("subcategory", null, "unknown");
  set("priceMin", null, "unknown");
  set("priceMax", null, "unknown");
  set("priceBasis", null, "unknown");
  set("openingHours", null, "unknown");
  set("typicalVisitDuration", null, "unknown");
  set("suitableFor", [], "unknown");
  set("activities", [], "unknown");
  set("vibe", null, "unknown");
  set("rating", null, "unknown");
  set("reviewCount", null, "unknown");
  set("experienceScore", null, "unknown");
  const website = Array.isArray(record.websites) && typeof record.websites[0] === "string" ? record.websites[0] : null;
  set("websiteUrl", website, website === null ? "unknown" : "overture");
  set("mapsUrl", null, "unknown");
  set("source", `overture:${record.provenance.overture_release}`, "glimmr");
  set("sourceUrl", null, "unknown");
  set("verificationStatus", "unverified", "glimmr");
  set("lastVerified", null, "unknown");
  set("confidence", record.confidence, record.confidence === null ? "unknown" : "overture");

  const evaluated = evaluateDraftFields(draft);
  return {
    overture_id: record.overture_id,
    service_area: record.service_area,
    verification_status: "pending",
    place_draft: draft,
    field_sources: sources,
    checklist: evaluated.checklist,
    incomplete_fields: evaluated.incomplete_fields,
    production_ready: evaluated.production_ready,
    provenance: {
      overture_release: record.provenance.overture_release,
      overture_confidence: record.confidence,
      sources: Array.isArray(record.provenance.sources) ? record.provenance.sources : [],
    },
  };
}

function isMissing(field: string, value: unknown): boolean {
  // verificationStatus only counts when a human has flipped it to verified.
  if (field === "verificationStatus") return value !== "verified";
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "number") return !Number.isFinite(value);
  return false;
}

export function evaluateDraftFields(
  draft: Record<string, unknown>,
): { checklist: ChecklistItem[]; incomplete_fields: string[]; production_ready: boolean } {
  const checklist: ChecklistItem[] = Object.entries(CHECKLIST_ACTIONS).map(([field, meta]) => {
    // Status follows the value (what the importer will actually validate),
    // while field_sources keeps the separate provenance record.
    const missing = isMissing(field, draft[field]);
    return {
      field,
      status: missing ? ("unknown" as const) : ("sourced" as const),
      required: meta.required,
      action: meta.action,
    };
  });
  const incomplete_fields = checklist
    .filter((item) => item.required && item.status === "unknown")
    .map((item) => item.field);
  return { checklist, incomplete_fields, production_ready: incomplete_fields.length === 0 };
}
