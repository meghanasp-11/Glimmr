/**
 * Tests for the Overture discovery normalizer (mapping + filters).
 *
 * Pure unit tests with fixture records — no network, no Firestore.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  EXCLUDED_CATEGORIES,
  normalizeOvertureSnapshot,
  type OvertureRecord,
} from "./overture";

function record(overrides: Partial<OvertureRecord> = {}): OvertureRecord {
  return {
    overture_id: "test-id-1",
    names: { primary: "Test Eatery" },
    categories: { primary: "indian_restaurant" },
    basic_category: "restaurant",
    taxonomy: { primary: "restaurant" },
    addresses: [{ freeform: "1 Test Rd, Bengaluru", locality: "Bengaluru" }],
    websites: ["https://example.com/test-eatery"],
    operating_status: null,
    confidence: 0.8,
    sources: [{ property: "", dataset: "meta" }],
    geometry: { lng: 77.64, lat: 12.978 },
    ...overrides,
  };
}

function snapshot(records: OvertureRecord[]) {
  return {
    source: "overture_places",
    overture_release: "2026-08-19.0",
    service_area: "indiranagar",
    fetched_at_utc: "2026-09-16T00:00:00+00:00",
    records,
  };
}

describe("normalizeOvertureSnapshot", () => {
  it("maps Overture fields into the raw discovery format", () => {
    const { places, counts } = normalizeOvertureSnapshot(snapshot([record()]));
    expect(counts).toMatchObject({ fetched: 1, kept: 1 });
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      overture_id: "test-id-1",
      service_area: "indiranagar",
      name: "Test Eatery",
      address_freeform: "1 Test Rd, Bengaluru",
      locality: "Bengaluru",
      lat: 12.978,
      lng: 77.64,
      basic_category: "restaurant",
      primary_category: "indian_restaurant",
      taxonomy_primary: "restaurant",
      websites: ["https://example.com/test-eatery"],
      operating_status: null,
      confidence: 0.8,
      overture_release: "2026-08-19.0",
    });
    expect(places[0].sources).toHaveLength(1);
  });

  it("falls back to the common name and tolerates missing optionals", () => {
    const { places } = normalizeOvertureSnapshot(
      snapshot([record({ names: { primary: null, common: "Common Name" }, websites: null, addresses: null })]),
    );
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe("Common Name");
    expect(places[0].websites).toEqual([]);
    expect(places[0].address_freeform).toBeNull();
  });

  it("drops permanently closed places but keeps unknown status", () => {
    const rows = [
      record({ overture_id: "closed-1", operating_status: "permanently_closed" }),
      record({ overture_id: "open-1", operating_status: "open" }),
      record({ overture_id: "unknown-1", operating_status: null }),
    ];
    const { places, counts } = normalizeOvertureSnapshot(snapshot(rows));
    expect(counts).toMatchObject({ fetched: 3, kept: 2, dropped_closed: 1 });
    expect(places.map((p) => p.overture_id).sort()).toEqual(["open-1", "unknown-1"]);
  });

  it("drops obviously irrelevant POIs and keeps outing-worthy ones", () => {
    const irrelevant = [
      "bank_credit_union", "gas_station", "parking", "hospital", "school",
      "hotel", "police_station", "post_office", "car_dealer", "college_university",
    ];
    const rows = irrelevant.map((primary, i) =>
      record({ overture_id: `bad-${i}`, categories: { primary }, basic_category: null }),
    );
    const kept = [
      record({ overture_id: "keep-temple", categories: { primary: "hindu_temple" }, basic_category: null }),
      record({ overture_id: "keep-bar", categories: { primary: "bar" }, basic_category: null }),
      record({ overture_id: "keep-park", categories: { primary: "park" }, basic_category: null }),
      record({ overture_id: "keep-museum", categories: { primary: "museum" }, basic_category: null }),
      record({ overture_id: "keep-uncategorized", categories: null, basic_category: null }),
    ];
    const { places, counts } = normalizeOvertureSnapshot(snapshot([...rows, ...kept]));
    expect(counts.dropped_irrelevant).toBe(irrelevant.length);
    expect(places.map((p) => p.overture_id).sort()).toEqual(
      ["keep-bar", "keep-museum", "keep-park", "keep-temple", "keep-uncategorized"].sort(),
    );
  });

  it("also matches the exclusion list on basic_category", () => {
    const { counts } = normalizeOvertureSnapshot(
      snapshot([record({ categories: { primary: "weird_subtype" }, basic_category: "bank_or_credit_union" })]),
    );
    expect(counts).toMatchObject({ fetched: 1, kept: 0, dropped_irrelevant: 1 });
  });

  it("drops records with no usable name or geometry", () => {
    const rows = [
      record({ overture_id: "no-name", names: { primary: null, common: null } }),
      record({ overture_id: "no-geom", geometry: { lng: null, lat: null } }),
      record({ overture_id: null }),
    ];
    const { places, counts } = normalizeOvertureSnapshot(snapshot(rows));
    expect(counts).toMatchObject({ fetched: 3, kept: 0, dropped_unusable: 3 });
    expect(places).toEqual([]);
  });

  it("clamps out-of-range confidence to null instead of inventing a value", () => {
    const { places } = normalizeOvertureSnapshot(snapshot([record({ confidence: 7 })]));
    expect(places[0].confidence).toBeNull();
  });

  it("handles empty and malformed snapshots without throwing", () => {
    expect(normalizeOvertureSnapshot({ service_area: "x", records: [] }).counts).toMatchObject({
      fetched: 0,
      kept: 0,
    });
    expect(normalizeOvertureSnapshot({}).counts.fetched).toBe(0);
  });

  it("keeps the exclusion list free of outing-worthy categories", () => {
    for (const keep of ["hindu_temple", "bar", "park", "museum", "cafe", "brewery", "cinema", "library"]) {
      expect(EXCLUDED_CATEGORIES.has(keep)).toBe(false);
    }
  });
});
