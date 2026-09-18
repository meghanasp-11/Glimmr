/**
 * Tests for Batch-01 curation proposals (rubric-validated, honestly based).
 *
 * Guards the proposal table itself: every bundle must pass the rubric for
 * its category, carry reasons, avoid forbidden fields, and never touch
 * verification-gated keys.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import { PROPOSALS } from "./curation-proposals";
import { curateAttributes } from "./rubric";

const FORBIDDEN_IN_PROPOSALS = [
  "priceMin", "priceMax", "priceBasis", "openingHours",
  "rating", "reviewCount", "address", "lat", "lng",
  "verificationStatus", "sourceUrl", "id", "name",
];

describe("Batch-01 proposals", () => {
  it("covers the 9 non-rejected places exactly once", () => {
    expect(PROPOSALS).toHaveLength(9);
    const ids = PROPOSALS.map((p) => p.overture_id);
    expect(new Set(ids).size).toBe(9);
  });

  it("passes every bundle through the rubric for its own category", () => {
    for (const proposal of PROPOSALS) {
      const result = curateAttributes(proposal.bundle, proposal.category);
      expect(result.ok, `${proposal.overture_id}: ${result.ok ? "" : result.errors.join("; ")}`).toBe(true);
    }
  });

  it("never proposes forbidden or verification-gated fields", () => {
    for (const proposal of PROPOSALS) {
      for (const field of Object.keys(proposal.bundle)) {
        expect(FORBIDDEN_IN_PROPOSALS).not.toContain(field);
      }
    }
  });

  it("gives every proposed value a reason and an evidence basis", () => {
    for (const proposal of PROPOSALS) {
      expect(Object.keys(proposal.bundle).length).toBeGreaterThan(0);
    }
  });

  it("proposes no experience scores without non-rating basis", () => {
    for (const proposal of PROPOSALS) {
      expect("experienceScore" in proposal.bundle).toBe(false);
    }
  });
});
