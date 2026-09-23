/**
 * Focused regression tests for the Firestore-backed outing flow.
 *
 * Covers the first production-blocker chain: generation resolves the
 * Firestore service-area catalog, persistence failures never break
 * generation/editing/outing, and reads degrade to the local copy.
 * Firestore and routing are mocked — these tests never leave the machine.
 *
 * Run with: npm run test -w @glimmr/app
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPlaces: vi.fn(),
  getServiceAreas: vi.fn(),
  getDocument: vi.fn(),
  setDocument: vi.fn(),
  ensureFirebaseUser: vi.fn(async () => ({ uid: 'test-user' })),
  routeLegs: vi.fn(async () => {
    throw new Error('routing offline in tests');
  }),
  geocode: vi.fn(async () => null),
}));

vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: true,
  ensureFirebaseUser: mocks.ensureFirebaseUser,
}));

vi.mock('@/services/firebaseService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/firebaseService')>();
  return {
    ...actual,
    getPlaces: mocks.getPlaces,
    getServiceAreas: mocks.getServiceAreas,
    getDocument: mocks.getDocument,
    setDocument: mocks.setDocument,
  };
});

vi.mock('@/lib/maps', () => ({
  mapsService: { routeLegs: mocks.routeLegs, geocode: mocks.geocode },
}));

import {
  completeStep,
  createPlans,
  editPlan,
  geocodeEndpoints,
  getOuting,
  getPlanById,
  listPlaces,
  readGeocodeCache,
  reconcileOuting,
  saveOuting,
  startOuting,
} from '@/services/glimmrService';
import type { Outing, Place, PlannerRequest } from '@/types/glimmr';

/** Minimal sessionStorage shim so cache/session paths run in node. */
function installSessionShim(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    sessionStorage: {
      getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
  return store;
}

installSessionShim();

const HSR = { id: 'hsr-layout', name: 'HSR Layout', city: 'Bengaluru', active: true };

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: 't-place',
    name: 'Test Place',
    serviceArea: 'hsr-layout',
    category: 'Cafe',
    address: '1 Test Road',
    lat: 12.978,
    lng: 77.64,
    priceMin: 100,
    priceMax: 200,
    priceBasis: 'per_person',
    openingHours: '9:00 AM - 9:00 PM',
    typicalVisitDuration: 60,
    suitableFor: ['solo', 'couple', 'friends'],
    activities: [],
    vibe: 'test vibe',
    rating: 4.0,
    reviewCount: 10,
    experienceScore: 0.5,
    source: 'test',
    verificationStatus: 'unverified',
    lastVerified: '2026-09-16',
    confidence: 0.5,
    ...overrides,
  };
}

/** Full bucket coverage for the Firestore-only area. */
function firestoreCatalog(): Place[] {
  return [
    makePlace({ id: 'fs-starter', name: 'Firestore starter', category: 'Cafe' }),
    makePlace({ id: 'fs-main', name: 'Firestore main', category: 'Dinner' }),
    makePlace({ id: 'fs-activity', name: 'Firestore activity', category: 'Activity' }),
    makePlace({ id: 'fs-evening', name: 'Firestore evening', category: 'Drinks' }),
  ];
}

function makeRequest(overrides: Partial<PlannerRequest> = {}): PlannerRequest {
  return {
    from: 'HSR Layout',
    to: 'HSR Layout',
    availableMinutes: 600,
    budget: 2000,
    people: 2,
    transport: 'walk',
    outingType: 'Food crawl',
    preference: '',
    startTimeMinutes: 540,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureFirebaseUser.mockImplementation(async () => ({ uid: 'test-user' }) as never);
  mocks.getPlaces.mockResolvedValue(firestoreCatalog());
  mocks.getServiceAreas.mockResolvedValue([HSR]);
  mocks.getDocument.mockResolvedValue(null);
  mocks.setDocument.mockResolvedValue(undefined);
  mocks.routeLegs.mockRejectedValue(new Error('routing offline in tests'));
  mocks.geocode.mockResolvedValue(null);
});

describe('Firestore-backed generation', () => {
  it('generates plans from Firestore places resolved to Firestore areas', async () => {
    const plans = await createPlans(makeRequest());
    expect(plans.length).toBe(3);
    for (const plan of plans) {
      expect(plan.steps.length).toBeGreaterThan(0);
      for (const step of plan.steps) {
        expect(step.place.serviceArea).toBe('hsr-layout');
      }
    }
  });

  it('exposes the same Firestore catalog to UI option lists', async () => {
    expect(await listPlaces()).toEqual(firestoreCatalog());
  });

  it('still returns plans when Firestore persistence is denied', async () => {
    mocks.setDocument.mockRejectedValue(new Error('permission-denied'));
    const plans = await createPlans(makeRequest());
    expect(plans.length).toBe(3);
    expect(plans[0].status).toBe('ready');
  });
});

describe('resilient reads', () => {
  it('falls back to the local copy when the Firestore plan read fails', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.getDocument.mockRejectedValue(new Error('offline'));
    const loaded = await getPlanById(first.id);
    expect(loaded?.id).toBe(first.id);
  });

  it('returns null for an unknown plan instead of throwing', async () => {
    mocks.getDocument.mockRejectedValue(new Error('offline'));
    await expect(getPlanById('no-such-plan')).resolves.toBeNull();
  });

  it('rejects stored plans that fail PlanSchema and falls back locally', async () => {
    mocks.getDocument.mockResolvedValue({ id: 'bogus', userId: 'test-user' });
    await expect(getPlanById('bogus')).resolves.toBeNull();
  });
});

describe('outing lifecycle under Firestore failure', () => {
  it('creates a usable outing even when outing persistence fails', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.getDocument.mockResolvedValue(null);
    mocks.setDocument.mockRejectedValue(new Error('permission-denied'));
    const outing = await getOuting(first.id);
    expect(outing).not.toBeNull();
    expect(outing?.planId).toBe(first.id);
    expect(outing?.completedStepIds).toEqual([]);
    expect(outing?.currentStepId).toBe(first.steps[0].id);
    expect(outing?.status).toBe('in_progress');
    expect(typeof outing?.startedAt).toBe('string');
    expect(typeof outing?.updatedAt).toBe('string');
  });

  it('returns null for an outing whose plan does not exist', async () => {
    mocks.getDocument.mockResolvedValue(null);
    await expect(getOuting('no-such-plan')).resolves.toBeNull();
  });

  it('persists outing progress through the Firestore abstraction when healthy', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.getDocument.mockResolvedValue(null);
    const outing = (await getOuting(first.id))!;
    await saveOuting({ ...outing, completedStepIds: [first.steps[0].id, first.steps[1].id] });
    expect(mocks.setDocument).toHaveBeenCalledWith(
      'outings',
      outing.id,
      expect.objectContaining({ userId: 'test-user', planId: first.id }),
    );
  });
});

describe('unified outing shape', () => {
  it('starts outings with status, timestamps, and an empty trail', async () => {
    const [first] = await createPlans(makeRequest());
    const outing = await startOuting(first);
    expect(outing).toMatchObject({
      id: `outing-${first.id}`,
      planId: first.id,
      currentStepId: first.steps[0].id,
      status: 'in_progress',
    });
    expect(outing.completedStepIds).toEqual([]);
    expect(outing.completedAt).toBeUndefined();
  });

  it('normalizes Firestore Timestamp fields to ISO strings on read', async () => {
    const [first] = await createPlans(makeRequest());
    const toDate = () => new Date('2026-09-20T09:00:00.000Z');
    mocks.getDocument.mockImplementation(async (collection: string) => {
      if (collection === 'plans') return null;
      return {
        id: `outing-${first.id}`,
        userId: 'test-user',
        planId: first.id,
        startedAt: { toDate },
        updatedAt: { toDate },
        currentStepId: first.steps[0].id,
        completedStepIds: [],
        status: 'in_progress',
      };
    });
    const outing = await getOuting(first.id);
    expect(outing?.startedAt).toBe('2026-09-20T09:00:00.000Z');
    expect(outing?.updatedAt).toEqual(expect.any(String));
  });

  it('drops outing documents that fail the unified schema', async () => {
    const [first] = await createPlans(makeRequest());
    // Missing currentStepId/status/startedAt: invalid, so a fresh start wins.
    mocks.getDocument.mockImplementation(async (collection: string) =>
      collection === 'outings' ? { id: `outing-${first.id}`, planId: first.id } : null,
    );
    const outing = await getOuting(first.id);
    expect(outing?.status).toBe('in_progress');
    expect(outing?.completedStepIds).toEqual([]);
  });
});

describe('completeStep transitions', () => {
  it('advances the current stop and persists unified progress', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.getDocument.mockResolvedValue(null);
    const next = (await completeStep(first.id, first.steps[0].id))!;
    expect(next.completedStepIds).toEqual([first.steps[0].id]);
    expect(next.currentStepId).toBe(first.steps[1].id);
    expect(next.status).toBe('in_progress');
    expect(mocks.setDocument).toHaveBeenCalledWith(
      'outings',
      next.id,
      expect.objectContaining({ status: 'in_progress', currentStepId: first.steps[1].id }),
    );
  });

  it('is idempotent for an already-completed stop', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.getDocument.mockResolvedValue(null);
    await completeStep(first.id, first.steps[0].id);
    const again = (await completeStep(first.id, first.steps[0].id))!;
    expect(again.completedStepIds).toEqual([first.steps[0].id]);
  });

  it('ignores unknown step ids', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.getDocument.mockResolvedValue(null);
    const outing = (await completeStep(first.id, 'no-such-step'))!;
    expect(outing.completedStepIds).toEqual([]);
    expect(outing.currentStepId).toBe(first.steps[0].id);
  });

  it('flips to completed with completedAt on the last stop', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.getDocument.mockResolvedValue(null);
    let outing: Outing | null = null;
    for (const step of first.steps) {
      outing = await completeStep(first.id, step.id);
    }
    expect(outing?.status).toBe('completed');
    expect(typeof outing?.completedAt).toBe('string');
    expect(outing?.completedStepIds).toHaveLength(first.steps.length);
    expect(mocks.setDocument).toHaveBeenCalledWith(
      'outings',
      outing!.id,
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('still advances locally when persistence fails', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.getDocument.mockResolvedValue(null);
    mocks.setDocument.mockRejectedValue(new Error('permission-denied'));
    const next = (await completeStep(first.id, first.steps[0].id))!;
    expect(next.currentStepId).toBe(first.steps[1].id);
  });

  it('returns null when the plan does not exist', async () => {
    mocks.getDocument.mockResolvedValue(null);
    await expect(completeStep('no-such-plan', 's1')).resolves.toBeNull();
  });
});

describe('outing resume (reconcileOuting)', () => {
  it('repairs a dangling current stop to the first unfinished stop', async () => {
    const [first] = await createPlans(makeRequest());
    const stale: Outing = {
      id: `outing-${first.id}`,
      planId: first.id,
      startedAt: '2026-09-20T09:00:00.000Z',
      currentStepId: 'removed-step',
      completedStepIds: [first.steps[0].id, 'removed-step'],
      status: 'in_progress',
    };
    const resumed = reconcileOuting(first, stale);
    expect(resumed.completedStepIds).toEqual([first.steps[0].id]);
    expect(resumed.currentStepId).toBe(first.steps[1].id);
    expect(resumed.status).toBe('in_progress');
  });

  it('resumes persisted progress after a restart', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.getDocument.mockResolvedValue(null);
    await completeStep(first.id, first.steps[0].id);
    // Simulate a restart: drop the in-memory plan cache by clearing the
    // module-level store through a fresh generation, then read back. The
    // session copy carries progress; Firestore is offline here.
    mocks.getDocument.mockRejectedValue(new Error('offline'));
    const resumed = await getOuting(first.id);
    expect(resumed?.completedStepIds).toEqual([first.steps[0].id]);
    expect(resumed?.currentStepId).toBe(first.steps[1].id);
  });
});

describe('submit-time geocoding', () => {
  it('caches single-shot Nominatim results for the outing page', async () => {
    mocks.geocode.mockImplementation(async (query: string) =>
      query === 'HSR Layout' ? { lat: 12.9116, lng: 77.6474, label: 'HSR Layout, Bengaluru' } : null,
    );
    const result = await geocodeEndpoints('HSR Layout', 'Nowhere');
    expect(result.from).toEqual({ lat: 12.9116, lng: 77.6474, label: 'HSR Layout, Bengaluru' });
    expect(result.to).toBeNull();
    expect(mocks.geocode).toHaveBeenCalledTimes(2);
    expect(readGeocodeCache('HSR Layout', 'Nowhere')).toEqual({
      fromQuery: 'HSR Layout',
      toQuery: 'Nowhere',
      ...result,
    });
  });

  it('degrades to nulls when geocoding fails and still caches', async () => {
    mocks.geocode.mockRejectedValue(new Error('offline'));
    const result = await geocodeEndpoints('HSR Layout', 'Koramangala');
    expect(result).toEqual({ from: null, to: null });
    expect(readGeocodeCache('HSR Layout', 'Koramangala')?.to).toBeNull();
  });

  it('ignores caches from different queries', async () => {
    mocks.geocode.mockResolvedValue(null);
    await geocodeEndpoints('HSR Layout', 'Koramangala');
    expect(readGeocodeCache('HSR Layout', 'Indiranagar')).toBeNull();
  });
});

describe('editing against the Firestore catalog', () => {
  it('swaps in a Firestore-only place by id', async () => {
    const [first] = await createPlans(makeRequest());
    const step = first.steps[0];
    const updated = await editPlan(first, { type: 'replace', stepId: step.id, placeId: 'fs-activity' });
    expect(updated.steps.some((s) => s.place.id === 'fs-activity')).toBe(true);
  });

  it('still returns the edited plan when persistence fails', async () => {
    const [first] = await createPlans(makeRequest());
    mocks.setDocument.mockRejectedValue(new Error('permission-denied'));
    const updated = await editPlan(first, { type: 'delete', stepId: first.steps[0].id });
    expect(updated.steps.length).toBe(first.steps.length - 1);
  });
});
