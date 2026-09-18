/**
 * Tests for the recommendation-ready profile (engine-grounded, additive).
 *
 * Pure unit tests with synthetic reviews — no network, no Firestore, and no
 * real-world facts (fixtures are synthetic). Also guards that the existing
 * production validator is untouched.
 * Run with: npm run test -w @glimmr/scripts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
  evaluateRecommendationReadiness,
  readinessReport,
  type ReviewInput,
} from "./readiness";
import type { ServiceArea } from "../../../artifacts/glimmr/src/schemas/glimmr.schema";

const AREA: ServiceArea = {
  id: "indiranagar",
  name: "Indiranagar",
  city: "Bengaluru",
  active: true,
  bounds: { north: 12.985, south: 12.97, east: 77.645, west: 77.635 },
};

const AREAS = new Map([["indiranagar", AREA]]);

function field(value: unknown, status: "verified" | "curated" | "missing" | "rejected" = "verified") {
  return { value, status };
}

function readyReview(): ReviewInput {
  return {
    overture_id: "synthetic-1",
    service_area: "indiranagar",
    fields: {
      id: field("synthetic-1"),
      name: field("Synthetic Eatery"),
      serviceArea: field("indiranagar"),
      category: field("Dinner"),
      address: field("1 Test Rd"),
      lat: field(12.978),
      lng: field(77.64),
      priceMin: field(100),
      priceMax: field(250),
      priceBasis: field("per_person"),
      openingHours: field("9:00 AM - 9:00 PM"),
      typicalVisitDuration: field(60),
      activities: field(["food"]),
      suitableFor: field(["friends"]),
      vibe: field("Lively", "curated"),
      experienceScore: field(0.7, "curated"),
      sourceUrl: field("https://example.com/verified"),
      verificationStatus: field("verified"),
      confidence: field(0.9),
      lastVerified: field("2026-09-16"),
    },
  };
}

describe("readiness profile shape", () => {
  it("requires the engine-critical set from the task", () => {
    for (const field of [
      "id", "name", "serviceArea", "category", "address", "lat", "lng",
      "priceMin", "priceMax", "priceBasis", "openingHours", "typicalVisitDuration",
      "activities", "suitableFor", "vibe", "experienceScore",
      "sourceUrl", "verificationStatus", "confidence", "lastVerified",
    ]) {
      expect(REQUIRED_FIELDS).toContain(field);
    }
  });

  it("keeps rating, reviewCount, description, subcategory, and mapsUrl optional", () => {
    expect([...OPTIONAL_FIELDS].sort()).toEqual(
      ["description", "mapsUrl", "rating", "reviewCount", "subcategory"].sort(),
    );
  });

  it("leaves the existing production validator untouched", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "..", "place-import.ts"), "utf8");
    for (const marker of ["evaluateRecommendationReadiness", "readinessReport", "REQUIRED_FIELDS", "ReadinessResult"]) {
      expect(source).not.toContain(marker);
    }
  });
});

describe("evaluateRecommendationReadiness", () => {
  it("marks a complete verified-or-curated review ready", () => {
    const result = evaluateRecommendationReadiness(readyReview(), AREAS);
    expect(result.blockers).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.fields["vibe"].origin).toBe("curated");
    expect(result.fields["name"].origin).toBe("verified");
  });

  it("blocks on missing values without filling them", () => {
    const review = readyReview();
    review.fields["priceMin"] = { value: null, status: "missing" };
    const result = evaluateRecommendationReadiness(review, AREAS);
    expect(result.ready).toBe(false);
    expect(result.blockers.join()).toMatch(/priceMin/);
  });

  it("blocks on unparseable hours, bad basis, and inverted ranges", () => {
    const hours = readyReview();
    hours.fields["openingHours"] = { value: "Call ahead", status: "verified" };
    expect(evaluateRecommendationReadiness(hours, AREAS).blockers.join()).toMatch(/openingHours/);

    const basis = readyReview();
    basis.fields["priceBasis"] = { value: "per_visit", status: "verified" };
    expect(evaluateRecommendationReadiness(basis, AREAS).blockers.join()).toMatch(/priceBasis/);

    const inverted = readyReview();
    inverted.fields["priceMax"] = { value: 50, status: "verified" };
    expect(evaluateRecommendationReadiness(inverted, AREAS).blockers.join()).toMatch(/priceMax/);
  });

  it("blocks on unverified status and out-of-bounds coordinates", () => {
    const status = readyReview();
    status.fields["verificationStatus"] = { value: "unverified", status: "verified" };
    expect(evaluateRecommendationReadiness(status, AREAS).blockers.join()).toMatch(/verificationStatus/);

    const coords = readyReview();
    coords.fields["lat"] = { value: 13.5, status: "verified" };
    expect(evaluateRecommendationReadiness(coords, AREAS).blockers.join()).toMatch(/coordinates/);
  });

  it("never blocks on rating, reviewCount, description, subcategory, or mapsUrl", () => {
    const review = readyReview();
    for (const field of OPTIONAL_FIELDS) {
      expect(review.fields[field]).toBeUndefined();
    }
    const result = evaluateRecommendationReadiness(review, AREAS);
    expect(result.ready).toBe(true);
    for (const field of OPTIONAL_FIELDS) {
      expect(result.fields[field].status).toBe("optional");
    }
  });
});

describe("readinessReport", () => {
  it("reports who is ready and why others wait", () => {
    const ok = evaluateRecommendationReadiness(readyReview(), AREAS);
    const bad = readyReview();
    bad.overture_id = "synthetic-2";
    bad.fields["vibe"] = { value: "", status: "curated" };
    const waiting = evaluateRecommendationReadiness(bad, AREAS);
    const report = readinessReport([ok, waiting]);
    expect(report).toMatch(/1 of 2 place\(s\) recommendation-ready/);
    expect(report).toMatch(/synthetic-1 — READY/);
    expect(report).toMatch(/synthetic-2 — NOT READY/);
    expect(report).toMatch(/vibe/);
  });
});
