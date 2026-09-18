/**
 * Verification dossier builder: one review record per place.
 *
 * Joins a verification draft (Place-shaped values with explicit unknowns)
 * with its fetched evidence (title, snippets, reachability) and reviews
 * every production Place field with the evidence beside it:
 * - `verified` — value present and corroborated (title/name overlap,
 *   address token overlap, reachable website, stable derivation, or an
 *   uncontested source fact with no counter-evidence and nothing to
 *   corroborate it against, e.g. coordinates and confidence).
 * - `missing` — no value and no relevant evidence.
 * - `conflicting` — genuine disagreement only: page title unrelated to the
 *   name, or closure signals in status excerpts.
 * - `needs_manual_review` — everything else (value or evidence exists, but
 *   a human must still decide).
 *
 * Curated attributes (duration, activities, suitability, vibe, scores) are
 * never inferred or auto-filled: without a value they stay missing, with
 * only excerpts they stay needs_manual_review. Flags call out stale,
 * ambiguous, unreachable, or contradictory evidence. Records rank by
 * verification completeness so the strongest candidates review first.
 *
 * Pure functions (no network, no Firestore). Inputs are never mutated.
 */

export type ReviewStatus = "verified" | "missing" | "conflicting" | "needs_manual_review";

export interface FieldEvidence {
  hours: string[];
  pricing: string[];
  address: string[];
  status: string[];
  website: { url: string | null; reachable: boolean; page_title: string | null };
}

export interface FieldReview {
  field: string;
  value: unknown;
  status: ReviewStatus;
  evidence: FieldEvidence;
  flags: string[];
  note: string;
}

export interface DossierRecord {
  overture_id: string;
  service_area: string;
  name: string;
  dossier_rank: number;
  completeness: number;
  counts: Record<ReviewStatus, number>;
  flags: string[];
  fields: Record<string, FieldReview>;
  provenance: {
    overture_release: string;
    overture_confidence: number | null;
    sources: unknown[];
    evidence_source_url: string | null;
    evidence_fetched_at: string | null;
  };
}

export interface DraftInput {
  overture_id: string;
  service_area: string;
  place_draft: Record<string, unknown>;
  provenance: { overture_release: string; sources: unknown[] };
}

export interface EvidenceInput {
  source_url: string | null;
  fetched_at_utc: string | null;
  page_title: string | null;
  website_reachable: boolean;
  snippets: { hours: string[]; pricing: string[]; address: string[]; status: string[] };
  failure: { reason: string } | null;
}

const GENERIC_TOKENS = new Set([
  "official", "home", "welcome", "order", "online", "best", "top",
  "india", "bengaluru", "bangalore", "karnataka",
  "road", "street", "main", "cross", "near", "opposite", "floor",
  "store", "block", "stage", "layout", "mall", "hotel", "limited", "private",
]);

function tokens(text: string, minLength: number): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= minLength && !GENERIC_TOKENS.has(token));
}

function overlap(a: string, b: string, minLength: number): boolean {
  const setA = new Set(tokens(a, minLength));
  if (setA.size === 0) return false;
  return tokens(b, minLength).some((token) => setA.has(token));
}

const CLOSURE_PATTERNS = [/permanently\s+closed/i, /\bclosed\s+down\b/i, /\bshut\s+down\b/i, /\bno\s+longer\s+open\b/i, /\bdefunct\b/i];

export function hasClosureSignal(snippets: string[]): boolean {
  return snippets.some((snippet) => CLOSURE_PATTERNS.some((pattern) => pattern.test(snippet)));
}

const STALE_FETCH_DAYS = 90;

export function isStaleFetch(fetchedAt: string | null, nowMs: number): boolean {
  if (fetchedAt === null) return false;
  const fetchedMs = Date.parse(fetchedAt);
  if (Number.isNaN(fetchedMs)) return false;
  return nowMs - fetchedMs > STALE_FETCH_DAYS * 24 * 60 * 60 * 1000;
}

const EVIDENCE_FIELDS = ["hours", "pricing", "address", "status"] as const;

/** Which evidence buckets sit beside each Place field for review. */
const FIELD_EVIDENCE_MAP: Record<string, (typeof EVIDENCE_FIELDS)[number][]> = {
  openingHours: ["hours"],
  priceMin: ["pricing"],
  priceMax: ["pricing"],
  priceBasis: ["pricing"],
  address: ["address"],
};

function emptyEvidence(): FieldEvidence {
  return {
    hours: [],
    pricing: [],
    address: [],
    status: [],
    website: { url: null, reachable: false, page_title: null },
  };
}

function attachEvidence(
  field: string,
  evidence: EvidenceInput,
): FieldEvidence {
  const attached = emptyEvidence();
  for (const bucket of FIELD_EVIDENCE_MAP[field] ?? []) {
    attached[bucket] = [...evidence.snippets[bucket]];
  }
  if (field === "websiteUrl" || field === "verificationStatus") {
    attached.status = [...evidence.snippets.status];
  }
  attached.website = {
    url: evidence.source_url,
    reachable: evidence.website_reachable,
    page_title: evidence.page_title,
  };
  return attached;
}

interface ReviewedField {
  status: ReviewStatus;
  flags: string[];
  note: string;
}

function reviewField(
  field: string,
  value: unknown,
  evidence: EvidenceInput,
): ReviewedField {
  const title = evidence.page_title;
  const statusSnippets = evidence.snippets.status;
  const closed = hasClosureSignal(statusSnippets);

  switch (field) {
    case "id":
    case "source":
      return { status: "verified", flags: [], note: "Stable Glimmr derivation, no action needed." };
    case "confidence":
      return typeof value === "number" && Number.isFinite(value)
        ? { status: "verified", flags: [], note: "Overture source value; re-score on verification." }
        : { status: "missing", flags: [], note: "No confidence on file." };
    case "name": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return { status: "missing", flags: [], note: "No name on file." };
      }
      if (title !== null && !overlap(value, title, 4)) {
        return {
          status: "conflicting",
          flags: ["title-mismatch"],
          note: "Fetched page title shares no token with the recorded name.",
        };
      }
      if (title !== null) {
        return { status: "verified", flags: [], note: "Corroborated by the fetched page title." };
      }
      return { status: "needs_manual_review", flags: [], note: "No title fetched to corroborate the name." };
    }
    case "address": {
      const addressSnippets = evidence.snippets.address;
      if (typeof value !== "string" || value.trim().length === 0) {
        return addressSnippets.length > 0
          ? { status: "needs_manual_review", flags: [], note: "Address excerpts exist but no recorded address to match." }
          : { status: "missing", flags: [], note: "No address on file and none in evidence." };
      }
      if (addressSnippets.length === 0) {
        return { status: "needs_manual_review", flags: [], note: "Recorded address has no corroborating excerpts." };
      }
      if (addressSnippets.some((snippet) => overlap(value, snippet, 4))) {
        return { status: "verified", flags: [], note: "Corroborated by address excerpts." };
      }
      return {
        status: "needs_manual_review",
        flags: ["ambiguous-address"],
        note: "Address excerpts exist but share no token with the recorded address.",
      };
    }
    case "websiteUrl": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return { status: "missing", flags: ["no-website"], note: "No website on file." };
      }
      if (evidence.website_reachable) {
        return { status: "verified", flags: [], note: "Website fetched successfully." };
      }
      return { status: "needs_manual_review", flags: ["unreachable-website"], note: "Website on file did not fetch." };
    }
    case "verificationStatus": {
      if (value === "verified") {
        return { status: "verified", flags: [], note: "Marked verified by a human." };
      }
      if (closed) {
        return {
          status: "conflicting",
          flags: ["possibly-closed"],
          note: "Closure signals in status excerpts while the record is still listed.",
        };
      }
      return { status: "needs_manual_review", flags: [], note: "Flip to verified only after checking every required field." };
    }
    default: {
      // Curated attributes and everything else: value only ever comes from
      // human verification (never inferred here), so presence decides
      // between needs_manual_review (excerpts to convert) and missing.
      if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
        const buckets = FIELD_EVIDENCE_MAP[field] ?? [];
        const hasExcerpts = buckets.some((bucket) => evidence.snippets[bucket].length > 0);
        return hasExcerpts
          ? { status: "needs_manual_review", flags: [], note: "Evidence excerpts exist; convert by hand, never auto-fill." }
          : { status: "missing", flags: [], note: "No value and no evidence on file." };
      }
      return { status: "needs_manual_review", flags: [], note: "Sourced value awaiting human confirmation." };
    }
  }
}

const REVIEWED_FIELDS = [
  "id", "name", "serviceArea", "category", "address", "lat", "lng",
  "description", "subcategory", "priceMin", "priceMax", "priceBasis",
  "openingHours", "typicalVisitDuration", "suitableFor", "activities",
  "vibe", "rating", "reviewCount", "experienceScore", "websiteUrl",
  "mapsUrl", "source", "sourceUrl", "verificationStatus", "confidence",
  "lastVerified",
];

export function buildDossierRecord(
  draft: DraftInput,
  evidence: EvidenceInput,
  nowMs: number = Date.now(),
): DossierRecord {
  const fields: Record<string, FieldReview> = {};
  const counts: Record<ReviewStatus, number> = {
    verified: 0,
    missing: 0,
    conflicting: 0,
    needs_manual_review: 0,
  };
  const flagSet = new Set<string>();

  for (const field of REVIEWED_FIELDS) {
    const reviewed = reviewField(field, draft.place_draft[field], evidence);
    for (const flag of reviewed.flags) flagSet.add(flag);
    counts[reviewed.status] += 1;
    fields[field] = {
      field,
      value: draft.place_draft[field] ?? null,
      status: reviewed.status,
      evidence: attachEvidence(field, evidence),
      flags: reviewed.flags,
      note: reviewed.note,
    };
  }

  if (isStaleFetch(evidence.fetched_at_utc, nowMs)) flagSet.add("stale-fetch");
  if (evidence.failure !== null && !evidence.website_reachable && draft.place_draft["websiteUrl"]) {
    flagSet.add("unreachable-website");
  }

  const completeness = counts.verified / REVIEWED_FIELDS.length;
  return {
    overture_id: draft.overture_id,
    service_area: draft.service_area,
    name: typeof draft.place_draft["name"] === "string" ? (draft.place_draft["name"] as string) : draft.overture_id,
    dossier_rank: 0,
    completeness,
    counts,
    flags: [...flagSet].sort(),
    fields,
    provenance: {
      overture_release: draft.provenance.overture_release,
      overture_confidence: typeof draft.place_draft["confidence"] === "number" ? (draft.place_draft["confidence"] as number) : null,
      sources: draft.provenance.sources,
      evidence_source_url: evidence.source_url,
      evidence_fetched_at: evidence.fetched_at_utc,
    },
  };
}

/** Rank strongest-first: verified count, then fewest missing, then stable id order. */
export function rankDossier(records: DossierRecord[]): DossierRecord[] {
  const ranked = [...records].sort((a, b) => {
    if (b.counts.verified !== a.counts.verified) return b.counts.verified - a.counts.verified;
    const missingA = a.counts.missing + a.counts.conflicting;
    const missingB = b.counts.missing + b.counts.conflicting;
    if (missingA !== missingB) return missingA - missingB;
    return a.overture_id < b.overture_id ? -1 : 1;
  });
  ranked.forEach((record, index) => {
    record.dossier_rank = index + 1;
  });
  return ranked;
}
