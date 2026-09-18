/**
 * Rank curated candidates for manual verification priority.
 *
 * Uses ONLY existing source data — never invents ratings, prices, hours,
 * vibe, durations, activities, or suitability. Unmapped/review records are
 * excluded from the shortlist (kept separate, never force-mapped).
 *
 * Scoring (deterministic; ties break on confidence, then Overture id):
 * - Glimmr category base: food-first, matching what plan templates need
 *   (every template needs starter+main): Dinner 100, Cafe 90, Drinks 85,
 *   Activity 80, Culture 75, Dessert 70, Outdoor 65.
 * - Listed as open (`operating_status === "open"`): +10.
 * - Source confidence scaled to +0..20.
 * - Has a website to verify against: +10.
 * - Valid finite coordinates are required (normalizer guarantees them;
 *   anything else is dropped as invalid, never scored).
 *
 * Coverage: per-area quotas proportional to each area's mapped pool
 * (minimum 20 per area, so all V1 areas are represented), plus a grid-cell
 * cap (~110 m cells, max 4 picks each) so picks spread geographically
 * instead of clustering on one street. Every pick carries its reasons.
 */

import type { CandidatePlace } from "./curate";

export interface ShortlistedCandidate extends CandidatePlace {
  verification_rank: number;
  verification_score: number;
  verification_reasons: string[];
}

export interface ShortlistCounts {
  pool: number;
  unmapped_excluded: number;
  invalid_dropped: number;
  shortlisted: number;
  skipped_clustered: number;
}

export interface ShortlistResult {
  shortlisted: ShortlistedCandidate[];
  counts: ShortlistCounts;
  quotas: Record<string, number>;
}

const CATEGORY_BASE: Record<string, number> = {
  Dinner: 100,
  Cafe: 90,
  Drinks: 85,
  Activity: 80,
  Culture: 75,
  Dessert: 70,
  Outdoor: 65,
};

export const SHORTLIST_TARGET = 180;
const MIN_PER_AREA = 20;
const MAX_PER_CELL = 4;

function cellKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)}|${lng.toFixed(3)}`;
}

function scoreCandidate(candidate: CandidatePlace): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const base = CATEGORY_BASE[candidate.glimmr_category ?? ""];
  if (base !== undefined) {
    score += base;
    reasons.push(`${candidate.glimmr_category} (core outing category)`);
  }
  if (candidate.operating_status === "open") {
    score += 10;
    reasons.push("listed as open");
  }
  if (typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)) {
    const scaled = Math.round(Math.max(0, Math.min(1, candidate.confidence)) * 20);
    score += scaled;
    if (scaled >= 14) reasons.push(`high source confidence ${candidate.confidence}`);
  }
  if (candidate.websites.length > 0) {
    score += 10;
    reasons.push("has website for verification");
  }
  return { score, reasons };
}

export function rankCandidates(
  records: CandidatePlace[],
  target: number = SHORTLIST_TARGET,
): ShortlistResult {
  const counts: ShortlistCounts = {
    pool: records.length,
    unmapped_excluded: 0,
    invalid_dropped: 0,
    shortlisted: 0,
    skipped_clustered: 0,
  };

  const eligible: { candidate: CandidatePlace; score: number; reasons: string[] }[] = [];
  for (const record of records) {
    if (record.glimmr_category === null) {
      counts.unmapped_excluded += 1;
      continue;
    }
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lng)) {
      counts.invalid_dropped += 1;
      continue;
    }
    const { score, reasons } = scoreCandidate(record);
    eligible.push({ candidate: record, score, reasons });
  }

  // Per-area quotas proportional to mapped pool size (floor keeps every V1
  // area represented); rounding drift goes to the largest pool.
  const byArea = new Map<string, typeof eligible>();
  for (const entry of eligible) {
    const list = byArea.get(entry.candidate.service_area) ?? [];
    list.push(entry);
    byArea.set(entry.candidate.service_area, list);
  }
  const quotas: Record<string, number> = {};
  if (eligible.length > 0 && target > 0) {
    let assigned = 0;
    let largest = "";
    for (const [area, list] of byArea) {
      const quota = Math.max(MIN_PER_AREA, Math.round((target * list.length) / eligible.length));
      quotas[area] = quota;
      assigned += quota;
      if (largest === "" || list.length > (byArea.get(largest)?.length ?? 0)) largest = area;
    }
    quotas[largest] += target - assigned;
    if (quotas[largest] < 0) quotas[largest] = 0;
  }

  const compare = (
    a: { candidate: CandidatePlace; score: number },
    b: { candidate: CandidatePlace; score: number },
  ): number => {
    if (b.score !== a.score) return b.score - a.score;
    const confA = a.candidate.confidence ?? -1;
    const confB = b.candidate.confidence ?? -1;
    if (confB !== confA) return confB - confA;
    return a.candidate.overture_id < b.candidate.overture_id ? -1 : 1;
  };

  const picked: typeof eligible = [];
  const takenPerCell = new Map<string, number>();
  const takenIds = new Set<string>();
  const countedSkips = new Set<string>();

  const tryTake = (entry: (typeof eligible)[number], diversityReason: string | null): boolean => {
    if (takenIds.has(entry.candidate.overture_id)) return false;
    const cell = `${entry.candidate.service_area}|${cellKey(entry.candidate.lat, entry.candidate.lng)}`;
    if ((takenPerCell.get(cell) ?? 0) >= MAX_PER_CELL) {
      if (!countedSkips.has(entry.candidate.overture_id)) {
        countedSkips.add(entry.candidate.overture_id);
        counts.skipped_clustered += 1;
      }
      return false;
    }
    takenIds.add(entry.candidate.overture_id);
    takenPerCell.set(cell, (takenPerCell.get(cell) ?? 0) + 1);
    if (diversityReason) entry.reasons.push(diversityReason);
    picked.push(entry);
    return true;
  };

  for (const [area, quota] of Object.entries(quotas)) {
    const list = [...(byArea.get(area) ?? [])].sort(compare);
    const taken: typeof eligible = [];
    // Phase 1 — diversity floor: every mapped category present in the area
    // gets its top records first, so verification covers all plan buckets.
    const cats = [...new Set(list.map((entry) => entry.candidate.glimmr_category ?? ""))].sort();
    const floor = Math.max(2, Math.floor(quota / Math.max(1, cats.length)));
    const need = new Map(cats.map((cat) => [cat, floor]));
    for (const cat of cats) {
      for (const entry of list) {
        if (taken.length >= quota) break;
        if ((need.get(cat) ?? 0) <= 0) break;
        if ((entry.candidate.glimmr_category ?? "") !== cat) continue;
        if (tryTake(entry, `ensures ${cat} coverage in ${area}`)) {
          taken.push(entry);
          need.set(cat, (need.get(cat) ?? 1) - 1);
        }
      }
    }
    // Phase 2 — fill the rest of the quota by rank.
    for (const entry of list) {
      if (taken.length >= quota) break;
      if (tryTake(entry, null)) taken.push(entry);
    }
  }
  picked.sort(compare);

  counts.shortlisted = picked.length;
  const shortlisted = picked.map((entry, index) => ({
    ...entry.candidate,
    verification_rank: index + 1,
    verification_score: entry.score,
    verification_reasons: entry.reasons,
  }));
  return { shortlisted, counts, quotas };
}
