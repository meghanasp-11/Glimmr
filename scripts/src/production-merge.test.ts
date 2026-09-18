/**
 * Tests for the production merge (per-area files -> one validated dataset).
 *
 * Pure unit tests — no Firestore, no network.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import { validateSeedFile } from "./place-import";
import { mergeAreaFiles } from "./production-merge";

const BOUNDS: Record<string, { north: number; south: number; east: number; west: number }> = {
  indiranagar: { north: 12.985, south: 12.97, east: 77.645, west: 77.635 },
  koramangala: { north: 12.945, south: 12.925, east: 77.625, west: 77.61 },
  "church-street": { north: 12.975, south: 12.97, east: 77.61, west: 77.6 },
};

const CENTERS: Record<string, { lat: number; lng: number }> = {
  indiranagar: { lat: 12.978, lng: 77.64 },
  koramangala: { lat: 12.935, lng: 77.617 },
  "church-street": { lat: 12.9725, lng: 77.605 },
};

function areaFile(id: string, places: unknown[] = []): { source: string; raw: unknown } {
  return {
    source: `${id}.json`,
    raw: {
      serviceArea: { id, name: id, city: "Bengaluru", active: true, bounds: BOUNDS[id] },
      places,
    },
  };
}

function prodPlace(area: string, id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    serviceArea: area,
    category: "Cafe",
    address: `${id} Test Road`,
    ...CENTERS[area],
    priceMin: 100,
    priceMax: 250,
    priceBasis: "per_person",
    openingHours: "9:00 AM - 9:00 PM",
    typicalVisitDuration: 35,
    suitableFor: ["solo"],
    activities: ["coffee"],
    vibe: "Bright",
    rating: 4.0,
    reviewCount: 10,
    experienceScore: 0.6,
    source: "field-research",
    sourceUrl: `https://example.com/places/${id}`,
    verificationStatus: "verified",
    lastVerified: "2026-09-16",
    confidence: 0.9,
  };
}

describe("mergeAreaFiles", () => {
  it("merges the three V1 area files with empty places", () => {
    const result = mergeAreaFiles([areaFile("indiranagar"), areaFile("koramangala"), areaFile("church-street")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.serviceAreas.map((a) => a.id)).toEqual(["church-street", "indiranagar", "koramangala"]);
    expect(result.data.places).toEqual([]);
  });

  it("orders deterministically regardless of input order", () => {
    const reversed = mergeAreaFiles([areaFile("koramangala"), areaFile("indiranagar")]);
    const forward = mergeAreaFiles([areaFile("indiranagar"), areaFile("koramangala")]);
    expect(reversed).toEqual(forward);
  });

  it("rejects malformed area files", () => {
    expect(mergeAreaFiles([{ source: "x.json", raw: null }]).ok).toBe(false);
    expect(mergeAreaFiles([{ source: "x.json", raw: [] }]).ok).toBe(false);
    expect(mergeAreaFiles([{ source: "x.json", raw: { places: [] } }]).ok).toBe(false);
    expect(
      mergeAreaFiles([{ source: "x.json", raw: { serviceArea: { id: "" }, places: [] } }]).ok,
    ).toBe(false);
    expect(
      mergeAreaFiles([areaFile("indiranagar"), { source: "dup.json", raw: { serviceArea: { id: "indiranagar", name: "x", city: "Bengaluru", active: true }, places: [] } }]).ok,
    ).toBe(false);
    const badPlaces = areaFile("indiranagar");
    (badPlaces.raw as { places: unknown }).places = "nope";
    expect(mergeAreaFiles([badPlaces]).ok).toBe(false);
  });

  it("rejects places misfiled under the wrong area", () => {
    const misfiled = areaFile("indiranagar", [prodPlace("koramangala", "p-x", "X Cafe")]);
    const result = mergeAreaFiles([misfiled]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/koramangala.*indiranagar|indiranagar.*koramangala/);
  });
});

describe("merged production validation", () => {
  it("accepts one valid place per V1 area", () => {
    const merged = mergeAreaFiles([
      areaFile("indiranagar", [prodPlace("indiranagar", "p-ind", "Ind Cafe")]),
      areaFile("koramangala", [prodPlace("koramangala", "p-kor", "Kor Cafe")]),
      areaFile("church-street", [prodPlace("church-street", "p-chu", "Chu Cafe")]),
    ]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const validated = validateSeedFile(
      { serviceAreas: merged.data.serviceAreas, places: merged.data.places },
      { production: true },
    );
    expect(validated.ok).toBe(true);
  });

  it("rejects duplicate place ids across areas", () => {
    const merged = mergeAreaFiles([
      areaFile("indiranagar", [prodPlace("indiranagar", "p-same", "Ind Cafe")]),
      areaFile("koramangala", [prodPlace("koramangala", "p-same", "Kor Cafe")]),
    ]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const validated = validateSeedFile(
      { serviceAreas: merged.data.serviceAreas, places: merged.data.places },
      { production: true },
    );
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors.join()).toMatch(/duplicate place id "p-same"/);
  });

  it("rejects duplicate name+address across areas", () => {
    const a = prodPlace("indiranagar", "p-a", "Same Cafe");
    const b = prodPlace("koramangala", "p-b", "SAME CAFE");
    (b as Record<string, unknown>)["address"] = (a as Record<string, unknown>)["address"];
    const merged = mergeAreaFiles([areaFile("indiranagar", [a]), areaFile("koramangala", [b])]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const validated = validateSeedFile(
      { serviceAreas: merged.data.serviceAreas, places: merged.data.places },
      { production: true },
    );
    expect(validated.ok).toBe(false);
    if (!validated.ok) expect(validated.errors.join()).toMatch(/duplicate name\+address/);
  });
});
