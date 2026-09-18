/**
 * Tests for the verification dossier builder (statuses, flags, ranking).
 *
 * Pure unit tests with fixture drafts and evidence — no network, no
 * Firestore, and no real-world facts (fixtures are synthetic).
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  buildDossierRecord,
  hasClosureSignal,
  isStaleFetch,
  rankDossier,
  type DossierRecord,
  type DraftInput,
  type EvidenceInput,
} from "./dossier";

function draft(overrides: Record<string, unknown> = {}): DraftInput {
  return {
    overture_id: "test-id",
    service_area: "indiranagar",
    place_draft: {
      id: "ov-test-id",
      name: "Test Eatery",
      serviceArea: "indiranagar",
      category: "Dinner",
      address: "1 Test Road, Indiranagar",
      lat: 12.978,
      lng: 77.64,
      description: null,
      subcategory: null,
      priceMin: null,
      priceMax: null,
      priceBasis: null,
      openingHours: null,
      typicalVisitDuration: null,
      suitableFor: [],
      activities: [],
      vibe: null,
      rating: null,
      reviewCount: null,
      experienceScore: null,
      websiteUrl: "https://example.com/x",
      mapsUrl: null,
      source: "overture:2026-08-19.0",
      sourceUrl: null,
      verificationStatus: "unverified",
      confidence: 0.8,
      lastVerified: null,
      ...overrides,
    },
    provenance: { overture_release: "2026-08-19.0", sources: [{ dataset: "meta" }] },
  };
}

function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    source_url: "https://example.com/x",
    fetched_at_utc: "2026-09-16T00:00:00.000Z",
    page_title: "Test Eatery — Official Site",
    website_reachable: true,
    snippets: {
      hours: ["Open daily 9:00 AM to 9:00 PM."],
      pricing: ["Meals from Rs. 200."],
      address: ["Find us at 1 Test Road, Indiranagar."],
      status: [],
    },
    failure: null,
    ...overrides,
  };
}

describe("hasClosureSignal / isStaleFetch", () => {
  it("detects closure language", () => {
    expect(hasClosureSignal(["Permanently closed since June."])).toBe(true);
    expect(hasClosureSignal(["We are now open!"])).toBe(false);
    expect(hasClosureSignal([])).toBe(false);
  });

  it("flags fetches older than 90 days", () => {
    const now = Date.parse("2026-09-16T00:00:00.000Z");
    expect(isStaleFetch("2026-09-01T00:00:00.000Z", now)).toBe(false);
    expect(isStaleFetch("2026-01-01T00:00:00.000Z", now)).toBe(true);
    expect(isStaleFetch(null, now)).toBe(false);
    expect(isStaleFetch("not-a-date", now)).toBe(false);
  });
});

describe("buildDossierRecord", () => {
  it("verifies corroborated fields and shows evidence beside each", () => {
    const record = buildDossierRecord(draft(), evidence(), Date.parse("2026-09-16T00:00:00.000Z"));
    expect(record.overture_id).toBe("test-id");
    expect(record.fields["name"].status).toBe("verified");
    expect(record.fields["address"].status).toBe("verified");
    expect(record.fields["websiteUrl"].status).toBe("verified");
    expect(record.fields["id"].status).toBe("verified");
    // Hours evidence sits beside the (still null) openingHours field.
    expect(record.fields["openingHours"].value).toBeNull();
    expect(record.fields["openingHours"].evidence.hours).toHaveLength(1);
    expect(record.fields["openingHours"].status).toBe("needs_manual_review");
    expect(record.fields["priceMin"].evidence.pricing).toHaveLength(1);
    // Provenance survives intact.
    expect(record.provenance.overture_release).toBe("2026-08-19.0");
    expect(record.provenance.evidence_source_url).toBe("https://example.com/x");
    expect(record.provenance.evidence_fetched_at).toBe("2026-09-16T00:00:00.000Z");
  });

  it("marks curated attributes missing without inventing values", () => {
    const record = buildDossierRecord(
      draft(),
      evidence({ snippets: { hours: [], pricing: [], address: [], status: [] } }),
    );
    for (const field of ["priceMin", "openingHours", "typicalVisitDuration", "vibe", "experienceScore"]) {
      expect(record.fields[field].value).toBeNull();
      expect(record.fields[field].status).toBe("missing");
    }
    expect(record.fields["suitableFor"].value).toEqual([]);
    expect(record.fields["activities"].value).toEqual([]);
  });

  it("flags title mismatch as conflicting", () => {
    const record = buildDossierRecord(draft(), evidence({ page_title: "Totally Unrelated Portal" }));
    expect(record.fields["name"].status).toBe("conflicting");
    expect(record.fields["name"].flags).toContain("title-mismatch");
    expect(record.flags).toContain("title-mismatch");
  });

  it("flags closure signals and unreachable websites", () => {
    const closed = buildDossierRecord(
      draft(),
      evidence({ snippets: { hours: [], pricing: [], address: [], status: ["Permanently closed."] } }),
    );
    expect(closed.fields["verificationStatus"].status).toBe("conflicting");
    expect(closed.flags).toContain("possibly-closed");

    const down = buildDossierRecord(draft(), evidence({ website_reachable: false }));
    expect(down.fields["websiteUrl"].status).toBe("needs_manual_review");
    expect(down.fields["websiteUrl"].flags).toContain("unreachable-website");
    expect(down.flags).toContain("unreachable-website");
  });

  it("flags stale fetches and ambiguous addresses", () => {
    const stale = buildDossierRecord(draft(), evidence(), Date.parse("2027-06-01T00:00:00.000Z"));
    expect(stale.flags).toContain("stale-fetch");

    const ambiguous = buildDossierRecord(
      draft(),
      evidence({ snippets: { hours: [], pricing: [], address: ["Visit our downtown outlet."], status: [] } }),
    );
    expect(ambiguous.fields["address"].status).toBe("needs_manual_review");
    expect(ambiguous.fields["address"].flags).toContain("ambiguous-address");
  });
});

describe("rankDossier", () => {
  function minimal(id: string, verifiedFields: string[]): DossierRecord {
    const base = buildDossierRecord(draft({}), evidence());
    const record: DossierRecord = {
      ...base,
      overture_id: id,
      counts: { verified: 0, missing: 0, conflicting: 0, needs_manual_review: 0 },
      completeness: 0,
      dossier_rank: 0,
    };
    for (const field of verifiedFields) {
      record.fields[field] = { ...base.fields[field], status: "verified" };
      record.counts.verified += 1;
    }
    const total = Object.keys(base.fields).length;
    record.counts.missing = total - verifiedFields.length;
    record.completeness = record.counts.verified / total;
    return record;
  }

  it("ranks strongest-first with stable tiebreaks", () => {
    const ranked = rankDossier([
      minimal("c-id", ["id"]),
      minimal("a-id", ["id", "name", "address"]),
      minimal("b-id", ["id", "name"]),
    ]);
    expect(ranked.map((r) => r.overture_id)).toEqual(["a-id", "b-id", "c-id"]);
    expect(ranked.map((r) => r.dossier_rank)).toEqual([1, 2, 3]);
  });

  it("prefers fewer missing fields on verified ties", () => {
    const x = minimal("x-id", ["id", "name"]);
    const y = minimal("y-id", ["id", "name"]);
    y.counts.conflicting = 1;
    y.counts.missing -= 1;
    const ranked = rankDossier([y, x]);
    expect(ranked[0].overture_id).toBe("x-id");
  });
});
