/**
 * Tests for the Glimmr place import validator (standard + production modes).
 *
 * Pure unit tests — no Firestore, no network.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import { isParseableOpeningHours, validateSeedFile } from "./place-import";

const INDIRANAGAR = {
  id: "indiranagar",
  name: "Indiranagar",
  city: "Bengaluru",
  active: true,
  bounds: { north: 12.985, south: 12.97, east: 77.645, west: 77.635 },
};

const KORAMANGALA = {
  id: "koramangala",
  name: "Koramangala",
  city: "Bengaluru",
  active: true,
  bounds: { north: 12.945, south: 12.925, east: 77.625, west: 77.61 },
};

const CHURCH_STREET = {
  id: "church-street",
  name: "Church Street",
  city: "Bengaluru",
  active: true,
  bounds: { north: 12.975, south: 12.97, east: 77.61, west: 77.6 },
};

function prodPlace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p-test-1",
    name: "Test Cafe",
    serviceArea: "indiranagar",
    category: "Cafe",
    address: "1 Test Road",
    lat: 12.978,
    lng: 77.64,
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
    sourceUrl: "https://example.com/places/test-cafe",
    verificationStatus: "verified",
    lastVerified: "2026-09-16",
    confidence: 0.9,
    ...overrides,
  };
}

function seedFile(places: unknown[], areas: unknown[] = [INDIRANAGAR]): unknown {
  return { serviceAreas: areas, places };
}

describe("isParseableOpeningHours", () => {
  it("accepts the engine grammar", () => {
    expect(isParseableOpeningHours("9:00 AM - 9:00 PM")).toBe(true);
    expect(isParseableOpeningHours("8:00 AM – 9:00 PM")).toBe(true);
    expect(isParseableOpeningHours("12:00 PM - 1:00 AM")).toBe(true);
    expect(isParseableOpeningHours("Always open")).toBe(true);
  });

  it("rejects free text", () => {
    expect(isParseableOpeningHours("Call ahead")).toBe(false);
    expect(isParseableOpeningHours("9-5")).toBe(false);
    expect(isParseableOpeningHours("")).toBe(false);
  });
});

describe("standard mode", () => {
  it("accepts a production-ready record", () => {
    const result = validateSeedFile(seedFile([prodPlace()]));
    expect(result.ok).toBe(true);
  });

  it("still accepts sample-style records (current behavior preserved)", () => {
    const sample = prodPlace({
      id: "sample-x",
      name: "[SAMPLE] X",
      source: "sample-seed",
      verificationStatus: "unverified",
      confidence: 0.1,
      openingHours: "Call ahead",
      activities: [],
    });
    delete sample["sourceUrl"];
    const result = validateSeedFile(seedFile([sample]));
    expect(result.ok).toBe(true);
  });

  it("rejects schema violations, duplicates, and unknown areas", () => {
    const bad = prodPlace({ id: "", priceMin: -5 });
    expect(validateSeedFile(seedFile([bad])).ok).toBe(false);

    const dup = [prodPlace({ id: "p-a" }), prodPlace({ id: "p-a", name: "Other" })];
    const dupResult = validateSeedFile(seedFile(dup));
    expect(dupResult.ok).toBe(false);
    if (!dupResult.ok) expect(dupResult.errors.join()).toMatch(/duplicate place id/);

    const nameDup = [prodPlace({ id: "p-a" }), prodPlace({ id: "p-b" })];
    const nameDupResult = validateSeedFile(seedFile(nameDup));
    expect(nameDupResult.ok).toBe(false);
    if (!nameDupResult.ok) expect(nameDupResult.errors.join()).toMatch(/duplicate name\+address/);

    const unknownArea = validateSeedFile(seedFile([prodPlace({ serviceArea: "nope" })]));
    expect(unknownArea.ok).toBe(false);

    expect(validateSeedFile({}).ok).toBe(false);
    expect(validateSeedFile({ serviceAreas: [], places: "x" }).ok).toBe(false);
  });
});

describe("production mode", () => {
  it("accepts a fully production-ready record", () => {
    const result = validateSeedFile(seedFile([prodPlace()]), { production: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.areas).toHaveLength(1);
      expect(result.data.places).toHaveLength(1);
    }
  });

  it("imports all three V1 areas without code branches", () => {
    const places = [
      prodPlace({ id: "p-ind", name: "Ind Place", serviceArea: "indiranagar", address: "1 A Rd", lat: 12.978, lng: 77.64 }),
      prodPlace({ id: "p-kor", name: "Kor Place", serviceArea: "koramangala", address: "2 B Rd", lat: 12.935, lng: 77.617 }),
      prodPlace({ id: "p-chu", name: "Chu Place", serviceArea: "church-street", address: "3 C Rd", lat: 12.9725, lng: 77.605 }),
    ];
    const result = validateSeedFile(seedFile(places, [INDIRANAGAR, KORAMANGALA, CHURCH_STREET]), {
      production: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.places.map((p) => p.serviceArea).sort()).toEqual([
        "church-street",
        "indiranagar",
        "koramangala",
      ]);
    }
  });

  it("rejects sample-marked records", () => {
    const sample = prodPlace({ source: "sample-seed", verificationStatus: "unverified", confidence: 0.1 });
    const result = validateSeedFile(seedFile([sample]), { production: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/sample data/);

    const named = prodPlace({ name: "[SAMPLE] Fake", verificationStatus: "verified" });
    expect(validateSeedFile(seedFile([named]), { production: true }).ok).toBe(false);
  });

  it("requires sourceUrl, verified status, and activities", () => {
    const noUrl = { ...prodPlace() };
    delete noUrl["sourceUrl"];
    expect(validateSeedFile(seedFile([noUrl]), { production: true }).ok).toBe(false);

    const badUrl = prodPlace({ sourceUrl: "not-a-url" });
    const badUrlResult = validateSeedFile(seedFile([badUrl]), { production: true });
    expect(badUrlResult.ok).toBe(false);
    if (!badUrlResult.ok) expect(badUrlResult.errors.join()).toMatch(/sourceUrl/);

    for (const status of ["unverified", "ai-suggested"]) {
      expect(
        validateSeedFile(seedFile([prodPlace({ verificationStatus: status })]), { production: true }).ok,
      ).toBe(false);
    }

    const noActivities = prodPlace({ activities: [] });
    const noActResult = validateSeedFile(seedFile([noActivities]), { production: true });
    expect(noActResult.ok).toBe(false);
    if (!noActResult.ok) expect(noActResult.errors.join()).toMatch(/activities/);

    // ...but standard mode still accepts records without them
    expect(validateSeedFile(seedFile([noUrl])).ok).toBe(true);
  });

  it("requires parseable opening hours", () => {
    const bad = prodPlace({ openingHours: "Call ahead for hours" });
    const result = validateSeedFile(seedFile([bad]), { production: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/openingHours/);

    const overnight = prodPlace({ openingHours: "12:00 PM - 1:00 AM" });
    expect(validateSeedFile(seedFile([overnight]), { production: true }).ok).toBe(true);
  });

  it("requires coordinates inside the area bounds", () => {
    const outside = prodPlace({ lat: 13.5, lng: 77.64 });
    const result = validateSeedFile(seedFile([outside]), { production: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/outside.*bounds/);

    // Out-of-range latitudes never pass, in either mode
    expect(validateSeedFile(seedFile([prodPlace({ lat: 120 })]), { production: true }).ok).toBe(false);
  });

  it("requires sane prices in both modes", () => {
    expect(
      validateSeedFile(seedFile([prodPlace({ priceMin: 500, priceMax: 100 })]), { production: true }).ok,
    ).toBe(false);
    expect(validateSeedFile(seedFile([prodPlace({ priceMin: -10, priceMax: 100 })])).ok).toBe(false);
  });
});
