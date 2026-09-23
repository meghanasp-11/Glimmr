/**
 * Focused tests for the Glimmr recommendation engine.
 *
 * Covers deterministic scoring, opening-hours filtering, time feasibility,
 * and 3-plan generation across all active service areas.
 *
 * Run with: npm run test -w @glimmr/app
 */

import { describe, expect, it } from 'vitest';
import {
  generatePlans,
  isOpenForVisit,
  parseOpeningHours,
  recalculateRoute,
  resolveStartTime,
  scoringWeights,
} from '@/lib/recommendationEngine';
import type { Place, PlannerRequest } from '@/types/glimmr';

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: 't-place',
    name: 'Test Place',
    serviceArea: 'indiranagar',
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

function makeRequest(overrides: Partial<PlannerRequest> = {}): PlannerRequest {
  return {
    from: 'Indiranagar',
    to: 'Indiranagar',
    availableMinutes: 300,
    budget: 1000,
    people: 2,
    transport: 'walk',
    outingType: 'Food crawl',
    preference: '',
    ...overrides,
  };
}

/** Full bucket coverage for one area: starter, main, activity, evening. */
function areaFixtures(areaId: string): Place[] {
  return [
    makePlace({ id: `fx-${areaId}-starter`, name: `Fixture ${areaId} starter`, serviceArea: areaId, category: 'Cafe' }),
    makePlace({ id: `fx-${areaId}-main`, name: `Fixture ${areaId} main`, serviceArea: areaId, category: 'Dinner' }),
    makePlace({ id: `fx-${areaId}-activity`, name: `Fixture ${areaId} activity`, serviceArea: areaId, category: 'Activity' }),
    makePlace({ id: `fx-${areaId}-evening`, name: `Fixture ${areaId} evening`, serviceArea: areaId, category: 'Drinks' }),
  ];
}

const stripIds = (plans: { id: string }[]) => plans.map(({ id: _id, ...rest }) => rest);

describe('parseOpeningHours', () => {
  it('parses standard AM/PM ranges', () => {
    expect(parseOpeningHours('9:00 AM - 9:00 PM')).toEqual({ open: 540, close: 1260 });
  });

  it('parses en-dash ranges used in the catalog', () => {
    expect(parseOpeningHours('8:00 AM – 9:00 PM')).toEqual({ open: 480, close: 1260 });
  });

  it('rolls overnight closings past midnight', () => {
    expect(parseOpeningHours('12:00 PM - 1:00 AM')).toEqual({ open: 720, close: 1500 });
  });

  it('treats always-open as a full-day window', () => {
    const window = parseOpeningHours('Always open');
    expect(window).not.toBeNull();
    expect(window!.open).toBe(0);
    expect(window!.close).toBeGreaterThanOrEqual(1440);
  });

  it('returns null for unparseable strings instead of inventing hours', () => {
    expect(parseOpeningHours('Call ahead for hours')).toBeNull();
    expect(parseOpeningHours('')).toBeNull();
  });
});

describe('isOpenForVisit', () => {
  it('accepts visits inside the window', () => {
    expect(isOpenForVisit({ open: 540, close: 1260 }, 600, 660)).toBe(true);
  });

  it('rejects visits outside the window', () => {
    expect(isOpenForVisit({ open: 540, close: 1260 }, 300, 360)).toBe(false);
    expect(isOpenForVisit({ open: 540, close: 1260 }, 1200, 1320)).toBe(false);
  });

  it('never excludes places with unknown hours', () => {
    expect(isOpenForVisit(null, 0, 60)).toBe(true);
  });

  it('handles overnight windows', () => {
    expect(isOpenForVisit({ open: 1320, close: 1500 }, 1400, 1460)).toBe(true);
    expect(isOpenForVisit({ open: 1320, close: 1500 }, 600, 660)).toBe(false);
  });
});

describe('resolveStartTime', () => {
  const catalog = [
    makePlace({ id: 'early-activity', category: 'Activity', openingHours: '7:00 AM - 10:00 PM' }),
    makePlace({ id: 'late-starter', category: 'Cafe', openingHours: '10:00 AM - 9:00 PM' }),
  ];

  it('prefers an explicit request start time', () => {
    expect(resolveStartTime(makeRequest({ startTimeMinutes: 540 }), catalog)).toBe(540);
  });

  it('defaults to the earliest starter opening, not a fixed clock time', () => {
    expect(resolveStartTime(makeRequest(), catalog)).toBe(600);
  });

  it('ignores unusable request start times and falls back to catalog data', () => {
    for (const bad of [-30, 1500, Number.NaN]) {
      expect(resolveStartTime(makeRequest({ startTimeMinutes: bad }), catalog)).toBe(600);
    }
  });

  it('uses the last-resort default only when nothing parses', () => {
    const noHours = [makePlace({ openingHours: 'Call ahead' })];
    expect(resolveStartTime(makeRequest(), noHours)).toBe(540);
  });
});

describe('deterministic scoring', () => {
  const catalog = [
    makePlace({ id: 'score-high', experienceScore: 0.95, priceMin: 100, priceMax: 200 }),
    makePlace({ id: 'score-low', experienceScore: 0.2, priceMin: 100, priceMax: 200 }),
    makePlace({ id: 'score-main', category: 'Dinner', experienceScore: 0.5 }),
    makePlace({ id: 'score-activity', category: 'Activity', experienceScore: 0.5 }),
  ];

  it('produces identical plans for identical inputs', () => {
    const request = makeRequest({ startTimeMinutes: 540 });
    expect(stripIds(generatePlans(request, catalog))).toEqual(stripIds(generatePlans(request, catalog)));
  });

  it('ranks the higher-experience starter first in Best fit', () => {
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540 }), catalog);
    expect(plans[0].recommendationLabel).toBe('Best fit');
    expect(plans[0].steps[0].place.id).toBe('score-high');
  });

  it('only ever schedules places from the input catalog', () => {
    const ids = new Set(catalog.map((place) => place.id));
    for (const plan of generatePlans(makeRequest({ startTimeMinutes: 540 }), catalog)) {
      for (const step of plan.steps) {
        expect(ids.has(step.place.id)).toBe(true);
      }
    }
  });

  it('keeps scoring weights normalized', () => {
    const total = Object.values(scoringWeights).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('opening-hours filtering', () => {
  const catalog = [
    makePlace({
      id: 'hours-closed',
      experienceScore: 0.95,
      openingHours: '8:00 PM - 11:00 PM',
    }),
    makePlace({
      id: 'hours-open',
      experienceScore: 0.3,
      openingHours: '9:00 AM - 9:00 PM',
    }),
    makePlace({ id: 'hours-main', category: 'Dinner', openingHours: '9:00 AM - 9:00 PM' }),
    makePlace({ id: 'hours-activity', category: 'Activity', openingHours: '9:00 AM - 9:00 PM' }),
  ];

  it('prefers an open place over a higher-scored closed one', () => {
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540 }), catalog);
    expect(plans[0].steps[0].place.id).toBe('hours-open');
  });

  it('never excludes a place whose hours cannot be parsed', () => {
    const onlyUnknown = [
      makePlace({ id: 'hours-unknown', openingHours: 'Call ahead for hours' }),
      makePlace({ id: 'hours-main', category: 'Dinner', openingHours: '9:00 AM - 9:00 PM' }),
    ];
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540 }), onlyUnknown);
    expect(plans.some((plan) => plan.steps.some((step) => step.place.id === 'hours-unknown'))).toBe(true);
  });

  it('still builds a full-shaped plan when nothing in a bucket is open', () => {
    const allClosed = [
      makePlace({ id: 'closed-only', openingHours: '8:00 PM - 11:00 PM' }),
      makePlace({ id: 'hours-main', category: 'Dinner', openingHours: '9:00 AM - 9:00 PM' }),
    ];
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540 }), allClosed);
    expect(plans[0].steps[0].place.id).toBe('closed-only');
  });
});

describe('time feasibility', () => {
  it('reports totals as actual visit duration plus travel time', () => {
    const catalog = areaFixtures('indiranagar');
    const plan = generatePlans(makeRequest({ startTimeMinutes: 540 }), catalog)[0];
    const expected = plan.steps.reduce((sum, step) => sum + step.durationMinutes + step.travelMinutes, 0);
    expect(plan.totalMinutes).toBe(expected);
    expect(plan.travelMinutes).toBe(plan.steps.reduce((sum, step) => sum + step.travelMinutes, 0));
  });

  it('trims to a shorter feasible plan when the full combination overruns', () => {
    const catalog = [
      makePlace({ id: 'long-starter', typicalVisitDuration: 120 }),
      makePlace({ id: 'long-main', category: 'Dinner', typicalVisitDuration: 120 }),
      makePlace({ id: 'long-activity', category: 'Activity', typicalVisitDuration: 120 }),
    ];
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540, availableMinutes: 200 }), catalog);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0].steps.length).toBe(1);
    expect(plans[0].totalMinutes).toBeLessThanOrEqual(200);
    expect(plans[0].feasible).toBe(true);
  });

  it('flags plans that cannot fit even as a single stop', () => {
    const catalog = [makePlace({ id: 'too-long', typicalVisitDuration: 120 })];
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540, availableMinutes: 20 }), catalog);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0].feasible).toBe(false);
    expect(plans[0].feasibilityNote).toMatch(/min over/);
  });

  it('marks fitting plans feasible with no note', () => {
    const catalog = areaFixtures('indiranagar');
    const plan = generatePlans(makeRequest({ startTimeMinutes: 540 }), catalog)[0];
    expect(plan.totalMinutes).toBeLessThanOrEqual(300);
    expect(plan.feasible).toBe(true);
    expect(plan.feasibilityNote).toBeUndefined();
  });
});

describe('3-plan generation', () => {
  const catalog = [
    ...areaFixtures('indiranagar'),
    ...areaFixtures('koramangala'),
    ...areaFixtures('church-street'),
  ];

  it('preserves the three plan types in order', () => {
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540 }), catalog);
    expect(plans.map((plan) => plan.recommendationLabel)).toEqual([
      'Best fit',
      'Best value',
      'Most adventurous',
    ]);
  });

  it.each([
    ['Indiranagar', 'indiranagar'],
    ['Koramangala', 'koramangala'],
    ['Church Street', 'church-street'],
  ])('builds same-area plans for %s without area-specific branches', (town, areaId) => {
    const plans = generatePlans(
      makeRequest({ from: town, to: town, startTimeMinutes: 540, availableMinutes: 600, budget: 2000 }),
      catalog,
    );
    expect(plans.length).toBe(3);
    for (const plan of plans) {
      expect(plan.steps.length).toBeGreaterThan(0);
      for (const step of plan.steps) {
        expect(step.place.serviceArea).toBe(areaId);
      }
    }
  });

  it('gives each plan type a distinct stop shape', () => {
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540 }), catalog);
    const shapes = plans.map((plan) => plan.steps.map((step) => step.place.category).join('+'));
    expect(new Set(shapes).size).toBe(3);
  });
});

describe('injected service areas (Firestore catalog)', () => {
  const hsr = { id: 'hsr-layout', name: 'HSR Layout', city: 'Bengaluru', active: true };
  const other = { id: 'other-area', name: 'Other Area', city: 'Bengaluru', active: true };

  it('resolves Firestore areas instead of the static list', () => {
    const plans = generatePlans(
      makeRequest({ from: 'HSR Layout', to: 'HSR Layout', startTimeMinutes: 540, availableMinutes: 600, budget: 2000 }),
      areaFixtures('hsr-layout'),
      [hsr],
    );
    expect(plans.length).toBe(3);
    for (const plan of plans) {
      expect(plan.steps.length).toBeGreaterThan(0);
      for (const step of plan.steps) {
        expect(step.place.serviceArea).toBe('hsr-layout');
      }
    }
  });

  it('falls back to the first active injected area, never a static one', () => {
    const plans = generatePlans(
      makeRequest({ from: 'Nowhere', to: 'Nowhere', startTimeMinutes: 540, availableMinutes: 600, budget: 2000 }),
      areaFixtures('other-area'),
      [other],
    );
    expect(plans.length).toBe(3);
    for (const plan of plans) {
      for (const step of plan.steps) {
        expect(step.place.serviceArea).toBe('other-area');
      }
    }
  });

  it('prefers an explicit name match among injected areas', () => {
    const mixed = [...areaFixtures('hsr-layout'), ...areaFixtures('other-area')];
    const plans = generatePlans(
      makeRequest({ from: 'Other Area', to: 'Other Area', startTimeMinutes: 540, availableMinutes: 600, budget: 2000 }),
      mixed,
      [hsr, other],
    );
    expect(plans.length).toBe(3);
    for (const plan of plans) {
      for (const step of plan.steps) {
        expect(step.place.serviceArea).toBe('other-area');
      }
    }
  });
});

describe('start time and edit consistency', () => {
  const catalog = areaFixtures('indiranagar');

  it('starts the clock at the requested time', () => {
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540 }), catalog);
    expect(plans[0].steps[0].arrival).toBe('9:00 AM');
  });

  it('derives the default start from catalog hours, never a fixed evening', () => {
    const plans = generatePlans(makeRequest(), catalog);
    expect(plans[0].steps[0].arrival).toBe('9:00 AM');
  });

  it('does not mutate the caller request', () => {
    const request = makeRequest();
    generatePlans(request, catalog);
    expect(request.startTimeMinutes).toBeUndefined();
  });

  it('reschedules edits on the same clock as generation', () => {
    const plans = generatePlans(makeRequest({ startTimeMinutes: 540 }), catalog);
    const before = plans[0].steps.map((step) => step.arrival);
    const after = recalculateRoute(plans[0].steps, plans[0].request).map((step) => step.arrival);
    expect(after).toEqual(before);
  });
});
