/**
 * Tests for hand-applying rubric-validated curation into review files.
 *
 * Guardrails under test: only missing fields receive curated values;
 * verified, already-curated, and human-rejected values are never
 * overwritten; verification-gated keys are refused even if proposed; and
 * record-level rejected reviews are left entirely alone.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import { applyCuratedEntries, type ReviewLike } from "./apply-curation";

function review(fields: Record<string, { value: unknown; status: string; source?: string; reason?: string }>): ReviewLike {
  return { overture_id: "test-place", service_area: "koramangala", fields };
}

const CURATED = (value: unknown, source = "rubric v1 — test reason") => ({ value, source });

describe("applyCuratedEntries", () => {
  it("fills missing fields with curated value, status, and source", () => {
    const result = applyCuratedEntries(
      review({ vibe: { value: null, status: "missing", reason: "not yet known" } }),
      { vibe: CURATED("Cozy corners") },
    );
    expect(result.applied).toEqual(["vibe"]);
    expect(result.skipped).toEqual([]);
  });

  it("never overwrites a verified value", () => {
    const before = review({
      address: { value: "1 Real Rd", status: "verified", source: "https://example.com" },
    });
    const result = applyCuratedEntries(before, {
      address: CURATED("2 Fake Rd"),
    } as never);
    expect(result.applied).toEqual([]);
    expect(result.skipped.map((s) => s.field)).toEqual(["address"]);
    expect(before.fields["address"].value).toBe("1 Real Rd");
  });

  it("never overwrites an already-curated value", () => {
    const before = review({
      vibe: { value: "Old vibe", status: "curated", source: "rubric v1 — earlier pass" },
    });
    const result = applyCuratedEntries(before, { vibe: CURATED("New vibe") });
    expect(result.applied).toEqual([]);
    expect(before.fields["vibe"].value).toBe("Old vibe");
  });

  it("leaves human-rejected fields alone", () => {
    const before = review({
      verificationStatus: { value: "unverified", status: "rejected", reason: "closed venue" },
    });
    const result = applyCuratedEntries(before, {
      verificationStatus: CURATED("verified"),
    } as never);
    expect(result.applied).toEqual([]);
    expect(before.fields["verificationStatus"].status).toBe("rejected");
  });

  it("refuses verification-gated keys even when proposed", () => {
    const before = review({
      priceMin: { value: null, status: "missing", reason: "no menu yet" },
      lat: { value: null, status: "missing", reason: "not confirmed" },
    });
    const result = applyCuratedEntries(before, {
      priceMin: CURATED(100),
      lat: CURATED(12.97),
    } as never);
    expect(result.applied).toEqual([]);
    expect(before.fields["priceMin"].value).toBeNull();
    expect(before.fields["lat"].value).toBeNull();
  });

  it("skips record-level rejected reviews entirely", () => {
    const before: ReviewLike = {
      overture_id: "closed-place",
      service_area: "koramangala",
      rejected: true,
      fields: {
        vibe: { value: null, status: "missing", reason: "not yet known" },
      },
    };
    const result = applyCuratedEntries(before, { vibe: CURATED("Nice") });
    expect(result.applied).toEqual([]);
    expect(before.fields["vibe"].status).toBe("missing");
  });

  it("skips curated entries for fields absent from the review", () => {
    const result = applyCuratedEntries(review({}), { vibe: CURATED("Nice") });
    expect(result.applied).toEqual([]);
    expect(result.skipped.map((s) => s.field)).toEqual(["vibe"]);
  });
});
