/**
 * Tests for the Batch-02 top-10 venue identity audit.
 *
 * Pure functions with synthetic fixtures (no network, no Firestore, no
 * production data). Covers: conflicting names, verified identity bar,
 * branch separation without evidence merging, rename preservation,
 * explicit review cases, separate-entity checks, bounds reasoning, and
 * markdown coverage. Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  auditIdentity,
  buildIdentityAudit,
  renderIdentityAuditMd,
  type IdentityRecordInput,
} from "./identity-audit";

const BOUNDS = {
  koramangala: { north: 12.945, south: 12.925, east: 77.625, west: 77.61 },
};

function record(overrides: Partial<IdentityRecordInput> = {}): IdentityRecordInput {
  return {
    overture_id: "ov-1",
    name: "Test Eatery",
    service_area: "koramangala",
    nameStatus: "verified",
    nameValue: "Test Eatery",
    addressValue: "1 Test Rd",
    addressStatus: "verified",
    latValue: 12.935,
    latStatus: "verified",
    lngValue: 77.618,
    lngStatus: "verified",
    websiteUrl: "https://testeatery.example/",
    websiteReachable: true,
    pageTitle: "Test Eatery — Official Site",
    flags: [],
    ...overrides,
  };
}

describe("auditIdentity verdicts", () => {
  it("marks conflicting names as conflicting with cited evidence", () => {
    const finding = auditIdentity(
      record({ nameStatus: "conflicting", pageTitle: "Home" }),
      { boundsByArea: BOUNDS, peers: [], separateFrom: [], explicitReview: false, reviewNotes: [] },
    );
    expect(finding.verdict).toBe("conflicting");
    expect(finding.reasons.join(" ")).toMatch(/Home/);
    expect(finding.overture_name).toBe("Test Eatery");
  });

  it("marks fully corroborated identity as verified", () => {
    const finding = auditIdentity(record(), {
      boundsByArea: BOUNDS,
      peers: [],
      separateFrom: [],
      explicitReview: false,
    });
    expect(finding.verdict).toBe("verified");
  });

  it("keeps unconfirmed pins at needs_manual_review, never verified", () => {
    const finding = auditIdentity(
      record({ latStatus: "needs_manual_review", lngStatus: "needs_manual_review" }),
      { boundsByArea: BOUNDS, peers: [], separateFrom: [], explicitReview: false, reviewNotes: [] },
    );
    expect(finding.verdict).toBe("needs_manual_review");
    expect(finding.reasons.join(" ")).toMatch(/pin|coordinate/i);
  });

  it("marks out-of-bounds coordinates as conflicting", () => {
    const finding = auditIdentity(
      record({ latValue: 13.5, lngValue: 77.9 }),
      { boundsByArea: BOUNDS, peers: [], separateFrom: [], explicitReview: false, reviewNotes: [] },
    );
    expect(finding.verdict).toBe("conflicting");
    expect(finding.reasons.join(" ")).toMatch(/outside|bounds/);
  });

  it("marks missing coordinates as needs_manual_review without inventing them", () => {
    const finding = auditIdentity(
      record({ latValue: null, lngValue: null }),
      { boundsByArea: BOUNDS, peers: [], separateFrom: [], explicitReview: false, reviewNotes: [] },
    );
    expect(finding.verdict).toBe("needs_manual_review");
    expect(finding.coordinates.lat).toBeNull();
    expect(finding.coordinates.lng).toBeNull();
  });
});

describe("auditIdentity branches and renames", () => {
  it("treats chain peers as separate entities citing only their own source", () => {
    const finding = auditIdentity(
      record({ name: "Test Eatery | Mall Outlet", websiteUrl: "https://testeatery.example/mall" }),
      {
        boundsByArea: BOUNDS,
        peers: [{ overture_id: "ov-2", name: "Test Eatery | Downtown" }],
        separateFrom: [],
        explicitReview: false,
      },
    );
    const note = finding.branch_notes.join(" ");
    expect(note).toMatch(/ov-2/);
    expect(note).toMatch(/separate/i);
    expect(note).not.toMatch(/Downtown.*merged|merged.*Downtown/i);
    expect(finding.sources.website_url).toBe("https://testeatery.example/mall");
  });

  it("flags rename history while preserving the original Overture name", () => {
    const finding = auditIdentity(
      record({ name: "New Hall (Previously Old Hall)" }),
      { boundsByArea: BOUNDS, peers: [], separateFrom: [], explicitReview: false, reviewNotes: [] },
    );
    expect(finding.overture_name).toBe("New Hall (Previously Old Hall)");
    expect(finding.reasons.join(" ")).toMatch(/rename|previously/i);
  });

  it("keeps a record separate when its own source shows no link to the other entity", () => {
    const finding = auditIdentity(
      record({ name: "Other Rooms", pageTitle: "Home", websiteUrl: "https://otherrooms.example/" }),
      {
        boundsByArea: BOUNDS,
        peers: [],
        separateFrom: [{ overture_id: "ov-x", name: "The Amazing Place" }],
        explicitReview: false,
      },
    );
    expect(finding.separate_entity_notes.join(" ")).toMatch(/ov-x/);
    expect(finding.separate_entity_notes.join(" ")).toMatch(/separate/i);
  });
});

describe("auditIdentity explicit review", () => {
  it("annotates explicit review cases without changing verdict math", () => {
    const plain = auditIdentity(record(), { boundsByArea: BOUNDS, peers: [], separateFrom: [], explicitReview: false, reviewNotes: [] });
    const focused = auditIdentity(record(), { boundsByArea: BOUNDS, peers: [], separateFrom: [], explicitReview: true, reviewNotes: [] });
    expect(focused.verdict).toBe(plain.verdict);
    expect(focused.explicit_review).toBe(true);
    expect(plain.explicit_review).toBe(false);
  });
});

describe("auditIdentity review notes", () => {
  it("carries reviewer directions through to finding and markdown", () => {
    const audit = buildIdentityAudit(
      ["a"],
      { a: record({ overture_id: "a" }) },
      {
        boundsByArea: BOUNDS,
        peersById: {},
        separateById: {},
        explicitIds: new Set(["a"]),
        notesById: { a: ["Confirm Brigade Road entity separately from the area assignment."] },
      },
    );
    expect(audit.places[0].review_notes).toEqual([
      "Confirm Brigade Road entity separately from the area assignment.",
    ]);
    const md = renderIdentityAuditMd(audit, "2026-08-19.0");
    expect(md).toContain("Review direction: Confirm Brigade Road entity separately from the area assignment.");
  });
});

describe("buildIdentityAudit", () => {
  it("audits every record in top-10 order with ranks", () => {
    const audit = buildIdentityAudit(
      ["a", "b"],
      {
        a: record({ overture_id: "a" }),
        b: record({ overture_id: "b", nameStatus: "conflicting" }),
      },
      { boundsByArea: BOUNDS, peersById: {}, separateById: {}, explicitIds: new Set(["b"]) },
    );
    expect(audit.places.map((p) => p.overture_id)).toEqual(["a", "b"]);
    expect(audit.places.map((p) => p.rank)).toEqual([1, 2]);
    expect(audit.counts).toMatchObject({ total: 2, verified: 1, conflicting: 1, needs_manual_review: 0 });
  });

  it("throws on a top-10 id with no record instead of inventing one", () => {
    expect(() =>
      buildIdentityAudit(["ghost"], {}, { boundsByArea: BOUNDS, peersById: {}, separateById: {}, explicitIds: new Set() }),
    ).toThrow(/ghost/);
  });
});

describe("renderIdentityAuditMd", () => {
  it("covers every record with evidence and recommended action", () => {
    const audit = buildIdentityAudit(
      ["a"],
      { a: record({ overture_id: "a" }) },
      { boundsByArea: BOUNDS, peersById: {}, separateById: {}, explicitIds: new Set() },
    );
    const md = renderIdentityAuditMd(audit, "2026-08-19.0");
    expect(md).toContain("# Batch-02 top-10 venue identity audit");
    expect(md).toContain("Test Eatery");
    expect(md).toContain("Recommended action");
  });
});
