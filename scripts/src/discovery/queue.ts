/**
 * Build the manual verification queue from shortlisted candidates.
 *
 * Pure functions (no network, no Firestore). Selects the top records by
 * verification rank while guaranteeing every V1 area and every mapped
 * Glimmr category is represented. Each queue entry carries the facts a
 * verifier needs (name, area, category, coordinates, website, Overture
 * sources, confidence), the fields still requiring verification, an
 * explicit priority reason, and source-priority guidance derived only from
 * what is already on file:
 * - official website on file → start there;
 * - otherwise Overture sources on file → another reliable public source;
 * - otherwise unknown → find a reliable public source first.
 *
 * Curated attributes (price, hours, duration, activities, suitability,
 * vibe, scores) are never included — only the needs-verification list.
 * Unmapped records are never admitted. Inputs are never mutated.
 */

export interface QueueInput {
  overture_id: string;
  service_area: string;
  name: string;
  lat: number;
  lng: number;
  glimmr_category: string | null;
  websites: string[];
  operating_status: string | null;
  confidence: number | null;
  provenance: { sources: unknown[]; overture_release: string };
  verification_rank: number;
  verification_score: number;
  verification_reasons: string[];
}

export type SourceGuidance = "official-website" | "public-source" | "unknown";

export interface QueueEntry {
  queue_rank: number;
  overture_id: string;
  place_draft_id: string;
  name: string;
  service_area: string;
  glimmr_category: string;
  lat: number;
  lng: number;
  website: string | null;
  overture_sources: unknown[];
  overture_release: string;
  confidence: number | null;
  verification_score: number;
  verification_reasons: string[];
  priority_reason: string;
  source_guidance: SourceGuidance;
  source_guidance_detail: string;
  needs_verification: string[];
}

export interface QueueResult {
  queue: QueueEntry[];
  counts: {
    pool: number;
    queued: number;
    areas: Record<string, number>;
    categories: Record<string, number>;
  };
}

export const QUEUE_SIZE = 40;
const PER_AREA_GUARANTEE = 3;
const PER_CATEGORY_GUARANTEE = 4;

export function sourceGuidanceFor(input: {
  websites: string[];
  sources: unknown[];
}): { guidance: SourceGuidance; detail: string } {
  const website =
    Array.isArray(input.websites) && typeof input.websites[0] === "string" ? input.websites[0] : null;
  if (website !== null) {
    return {
      guidance: "official-website",
      detail: `Start with the official website on file (${website}); confirm facts there first.`,
    };
  }
  if (Array.isArray(input.sources) && input.sources.length > 0) {
    return {
      guidance: "public-source",
      detail:
        "No website on file. Verify against another reliable public source (venue site, map listing, established guide) and record its URL as sourceUrl.",
    };
  }
  return {
    guidance: "unknown",
    detail: "No source on file. Find a reliable public source first, then verify.",
  };
}

export function buildQueue(inputs: QueueInput[], drafts: Map<string, string[]>, size: number = QUEUE_SIZE): QueueResult {
  const pool = inputs.filter(
    (input) =>
      input.glimmr_category !== null &&
      Number.isFinite(input.lat) &&
      Number.isFinite(input.lng),
  );
  const ranked = [...pool].sort((a, b) => a.verification_rank - b.verification_rank);

  const picked: QueueInput[] = [];
  const pickedIds = new Set<string>();
  const take = (input: QueueInput): void => {
    if (pickedIds.has(input.overture_id)) return;
    pickedIds.add(input.overture_id);
    picked.push(input);
  };

  // Phase 1 — coverage guarantees in rank order (deterministic).
  const areas = [...new Set(ranked.map((input) => input.service_area))].sort();
  for (const area of areas) {
    let n = 0;
    for (const input of ranked) {
      if (picked.length >= size) break;
      if (n >= PER_AREA_GUARANTEE) break;
      if (input.service_area !== area) continue;
      const before = picked.length;
      take(input);
      if (picked.length > before) n += 1;
    }
  }
  const categories = [...new Set(ranked.map((input) => input.glimmr_category as string))].sort();
  for (const category of categories) {
    let n = 0;
    for (const input of ranked) {
      if (picked.length >= size) break;
      if (n >= PER_CATEGORY_GUARANTEE) break;
      if (input.glimmr_category !== category) continue;
      const before = picked.length;
      take(input);
      if (picked.length > before) n += 1;
    }
  }
  // Phase 2 — fill the rest by rank.
  for (const input of ranked) {
    if (picked.length >= size) break;
    take(input);
  }
  picked.sort((a, b) => a.verification_rank - b.verification_rank);

  const queue = picked.map((input, index) => {
    const guidance = sourceGuidanceFor({ websites: input.websites, sources: input.provenance.sources });
    const needs = drafts.get(input.overture_id) ?? [];
    const entry: QueueEntry = {
      queue_rank: index + 1,
      overture_id: input.overture_id,
      place_draft_id: `ov-${input.overture_id}`,
      name: input.name,
      service_area: input.service_area,
      glimmr_category: input.glimmr_category as string,
      lat: input.lat,
      lng: input.lng,
      website: typeof input.websites[0] === "string" ? input.websites[0] : null,
      overture_sources: input.provenance.sources,
      overture_release: input.provenance.overture_release,
      confidence: input.confidence,
      verification_score: input.verification_score,
      verification_reasons: [...input.verification_reasons],
      priority_reason: "",
      source_guidance: guidance.guidance,
      source_guidance_detail: guidance.detail,
      needs_verification: [...needs],
    };
    entry.priority_reason =
      `Shortlist #${input.verification_rank} (score ${input.verification_score}) — ` +
      `${entry.glimmr_category} in ${entry.service_area}` +
      (input.verification_reasons.length > 0 ? `: ${input.verification_reasons.join("; ")}` : "");
    return entry;
  });

  const areasCount: Record<string, number> = {};
  const catsCount: Record<string, number> = {};
  for (const entry of queue) {
    areasCount[entry.service_area] = (areasCount[entry.service_area] ?? 0) + 1;
    catsCount[entry.glimmr_category] = (catsCount[entry.glimmr_category] ?? 0) + 1;
  }
  return { queue, counts: { pool: inputs.length, queued: queue.length, areas: areasCount, categories: catsCount } };
}
