/**
 * ============================================================================
 * GLIMMR Maps service (provider-agnostic)
 * ============================================================================
 * Routing, distance, and travel-time behind a small provider interface.
 * Free data only: Leaflet renders OpenStreetMap tiles, OSRM provides road
 * routing when reachable, and a local Haversine estimator is the offline
 * fallback. No paid Maps APIs, no API keys.
 *
 * - `HaversineRoutingProvider` never touches the network. Its rounding
 *   matches the recommendation engine's estimates exactly, so falling back
 *   never changes plan math unexpectedly.
 * - `OSRMRoutingProvider` queries a public OSRM endpoint (default: the free
 *   OSRM demo server) and falls back to Haversine per request on any
 *   failure: HTTP error, timeout, malformed payload, or leg-count mismatch.
 * - `NominatimGeocoder` is a single-shot geocoder behind an abstraction.
 *   Per Nominatim usage policy it must NOT be used for autocomplete or bulk
 *   queries — there is deliberately no debounce/streaming API here.
 * ============================================================================
 */

import type { TransportMode } from '@/types/glimmr';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** One travel leg between two consecutive points. */
export interface RouteLeg {
  distanceKm: number;
  durationMinutes: number;
}

export interface RouteProvider {
  readonly name: string;
  /** Legs for consecutive points; resolves to (points.length - 1) legs. */
  routeLegs(points: GeoPoint[], mode: TransportMode): Promise<RouteLeg[]>;
}

export interface GeocodedPoint extends GeoPoint {
  label: string;
}

export interface Geocoder {
  readonly name: string;
  /** Single-shot lookup; null when nothing matches or the lookup fails. */
  geocode(query: string): Promise<GeocodedPoint | null>;
}

// Planning speeds (km/h) — deliberately the same figures the recommendation
// engine estimates with, so the Haversine fallback agrees with plan math.
const FALLBACK_SPEED_KMH: Record<TransportMode, number> = {
  walk: 4.5,
  bike: 13,
  transit: 17,
  drive: 20,
};

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Offline estimator with the engine's exact rounding: 0.1 km, min 5 min/leg. */
export function haversineLeg(from: GeoPoint, to: GeoPoint, mode: TransportMode): RouteLeg {
  const distanceKm = Number(haversineKm(from, to).toFixed(1));
  const durationMinutes = Math.max(5, Math.round((distanceKm / FALLBACK_SPEED_KMH[mode]) * 60));
  return { distanceKm, durationMinutes };
}

export class HaversineRoutingProvider implements RouteProvider {
  readonly name = 'haversine';

  async routeLegs(points: GeoPoint[], mode: TransportMode): Promise<RouteLeg[]> {
    const legs: RouteLeg[] = [];
    for (let i = 1; i < points.length; i += 1) {
      legs.push(haversineLeg(points[i - 1], points[i], mode));
    }
    return legs;
  }
}

const OSRM_PROFILE: Record<TransportMode, string> = {
  // OSRM has no transit routing; driving is the closest road profile.
  walk: 'walking',
  bike: 'cycling',
  transit: 'driving',
  drive: 'driving',
};

export const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';
export const DEFAULT_NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

function readEnv(key: string): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

export interface OSRMOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface OSRMRouteResponse {
  code?: string;
  routes?: { legs?: { distance?: number; duration?: number }[] }[];
}

/**
 * Road routing via a public OSRM endpoint. Any failure degrades to the
 * Haversine fallback for the whole request — callers always get legs.
 * Pass `baseUrl: ''` to disable the network path entirely (offline mode).
 */
export class OSRMRoutingProvider implements RouteProvider {
  readonly name = 'osrm';
  private readonly fallback = new HaversineRoutingProvider();
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OSRMOptions = {}) {
    this.baseUrl = options.baseUrl ?? readEnv('VITE_OSRM_BASE_URL') ?? DEFAULT_OSRM_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async routeLegs(points: GeoPoint[], mode: TransportMode): Promise<RouteLeg[]> {
    if (points.length < 2 || !this.baseUrl) {
      return this.fallback.routeLegs(points, mode);
    }
    try {
      const coords = points.map((point) => `${point.lng},${point.lat}`).join(';');
      const url =
        `${this.baseUrl.replace(/\/$/, '')}/route/v1/${OSRM_PROFILE[mode]}/${coords}` +
        '?overview=false&annotations=false';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) return this.fallback.routeLegs(points, mode);
      const payload = (await response.json()) as OSRMRouteResponse;
      const legs = payload?.routes?.[0]?.legs;
      if (payload?.code !== 'Ok' || !legs || legs.length !== points.length - 1) {
        return this.fallback.routeLegs(points, mode);
      }
      return legs.map((leg) => ({
        distanceKm: Number(((leg.distance ?? 0) / 1000).toFixed(1)),
        durationMinutes: Math.max(1, Math.round((leg.duration ?? 0) / 60)),
      }));
    } catch {
      return this.fallback.routeLegs(points, mode);
    }
  }
}

export interface NominatimOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
}

/**
 * Single-shot Nominatim geocoder. One query in, one result (or null) out —
 * no autocomplete, no bulk endpoint, per Nominatim usage policy.
 */
export class NominatimGeocoder implements Geocoder {
  readonly name = 'nominatim';
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: NominatimOptions = {}) {
    this.baseUrl = options.baseUrl ?? readEnv('VITE_NOMINATIM_BASE_URL') ?? DEFAULT_NOMINATIM_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async geocode(query: string): Promise<GeocodedPoint | null> {
    const text = query.trim();
    if (!text || !this.baseUrl) return null;
    try {
      const url =
        `${this.baseUrl.replace(/\/$/, '')}/search?format=jsonv2&limit=1&q=${encodeURIComponent(text)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) return null;
      const [first] = (await response.json()) as NominatimResult[];
      if (!first) return null;
      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng, label: first.display_name ?? text };
    } catch {
      return null;
    }
  }
}

export interface MapsServiceOptions {
  router?: RouteProvider;
  geocoder?: Geocoder;
}

/** Default service: OSRM road routing with Haversine fallback + Nominatim. */
export function createMapsService(options: MapsServiceOptions = {}): {
  readonly routingProviderName: string;
  routeLegs(points: GeoPoint[], mode: TransportMode): Promise<RouteLeg[]>;
  geocode(query: string): Promise<GeocodedPoint | null>;
} {
  const router = options.router ?? new OSRMRoutingProvider();
  const geocoder = options.geocoder ?? new NominatimGeocoder();
  return {
    routingProviderName: router.name,
    routeLegs: (points, mode) => router.routeLegs(points, mode),
    geocode: (query) => geocoder.geocode(query),
  };
}

export type MapsService = ReturnType<typeof createMapsService>;

/** Shared default instance used by plan recalculation. */
export const mapsService: MapsService = createMapsService();
