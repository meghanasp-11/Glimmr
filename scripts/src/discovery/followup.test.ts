/**
 * Tests for Batch-02 follow-up selection and readiness ranking.
 *
 * Pure functions (no network, no Firestore). Fixtures are synthetic.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_SIZE,
  rankByReadinessPotential,
  renderFollowUpReport,
  selectFollowUpBatch,
  type FollowUpInput,
  type ReadinessRanked,
} from "./followup";

function input(overrides: Partial<FollowUpInput> & { overture_id: string }): FollowUpInput {
  return {
    service_area: "koramangala",
    name: `Place ${overrides.overture_id}`,
    lat: 12.93,
    lng: 77.62,
    glimmr_category: "Dinner",
    websites: ["https://example.com/venue"],
    address_freeform: "1 Test Road",
    confidence: 1,
    sourceCount: 2,
    verification_rank: 50,
    ...overrides,
  };
}

function ranked(overrides: Partial<ReadinessRanked> & { overture_id: string }): ReadinessRanked {
  return {
    name: `Place ${overrides.overture_id}`,
    service_area: "koramangala",
    glimmr_category: "Dinner",
    blockerCount: 5,
    blockers: ["priceMin: missing"],
    hasPricingEvidence: false,
    hasHoursEvidence: false,
    websiteReachable: false,
    completeness: 0.2,
    flags: [],
    ...overrides,
  };
}

describe("selectFollowUpBatch", () => {
  it("caps the batch at the requested size", () => {
    const categories = ["Activity", "Cafe", "Culture", "Dessert", "Dinner", "Drinks", "Outdoor"];
    const inputs = Array.from({ length: 30 }, (_, i) =>
      input({ overture_id: `id-${i}`, glimmr_category: categories[i % categories.length] }),
    );
    const result = selectFollowUpBatch(inputs, new Set(), 20);
    expect(result.picked).toHaveLength(20);
    expect(result.counts.picked).toBe(20);
  });

  it("excludes already-processed Batch-01 ids", () => {
    const inputs = [input({ overture_id: "a" }), input({ overture_id: "b" })];
    const result = selectFollowUpBatch(inputs, new Set(["a"]), 20);
    expect(result.picked.map((p) => p.overture_id)).toEqual(["b"]);
    expect(result.counts.excluded).toBe(1);
  });

  it("drops unmapped records and records without coordinates", () => {
    const inputs = [
      input({ overture_id: "ok" }),
      input({ overture_id: "unmapped", glimmr_category: null }),
      input({ overture_id: "no-coords", lat: Number.NaN }),
    ];
    const result = selectFollowUpBatch(inputs, new Set(), 20);
    expect(result.picked.map((p) => p.overture_id)).toEqual(["ok"]);
  });

  it("guarantees every area and every category a floor", () => {
    const areas = ["church-street", "indiranagar", "koramangala"];
    const categories = ["Activity", "Cafe", "Culture", "Dessert", "Dinner", "Drinks", "Outdoor"];
    const inputs: FollowUpInput[] = [];
    let n = 0;
    for (const area of areas) {
      for (const category of categories) {
        for (let k = 0; k < 4; k += 1) {
          n += 1;
          inputs.push(
            input({ overture_id: `id-${n}`, service_area: area, glimmr_category: category, verification_rank: n }),
          );
        }
      }
    }
    const result = selectFollowUpBatch(inputs, new Set(), FOLLOW_UP_SIZE);
    expect(result.picked).toHaveLength(FOLLOW_UP_SIZE);
    for (const area of areas) {
      const count = result.picked.filter((p) => p.service_area === area).length;
      expect(count, `area ${area}`).toBeGreaterThanOrEqual(3);
    }
    for (const category of categories) {
      const count = result.picked.filter((p) => p.glimmr_category === category).length;
      expect(count, `category ${category}`).toBeGreaterThanOrEqual(2);
    }
    expect(result.counts.areas).toEqual(
      Object.fromEntries(areas.map((area) => [area, result.picked.filter((p) => p.service_area === area).length])),
    );
  });

  it("prioritizes explicit on-file evidence over bare rank", () => {
    const bare = input({ overture_id: "bare", verification_rank: 1, websites: [], address_freeform: null, confidence: 0.5, sourceCount: 1 });
    const evidenced = input({ overture_id: "evidenced", verification_rank: 90 });
    const result = selectFollowUpBatch([bare, evidenced], new Set(), 1);
    expect(result.picked.map((p) => p.overture_id)).toEqual(["evidenced"]);
  });

  it("orders deterministically by evidence, rank, then id", () => {
    const a = input({ overture_id: "b-id", verification_rank: 10 });
    const b = input({ overture_id: "a-id", verification_rank: 10 });
    const first = selectFollowUpBatch([a, b], new Set(), 2);
    const second = selectFollowUpBatch([b, a], new Set(), 2);
    expect(first.picked.map((p) => p.overture_id)).toEqual(["a-id", "b-id"]);
    expect(second.picked.map((p) => p.overture_id)).toEqual(["a-id", "b-id"]);
  });

  it("never mutates its inputs", () => {
    const inputs = [input({ overture_id: "a" }), input({ overture_id: "b" })];
    const snapshot = JSON.stringify(inputs);
    selectFollowUpBatch(inputs, new Set(["a"]), 20);
    expect(JSON.stringify(inputs)).toBe(snapshot);
  });

  it("caps same-chain outlets at two so one brand cannot fill the batch", () => {
    const inputs = [
      input({ overture_id: "d1", name: "Domino's Pizza | Garuda Mall, Bangalore", verification_rank: 1 }),
      input({ overture_id: "d2", name: "Domino's Pizza | M.G Road, Bangalore", verification_rank: 2 }),
      input({ overture_id: "d3", name: "Domino's Pizza | Indira Nagar, Bangalore", verification_rank: 3 }),
      input({ overture_id: "d4", name: "Domino's Pizza, Koramangala, Bangalore", verification_rank: 4 }),
      input({ overture_id: "k1", name: "KFC", glimmr_category: "Dinner", verification_rank: 5 }),
      input({ overture_id: "c1", name: "Corner House", glimmr_category: "Dessert", verification_rank: 6 }),
    ];
    const result = selectFollowUpBatch(inputs, new Set(), 6);
    const dominos = result.picked.filter((p) => p.name.startsWith("Domino's"));
    expect(dominos.length).toBeLessThanOrEqual(2);
    expect(result.picked.map((p) => p.overture_id)).toContain("k1");
    expect(result.picked.map((p) => p.overture_id)).toContain("c1");
  });

  it("caps any single category during fill so the mix stays balanced", () => {
    const inputs: FollowUpInput[] = [];
    for (let i = 0; i < 10; i += 1) {
      inputs.push(input({ overture_id: `dinner-${i}`, name: `Dinner Spot ${i}`, verification_rank: i + 1 }));
    }
    for (let i = 0; i < 4; i += 1) {
      inputs.push(
        input({ overture_id: `cafe-${i}`, name: `Cafe Spot ${i}`, glimmr_category: "Cafe", verification_rank: 20 + i }),
      );
    }
    const result = selectFollowUpBatch(inputs, new Set(), 12);
    const dinners = result.picked.filter((p) => p.glimmr_category === "Dinner").length;
    expect(dinners).toBeLessThanOrEqual(4);
    // 10 dinners cap at 4, 4 cafes cap at 4: the pool yields 8, not 12.
    expect(result.picked).toHaveLength(8);
  });
});

describe("rankByReadinessPotential", () => {
  it("sorts by fewest blockers first", () => {
    const result = rankByReadinessPotential([ranked({ overture_id: "b", blockerCount: 9 }), ranked({ overture_id: "a", blockerCount: 3 })]);
    expect(result.map((r) => r.overture_id)).toEqual(["a", "b"]);
  });

  it("prefers pricing evidence, then hours evidence, then reachable sites", () => {
    const base = { blockerCount: 5 };
    const result = rankByReadinessPotential([
      ranked({ overture_id: "plain", ...base }),
      ranked({ overture_id: "hours", ...base, hasHoursEvidence: true }),
      ranked({ overture_id: "pricing", ...base, hasPricingEvidence: true }),
      ranked({ overture_id: "reachable", ...base, websiteReachable: true }),
    ]);
    expect(result.map((r) => r.overture_id)).toEqual(["pricing", "hours", "reachable", "plain"]);
  });

  it("breaks remaining ties by completeness, then id", () => {
    const result = rankByReadinessPotential([
      ranked({ overture_id: "b", blockerCount: 5, completeness: 0.1 }),
      ranked({ overture_id: "a", blockerCount: 5, completeness: 0.1 }),
      ranked({ overture_id: "c", blockerCount: 5, completeness: 0.4 }),
    ]);
    expect(result.map((r) => r.overture_id)).toEqual(["c", "a", "b"]);
  });

  it("never mutates its inputs", () => {
    const items = [ranked({ overture_id: "b", blockerCount: 9 }), ranked({ overture_id: "a", blockerCount: 3 })];
    const snapshot = JSON.stringify(items);
    rankByReadinessPotential(items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe("renderFollowUpReport", () => {
  it("renders selection, readiness, and top-10 sections", () => {
    const picked = [input({ overture_id: "alpha" }), input({ overture_id: "beta" })];
    const report = renderFollowUpReport(
      { picked, counts: { pool: 170, excluded: 10, picked: 2, areas: { koramangala: 2 }, categories: { Dinner: 2 } } },
      [{ overture_id: "alpha", ready: false, blockers: ["priceMin: missing"] }],
      ["alpha"],
      "2026-08-19.0",
    );
    expect(report).toMatch(/# Glimmr follow-up batch/);
    expect(report).toMatch(/## Selected places/);
    expect(report).toMatch(/## Readiness blockers/);
    expect(report).toMatch(/## Top 10 most likely to become production-ready/);
    expect(report).toContain("alpha");
    expect(report).toContain("priceMin: missing");
  });
});
