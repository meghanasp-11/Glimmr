import type { OutingType, Place, Plan, PlannerRequest, PlanStep, ServiceArea, TransportMode } from '@/types/glimmr';
import { placePrice, formatINR } from '@/lib/glimmr-format';
import { serviceAreas as staticServiceAreas } from '@/data/places';

/**
 * ============================================================================
 * GLIMMR recommendation engine
 * ============================================================================
 * Deterministic scoring engine: same request + same data always produces the
 * same plans, and every plan carries the reasons it was picked. Scoring
 * weights are centralised here so they're easy to tune as the dataset grows.
 *
 * This module selects and ranks combinations of places from the place
 * catalog (Firestore primary, local data fallback). It never invents a
 * place, price, or opening hour. Distance is approximated with straight-line
 * (Haversine) geometry — a deliberate, isolated stand-in for a real routing
 * API; swapping one in later means changing estimateTravel and nothing else.
 *
 * Scheduling is time-aware but uses only the request and the catalog:
 * the outing start comes from request.startTimeMinutes when provided,
 * otherwise from the catalog's own opening hours. A place is preferred
 * when the planned visit fits inside its listed hours; places with
 * unparseable hours are never excluded on hours grounds.
 * ============================================================================
 */

export const scoringWeights = {
  budgetFit: 0.25,
  preferenceMatch: 0.25,
  experienceQuality: 0.2,
  groupFit: 0.15,
  activityFit: 0.15,
};

const OUTING_TYPE_TAGS: Record<OutingType, string[]> = {
  'Food crawl': ['food'],
  'Low-key day': ['peaceful', 'chill'],
  'Date night': ['drinks', 'photography'],
  'Arts & culture': ['culture', 'art'],
  'Fresh air': ['outdoor', 'active'],
};

// Maps free-text preference to activity tags. Tags are matched against
// place.activities in data/places.ts to influence plan scoring.
const PREFERENCE_TAG_KEYWORDS: Record<string, string[]> = {
  peaceful: ['peaceful', 'quiet', 'calm', 'chill'],
  food: ['food', 'eat', 'dinner', 'lunch', 'breakfast', 'hungry', 'meal'],
  photography: ['photo', 'instagram', 'pictures', 'aesthetic'],
  coffee: ['coffee', 'cafe', 'caffeine'],
  outdoor: ['outdoor', 'park', 'fresh air', 'walk', 'outside'],
  drinks: ['drink', 'beer', 'cocktail', 'bar', 'wine'],
  culture: ['art', 'theatre', 'culture', 'museum', 'poetry'],
  active: ['active', 'adventure', 'sport', 'climb'],
};

export function parsePreferenceTags(preference?: string): string[] {
  if (!preference) return [];
  const text = preference.toLowerCase();
  return Object.entries(PREFERENCE_TAG_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
    .map(([tag]) => tag);
}

// Rough planning speeds (km/h) — not live traffic, just a useful estimate.
const TRANSPORT_SPEED_KMH: Record<TransportMode, number> = {
  walk: 4.5,
  bike: 13,
  transit: 17,
  drive: 20,
};

function haversineKm(a: Pick<Place, 'lat' | 'lng'>, b: Pick<Place, 'lat' | 'lng'>): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function estimateTravel(from: Pick<Place, 'lat' | 'lng'>, to: Pick<Place, 'lat' | 'lng'>, mode: TransportMode) {
  const distanceKm = Number(haversineKm(from, to).toFixed(1));
  const minutes = Math.max(5, Math.round((distanceKm / TRANSPORT_SPEED_KMH[mode]) * 60));
  return { distanceKm, minutes };
}

interface ScoredPlace {
  place: Place;
  score: number;
  reasons: string[];
}

function scorePlace(place: Place, request: PlannerRequest, tags: Set<string>): ScoredPlace {
  const price = placePrice(place);
  const budgetFit = price <= request.budget ? 1 : Math.max(0, 1 - (price - request.budget) / request.budget);

  const matchCount = place.activities.filter((activity) => tags.has(activity)).length;
  const preferenceMatch = tags.size ? matchCount / tags.size : 0.5;

  const experienceQuality = place.experienceScore;

  const wantsIntimate = request.people <= 2;
  const groupFit = wantsIntimate
    ? place.suitableFor.includes('couple') || place.suitableFor.includes('solo') ? 1 : 0.6
    : place.suitableFor.includes('friends') || place.suitableFor.includes('family') ? 1 : 0.6;

  const activityFit = place.activities.some((activity) => tags.has(activity)) ? 1 : 0.5;

  const score =
    budgetFit * scoringWeights.budgetFit +
    preferenceMatch * scoringWeights.preferenceMatch +
    experienceQuality * scoringWeights.experienceQuality +
    groupFit * scoringWeights.groupFit +
    activityFit * scoringWeights.activityFit;

  const reasons: string[] = [];
  if (budgetFit >= 0.85) reasons.push('Fits your budget');
  if (preferenceMatch >= 0.5) reasons.push('Matches what you asked for');
  if (experienceQuality >= 0.8) reasons.push('Highly rated experience');
  if (groupFit === 1) reasons.push('Works for your group');

  return { place, score, reasons };
}

// Category buckets used to build varied, sensible stop sequences.
// Data-driven against the category strings in data/places.ts so new places
// slot in automatically by category.
const BUCKETS: Record<'starter' | 'main' | 'activity' | 'evening', string[]> = {
  starter: ['Cafe', 'Dessert'],
  main: ['Dinner'],
  activity: ['Activity', 'Culture', 'Outdoor'],
  evening: ['Drinks'],
};

function bucketOf(place: Place): keyof typeof BUCKETS | null {
  for (const [bucket, categories] of Object.entries(BUCKETS) as [keyof typeof BUCKETS, string[]][]) {
    if (categories.includes(place.category)) return bucket;
  }
  return null;
}

// Three distinct stop-sequence templates — what makes the 3 results
// meaningfully different shapes of outing, not 3 shuffles of the same idea.
// 'sort' controls how each bucket's candidates are ranked before picking:
// score-based for general templates, price-based for the value option.
const PLAN_TEMPLATES: { label: string; buckets: (keyof typeof BUCKETS)[]; sort: 'score' | 'price' }[] = [
  { label: 'Best fit', buckets: ['starter', 'main', 'activity'], sort: 'score' },
  { label: 'Best value', buckets: ['starter', 'main'], sort: 'price' },
  { label: 'Most adventurous', buckets: ['activity', 'main', 'evening'], sort: 'score' },
];

const START_TIME_MINUTES_FALLBACK = 9 * 60; // 9:00 AM, last resort only: no request start and no parseable hours anywhere in the catalog

function formatOverBudget(price: number, budget: number): string {
  return formatINR(price - budget);
}

function formatClock(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  return `${hour12}:${minute.toString().padStart(2, '0')} ${suffix}`;
}

// ============================================================================
// Opening hours (parsed from each place's own openingHours string)
// ============================================================================

export interface OpeningWindow {
  /** Minutes since midnight the place opens. */
  open: number;
  /** Minutes since midnight it closes; may exceed 1440 for overnight hours. */
  close: number;
}

function toMinutesSinceMidnight(hours: number, minutes: number, meridiem: string): number {
  const hour12 = hours % 12;
  return hour12 * 60 + minutes + (meridiem.toLowerCase() === 'pm' ? 12 * 60 : 0);
}

/**
 * Parse common opening-hours strings ("8:00 AM – 9:00 PM", "12:00 PM - 1:00 AM",
 * "Always open") into a minute window. Returns null when the string carries
 * no parseable window — callers must treat null as "unknown", never as closed.
 */
export function parseOpeningHours(openingHours: string): OpeningWindow | null {
  const text = openingHours.trim().toLowerCase();
  if (/always\s+open|24\s*hours?|24\s*\/\s*7|open\s*24/.test(text)) {
    return { open: 0, close: 2 * 1440 };
  }
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (!match) return null;
  const open = toMinutesSinceMidnight(Number(match[1]), Number(match[2] ?? 0), match[3]);
  let close = toMinutesSinceMidnight(Number(match[4]), Number(match[5] ?? 0), match[6]);
  // A closing time at or before opening means overnight hours (e.g. 12 PM – 1 AM).
  if (close <= open) close += 1440;
  return { open, close };
}

/**
 * Whether a [arrival, departure] visit (absolute minutes from start-day
 * midnight) fits inside the place's window. Overnight visits are checked
 * against the window shifted one day forward as well.
 */
export function isOpenForVisit(window: OpeningWindow | null, arrival: number, departure: number): boolean {
  if (!window) return true;
  if (window.open <= arrival && departure <= window.close) return true;
  return window.open + 1440 <= arrival && departure <= window.close + 1440;
}

// ============================================================================
// Outing start time (request context first, catalog data second)
// ============================================================================

function normalizeStartTime(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const minutes = Math.floor(value);
  if (minutes < 0 || minutes >= 1440) return null;
  return minutes;
}

/**
 * Resolve the outing start in minutes since midnight:
 * 1. request.startTimeMinutes when it is a usable clock time;
 * 2. the earliest opening among starter-bucket candidates (the outing opens
 *    with its first stop), else the earliest opening among all candidates;
 * 3. a documented last-resort morning default (only reachable when no place
 *    in the catalog has parseable hours).
 */
export function resolveStartTime(request: PlannerRequest, candidates: Place[]): number {
  const fromRequest = normalizeStartTime(request.startTimeMinutes);
  if (fromRequest !== null) return fromRequest;

  const openings = (places: Place[]): number[] => {
    const result: number[] = [];
    for (const place of places) {
      const window = parseOpeningHours(place.openingHours);
      if (window) result.push(window.open);
    }
    return result;
  };

  const starterOpenings = openings(candidates.filter((place) => bucketOf(place) === 'starter'));
  if (starterOpenings.length) return Math.min(...starterOpenings);
  const allOpenings = openings(candidates);
  if (allOpenings.length) return Math.min(...allOpenings);
  return START_TIME_MINUTES_FALLBACK;
}

interface StopInput {
  place: Place;
  durationMinutes: number;
}

/**
 * Lay a sequence of stops onto the clock: each stop's arrival is the start
 * (first stop) or the previous departure plus travel, using actual visit
 * durations and Haversine travel estimates. Pure and deterministic.
 */
function scheduleSequence(items: StopInput[], transport: TransportMode, start: number, idPrefix = 'step'): PlanStep[] {
  const steps: PlanStep[] = [];
  let clock = start;
  let previous: Place | null = null;
  for (const item of items) {
    const travel = previous ? estimateTravel(previous, item.place, transport) : { distanceKm: 0, minutes: 0 };
    clock += travel.minutes;
    steps.push({
      id: `${idPrefix}-${item.place.id}-${steps.length}`,
      place: item.place,
      arrival: formatClock(clock),
      durationMinutes: item.durationMinutes,
      travelMinutes: travel.minutes,
      distanceKm: travel.distanceKm,
    });
    clock += item.durationMinutes;
    previous = item.place;
  }
  return steps;
}

function buildSteps(sequence: Place[], request: PlannerRequest, start: number): PlanStep[] {
  return scheduleSequence(
    sequence.map((place) => ({ place, durationMinutes: place.typicalVisitDuration })),
    request.transport,
    start,
  );
}

/** One travel leg between consecutive stops (e.g. from the Maps service). */
export interface TravelLeg {
  distanceKm: number;
  durationMinutes: number;
}

/**
 * Lay existing steps onto the clock using caller-supplied legs (legs[i]
 * covers steps[i] → steps[i + 1]). Pure and provider-agnostic: legs may come
 * from the Haversine estimator or a road-routing provider. Step identity,
 * durations, and notes are preserved; only clock-derived fields refresh.
 */
export function scheduleStepsWithLegs(steps: PlanStep[], legs: TravelLeg[], start: number): PlanStep[] {
  let clock = start;
  return steps.map((step, index) => {
    const leg = index === 0 ? { distanceKm: 0, durationMinutes: 0 } : legs[index - 1];
    clock += leg?.durationMinutes ?? 0;
    const scheduled: PlanStep = {
      ...step,
      arrival: formatClock(clock),
      travelMinutes: leg?.durationMinutes ?? 0,
      distanceKm: leg?.distanceKm ?? 0,
    };
    clock += step.durationMinutes;
    return scheduled;
  });
}

/** Recalculate travel and arrival times after a user changes a route. */
export function recalculateRoute(steps: PlanStep[], request: PlannerRequest): PlanStep[] {
  const start = resolveStartTime(request, steps.map((step) => step.place));
  const legs: TravelLeg[] = [];
  for (let i = 1; i < steps.length; i += 1) {
    const travel = estimateTravel(steps[i - 1].place, steps[i].place, request.transport);
    legs.push({ distanceKm: travel.distanceKm, durationMinutes: travel.minutes });
  }
  return scheduleStepsWithLegs(steps, legs, start);
}

function totalsFor(steps: PlanStep[]) {
  const pricePerPerson = steps.reduce((sum, step) => sum + placePrice(step.place), 0);
  const totalMinutes = steps.reduce((sum, step) => sum + step.durationMinutes + step.travelMinutes, 0);
  const travelMinutes = steps.reduce((sum, step) => sum + step.travelMinutes, 0);
  const totalDistanceKm = Number(steps.reduce((sum, step) => sum + step.distanceKm, 0).toFixed(1));
  return { pricePerPerson, totalMinutes, travelMinutes, totalDistanceKm };
}

/**
 * Resolve the request to a service-area id against the provided areas.
 * Callers pass the Firestore-first catalog (`serviceAreasCatalog()`); the
 * static local areas are only the default so pure callers and existing
 * tests keep working unchanged.
 */
export function resolveServiceArea(request: PlannerRequest, areas: ServiceArea[] = staticServiceAreas): string {
  const match = areas.find(
    (area) => area.active && (request.from.toLowerCase().includes(area.name.toLowerCase()) || request.to.toLowerCase().includes(area.name.toLowerCase())),
  );
  // Fallback: default to the first active area.
  return match?.id ?? areas.find((area) => area.active)?.id ?? areas[0].id;
}

export function generatePlans(request: PlannerRequest, allPlaces: Place[], areas: ServiceArea[] = staticServiceAreas): Plan[] {
  const serviceArea = resolveServiceArea(request, areas);
  const candidates = allPlaces.filter((place) => place.serviceArea === serviceArea);

  // The resolved start travels with the plan so edits reschedule on the same
  // clock. The caller's request object is never mutated.
  const plannedRequest: PlannerRequest = {
    ...request,
    startTimeMinutes: resolveStartTime(request, candidates),
  };
  const start = plannedRequest.startTimeMinutes as number;

  const tags = new Set([...parsePreferenceTags(request.preference), ...OUTING_TYPE_TAGS[request.outingType]]);
  const scored = candidates
    .map((place) => scorePlace(place, request, tags))
    .sort((a, b) => b.score - a.score || (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0));

  const byBucket = new Map<keyof typeof BUCKETS, ScoredPlace[]>();
  for (const entry of scored) {
    const bucket = bucketOf(entry.place);
    if (!bucket) continue;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push(entry);
  }

  const usedPlaceIds = new Set<string>();
  const plans: Plan[] = [];

  for (const template of PLAN_TEMPLATES) {
    const poolFor = (bucket: keyof typeof BUCKETS): ScoredPlace[] => {
      const pool = [...(byBucket.get(bucket) ?? [])];
      if (template.sort === 'price') {
        pool.sort(
          (a, b) => placePrice(a.place) - placePrice(b.place) || b.score - a.score || (a.place.id < b.place.id ? -1 : 1),
        );
      }
      return pool;
    };

    // Sequential, clock-aware selection: each slot's arrival is known when
    // the pick is made, so opening hours and the remaining time budget can
    // prefer better-fitting candidates. Preference order per slot:
    // open + within budget + within time, then open + within budget, then
    // open, then the legacy budget-first order (a full-shaped plan built
    // from the catalog beats a dropped stop).
    const chosen: ScoredPlace[] = [];
    let clock = start;
    let runningPrice = 0;
    let runningMinutes = 0;
    let previous: Place | null = null;
    for (const bucket of template.buckets) {
      const pool = poolFor(bucket);
      const unused = pool.filter((entry) => !usedPlaceIds.has(entry.place.id));
      const rankedPool = unused.length ? unused : pool;
      const arrivalFor = (entry: ScoredPlace): number =>
        clock + (previous ? estimateTravel(previous, entry.place, request.transport).minutes : 0);
      const fitsTime = (entry: ScoredPlace): boolean => {
        const travel = previous ? estimateTravel(previous, entry.place, request.transport).minutes : 0;
        return runningMinutes + travel + entry.place.typicalVisitDuration <= request.availableMinutes;
      };
      const openRank = rankedPool.filter((entry) => {
        const window = parseOpeningHours(entry.place.openingHours);
        const arrival = arrivalFor(entry);
        return isOpenForVisit(window, arrival, arrival + entry.place.typicalVisitDuration);
      });
      const remaining = request.budget - runningPrice;
      const pick =
        openRank.find((entry) => placePrice(entry.place) <= remaining && fitsTime(entry)) ??
        openRank.find((entry) => placePrice(entry.place) <= remaining) ??
        openRank[0] ??
        rankedPool.find((entry) => placePrice(entry.place) <= remaining) ??
        rankedPool[0];
      if (pick) {
        const travel = previous ? estimateTravel(previous, pick.place, request.transport).minutes : 0;
        clock += travel + pick.place.typicalVisitDuration;
        runningMinutes += travel + pick.place.typicalVisitDuration;
        runningPrice += placePrice(pick.place);
        previous = pick.place;
        chosen.push(pick);
      }
    }
    if (!chosen.length) continue;

    let picked = [...chosen];
    let steps = buildSteps(picked.map((entry) => entry.place), request, start);
    let totals = totalsFor(steps);

    // If the combination doesn't fit the window, iteratively drop the
    // lowest-scored stop (deterministic tiebreak on id) and reschedule —
    // travel legs change when a middle stop leaves — until it fits or a
    // single stop remains. A short feasible plan beats a long impossible one;
    // a plan that still overruns says so instead of silently dropping stops.
    while (totals.totalMinutes > request.availableMinutes && picked.length > 1) {
      const ordered = [...picked].sort((a, b) => a.score - b.score || (a.place.id < b.place.id ? -1 : 1));
      picked = picked.filter((entry) => entry !== ordered[0]);
      steps = buildSteps(picked.map((entry) => entry.place), request, start);
      totals = totalsFor(steps);
    }

    let feasibilityNote: string | undefined;
    if (totals.totalMinutes > request.availableMinutes) {
      feasibilityNote = `This plan runs about ${totals.totalMinutes - request.availableMinutes} min over your available time.`;
    }
    if (totals.pricePerPerson > request.budget) {
      feasibilityNote = feasibilityNote
        ? `${feasibilityNote} It's also ${formatOverBudget(totals.pricePerPerson, request.budget)} over budget per person.`
        : `This plan runs ${formatOverBudget(totals.pricePerPerson, request.budget)} over your budget per person.`;
    }

    picked.forEach((entry) => usedPlaceIds.add(entry.place.id));

    // Reasons are derived from the final combined plan, not per-place scores.
    // A plan flagged infeasible never also claims "fits your budget".
    const reasons: string[] = [];
    if (totals.pricePerPerson <= request.budget) reasons.push('Fits your budget');
    if (totals.totalMinutes <= request.availableMinutes) reasons.push('Fits your time');
    if (picked.every((entry) => entry.reasons.includes('Works for your group'))) reasons.push('Works for your group');
    const avgPreferenceMatch = picked.reduce((sum, entry) => sum + (tags.size ? entry.place.activities.filter((a) => tags.has(a)).length / tags.size : 0), 0) / picked.length;
    if (avgPreferenceMatch >= 0.4) reasons.push('Matches what you asked for');
    const avgExperience = picked.reduce((sum, entry) => sum + entry.place.experienceScore, 0) / picked.length;
    if (avgExperience >= 0.75) reasons.push('Highly rated stops');
    if (template.sort === 'price') reasons.push('Keeps spend predictable');

    plans.push({
      id: `plan-${template.label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${plans.length}`,
      title: picked.map((entry) => entry.place.name).slice(0, 2).join(' → '),
      subtitle: picked.map((entry) => entry.place.subcategory ?? entry.place.category).join(', '),
      vibe: picked[0]?.place.vibe ?? '',
      totalMinutes: totals.totalMinutes,
      pricePerPerson: totals.pricePerPerson,
      groupTotal: totals.pricePerPerson * request.people,
      totalDistanceKm: totals.totalDistanceKm,
      travelMinutes: totals.travelMinutes,
      feasible: !feasibilityNote,
      feasibilityNote,
      recommendationLabel: template.label,
      recommendationReason: reasons.length ? reasons : ['A different shape of outing than the other two'],
      status: 'ready',
      steps,
      request: plannedRequest,
    });
  }

  return plans;
}
