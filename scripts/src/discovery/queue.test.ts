/**
 * Tests for the verification queue builder (coverage, reasons, guidance).
 *
 * Pure unit tests with fixture records — no network, no Firestore, and no
 * real-world facts (fixtures are synthetic).
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import { buildQueue, QUEUE_SIZE, sourceGuidanceFor, type QueueInput } from "./queue";

function input(overrides: Partial<QueueInput> = {}): QueueInput {
  return {
    overture_id: "test-id",
    service_area: "indiranagar",
    name: "Test Place",
    lat: 12.978,
    lng: 77.64,
    glimmr_category: "Dinner",
    websites: [],
    operating_status: null,
    confidence: 0.5,
    provenance: { sources: [{ dataset: "meta" }], overture_release: "2026-08-19.0" },
    verification_rank: 1,
    verification_score: 100,
    verification_reasons: ["Dinner (core outing category)"],
    ...overrides,
  };
}

const NEEDS = ["priceMin", "sourceUrl", "verificationStatus"];

describe("sourceGuidanceFor", () => {
  it("prefers the official website when on file", () => {
    const result = sourceGuidanceFor({ websites: ["https://example.com/x"], sources: [] });
    expect(result.guidance).toBe("official-website");
    expect(result.detail).toContain("https://example.com/x");
  });

  it("falls back to another public source, then unknown", () => {
    expect(sourceGuidanceFor({ websites: [], sources: [{ dataset: "meta" }] }).guidance).toBe("public-source");
    expect(sourceGuidanceFor({ websites: [], sources: [] }).guidance).toBe("unknown");
  });
});

describe("buildQueue", () => {
  it("selects top ranks with explicit reasons and needs lists", () => {
    const drafts = new Map([["a", NEEDS], ["b", NEEDS]]);
    const { queue, counts } = buildQueue(
      [
        input({ overture_id: "a", verification_rank: 2, verification_score: 90 }),
        input({ overture_id: "b", verification_rank: 1, verification_score: 120 }),
      ],
      drafts,
      10,
    );
    expect(counts).toMatchObject({ pool: 2, queued: 2 });
    expect(queue[0].overture_id).toBe("b");
    expect(queue[0].queue_rank).toBe(1);
    expect(queue[0].priority_reason).toContain("Shortlist #1");
    expect(queue[0].needs_verification).toEqual(NEEDS);
    expect(queue[0].place_draft_id).toBe("ov-b");
    for (const invented of ["priceMin", "openingHours", "vibe", "rating", "experienceScore"]) {
      expect(queue[0]).not.toHaveProperty(invented);
    }
  });

  it("keeps all areas and categories represented", () => {
    const rows: QueueInput[] = [];
    const areas = ["indiranagar", "koramangala", "church-street"];
    const cats = ["Dinner", "Cafe", "Activity", "Drinks", "Culture", "Dessert", "Outdoor"];
    let rank = 1;
    for (const area of areas) {
      for (const cat of cats) {
        rows.push(
          input({
            overture_id: `${area}-${cat}`,
            service_area: area,
            glimmr_category: cat,
            verification_rank: rank,
            verification_score: 200 - rank,
          }),
        );
        rank += 1;
      }
    }
    const drafts = new Map(rows.map((r) => [r.overture_id, NEEDS] as [string, string[]]));
    const { queue, counts } = buildQueue(rows, drafts, 40);
    expect(queue).toHaveLength(21);
    expect(Object.keys(counts.areas).sort()).toEqual([...areas].sort());
    expect(Object.keys(counts.categories).sort()).toEqual([...cats].sort());
    // Rank order preserved in output.
    for (let i = 1; i < queue.length; i += 1) {
      expect(queue[i - 1].queue_rank).toBeLessThan(queue[i].queue_rank);
    }
  });

  it("never admits unmapped or invalid records", () => {
    const drafts = new Map<string, string[]>();
    const { queue, counts } = buildQueue(
      [
        input({ overture_id: "u", glimmr_category: null }),
        input({ overture_id: "bad", lat: Number.NaN }),
        input({ overture_id: "ok" }),
      ],
      drafts,
      10,
    );
    expect(counts.pool).toBe(3);
    expect(queue.map((q) => q.overture_id)).toEqual(["ok"]);
  });

  it("does not mutate its inputs", () => {
    const rows = [input({ overture_id: "a" }), input({ overture_id: "b" })];
    const snapshot = JSON.parse(JSON.stringify(rows)) as unknown;
    buildQueue(rows, new Map([["a", NEEDS], ["b", NEEDS]]), 10);
    expect(rows).toEqual(snapshot);
  });

  it("handles empty input and defaults to a 40-place queue", () => {
    expect(buildQueue([], new Map(), 10).queue).toEqual([]);
    expect(QUEUE_SIZE).toBe(40);
  });
});
