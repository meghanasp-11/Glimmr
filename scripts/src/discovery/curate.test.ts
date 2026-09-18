/**
 * Tests for discovery curation (dedup, category mapping, provenance).
 *
 * Pure unit tests with fixture records — no network, no Firestore.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  CURATION_DROP,
  curateRecords,
  dedupKey,
  mapGlimmrCategory,
  type GlimmrCategory,
} from "./curate";
import type { RawDiscoveryPlace } from "./overture";

function discoveryPlace(overrides: Partial<RawDiscoveryPlace> = {}): RawDiscoveryPlace {
  return {
    overture_id: "test-overture-1",
    service_area: "indiranagar",
    name: "Test Eatery",
    address_freeform: "1 Test Rd",
    locality: "Bengaluru",
    lat: 12.978,
    lng: 77.64,
    basic_category: "restaurant",
    primary_category: "indian_restaurant",
    taxonomy_primary: "restaurant",
    websites: ["https://example.com/x"],
    operating_status: null,
    confidence: 0.8,
    sources: [{ property: "", dataset: "meta" }],
    overture_release: "2026-08-19.0",
    ...overrides,
  };
}

describe("mapGlimmrCategory", () => {
  const cases: [string | null, string | null, GlimmrCategory | null][] = [
    ["cafe", null, "Cafe"],
    ["coffee_shop", null, "Cafe"],
    ["bakery", null, "Cafe"],
    ["ice_cream_shop", null, "Dessert"],
    ["desserts", null, "Dessert"],
    ["indian_restaurant", null, "Dinner"],
    ["thai_restaurant", null, "Dinner"],
    ["restaurant", null, "Dinner"],
    ["bar", null, "Drinks"],
    ["pub", null, "Drinks"],
    ["cocktail_bar", null, "Drinks"],
    ["brewery", null, "Drinks"],
    ["sandwich_shop", null, "Dinner"],
    [null, "casual_eatery", "Dinner"],
    ["gym", null, "Activity"],
    ["movie_theater", null, "Activity"],
    ["escape_rooms", null, "Activity"],
    ["museum", null, "Culture"],
    ["hindu_temple", null, "Culture"],
    ["library", null, "Culture"],
    ["park", null, "Outdoor"],
    ["shopping", null, null],
    ["mobile_phone_store", null, null],
    ["tattoo_and_piercing", null, null],
    [null, "restaurant", "Dinner"],
    [null, null, null],
  ];
  for (const [primary, basic, expected] of cases) {
    it(`maps ${primary ?? "?"} / ${basic ?? "?"} to ${expected ?? "unmapped"}`, () => {
      expect(mapGlimmrCategory(primary, basic).category).toBe(expected);
    });
  }

  it("prefers the primary category over basic", () => {
    expect(mapGlimmrCategory("bar", "restaurant").category).toBe("Drinks");
  });
});

describe("dedupKey", () => {
  it("is stable across case and whitespace", () => {
    expect(dedupKey("  Test Eatery ", "1 Test Rd", 12.978, 77.64)).toBe(
      dedupKey("test eatery", "1  test rd", 12.978001, 77.640001),
    );
  });

  it("distinguishes nearby but distinct coordinates", () => {
    expect(dedupKey("A", "x", 12.978, 77.64)).not.toBe(dedupKey("A", "x", 12.9795, 77.64));
  });
});

describe("curateRecords", () => {
  it("drops duplicate source ids", () => {
    const { candidates, counts } = curateRecords([
      discoveryPlace({ overture_id: "same" }),
      discoveryPlace({ overture_id: "same", name: "Other Name" }),
    ]);
    expect(counts).toMatchObject({ fetched: 2, kept: 1, dropped_duplicates: 1 });
    expect(candidates).toHaveLength(1);
  });

  it("drops normalized name+address+coordinate duplicates but keeps branches", () => {
    const { counts } = curateRecords([
      discoveryPlace({ overture_id: "a", name: "Chain Cafe", address_freeform: "1 Main Rd" }),
      discoveryPlace({ overture_id: "b", name: "  chain CAFE ", address_freeform: "1  Main Rd" }),
      discoveryPlace({ overture_id: "c", name: "Chain Cafe", address_freeform: "99 Other Rd" }),
      discoveryPlace({ overture_id: "d", name: "Chain Cafe", address_freeform: "1 Main Rd", lat: 12.99, lng: 77.65 }),
    ]);
    expect(counts).toMatchObject({ fetched: 4, kept: 3, dropped_duplicates: 1 });
  });

  it("removes obvious non-outing entities without external data", () => {
    const dropped = [
      "hospital", "bank_credit_union", "school", "mobile_phone_store", "grocery_store", "hotel",
      "tobacco_shop", "medical_supply", "construction_services", "non_governmental_association",
      "transportation", "health_food_store",
    ];
    const rows = dropped.map((primary, i) =>
      discoveryPlace({
        overture_id: `drop-${i}`,
        name: `Drop ${i}`,
        address_freeform: `${i} Drop Rd`,
        primary_category: primary,
        basic_category: null,
      }),
    );
    const { counts, candidates } = curateRecords(rows);
    expect(counts).toMatchObject({ fetched: dropped.length, kept: 0, dropped_non_outing: dropped.length });
    expect(candidates).toEqual([]);
  });

  it("keeps temples, parks, bars, and museums", () => {
    const rows = ["hindu_temple", "park", "bar", "museum"].map((primary, i) =>
      discoveryPlace({
        overture_id: `keep-${i}`,
        name: `Keep ${i}`,
        address_freeform: `${i} Keep Rd`,
        primary_category: primary,
        basic_category: null,
      }),
    );
    const { counts } = curateRecords(rows);
    expect(counts).toMatchObject({ fetched: 4, kept: 4 });
  });

  it("leaves review-class groups unmapped, never forced", () => {
    const rows = [
      discoveryPlace({ overture_id: "r1", name: "R1", address_freeform: "1 R Rd", primary_category: "bookstore", basic_category: null }),
      discoveryPlace({ overture_id: "r2", name: "R2", address_freeform: "2 R Rd", primary_category: "shopping", basic_category: null }),
      discoveryPlace({ overture_id: "r3", name: "R3", address_freeform: "3 R Rd", primary_category: null, basic_category: null }),
      discoveryPlace({ overture_id: "r4", name: "R4", address_freeform: "4 R Rd", primary_category: "liquor_store", basic_category: null }),
    ];
    const { candidates, counts } = curateRecords(rows);
    expect(counts).toMatchObject({ fetched: 4, kept: 4, mapped: 0, unmapped: 4 });
    for (const candidate of candidates) {
      expect(candidate.glimmr_category).toBeNull();
      expect(candidate.category_match).toBe("none");
    }
  });

  it("preserves provenance and invents nothing", () => {
    const { candidates } = curateRecords([discoveryPlace()]);
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.provenance).toEqual({
      sources: [{ property: "", dataset: "meta" }],
      overture_release: "2026-08-19.0",
    });
    expect(candidate.confidence).toBe(0.8);
    expect(candidate.websites).toEqual(["https://example.com/x"]);
    for (const invented of [
      "priceMin", "priceMax", "priceBasis", "openingHours", "typicalVisitDuration",
      "vibe", "activities", "suitableFor", "rating", "reviewCount", "experienceScore",
    ]) {
      expect(candidate).not.toHaveProperty(invented);
    }
  });

  it("counts mapped vs unmapped", () => {
    const { counts, byCategory } = curateRecords([
      discoveryPlace({ overture_id: "m1" }),
      discoveryPlace({
        overture_id: "m2",
        name: "Other Shop",
        address_freeform: "2 Other Rd",
        primary_category: "shopping",
        basic_category: null,
      }),
    ]);
    expect(counts).toMatchObject({ fetched: 2, kept: 2, mapped: 1, unmapped: 1 });
    expect(byCategory["Dinner"]).toBe(1);
    expect(byCategory["unmapped"]).toBe(1);
  });

  it("keeps the drop list clear of outing-worthy categories", () => {
    for (const keep of ["park", "museum", "bar", "cafe", "brewery", "library", "zoo", "theatre"]) {
      expect(CURATION_DROP.has(keep)).toBe(false);
    }
  });
});
