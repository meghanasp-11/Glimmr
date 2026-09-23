import { places as localPlaces, serviceAreas as localServiceAreas } from '@/data/mockData';
import { ensureFirebaseUser, isFirebaseConfigured } from '@/lib/firebase';
import { placePrice } from '@/lib/glimmr-format';
import { generatePlans, parsePreferenceTags, recalculateRoute, resolveStartTime, scheduleStepsWithLegs } from '@/lib/recommendationEngine';
import { mapsService } from '@/lib/maps';
import type { GeocodedPoint } from '@/lib/maps';
import { getDocument, getPlaces, getServiceAreas, normalizeOutingRecord, setDocument } from '@/services/firebaseService';
import type { Outing, Place, Plan, PlanEdit, PlannerRequest, PlanStep, ServiceArea } from '@/types/glimmr';
import { PlaceSchema, PlanSchema, ServiceAreaSchema } from '@/types/glimmr';

const wait = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));
const planStore = new Map<string, Plan>();
const PLAN_STORE_KEY = 'glimmr-plans';
const OUTING_STORE_KEY = 'glimmr-outings';

type StoredRecord<T> = T & { userId: string };

function readSession(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Private-mode / quota failures must never break planning.
  }
}

function clearSession(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore: clearing is best-effort.
  }
}

function restorePlans(): void {
  if (planStore.size) return;
  try {
    (JSON.parse(readSession(PLAN_STORE_KEY) ?? '[]') as Plan[]).forEach((plan) => planStore.set(plan.id, plan));
  } catch {
    clearSession(PLAN_STORE_KEY);
  }
}

function persistLocalPlans(): void {
  writeSession(PLAN_STORE_KEY, JSON.stringify([...planStore.values()]));
}

function firestorePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function invalidRecordLabel(doc: unknown): string {
  return typeof doc === 'object' && doc !== null
    ? String((doc as { id?: unknown }).id ?? '(missing id)')
    : '(missing id)';
}

/**
 * Primary catalog: Firestore `places` when Firebase is configured.
 * Documents that fail PlaceSchema are dropped with a warning so one bad
 * record cannot break planning. Falls back to the local catalog when
 * Firebase is unconfigured, unreachable, or yields zero valid places.
 */
async function catalog(): Promise<Place[]> {
  if (!isFirebaseConfigured) return localPlaces;
  try {
    const remote: Place[] = [];
    for (const doc of await getPlaces()) {
      const parsed = PlaceSchema.safeParse(doc);
      if (parsed.success) {
        remote.push(parsed.data);
      } else {
        console.warn('[glimmr] Ignoring invalid place record:', invalidRecordLabel(doc));
      }
    }
    if (remote.length > 0) return remote;
    console.warn('[glimmr] Firestore places catalog is empty; using local fallback catalog.');
  } catch (err) {
    console.warn('[glimmr] Firestore places unavailable; using local fallback catalog.', err);
  }
  return localPlaces;
}

/**
 * Public catalog for UI option lists (plan-detail dialogs). Same
 * Firestore-first contract as generation: callers always see the same
 * places the engine plans from, never a divergent static copy.
 */
export async function listPlaces(): Promise<Place[]> {
  return catalog();
}

/**
 * Service areas, Firestore-first with the same local-fallback contract as
 * the places catalog. Areas stay data-driven: no area ids branch in code.
 */
export async function serviceAreasCatalog(): Promise<ServiceArea[]> {
  if (!isFirebaseConfigured) return localServiceAreas;
  try {
    const remote: ServiceArea[] = [];
    for (const doc of await getServiceAreas()) {
      const parsed = ServiceAreaSchema.safeParse(doc);
      if (parsed.success) {
        remote.push(parsed.data);
      } else {
        console.warn('[glimmr] Ignoring invalid serviceArea record:', invalidRecordLabel(doc));
      }
    }
    if (remote.length > 0) return remote;
    console.warn('[glimmr] Firestore serviceAreas catalog is empty; using local fallback areas.');
  } catch (err) {
    console.warn('[glimmr] Firestore serviceAreas unavailable; using local fallback areas.', err);
  }
  return localServiceAreas;
}

const GEOCODE_CACHE_KEY = 'glimmr-geocode';

export interface EndpointGeocodes {
  from: GeocodedPoint | null;
  to: GeocodedPoint | null;
}

export interface CachedGeocodes extends EndpointGeocodes {
  fromQuery: string;
  toQuery: string;
}

async function safeGeocode(query: string): Promise<GeocodedPoint | null> {
  try {
    return await mapsService.geocode(query);
  } catch {
    return null;
  }
}

/**
 * Geocode the planner's start/destination exactly once per submission using
 * the existing single-shot Nominatim abstraction — no autocomplete, no
 * bulk requests. Never throws and never blocks longer than a short
 * best-effort window: failures simply cache as null and the flow continues
 * on place coordinates. Results are cached in-session for the outing page
 * (directions origin).
 */
export async function geocodeEndpoints(from: string, to: string, timeoutMs = 3000): Promise<EndpointGeocodes> {
  const lookup = Promise.all([safeGeocode(from), safeGeocode(to)]).then(([fromPoint, toPoint]) => ({
    from: fromPoint,
    to: toPoint,
  }));
  const fallback: EndpointGeocodes = { from: null, to: null };
  let result = fallback;
  try {
    result = await Promise.race([
      lookup,
      new Promise<EndpointGeocodes>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
  } catch {
    result = fallback;
  }
  // Cache even total failures so readers can distinguish "looked up" (nulls)
  // from "never looked up" (missing entry).
  writeSession(GEOCODE_CACHE_KEY, JSON.stringify({ fromQuery: from, toQuery: to, ...result }));
  return result;
}

/** Read the cached submit-time geocodes, if the queries still match. */
export function readGeocodeCache(fromQuery: string, toQuery: string): CachedGeocodes | null {
  try {
    const raw = readSession(GEOCODE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedGeocodes;
    if (cached.fromQuery !== fromQuery || cached.toQuery !== toQuery) return null;
    return cached;
  } catch {
    return null;
  }
}

async function persistPlan(plan: Plan): Promise<void> {
  if (!isFirebaseConfigured) return;
  const user = await ensureFirebaseUser();
  await setDocument('plans', plan.id, firestorePayload<StoredRecord<Plan>>({ ...plan, userId: user.uid }));
}

/**
 * Best-effort persistence: a denied/offline Firestore write must never fail
 * plan generation or editing. The in-memory + session copy is already
 * updated by calculatePlanTotals, so the user keeps a working plan.
 */
async function persistPlanBestEffort(plan: Plan): Promise<void> {
  try {
    await persistPlan(plan);
  } catch (err) {
    console.warn('[glimmr] Plan persistence failed; keeping the local copy.', err);
  }
}

export function calculatePlanTotals(plan: Plan, status: Plan['status'] = plan.status): Plan {
  const pricePerPerson = plan.steps.reduce((total, step) => total + placePrice(step.place), 0);
  const totalMinutes = plan.steps.reduce((total, step) => total + step.durationMinutes + step.travelMinutes, 0);
  const travelMinutes = plan.steps.reduce((total, step) => total + step.travelMinutes, 0);
  const totalDistanceKm = Number(plan.steps.reduce((total, step) => total + step.distanceKm, 0).toFixed(1));
  const feasible = totalMinutes <= plan.request.availableMinutes;
  const updated: Plan = {
    ...plan, totalMinutes, pricePerPerson, groupTotal: pricePerPerson * plan.request.people, totalDistanceKm, travelMinutes, feasible,
    feasibilityNote: feasible ? undefined : `This edit adds ${totalMinutes - plan.request.availableMinutes} min beyond your available time.`, status,
  };
  planStore.set(updated.id, updated);
  persistLocalPlans();
  return updated;
}

/**
 * Reschedule edited steps on the same clock the engine uses, upgrading the
 * Haversine legs to road-routing legs from the Maps service when reachable.
 * Any failure (offline, timeout, malformed payload) keeps the engine's own
 * numbers — an edit never fails because routing did.
 */
export async function recalculateRouteWithMaps(steps: PlanStep[], request: PlannerRequest): Promise<PlanStep[]> {
  const base = recalculateRoute(steps, request);
  if (steps.length < 2) return base;
  try {
    const legs = await mapsService.routeLegs(
      steps.map((step) => step.place),
      request.transport,
    );
    if (legs.length !== steps.length - 1) return base;
    return scheduleStepsWithLegs(
      steps,
      legs,
      resolveStartTime(request, steps.map((step) => step.place)),
    );
  } catch {
    return base;
  }
}

export async function createPlans(request: PlannerRequest): Promise<Plan[]> {
  await wait();
  if (request.availableMinutes <= 30 || request.budget <= 100) return [];
  planStore.clear();
  const [places, areas] = await Promise.all([catalog(), serviceAreasCatalog()]);
  const plans = generatePlans(request, places, areas).map((plan) => calculatePlanTotals(plan, 'ready'));
  await Promise.all(plans.map(persistPlanBestEffort));
  return plans;
}

function asPlan(value: unknown): Plan | null {
  const parsed = PlanSchema.safeParse(value);
  if (!parsed.success) {
    console.warn('[glimmr] Ignoring stored plan that fails PlanSchema.');
    return null;
  }
  return parsed.data as Plan;
}

function localPlan(id: string): Plan | null {
  restorePlans();
  const cached = planStore.get(id);
  return cached ? calculatePlanTotals(cached, 'ready') : null;
}

export async function getPlanById(id: string): Promise<Plan | null> {
  await wait(120);
  if (isFirebaseConfigured) {
    try {
      const stored = await getDocument<StoredRecord<Plan>>('plans', id);
      if (!stored) return localPlan(id);
      const plan = asPlan(stored);
      return plan ? calculatePlanTotals(plan, 'ready') : localPlan(id);
    } catch (err) {
      // Rules denial / offline must degrade to the local copy, not a dead end.
      console.warn('[glimmr] Firestore plan read failed; falling back to the local copy.', err);
      return localPlan(id);
    }
  }
  return localPlan(id);
}

function readLocalOuting(planId: string): Outing | null {
  try {
    const outings = JSON.parse(readSession(OUTING_STORE_KEY) ?? '{}') as Record<string, Outing>;
    const outing = outings[planId] ?? null;
    return outing ? normalizeOutingRecord(outing) : null;
  } catch {
    clearSession(OUTING_STORE_KEY);
    return null;
  }
}

function writeLocalOuting(outing: Outing): void {
  try {
    const outings = JSON.parse(readSession(OUTING_STORE_KEY) ?? '{}') as Record<string, Outing>;
    outings[outing.planId] = outing;
    writeSession(OUTING_STORE_KEY, JSON.stringify(outings));
  } catch {
    clearSession(OUTING_STORE_KEY);
  }
}

/**
 * Reconcile a stored outing against the current plan: plans stay editable,
 * so a resumed outing may reference removed stops. Completed ids that no
 * longer exist are pruned and a dangling current stop moves to the first
 * unfinished stop. Status is derived from actual progress.
 */
export function reconcileOuting(plan: Plan, outing: Outing): Outing {
  const ids = new Set(plan.steps.map((step) => step.id));
  const completedStepIds = outing.completedStepIds.filter((id) => ids.has(id));
  const currentStepId = ids.has(outing.currentStepId)
    ? outing.currentStepId
    : (plan.steps.find((step) => !completedStepIds.includes(step.id))?.id ?? plan.steps[0]?.id ?? outing.currentStepId);
  const done = plan.steps.length > 0 && completedStepIds.length >= plan.steps.length;
  const now = new Date().toISOString();
  return {
    ...outing,
    completedStepIds,
    currentStepId,
    status: done ? 'completed' : outing.status === 'abandoned' ? 'abandoned' : 'in_progress',
    completedAt: done ? (outing.completedAt ?? now) : undefined,
    updatedAt: now,
  };
}

function outingNeedsRepair(before: Outing, after: Outing): boolean {
  return (
    before.currentStepId !== after.currentStepId ||
    before.status !== after.status ||
    before.completedStepIds.length !== after.completedStepIds.length ||
    before.completedStepIds.some((id, index) => id !== after.completedStepIds[index])
  );
}

export async function getOuting(planId: string): Promise<Outing | null> {
  const plan = await getPlanById(planId);
  if (!plan) return null;
  let stored: Outing | null = null;
  if (isFirebaseConfigured) {
    try {
      const doc = await getDocument<StoredRecord<Outing>>('outings', `outing-${planId}`);
      stored = normalizeOutingRecord(doc);
    } catch (err) {
      console.warn('[glimmr] Firestore outing read failed; falling back to the local copy.', err);
    }
    // Firestore may be empty while a session copy holds progress written
    // during an offline/denied window — resume it instead of restarting.
    stored ??= readLocalOuting(planId);
  } else {
    stored = readLocalOuting(planId);
  }
  if (!stored) return startOuting(plan);
  // Resume: reconcile against the (possibly edited) plan and repair the
  // stored copies best-effort so refresh/restart lands on a valid stop.
  const resumed = reconcileOuting(plan, stored);
  if (outingNeedsRepair(stored, resumed)) {
    try {
      await saveOuting(resumed);
    } catch (err) {
      console.warn('[glimmr] Outing repair persistence failed; continuing with the reconciled copy.', err);
    }
  }
  return resumed;
}

/** Start a fresh outing: nothing completed, current stop is the first stop. */
export async function startOuting(plan: Plan): Promise<Outing> {
  const now = new Date().toISOString();
  const outing: Outing = {
    id: `outing-${plan.id}`,
    planId: plan.id,
    startedAt: now,
    updatedAt: now,
    currentStepId: plan.steps[0]?.id ?? '',
    completedStepIds: [],
    status: 'in_progress',
  };
  try {
    await saveOuting(outing);
  } catch (err) {
    // Persistence is best-effort: the outing is still usable in memory.
    console.warn('[glimmr] Outing persistence failed; keeping the in-memory outing.', err);
  }
  return outing;
}

/**
 * Complete one stop: idempotent, advances to the next unfinished stop, and
 * flips the outing to `completed` (with `completedAt`) when every stop is
 * done. Unknown step ids are a no-op. Persistence stays best-effort.
 */
export async function completeStep(planId: string, stepId: string): Promise<Outing | null> {
  const plan = await getPlanById(planId);
  if (!plan || plan.steps.length === 0) return null;
  const outing = await getOuting(planId);
  if (!outing) return null;
  if (!plan.steps.some((step) => step.id === stepId)) return outing;
  const completedStepIds = outing.completedStepIds.includes(stepId)
    ? outing.completedStepIds
    : [...outing.completedStepIds, stepId];
  const next = plan.steps.find((step) => !completedStepIds.includes(step.id));
  const done = completedStepIds.length >= plan.steps.length;
  const now = new Date().toISOString();
  const updated: Outing = {
    ...outing,
    completedStepIds,
    currentStepId: next?.id ?? plan.steps[plan.steps.length - 1].id,
    status: done ? 'completed' : 'in_progress',
    completedAt: done ? (outing.completedAt ?? now) : undefined,
    updatedAt: now,
  };
  try {
    await saveOuting(updated);
  } catch (err) {
    console.warn('[glimmr] Outing progress persistence failed; keeping local progress.', err);
  }
  return updated;
}

export async function saveOuting(outing: Outing): Promise<void> {
  const stamped: Outing = { ...outing, updatedAt: new Date().toISOString() };
  if (isFirebaseConfigured) {
    const user = await ensureFirebaseUser();
    await setDocument('outings', stamped.id, firestorePayload<StoredRecord<Outing>>({ ...stamped, userId: user.uid }));
  }
  writeLocalOuting(stamped);
}

export async function editPlan(plan: Plan, edit: PlanEdit): Promise<Plan> {
  await wait();
  const places = await catalog();
  let steps = [...plan.steps];
  if (edit.type === 'delete' && edit.stepId && steps.length > 1) steps = steps.filter((step) => step.id !== edit.stepId);
  if (edit.type === 'replace' && edit.stepId && edit.placeId) {
    const replacement = places.find((place) => place.id === edit.placeId);
    steps = steps.map((step) => replacement && step.id === edit.stepId ? { ...step, place: replacement, durationMinutes: replacement.typicalVisitDuration } : step);
  }
  if (edit.type === 'edit' && edit.stepId && edit.changes) steps = steps.map((step) => step.id === edit.stepId ? { ...step, ...edit.changes } : step);
  if (edit.type === 'edit' && edit.stepId && edit.instruction) {
    const instruction = edit.instruction.toLowerCase();
    const current = steps.find((step) => step.id === edit.stepId);
    if (current) {
      const candidate = instruction.includes('cheap')
        ? [...places].filter((place) => place.id !== current.place.id && placePrice(place) < placePrice(current.place)).sort((a, b) => placePrice(a) - placePrice(b))[0]
        : instruction.includes('far') ? places.find((place) => place.id !== current.place.id && place.category !== current.place.category)
        : instruction.includes('vegetarian') || instruction.includes('veg') ? places.find((place) => place.id !== current.place.id && place.category === current.place.category)
        : undefined;
      if (candidate) steps = steps.map((step) => step.id === edit.stepId ? { ...step, place: candidate, durationMinutes: candidate.typicalVisitDuration, note: edit.instruction } : step);
    }
  }
  if (edit.type === 'add') {
    const tags = parsePreferenceTags(edit.instruction);
    const place = edit.placeId ? places.find((item) => item.id === edit.placeId) : places.find((item) => item.serviceArea === plan.steps[0]?.place.serviceArea && tags.some((tag) => item.activities.includes(tag)));
    if (place) steps = [...steps, { id: `step-${place.id}-${Date.now()}`, place, arrival: '', durationMinutes: place.typicalVisitDuration, travelMinutes: 0, distanceKm: 0, note: edit.instruction || 'Added to your route.' } satisfies PlanStep];
  }
  const routedSteps = await recalculateRouteWithMaps(steps, plan.request);
  const updated = calculatePlanTotals({ ...plan, steps: routedSteps, title: routedSteps.map((step) => step.place.name).slice(0, 2).join(' → '), subtitle: routedSteps.map((step) => step.place.subcategory ?? step.place.category).join(', '), vibe: routedSteps[0]?.place.vibe ?? plan.vibe }, 'success');
  await persistPlanBestEffort(updated);
  return updated;
}

export async function migrateAnonymousData(uid: string): Promise<void> {
  if (!isFirebaseConfigured) return;
  if (!uid) {
    console.warn('[glimmr] Skipping anonymous-data migration: no authenticated uid.');
    return;
  }

  const plans = JSON.parse(readSession(PLAN_STORE_KEY) ?? '[]') as Plan[];
  const outings = JSON.parse(readSession(OUTING_STORE_KEY) ?? '{}') as Record<string, Outing>;

  if (!plans.length && !Object.keys(outings).length) return;

  const { migrateSessionPlansToFirestore } = await import('@/services/firebaseService');
  await migrateSessionPlansToFirestore(uid, plans, outings);

  clearSession(PLAN_STORE_KEY);
  clearSession(OUTING_STORE_KEY);
}
