/**
 * Tests for the verification pipeline (drafts, unknown markers, checklists).
 *
 * Pure unit tests with fixture records — no network, no Firestore, and no
 * real-world facts (fixtures are synthetic).
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  draftVerification,
  evaluateDraftFields,
  REQUIRED_DRAFT_FIELDS,
  type ShortlistRecord,
} from "./verify";

function shortlisted(overrides: Partial<ShortlistRecord> = {}): ShortlistRecord {
  return {
    overture_id: "test-overture-1",
    service_area: "indiranagar",
    name: "Test Eatery",
    address_freeform: "1 Test Rd",
    locality: "Bengaluru",
    lat: 12.978,
    lng: 77.64,
    glimmr_category: "Dinner",
    overture_primary: "indian_restaurant",
    overture_basic: "restaurant",
    taxonomy_primary: "restaurant",
    websites: ["https://example.com/x"],
    operating_status: null,
    confidence: 0.8,
    provenance: { sources: [{ property: "", dataset: "meta" }], overture_release: "2026-08-19.0" },
    ...overrides,
  };
}

describe("draftVerification", () => {
  it("maps every Place field with source-verified facts separated from unknowns", () => {
    const draft = draftVerification(shortlisted());
    expect(draft.overture_id).toBe("test-overture-1");
    expect(draft.verification_status).toBe("pending");
    expect(draft.production_ready).toBe(false);

    // Source-verified facts keep their values and provenance.
    expect(draft.place_draft["name"]).toBe("Test Eatery");
    expect(draft.field_sources["name"]).toBe("overture");
    expect(draft.place_draft["lat"]).toBe(12.978);
    expect(draft.place_draft["category"]).toBe("Dinner");
    expect(draft.place_draft["websiteUrl"]).toBe("https://example.com/x");
    expect(draft.place_draft["confidence"]).toBe(0.8);
    expect(draft.place_draft["source"]).toBe("overture:2026-08-19.0");

    // Curated attributes are explicit nulls, never fabrications.
    for (const field of [
      "priceMin", "priceMax", "priceBasis", "openingHours", "typicalVisitDuration",
      "vibe", "experienceScore", "rating", "reviewCount",
    ]) {
      expect(draft.place_draft[field]).toBeNull();
      expect(draft.field_sources[field]).toBe("unknown");
    }
    expect(draft.place_draft["suitableFor"]).toEqual([]);
    expect(draft.place_draft["activities"]).toEqual([]);
    expect(draft.place_draft["verificationStatus"]).toBe("unverified");
    expect(draft.place_draft["sourceUrl"]).toBeNull();
    expect(draft.place_draft["lastVerified"]).toBeNull();
  });

  it("tracks incomplete fields blocking production readiness", () => {
    const draft = draftVerification(shortlisted());
    for (const field of ["priceMin", "priceMax", "openingHours", "sourceUrl", "lastVerified"]) {
      expect(draft.incomplete_fields).toContain(field);
    }
    // Sourced facts are not blockers.
    for (const field of ["id", "name", "serviceArea", "category", "address", "lat", "lng"]) {
      expect(draft.incomplete_fields).not.toContain(field);
    }
    // verificationStatus stays a blocker until a human flips it to verified.
    expect(draft.incomplete_fields).toContain("verificationStatus");
  });

  it("requires sourceUrl, verificationStatus, confidence, and lastVerified", () => {
    const draft = draftVerification(shortlisted());
    expect(draft.incomplete_fields).toEqual(
      expect.arrayContaining(["sourceUrl", "verificationStatus", "lastVerified"]),
    );
    // Overture confidence counts as sourced provenance.
    expect(draft.incomplete_fields).not.toContain("confidence");
  });

  it("preserves Overture provenance untouched", () => {
    const draft = draftVerification(shortlisted());
    expect(draft.provenance).toEqual({
      overture_release: "2026-08-19.0",
      overture_confidence: 0.8,
      sources: [{ property: "", dataset: "meta" }],
    });
  });

  it("derives stable ids without touching raw data", () => {
    const a = draftVerification(shortlisted({ overture_id: "abc" }));
    const b = draftVerification(shortlisted({ overture_id: "abc" }));
    expect(a.place_draft["id"]).toBe(b.place_draft["id"]);
    expect(a.place_draft["id"]).toContain("abc");
  });
});

describe("evaluateDraftFields", () => {
  it("marks a fully enriched draft production-ready", () => {
    const draft = draftVerification(shortlisted());
    const enriched: Record<string, unknown> = {
      ...draft.place_draft,
      priceMin: 100,
      priceMax: 250,
      priceBasis: "per_person",
      openingHours: "9:00 AM - 9:00 PM",
      typicalVisitDuration: 45,
      suitableFor: ["friends"],
      activities: ["food"],
      vibe: "Lively",
      experienceScore: 0.7,
      sourceUrl: "https://example.com/verified",
      verificationStatus: "verified",
      lastVerified: "2026-09-16",
    };
    const result = evaluateDraftFields(enriched);
    expect(result.incomplete_fields).toEqual([]);
    expect(result.production_ready).toBe(true);
  });

  it("covers every required draft field in the checklist", () => {
    const fields = evaluateDraftFields(draftVerification(shortlisted()).place_draft).checklist.map(
      (item) => item.field,
    );
    for (const required of REQUIRED_DRAFT_FIELDS) {
      expect(fields).toContain(required);
    }
  });
});
