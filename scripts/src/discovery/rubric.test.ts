/**
 * Tests for the enrichment rubric (rules, vocabularies, guarantees).
 *
 * Pure unit tests on synthetic proposals — the rubric is never applied to
 * real places here (see req: synthetic test records first).
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  ACTIVITY_TAG_SET,
  DURATION_BANDS,
  SUITABLE_FOR_SET,
  curateAttributes,
  estimateDuration,
} from "./rubric";

const REASON = "Curator judgment from the official menu and format page.";

function validBundle() {
  return {
    typicalVisitDuration: { value: 60, reason: REASON },
    activities: { values: ["food", "coffee"], reason: REASON },
    suitableFor: { values: ["friends", "family"], reason: REASON },
    vibe: { value: "Lively and unhurried", reason: REASON },
    experienceScore: { value: 0.7, reason: REASON, basis: ["craft", "ambience"] },
  };
}

describe("estimateDuration", () => {
  it("returns band midpoints per category and null when unknown", () => {
    expect(estimateDuration("Dinner")).toBe(DURATION_BANDS["Dinner"].typical);
    expect(estimateDuration("Cafe")).toBe(DURATION_BANDS["Cafe"].typical);
    expect(estimateDuration("Nope")).toBeNull();
  });
});

describe("curateAttributes", () => {
  it("accepts a valid synthetic bundle with curated statuses", () => {
    const result = curateAttributes(validBundle(), "Dinner");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.curated.typicalVisitDuration).toMatchObject({ value: 60, status: "curated" });
    expect(result.curated.activities).toMatchObject({ value: ["food", "coffee"], status: "curated" });
    expect(result.curated.suitableFor).toMatchObject({ value: ["friends", "family"], status: "curated" });
    expect(result.curated.vibe).toMatchObject({ value: "Lively and unhurried", status: "curated" });
    expect(result.curated.experienceScore).toMatchObject({ value: 0.7, status: "curated" });
  });

  it("requires an explicit reason for every attribute", () => {
    for (const field of ["typicalVisitDuration", "activities", "suitableFor", "vibe", "experienceScore"] as const) {
      const bundle = validBundle() as Record<string, unknown>;
      const entry = { ...(bundle[field] as Record<string, unknown>), reason: "x" };
      const result = curateAttributes({ [field]: entry }, "Dinner");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join()).toMatch(/reason/);
    }
  });

  it("rejects ratings and popularity as an experience-score basis", () => {
    for (const basis of [["high rating"], ["review count"], ["popular spot"]]) {
      const result = curateAttributes(
        { experienceScore: { value: 0.9, reason: "Loved by many visitors here.", basis } },
        "Cafe",
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join()).toMatch(/ratings/);
    }
    const sneaky = curateAttributes(
      { experienceScore: { value: 0.9, reason: "Top rated destination.", basis: ["craft"] } },
      "Cafe",
    );
    expect(sneaky.ok).toBe(false);
  });

  it("rejects out-of-range scores and bad vocabularies", () => {
    expect(
      curateAttributes({ experienceScore: { value: 1.5, reason: REASON, basis: ["craft"] } }, "Cafe").ok,
    ).toBe(false);
    expect(
      curateAttributes({ activities: { values: ["skydiving"], reason: REASON } }, "Cafe").ok,
    ).toBe(false);
    expect(
      curateAttributes({ suitableFor: { values: ["pets"], reason: REASON } }, "Cafe").ok,
    ).toBe(false);
    expect(curateAttributes({ vibe: { value: "", reason: REASON } }, "Cafe").ok).toBe(false);
    expect(
      curateAttributes({ typicalVisitDuration: { value: -5, reason: REASON } }, "Cafe").ok,
    ).toBe(false);
  });

  it("holds durations to the planning band without an official source", () => {
    const over = curateAttributes({ typicalVisitDuration: { value: 180, reason: REASON } }, "Cafe");
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.join()).toMatch(/planning band/);
    const sourced = curateAttributes(
      {
        typicalVisitDuration: {
          value: 60,
          reason: "Official 60-minute game format.",
          officialSource: "https://example.com/format",
        },
      },
      "Activity",
    );
    expect(sourced.ok).toBe(true);
  });

  it("cannot bypass verification-gated fields", () => {
    for (const field of ["verificationStatus", "sourceUrl", "lastVerified", "id", "name", "priceMin"]) {
      const result = curateAttributes({ [field]: { value: "x", reason: REASON } }, "Cafe");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join()).toMatch(/cannot be curated|verification-gated/);
    }
  });

  it("keeps vocabularies aligned with schema and engine", () => {
    expect(SUITABLE_FOR_SET.has("solo")).toBe(true);
    expect(ACTIVITY_TAG_SET.has("coffee")).toBe(true);
    expect(ACTIVITY_TAG_SET.has("food")).toBe(true);
  });
});
