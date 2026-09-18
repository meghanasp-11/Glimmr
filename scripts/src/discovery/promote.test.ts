/**
 * Tests for the production-promotion workflow (reviewed places → readiness).
 *
 * Pure unit tests with synthetic reviews — no network, no Firestore, and no
 * real-world facts (fixtures are synthetic).
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  assemblePlace,
  evaluatePromotion,
  promotionReport,
  type ReviewedPlace,
} from "./promote";
import type { ServiceArea } from "../../../artifacts/glimmr/src/schemas/glimmr.schema";

const AREA: ServiceArea = {
  id: "indiranagar",
  name: "Indiranagar",
  city: "Bengaluru",
  active: true,
  bounds: { north: 12.985, south: 12.97, east: 77.645, west: 77.635 },
};

const AREAS = new Map([["indiranagar", AREA]]);

function reviewed(fields: Record<string, { value: unknown; status: "verified" | "curated" | "missing" | "rejected"; source?: string; reason?: string }>): ReviewedPlace {
  return { overture_id: "test-id", service_area: "indiranagar", fields };
}

function fullReview(): ReviewedPlace {
  return reviewed({
    id: { value: "ov-test-id", status: "verified", source: "glimmr" },
    name: { value: "Test Eatery", status: "verified", source: "https://example.com/x" },
    serviceArea: { value: "indiranagar", status: "verified", source: "overture" },
    category: { value: "Dinner", status: "verified", source: "overture" },
    address: { value: "1 Test Rd", status: "verified", source: "https://example.com/x" },
    lat: { value: 12.978, status: "verified", source: "overture" },
    lng: { value: 77.64, status: "verified", source: "overture" },
    priceMin: { value: 100, status: "verified", source: "https://example.com/menu" },
    priceMax: { value: 250, status: "verified", source: "https://example.com/menu" },
    priceBasis: { value: "per_person", status: "verified", source: "https://example.com/menu" },
    openingHours: { value: "9:00 AM - 9:00 PM", status: "verified", source: "https://example.com/hours" },
    typicalVisitDuration: { value: 45, status: "curated", source: "reviewer judgment" },
    suitableFor: { value: ["friends"], status: "curated", source: "reviewer judgment" },
    activities: { value: ["food"], status: "curated", source: "reviewer judgment" },
    vibe: { value: "Lively", status: "curated", source: "reviewer judgment" },
    rating: { value: 4.0, status: "verified", source: "https://example.com/guide" },
    reviewCount: { value: 100, status: "verified", source: "https://example.com/guide" },
    experienceScore: { value: 0.7, status: "curated", source: "reviewer judgment" },
    websiteUrl: { value: "https://example.com/x", status: "verified", source: "https://example.com/x" },
    source: { value: "overture:2026-08-19.0", status: "verified", source: "glimmr" },
    sourceUrl: { value: "https://example.com/verified", status: "verified", source: "https://example.com/verified" },
    verificationStatus: { value: "verified", status: "verified", source: "reviewer check" },
    confidence: { value: 0.9, status: "verified", source: "reviewer check" },
    lastVerified: { value: "2026-09-16", status: "verified", source: "reviewer check" },
  });
}

describe("assemblePlace", () => {
  it("uses only verified/curated values and keeps curated fields manual", () => {
    const place = assemblePlace(fullReview());
    expect(place["priceMin"]).toBe(100);
    expect(place["vibe"]).toBe("Lively");
    expect(place["suitableFor"]).toEqual(["friends"]);
  });

  it("nulls missing/rejected fields instead of inventing them", () => {
    const place = assemblePlace(reviewed({ priceMin: { value: null, status: "missing", reason: "no menu yet" } }));
    expect(place["priceMin"]).toBeNull();
    expect(place["vibe"]).toBeNull();
    expect(place).not.toHaveProperty("description");
  });
});

describe("evaluatePromotion", () => {
  it("promotes a fully verified and curated review", () => {
    const result = evaluatePromotion(fullReview(), AREAS);
    expect(result.problems).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.overture_id).toBe("test-id");
  });

  it("holds incomplete records in review with named problems", () => {
    const partial = fullReview();
    partial.fields["priceMin"] = { value: null, status: "missing", reason: "menu not found" };
    partial.fields["sourceUrl"] = { value: null, status: "missing", reason: "needs a source" };
    const result = evaluatePromotion(partial, AREAS);
    expect(result.ready).toBe(false);
    // Schema errors surface first; production-profile problems follow once
    // the schema passes.
    expect(result.problems.join("\n")).toMatch(/priceMin/);
    const fixed = fullReview();
    fixed.fields["sourceUrl"] = { value: null, status: "missing", reason: "needs a source" };
    const rerun = evaluatePromotion(fixed, AREAS);
    expect(rerun.ready).toBe(false);
    expect(rerun.problems.join("\n")).toMatch(/sourceUrl/);
  });

  it("rejects rejected fields and unknown areas", () => {
    const bad = fullReview();
    bad.fields["name"] = { value: "Wrong Name", status: "rejected", reason: "closed, different venue" };
    const rejected = evaluatePromotion(bad, AREAS);
    expect(rejected.ready).toBe(false);

    const elsewhere = fullReview();
    elsewhere.fields["serviceArea"] = { value: "nowhere", status: "verified", source: "x" };
    const unknown = evaluatePromotion(elsewhere, AREAS);
    expect(unknown.ready).toBe(false);
    expect(unknown.problems.join()).toMatch(/nowhere/);
  });

  it("tracks every field status", () => {
    const result = evaluatePromotion(fullReview(), AREAS);
    expect(result.field_status["priceMin"]).toBe("verified");
    expect(result.field_status["vibe"]).toBe("curated");
    const partial = fullReview();
    delete partial.fields["priceMin"];
    const missing = evaluatePromotion(partial, AREAS);
    expect(missing.field_status["priceMin"]).toBe("missing");
    expect(missing.ready).toBe(false);
  });
});

describe("promotionReport", () => {  it("reports exactly who is ready and why others wait", () => {
    const ready = evaluatePromotion(fullReview(), AREAS);
    const partial = fullReview();
    partial.fields["openingHours"] = { value: null, status: "missing", reason: "hours unclear" };
    const waiting = evaluatePromotion(partial, AREAS);
    const report = promotionReport([ready, waiting]);
    expect(report).toMatch(/1 of 2 reviewed place\(s\) production-ready/);
    expect(report).toMatch(/test-id: passes schema \+ production profile/);
    expect(report).toMatch(/openingHours/);
  });

  it("handles an empty review set", () => {
    expect(promotionReport([])).toMatch(/0 of 0/);
  });

  it("excludes record-level rejections with their reason", () => {
    const closed = fullReview();
    closed.rejected = true;
    closed.rejection_reason = "Permanently closed per official site https://example.com/closed.";
    const result = evaluatePromotion(closed, AREAS);
    expect(result.ready).toBe(false);
    expect(result.rejected).toBe(true);
    expect(result.place).toBeNull();
    const report = promotionReport([result]);
    expect(report).toMatch(/0 of 1 reviewed place\(s\) production-ready, 1 rejected and excluded/);
    expect(report).toMatch(/Rejected — excluded from promotion/);
    expect(report).toMatch(/Permanently closed/);
  });
});
