/**
 * Tests for verification-priority ranking (existing source data only).
 *
 * Pure unit tests with fixture candidates — no network, no Firestore.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import { rankCandidates, SHORTLIST_TARGET } from "./shortlist";
import type { CandidatePlace } from "./curate";

function candidate(overrides: Partial<CandidatePlace> = {}): CandidatePlace {
  return {
    overture_id: "test-id",
    service_area: "indiranagar",
    name: "Test Place",
    address_freeform: "1 Test Rd",
    locality: "Bengaluru",
    lat: 12.978,
    lng: 77.64,
    glimmr_category: "Dinner",
    category_match: "primary",
    overture_primary: "indian_restaurant",
    overture_basic: "restaurant",
    taxonomy_primary: "restaurant",
    websites: [],
    operating_status: null,
    confidence: 0.5,
    provenance: { sources: [], overture_release: "2026-08-19.0" },
    ...overrides,
  };
}

describe("rankCandidates", () => {
  it("ranks food-first and explains each pick without inventing facts", () => {
    const { shortlisted } = rankCandidates(
      [
        candidate({ overture_id: "outdoor-1", glimmr_category: "Outdoor", confidence: 0.9, websites: ["https://example.com"] }),
        candidate({ overture_id: "dinner-1", glimmr_category: "Dinner", confidence: 0.1 }),
      ],
      10,
    );
    expect(shortlisted).toHaveLength(2);
    // Dinner base (100+2) beats Outdoor base (65+18+10) here by design.
    expect(shortlisted[0].overture_id).toBe("dinner-1");
    expect(shortlisted[0].verification_rank).toBe(1);
    expect(shortlisted[0].verification_reasons).toContain("Dinner (core outing category)");
    for (const invented of ["priceMin", "rating", "vibe", "openingHours", "experienceScore"]) {
      expect(shortlisted[0]).not.toHaveProperty(invented);
    }
  });

  it("rewards open status, confidence, and websites", () => {
    const { shortlisted } = rankCandidates(
      [
        candidate({ overture_id: "plain", confidence: 0.1 }),
        candidate({
          overture_id: "rich",
          operating_status: "open",
          confidence: 0.95,
          websites: ["https://example.com/rich"],
        }),
      ],
      10,
    );
    expect(shortlisted[0].overture_id).toBe("rich");
    expect(shortlisted[0].verification_reasons).toEqual(
      expect.arrayContaining(["listed as open", "has website for verification"]),
    );
  });

  it("excludes unmapped records without force-mapping them", () => {
    const { shortlisted, counts } = rankCandidates(
      [candidate({ overture_id: "m" }), candidate({ overture_id: "u", glimmr_category: null })],
      10,
    );
    expect(counts).toMatchObject({ pool: 2, unmapped_excluded: 1, shortlisted: 1 });
    expect(shortlisted[0].overture_id).toBe("m");
  });

  it("keeps every V1 area represented via quotas", () => {
    const rows: CandidatePlace[] = [];
    const areas = ["indiranagar", "koramangala", "church-street"] as const;
    areas.forEach((area, a) => {
      for (let i = 0; i < 60; i += 1) {
        rows.push(
          candidate({
            overture_id: `${area}-${i}`,
            service_area: area,
            lat: 12.9 + a * 0.05 + i * 0.002,
            lng: 77.6 + i * 0.002,
          }),
        );
      }
    });
    const { shortlisted, quotas, counts } = rankCandidates(rows, 90);
    const byArea = new Map<string, number>();
    for (const pick of shortlisted) byArea.set(pick.service_area, (byArea.get(pick.service_area) ?? 0) + 1);
    expect([...byArea.keys()].sort()).toEqual(["church-street", "indiranagar", "koramangala"]);
    for (const area of areas) expect(byArea.get(area)).toBeGreaterThan(0);
    expect(Object.values(quotas).reduce((a, b) => a + b, 0)).toBe(90);
    expect(counts.shortlisted).toBeLessThanOrEqual(90);
  });

  it("spreads picks geographically with the cell cap", () => {    const rows: CandidatePlace[] = [];
    for (let i = 0; i < 10; i += 1) {
      rows.push(candidate({ overture_id: `same-cell-${i}`, lat: 12.978, lng: 77.64 }));
    }
    rows.push(candidate({ overture_id: "far-away", lat: 12.99, lng: 77.65 }));
    const { shortlisted, counts } = rankCandidates(rows, 11);
    expect(counts.skipped_clustered).toBe(6);
    expect(shortlisted.map((p) => p.overture_id)).toContain("far-away");
  });

  it("guarantees every mapped category a verification floor per area", () => {
    const rows: CandidatePlace[] = [];
    const cats = ["Dinner", "Cafe", "Activity", "Drinks", "Culture", "Dessert", "Outdoor"] as const;
    cats.forEach((cat, c) => {
      for (let i = 0; i < 10; i += 1) {
        rows.push(
          candidate({
            overture_id: `${cat}-${i}`,
            name: `${cat} ${i}`,
            address_freeform: `${i} ${cat} Rd`,
            glimmr_category: cat,
            lat: 12.9 + c * 0.02 + i * 0.003,
            lng: 77.6 + i * 0.003,
          }),
        );
      }
    });
    const { shortlisted } = rankCandidates(rows, 70);
    const present = new Set(shortlisted.map((p) => p.glimmr_category));
    expect([...present].sort()).toEqual([...cats].sort());
    const diversityNoted = shortlisted.filter((p) =>
      p.verification_reasons.some((r) => r.startsWith("ensures ")),
    );
    expect(diversityNoted.length).toBeGreaterThan(0);
  });

  it("is deterministic with stable tiebreaks", () => {
    const rows = ["c", "a", "b"].map((id) => candidate({ overture_id: id }));
    const first = rankCandidates(rows, 3).shortlisted.map((p) => p.overture_id);
    const second = rankCandidates([...rows].reverse(), 3).shortlisted.map((p) => p.overture_id);
    expect(first).toEqual(["a", "b", "c"]);
    expect(second).toEqual(["a", "b", "c"]);
  });

  it("handles empty input and zero targets", () => {
    expect(rankCandidates([], 10).shortlisted).toEqual([]);
    expect(rankCandidates([candidate()], 0).shortlisted).toEqual([]);
    expect(SHORTLIST_TARGET).toBe(180);
  });
});
