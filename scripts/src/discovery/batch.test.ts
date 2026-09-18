/**
 * Tests for the manual verification batch builder.
 *
 * Pure unit tests with fixture dossier records — no network, no Firestore,
 * and no real-world facts (fixtures are synthetic).
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  BATCH_SIZE,
  dossierToReview,
  renderBatchReport,
  selectBatch,
  type DossierRecordInput,
} from "./batch";

function dossierField(value: unknown, status: "verified" | "missing" | "conflicting" | "needs_manual_review", flags: string[] = []) {
  return {
    value,
    status,
    flags,
    note: "test",
    evidence: { website: { url: "https://example.com/x", reachable: true, page_title: "Test" } },
  };
}

function dossierRecord(overrides: Partial<DossierRecordInput> = {}): DossierRecordInput {
  return {
    overture_id: "test-id",
    service_area: "indiranagar",
    name: "Test Eatery",
    dossier_rank: 1,
    completeness: 0.2,
    flags: [],
    fields: {
      id: dossierField("ov-test-id", "verified"),
      name: dossierField("Test Eatery", "verified"),
      serviceArea: dossierField("indiranagar", "needs_manual_review"),
      category: dossierField("Dinner", "needs_manual_review"),
      address: dossierField("1 Test Rd", "verified"),
      lat: dossierField(12.978, "needs_manual_review"),
      lng: dossierField(77.64, "needs_manual_review"),
      priceMin: dossierField(null, "missing"),
      openingHours: dossierField(null, "missing"),
      vibe: dossierField(null, "missing"),
      websiteUrl: dossierField("https://example.com/x", "verified"),
      verificationStatus: dossierField("unverified", "needs_manual_review"),
      confidence: dossierField(0.8, "verified"),
      sourceUrl: dossierField(null, "missing"),
      lastVerified: dossierField(null, "missing"),
    },
    provenance: {
      overture_release: "2026-08-19.0",
      sources: [],
      evidence_source_url: "https://example.com/x",
      evidence_fetched_at: "2026-09-16T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("dossierToReview", () => {
  it("preserves verified values with cited sources", () => {
    const file = dossierToReview(dossierRecord());
    expect(file.overture_id).toBe("test-id");
    expect(file.dossier_rank).toBe(1);
    expect(file.fields["name"]).toMatchObject({ value: "Test Eatery", status: "verified" });
    expect(file.fields["name"].source).toContain("https://example.com/x");
    expect(file.fields["address"].status).toBe("verified");
    expect(file.evidence.source_url).toBe("https://example.com/x");
    expect(file.evidence.page_title).toBe("Test");
    expect(file.evidence.website_reachable).toBe(true);
  });

  it("leaves curated attributes missing and uncorroborated values unclaimed", () => {
    const file = dossierToReview(dossierRecord());
    for (const field of ["priceMin", "openingHours", "vibe"]) {
      expect(file.fields[field].value).toBeNull();
      expect(file.fields[field].status).toBe("missing");
      expect(file.fields[field].reason).toMatch(/Not verified yet/);
    }
    // Present-but-uncorroborated values are not smuggled in as verified.
    expect(file.fields["lat"].value).toBeNull();
    expect(file.fields["lat"].status).toBe("missing");
    expect(file.fields["lat"].reason).toMatch(/12\.978/);
    expect(file.fields["category"].value).toBeNull();
  });

  it("turns conflicts into missing-with-reason, never into facts", () => {
    const record = dossierRecord({
      fields: {
        name: dossierField("Test Eatery", "conflicting", ["title-mismatch"]),
      },
    });
    const file = dossierToReview(record);
    expect(file.fields["name"].value).toBeNull();
    expect(file.fields["name"].status).toBe("missing");
    expect(file.fields["name"].reason).toMatch(/conflicting.*title-mismatch/);
  });

  it("never carries empty curated values as verified", () => {
    const record = dossierRecord({
      fields: {
        suitableFor: dossierField([], "needs_manual_review"),
        activities: dossierField([], "needs_manual_review"),
        vibe: dossierField(null, "missing"),
      },
    });
    const file = dossierToReview(record);
    for (const field of ["suitableFor", "activities", "vibe"]) {
      expect(file.fields[field].value === null || file.fields[field].value).toBeTruthy;
      expect(file.fields[field].status).toBe("missing");
    }
    expect(file.fields["suitableFor"].value).toBeNull();
    expect(file.fields["activities"].value).toBeNull();
  });

  it("does not mutate its input", () => {
    const record = dossierRecord();
    const snapshot = JSON.parse(JSON.stringify(record)) as unknown;
    dossierToReview(record);
    expect(record).toEqual(snapshot);
  });
});

describe("selectBatch", () => {
  it("takes the top records by dossier rank", () => {
    const records = [3, 1, 2].map((rank) =>
      dossierRecord({ overture_id: `id-${rank}`, dossier_rank: rank }),
    );
    const batch = selectBatch(records, 2);
    expect(batch.map((file) => file.overture_id)).toEqual(["id-1", "id-2"]);
    expect(batch[0].dossier_rank).toBe(1);
  });

  it("defaults to a 10-place batch and handles short input", () => {
    expect(BATCH_SIZE).toBe(10);
    expect(selectBatch([dossierRecord()], 10)).toHaveLength(1);
    expect(selectBatch([], 10)).toEqual([]);
  });
});

describe("renderBatchReport", () => {
  it("renders a ranked human-readable report", () => {
    const batch = selectBatch([dossierRecord({ overture_id: "a" }), dossierRecord({ overture_id: "b", dossier_rank: 2 })], 10);
    const report = renderBatchReport(batch, "2026-08-19.0");
    expect(report).toContain("# Glimmr manual verification batch");
    expect(report).toContain("## #1 Test Eatery");
    expect(report).toContain("## #2 Test Eatery");
    expect(report).toContain("Still to verify");
    expect(report).toContain("2026-08-19.0");
  });
});
