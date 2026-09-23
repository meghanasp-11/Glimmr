/**
 * Focused regression tests for plan-detail dialog options.
 *
 * The swap/add pickers must offer the same Firestore-first catalog the
 * engine plans from — never a divergent static copy.
 *
 * Run with: npm run test -w @glimmr/app
 */

import { describe, expect, it } from 'vitest';
import { addCandidates, replaceCandidates } from '@/components/glimmr-ui';
import type { Place, PlanStep } from '@/types/glimmr';

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
    suitableFor: ['solo'],
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

function makeStep(place: Place): PlanStep {
  return { id: `step-${place.id}`, place, arrival: '9:00 AM', durationMinutes: 60, travelMinutes: 0, distanceKm: 0 };
}

describe('replaceCandidates', () => {
  it('offers same-category Firestore places for a swap', () => {
    const catalog = [
      makePlace({ id: 'fs-cafe-a', name: 'Firestore cafe A' }),
      makePlace({ id: 'fs-cafe-b', name: 'Firestore cafe B' }),
      makePlace({ id: 'fs-dinner', name: 'Firestore dinner', category: 'Dinner' }),
    ];
    const options = replaceCandidates(catalog, makeStep(catalog[0]));
    expect(options.map((place) => place.id)).toEqual(['fs-cafe-b']);
  });

  it('excludes the current stop and caps the list', () => {
    const catalog = Array.from({ length: 10 }, (_, i) => makePlace({ id: `cafe-${i}` }));
    const options = replaceCandidates(catalog, makeStep(catalog[0]));
    expect(options).toHaveLength(6);
    expect(options.some((place) => place.id === 'cafe-0')).toBe(false);
  });

  it('returns no options without a step', () => {
    expect(replaceCandidates([makePlace()])).toEqual([]);
  });
});

describe('addCandidates', () => {
  const catalog = [
    makePlace({ id: 'fs-cafe', category: 'Cafe' }),
    makePlace({ id: 'fs-dinner', category: 'Dinner' }),
  ];

  it('lists Firestore places in the picked category', () => {
    expect(addCandidates(catalog, 'Cafe').map((place) => place.id)).toEqual(['fs-cafe']);
  });

  it('maps the Food picker to Dinner places', () => {
    expect(addCandidates(catalog, 'Food').map((place) => place.id)).toEqual(['fs-dinner']);
  });

  it('offers nothing for Custom or no selection', () => {
    expect(addCandidates(catalog, 'Custom')).toEqual([]);
    expect(addCandidates(catalog, null)).toEqual([]);
  });
});
