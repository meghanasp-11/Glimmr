/**
 * Batch-02 follow-up selection and readiness ranking.
 *
 * Selects the next verification candidates after Batch-01 from the
 * shortlist: Batch-01 ids are excluded, unmapped records and records
 * without coordinates are dropped (same pool rule as the queue builder),
 * and picks are balanced across areas and Glimmr categories. Within those
 * constraints, candidates with explicit on-file evidence (official website,
 * street address, high source confidence, multiple sources) sort first —
 * price and hours evidence can only appear after fetching, so the later
 * readiness ranking weighs those instead.
 *
 * Pure functions (no network, no Firestore). Inputs are never mutated.
 */

export interface FollowUpInput {
  overture_id: string;
  service_area: string;
  name: string;
  lat: number;
  lng: number;
  glimmr_category: string | null;
  websites: string[];
  address_freeform: string | null;
  confidence: number | null;
  sourceCount: number;
  verification_rank: number;
}

export interface FollowUpCounts {
  pool: number;
  excluded: number;
  picked: number;
  areas: Record<string, number>;
  categories: Record<string, number>;
}

export interface FollowUpSelection {
  picked: FollowUpInput[];
  counts: FollowUpCounts;
}

export interface ReadinessRanked {
  overture_id: string;
  name: string;
  service_area: string;
  glimmr_category: string;
  blockerCount: number;
  blockers: string[];
  hasPricingEvidence: boolean;
  hasHoursEvidence: boolean;
  websiteReachable: boolean;
  completeness: number;
  flags: string[];
}

export interface PlaceBlockers {
  overture_id: string;
  ready: boolean;
  blockers: string[];
}

export const FOLLOW_UP_SIZE = 20;
// Quota and floor are sized so both guarantees always fit: 7 categories × 2
// (14 slots) plus topping every area up to 3 (at most 6 more) never exceeds
// a 20-slot batch. Leftovers fill by priority order.
// Diversity caps keep one brand or bucket from eating the batch: different
// outlets of one chain are distinct stops, but verifying the same menu
// five times wastes the batch; likewise no single category may exceed four.
const PER_CATEGORY_QUOTA = 2;
const PER_AREA_FLOOR = 3;
const MAX_PER_CHAIN = 2;
const MAX_PER_CATEGORY = 4;

/**
 * Chain key for diversity capping: the base venue name before any outlet
 * qualifier ("Domino's Pizza | Garuda Mall, …" → "domino's pizza").
 * Matching is deliberately conservative — only an exact normalized base
 * name counts as the same chain.
 */
export function chainKeyFor(name: string): string {
  return name.split("|")[0].split(",")[0].trim().toLowerCase();
}

/** On-file evidence score: official site first, then address, confidence, sources. */
export function evidencePriorityScore(input: FollowUpInput): number {
  let score = 0;
  if (Array.isArray(input.websites) && typeof input.websites[0] === "string" && input.websites[0].length > 0) {
    score += 4;
  }
  if (typeof input.address_freeform === "string" && input.address_freeform.trim().length > 0) {
    score += 2;
  }
  if (typeof input.confidence === "number" && input.confidence >= 0.9) {
    score += 1;
  }
  if (input.sourceCount >= 2) {
    score += 1;
  }
  return score;
}

function orderInputs(inputs: FollowUpInput[]): FollowUpInput[] {
  return [...inputs].sort((a, b) => {
    const score = evidencePriorityScore(b) - evidencePriorityScore(a);
    if (score !== 0) return score;
    if (a.verification_rank !== b.verification_rank) return a.verification_rank - b.verification_rank;
    return a.overture_id < b.overture_id ? -1 : 1;
  });
}

export function selectFollowUpBatch(
  inputs: FollowUpInput[],
  excludeIds: Set<string> | string[],
  size: number = FOLLOW_UP_SIZE,
): FollowUpSelection {
  const excluded = excludeIds instanceof Set ? excludeIds : new Set(excludeIds);
  const pool = inputs.filter(
    (input) =>
      !excluded.has(input.overture_id) &&
      input.glimmr_category !== null &&
      Number.isFinite(input.lat) &&
      Number.isFinite(input.lng),
  );
  const ordered = orderInputs(pool);

  const picked: FollowUpInput[] = [];
  const pickedIds = new Set<string>();
  const chainTaken = new Map<string, number>();
  const categoryTaken = new Map<string, number>();
  const take = (input: FollowUpInput): boolean => {
    if (pickedIds.has(input.overture_id) || picked.length >= size) return false;
    const chain = chainKeyFor(input.name);
    if ((chainTaken.get(chain) ?? 0) >= MAX_PER_CHAIN) return false;
    const category = input.glimmr_category as string;
    if ((categoryTaken.get(category) ?? 0) >= MAX_PER_CATEGORY) return false;
    pickedIds.add(input.overture_id);
    chainTaken.set(chain, (chainTaken.get(chain) ?? 0) + 1);
    categoryTaken.set(category, (categoryTaken.get(category) ?? 0) + 1);
    picked.push(input);
    return true;
  };

  // Phase 1 — per-category quota in rank order (deterministic).
  const categories = [...new Set(ordered.map((input) => input.glimmr_category as string))].sort();
  for (const category of categories) {
    let n = 0;
    for (const input of ordered) {
      if (picked.length >= size) break;
      if (n >= PER_CATEGORY_QUOTA) break;
      if (input.glimmr_category !== category) continue;
      if (take(input)) n += 1;
    }
  }
  // Phase 2 — per-area floor from the remaining pool in rank order.
  const areas = [...new Set(ordered.map((input) => input.service_area))].sort();
  for (const area of areas) {
    for (const input of ordered) {
      if (picked.length >= size) break;
      const count = picked.filter((p) => p.service_area === area).length;
      if (count >= PER_AREA_FLOOR) break;
      if (input.service_area !== area) continue;
      take(input);
    }
  }
  // Phase 3 — fill the rest by priority order.
  for (const input of ordered) {
    if (picked.length >= size) break;
    take(input);
  }
  const ranked = orderInputs(picked);

  const areaCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  for (const entry of ranked) {
    areaCounts[entry.service_area] = (areaCounts[entry.service_area] ?? 0) + 1;
    const category = entry.glimmr_category as string;
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }
  return {
    picked: ranked,
    counts: {
      pool: inputs.length,
      excluded: inputs.length - pool.length,
      picked: ranked.length,
      areas: areaCounts,
      categories: categoryCounts,
    },
  };
}

/**
 * Rank evaluated places by likelihood of becoming production-ready:
 * fewest readiness blockers first, then fetched pricing evidence, then
 * hours evidence, then a reachable official site, then dossier
 * completeness. Fully deterministic (overture_id tiebreak).
 */
export function rankByReadinessPotential(items: ReadinessRanked[]): ReadinessRanked[] {
  return [...items].sort((a, b) => {
    if (a.blockerCount !== b.blockerCount) return a.blockerCount - b.blockerCount;
    if (a.hasPricingEvidence !== b.hasPricingEvidence) return a.hasPricingEvidence ? -1 : 1;
    if (a.hasHoursEvidence !== b.hasHoursEvidence) return a.hasHoursEvidence ? -1 : 1;
    if (a.websiteReachable !== b.websiteReachable) return a.websiteReachable ? -1 : 1;
    if (a.completeness !== b.completeness) return b.completeness - a.completeness;
    return a.overture_id < b.overture_id ? -1 : 1;
  });
}

export interface ReportPlace {
  overture_id: string;
  name: string;
  service_area: string;
  glimmr_category: string | null;
  evidence_score?: number;
}

export interface ReportSelection {
  picked: ReportPlace[];
  counts: FollowUpCounts;
}

/** Human-readable Batch-02 report: selection, blockers, and top 10. */
export function renderFollowUpReport(
  selection: ReportSelection,
  readiness: PlaceBlockers[],
  top10: string[],
  overtureRelease: string,
): string {
  const byId = new Map(selection.picked.map((p) => [p.overture_id, p]));
  const lines = [
    "# Glimmr follow-up batch",
    "",
    `Next ${selection.picked.length} verification candidates after Batch-01 (Overture release ${overtureRelease}).`,
    `Pool: ${selection.counts.pool} shortlisted, ${selection.counts.excluded} excluded or ineligible.`,
    `Coverage — areas: ${JSON.stringify(selection.counts.areas)}; categories: ${JSON.stringify(selection.counts.categories)}.`,
    "",
    "## Selected places",
    "",
  ];
  for (const entry of selection.picked) {
    const score = entry.evidence_score !== undefined ? `, evidence score ${entry.evidence_score}` : "";
    lines.push(
      `- ${entry.overture_id} — ${entry.name} (${entry.glimmr_category} in ${entry.service_area}${score})`,
    );
  }
  lines.push("", "## Readiness blockers", "");
  const blockersById = new Map(readiness.map((r) => [r.overture_id, r]));
  for (const entry of selection.picked) {
    const result = blockersById.get(entry.overture_id);
    if (!result) {
      lines.push(`- ${entry.overture_id}: not evaluated`);
    } else if (result.ready) {
      lines.push(`- ${entry.overture_id}: READY — no blockers`);
    } else {
      lines.push(`- ${entry.overture_id}: ${result.blockers.length} blocker(s): ${result.blockers.join("; ")}`);
    }
  }
  lines.push("", "## Top 10 most likely to become production-ready", "");
  top10.slice(0, 10).forEach((id, index) => {
    const entry = byId.get(id);
    lines.push(`## #${index + 1} ${entry?.name ?? id}${entry ? ` (${entry.glimmr_category} in ${entry.service_area})` : ""}`);
  });
  return `${lines.join("\n")}\n`;
}
