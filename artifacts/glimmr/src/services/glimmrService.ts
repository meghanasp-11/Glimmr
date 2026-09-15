import { places as localPlaces } from '@/data/mockData';
import { ensureFirebaseUser, isFirebaseConfigured } from '@/lib/firebase';
import { placePrice } from '@/lib/glimmr-format';
import { generatePlans, parsePreferenceTags, recalculateRoute } from '@/lib/recommendationEngine';
import { getDocument, getPlaces, setDocument } from '@/services/firebaseService';
import type { Outing, Place, Plan, PlanEdit, PlannerRequest, PlanStep } from '@/types/glimmr';

const wait = (ms = 220) => new Promise((resolve) => window.setTimeout(resolve, ms));
const planStore = new Map<string, Plan>();
const PLAN_STORE_KEY = 'glimmr-plans';
const OUTING_STORE_KEY = 'glimmr-outings';

type StoredRecord<T> = T & { userId: string };

function restorePlans(): void {
  if (planStore.size || typeof window === 'undefined') return;
  try {
    (JSON.parse(window.sessionStorage.getItem(PLAN_STORE_KEY) ?? '[]') as Plan[]).forEach((plan) => planStore.set(plan.id, plan));
  } catch {
    window.sessionStorage.removeItem(PLAN_STORE_KEY);
  }
}

function persistLocalPlans(): void {
  if (typeof window !== 'undefined') window.sessionStorage.setItem(PLAN_STORE_KEY, JSON.stringify([...planStore.values()]));
}

function firestorePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function catalog(): Promise<Place[]> {
  if (!isFirebaseConfigured) return localPlaces;
  return getPlaces() as Promise<Place[]>;
}

async function persistPlan(plan: Plan): Promise<void> {
  if (!isFirebaseConfigured) return;
  const user = await ensureFirebaseUser();
  await setDocument('plans', plan.id, firestorePayload<StoredRecord<Plan>>({ ...plan, userId: user.uid }));
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

export async function createPlans(request: PlannerRequest): Promise<Plan[]> {
  await wait();
  if (request.availableMinutes <= 30 || request.budget <= 100) return [];
  planStore.clear();
  const plans = generatePlans(request, await catalog()).map((plan) => calculatePlanTotals(plan, 'ready'));
  await Promise.all(plans.map(persistPlan));
  return plans;
}

export async function getPlanById(id: string): Promise<Plan | null> {
  await wait(120);
  if (isFirebaseConfigured) {
    const stored = await getDocument<StoredRecord<Plan>>('plans', id);
    return stored ? calculatePlanTotals(stored, 'ready') : null;
  }
  restorePlans();
  const cached = planStore.get(id);
  return cached ? calculatePlanTotals(cached, 'ready') : null;
}

export async function getOuting(planId: string): Promise<Outing | null> {
  const plan = await getPlanById(planId);
  if (!plan) return null;
  if (isFirebaseConfigured) {
    const stored = await getDocument<StoredRecord<Outing>>('outings', `outing-${planId}`);
    if (stored) return stored;
  } else {
    try {
      const outings = JSON.parse(window.sessionStorage.getItem(OUTING_STORE_KEY) ?? '{}') as Record<string, Outing>;
      if (outings[planId]) return outings[planId];
    } catch { window.sessionStorage.removeItem(OUTING_STORE_KEY); }
  }
  const outing: Outing = { id: `outing-${planId}`, planId, startedAt: new Date().toISOString(), currentStepId: plan.steps[1]?.id ?? plan.steps[0].id, completedStepIds: [plan.steps[0]?.id ?? ''] };
  await saveOuting(outing);
  return outing;
}

export async function saveOuting(outing: Outing): Promise<void> {
  if (isFirebaseConfigured) {
    const user = await ensureFirebaseUser();
    await setDocument('outings', outing.id, firestorePayload<StoredRecord<Outing>>({ ...outing, userId: user.uid }));
    return;
  }
  const outings = JSON.parse(window.sessionStorage.getItem(OUTING_STORE_KEY) ?? '{}') as Record<string, Outing>;
  outings[outing.planId] = outing;
  window.sessionStorage.setItem(OUTING_STORE_KEY, JSON.stringify(outings));
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
  const routedSteps = recalculateRoute(steps, plan.request);
  const updated = calculatePlanTotals({ ...plan, steps: routedSteps, title: routedSteps.map((step) => step.place.name).slice(0, 2).join(' → '), subtitle: routedSteps.map((step) => step.place.subcategory ?? step.place.category).join(', '), vibe: routedSteps[0]?.place.vibe ?? plan.vibe }, 'success');
  await persistPlan(updated);
  return updated;
}

export async function migrateAnonymousData(uid: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!isFirebaseConfigured) return;
  
  const plans = JSON.parse(window.sessionStorage.getItem(PLAN_STORE_KEY) ?? '[]') as Plan[];
  const outings = JSON.parse(window.sessionStorage.getItem(OUTING_STORE_KEY) ?? '{}') as Record<string, Outing>;
  
  if (!plans.length && !Object.keys(outings).length) return;
  
  const { migrateSessionPlansToFirestore } = await import('@/services/firebaseService');
  await migrateSessionPlansToFirestore(uid, plans, outings);
  
  window.sessionStorage.removeItem(PLAN_STORE_KEY);
  window.sessionStorage.removeItem(OUTING_STORE_KEY);
}
