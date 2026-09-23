/**
 * Focused tests for the Glimmr Maps service.
 *
 * Covers Haversine distance/travel-time math, OSRM success parsing, OSRM
 * failure fallback, offline mode, mode-to-profile mapping, Nominatim
 * single-shot geocoding, and provider-agnostic leg scheduling in the engine.
 * All network access is stubbed — these tests never leave the machine.
 *
 * Run with: npm run test -w @glimmr/app
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HaversineRoutingProvider,
  NominatimGeocoder,
  OSRMRoutingProvider,
  createMapsService,
  hasValidPoints,
  haversineKm,
  haversineLeg,
  stepsToPoints,
} from '@/lib/maps';
import { scheduleStepsWithLegs } from '@/lib/recommendationEngine';
import type { Place, PlanStep } from '@/types/glimmr';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const okJson = (payload: unknown) => ({ ok: true, json: async () => payload });

function stubFetch(handler: (url: string) => unknown) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    calls.push(url);
    return handler(url);
  });
  globalThis.fetch = fetchFn as unknown as typeof fetch;
  return { calls, fetchFn };
}

const A = { lat: 12.9, lng: 77.6 };
const B = { lat: 13.0, lng: 77.7 };

function testPlace(id: string): Place {
  return {
    id,
    name: `Place ${id}`,
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
    suitableFor: ['solo'],
    activities: [],
    vibe: 'test',
    rating: 4.0,
    reviewCount: 1,
    experienceScore: 0.5,
    source: 'test',
    verificationStatus: 'unverified',
    lastVerified: '2026-09-16',
    confidence: 0.5,
  };
}

function testStep(id: string, place: Place): PlanStep {
  return { id, place, arrival: '', durationMinutes: 60, travelMinutes: 0, distanceKm: 0 };
}

describe('haversine math', () => {
  it('returns zero for identical points with the minimum leg time', () => {
    expect(haversineKm(A, A)).toBe(0);
    expect(haversineLeg(A, A, 'walk')).toEqual({ distanceKm: 0, durationMinutes: 5 });
  });

  it('is symmetric', () => {
    expect(haversineKm(A, B)).toBe(haversineKm(B, A));
  });

  it('keeps distance mode-independent but scales time by mode', () => {
    const walk = haversineLeg(A, B, 'walk');
    const drive = haversineLeg(A, B, 'drive');
    expect(walk.distanceKm).toBe(drive.distanceKm);
    expect(walk.distanceKm).toBeGreaterThan(10);
    expect(walk.durationMinutes).toBeGreaterThan(drive.durationMinutes);
  });

  it('enforces the 5-minute minimum leg', () => {
    const near = { lat: 12.978, lng: 77.6401 };
    expect(haversineLeg({ lat: 12.978, lng: 77.64 }, near, 'drive').durationMinutes).toBe(5);
  });
});

describe('HaversineRoutingProvider', () => {
  it('returns one leg per consecutive pair', async () => {
    const provider = new HaversineRoutingProvider();
    expect(provider.name).toBe('haversine');
    const legs = await provider.routeLegs([A, B, A], 'bike');
    expect(legs).toHaveLength(2);
  });

  it('returns no legs for fewer than two points', async () => {
    const provider = new HaversineRoutingProvider();
    expect(await provider.routeLegs([], 'walk')).toEqual([]);
    expect(await provider.routeLegs([A], 'walk')).toEqual([]);
  });
});

describe('OSRMRoutingProvider', () => {
  const payload = {
    code: 'Ok',
    routes: [{ legs: [{ distance: 1234, duration: 300 }, { distance: 456, duration: 30 }] }],
  };

  it('parses OSRM legs (meters to 0.1 km, seconds to minutes)', async () => {
    const { calls } = stubFetch(() => okJson(payload));
    const provider = new OSRMRoutingProvider({ fetchFn: fetch as unknown as typeof fetch });
    const legs = await provider.routeLegs([A, B, A], 'drive');
    expect(legs).toEqual([
      { distanceKm: 1.2, durationMinutes: 5 },
      { distanceKm: 0.5, durationMinutes: 1 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/route/v1/driving/');
    expect(calls[0]).toContain('77.6,12.9;77.7,13;77.6,12.9');
    expect(calls[0]).toContain('overview=false');
  });

  it('maps walk to the walking profile and transit to driving', async () => {
    const { calls } = stubFetch(() => okJson(payload));
    const provider = new OSRMRoutingProvider({ fetchFn: fetch as unknown as typeof fetch });
    await provider.routeLegs([A, B, A], 'walk');
    expect(calls[0]).toContain('/route/v1/walking/');
    await provider.routeLegs([A, B, A], 'transit');
    expect(calls[1]).toContain('/route/v1/driving/');
  });

  it('falls back to Haversine on HTTP errors', async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const provider = new OSRMRoutingProvider({ fetchFn: fetch as unknown as typeof fetch });
    const expected = await new HaversineRoutingProvider().routeLegs([A, B], 'walk');
    expect(await provider.routeLegs([A, B], 'walk')).toEqual(expected);
  });

  it('falls back on network failure, bad payloads, and leg-count mismatch', async () => {
    const expected = await new HaversineRoutingProvider().routeLegs([A, B], 'bike');
    for (const bad of [
      () => {
        throw new Error('offline');
      },
      () => okJson({ code: 'NoRoute', routes: [] }),
      () => okJson({ code: 'Ok', routes: [{ legs: [{ distance: 1, duration: 1 }, { distance: 2, duration: 2 }] }] }),
      () => okJson({ nonsense: true }),
    ]) {
      stubFetch(bad);
      const provider = new OSRMRoutingProvider({ fetchFn: fetch as unknown as typeof fetch });
      expect(await provider.routeLegs([A, B], 'bike')).toEqual(expected);
    }
  });

  it('skips the network entirely when disabled and matches engine rounding', async () => {
    const { fetchFn } = stubFetch(() => okJson(payload));
    const provider = new OSRMRoutingProvider({ baseUrl: '', fetchFn: fetchFn as unknown as typeof fetch });
    expect(await provider.routeLegs([A, B], 'drive')).toEqual(
      await new HaversineRoutingProvider().routeLegs([A, B], 'drive'),
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('createMapsService', () => {
  it('defaults to OSRM routing with a geocoder', () => {
    const service = createMapsService();
    expect(service.routingProviderName).toBe('osrm');
  });

  it('honours an injected provider without network access', async () => {
    const service = createMapsService({ router: new HaversineRoutingProvider() });
    expect(service.routingProviderName).toBe('haversine');
    expect(await service.routeLegs([A, B], 'walk')).toEqual(
      await new HaversineRoutingProvider().routeLegs([A, B], 'walk'),
    );
  });
});

describe('NominatimGeocoder', () => {
  it('resolves a single result to lat/lng/label', async () => {
    const { calls } = stubFetch(() =>
      okJson([{ lat: '12.9716', lon: '77.5946', display_name: 'Bengaluru, Karnataka' }]),
    );
    const geocoder = new NominatimGeocoder({ fetchFn: fetch as unknown as typeof fetch });
    expect(geocoder.name).toBe('nominatim');
    const result = await geocoder.geocode('Bengaluru');
    expect(result).toEqual({ lat: 12.9716, lng: 77.5946, label: 'Bengaluru, Karnataka' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('format=jsonv2');
    expect(calls[0]).toContain('limit=1');
    expect(calls[0]).toContain(`q=${encodeURIComponent('Bengaluru')}`);
  });

  it('returns null for empty results, failures, and blank queries', async () => {
    const { fetchFn } = stubFetch(() => okJson([]));
    const geocoder = new NominatimGeocoder({ fetchFn: fetchFn as unknown as typeof fetch });
    expect(await geocoder.geocode('no-such-place-xyz')).toBeNull();
    expect(await geocoder.geocode('   ')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns null when the network fails', async () => {
    stubFetch(() => {
      throw new Error('offline');
    });
    const geocoder = new NominatimGeocoder({ fetchFn: fetch as unknown as typeof fetch });
    expect(await geocoder.geocode('Bengaluru')).toBeNull();
  });
});

describe('route rendering inputs (stepsToPoints/hasValidPoints)', () => {
  const steps = [
    { place: { lat: 12.978, lng: 77.64 } },
    { place: { lat: 12.935, lng: 77.624 } },
  ];

  it('extracts stop coordinates in visit order', () => {
    expect(stepsToPoints(steps)).toEqual([
      { lat: 12.978, lng: 77.64 },
      { lat: 12.935, lng: 77.624 },
    ]);
  });

  it('accepts finite coordinates and rejects the rest', () => {
    expect(hasValidPoints(stepsToPoints(steps))).toBe(true);
    expect(hasValidPoints([])).toBe(false);
    expect(hasValidPoints([{ lat: Number.NaN, lng: 77.64 }])).toBe(false);
    expect(hasValidPoints([{ lat: 12.978, lng: Number.POSITIVE_INFINITY }])).toBe(false);
  });
});

describe('scheduleStepsWithLegs (provider-agnostic travel time)', () => {
  it('applies caller-supplied legs to arrivals while preserving identity', () => {
    const steps = [testStep('s1', testPlace('p1')), testStep('s2', testPlace('p2'))];
    const scheduled = scheduleStepsWithLegs(steps, [{ distanceKm: 2.5, durationMinutes: 15 }], 540);
    expect(scheduled[0]).toMatchObject({ id: 's1', arrival: '9:00 AM', travelMinutes: 0, distanceKm: 0 });
    expect(scheduled[1]).toMatchObject({ id: 's2', arrival: '10:15 AM', travelMinutes: 15, distanceKm: 2.5 });
    expect(scheduled[1].durationMinutes).toBe(60);
  });
});
