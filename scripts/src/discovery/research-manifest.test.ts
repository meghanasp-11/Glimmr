/**
 * Tests for the Batch-02 top-10 research manifest builder.
 *
 * Pure functions with synthetic fixtures (no network, no Firestore, no
 * real-world facts). Guards: top-10 order preserved, identity/sources from
 * on-file inputs only, the 8 required missing fields each carry a search
 * target grounded in the on-file site, branch sharing and renames flagged,
 * cross-branch evidence never merged, markdown covers all records.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  MANIFEST_FIELDS,
  buildManifestEntry,
  buildResearchManifest,
  renderResearchManifestMd,
  type DossierLike,
  type EvidenceLike,
  type QueueLike,
} from "./research-manifest";

function dossier(overrides: Partial<DossierLike> = {}): DossierLike {
  return {
    overture_id: "abc123",
    name: "Test Cafe",
    service_area: "indiranagar",
    completeness: 0.2,
    flags: [],
    fields: {
      address: { status: "needs_manual_review", value: "1 Test Rd" },
      lat: { status: "needs_manual_review", value: 12.97 },
      lng: { status: "needs_manual_review", value: 77.64 },
      openingHours: { status: "missing", value: null },
      priceMin: { status: "missing", value: null },
      priceMax: { status: "missing", value: null },
      priceBasis: { status: "missing", value: null },
      verificationStatus: { status: "needs_manual_review", value: "unverified" },
      experienceScore: { status: "missing", value: null },
      category: { status: "needs_manual_review", value: "Cafe" },
      serviceArea: { status: "needs_manual_review", value: "indiranagar" },
    },
    provenance: { overture_confidence: 0.99, evidence_source_url: "https://testcafe.example/menu" },
    ...overrides,
  };
}

function queue(overrides: Partial<QueueLike> = {}): QueueLike {
  return {
    overture_id: "abc123",
    glimmr_category: "Cafe",
    website: "https://testcafe.example/",
    confidence: 0.99,
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceLike> = {}): EvidenceLike {
  return {
    overture_id: "abc123",
    source_url: "https://testcafe.example/",
    page_title: "Test Cafe",
    website_reachable: true,
    fetched_at_utc: "2026-09-01T00:00:00.000Z",
    failure: null,
    ...overrides,
  };
}

describe("MANIFEST_FIELDS", () => {
  it("covers exactly the 8 required verification fields", () => {
    expect(MANIFEST_FIELDS).toEqual([
      "address",
      "coordinates",
      "openingHours",
      "priceMin",
      "priceMax",
      "priceBasis",
      "verificationStatus",
      "experienceScore",
    ]);
  });
});

describe("buildManifestEntry", () => {
  it("carries identity, area, category, confidence, and on-file sources", () => {
    const entry = buildManifestEntry(1, dossier(), queue(), evidence(), []);
    expect(entry.rank).toBe(1);
    expect(entry.overture_id).toBe("abc123");
    expect(entry.name).toBe("Test Cafe");
    expect(entry.service_area).toBe("indiranagar");
    expect(entry.glimmr_category).toBe("Cafe");
    expect(entry.source_confidence).toBe(0.99);
    expect(entry.source_urls.website_url).toBe("https://testcafe.example/");
    expect(entry.source_urls.evidence_source_url).toBe("https://testcafe.example/");
    expect(entry.ambiguity_flags).toEqual([]);
  });

  it("lists all 8 required fields with dossier status and Overture leads", () => {
    const entry = buildManifestEntry(1, dossier(), queue(), evidence(), []);
    expect(entry.missing_fields.map((f) => f.field)).toEqual(MANIFEST_FIELDS);
    const byField = new Map(entry.missing_fields.map((f) => [f.field, f]));
    expect(byField.get("address")).toMatchObject({ status: "needs_manual_review", current_lead: "1 Test Rd" });
    expect(byField.get("coordinates")).toMatchObject({
      status: "needs_manual_review",
      current_lead: "12.97, 77.64",
    });
    expect(byField.get("priceMin")).toMatchObject({ status: "missing", current_lead: null });
    expect(byField.get("verificationStatus")).toMatchObject({ status: "needs_manual_review" });
  });

  it("grounds every search target in the on-file site, inventing no URLs", () => {
    const entry = buildManifestEntry(1, dossier(), queue(), evidence(), []);
    for (const f of entry.missing_fields) {
      expect(f.search_target).toContain("testcafe.example");
    }
    const urls = entry.missing_fields.flatMap((f) => f.search_target.match(/https?:\/\/\S+/g) ?? []);
    for (const url of urls) {
      expect(url.startsWith("https://testcafe.example/")).toBe(true);
    }
  });

  it("adds retry guidance when the site was unreachable", () => {
    const entry = buildManifestEntry(
      1,
      dossier(),
      queue(),
      evidence({ website_reachable: false, failure: { reason: "timeout" } }),
      [],
    );
    const prices = entry.missing_fields.find((f) => f.field === "priceMin");
    expect(prices?.search_target).toMatch(/unreachable|retry/i);
  });

  it("flags a shared chain on every involved record without merging evidence", () => {
    const peer = dossier({ overture_id: "def456", name: "Test Cafe | Mall Outlet" });
    const entry = buildManifestEntry(1, dossier({ name: "Test Cafe | Downtown" }), queue(), evidence(), [peer]);
    const flag = entry.ambiguity_flags.find((f) => f.type === "shared-chain");
    expect(flag?.detail).toContain("def456");
    expect(entry.source_urls.website_url).toBe("https://testcafe.example/");
  });

  it("does not flag distinct venue names as a shared chain", () => {
    const peer = dossier({ overture_id: "def456", name: "Other Place" });
    const entry = buildManifestEntry(1, dossier(), queue(), evidence(), [peer]);
    expect(entry.ambiguity_flags.filter((f) => f.type === "shared-chain")).toEqual([]);
  });

  it("flags rename history in the venue name", () => {
    const entry = buildManifestEntry(
      1,
      dossier({ name: "Test Hall (Previously Old Hall)" }),
      queue(),
      evidence(),
      [],
    );
    expect(entry.ambiguity_flags.some((f) => f.type === "rename-history")).toBe(true);
  });

  it("carries dossier flags through as ambiguity flags", () => {
    const entry = buildManifestEntry(1, dossier({ flags: ["ambiguous-address"] }), queue(), evidence(), []);
    expect(entry.ambiguity_flags).toContainEqual({ type: "dossier-flag", detail: "ambiguous-address" });
  });
});

describe("buildResearchManifest", () => {
  it("emits the top 10 in readiness order with ranks", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);
    const manifest = buildResearchManifest(
      ids,
      Object.fromEntries(ids.map((id) => [id, dossier({ overture_id: id, name: `Place ${id}` })])),
      Object.fromEntries(ids.map((id) => [id, queue({ overture_id: id })])),
      Object.fromEntries(ids.map((id) => [id, evidence({ overture_id: id })])),
      "2026-08-19.0",
    );
    expect(manifest.source).toBe("glimmr_batch_02_research_manifest");
    expect(manifest.places).toHaveLength(10);
    expect(manifest.places.map((p) => p.overture_id)).toEqual(ids);
    expect(manifest.places.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("throws when a top-10 record has no dossier", () => {
    expect(() => buildResearchManifest(["ghost"], {}, {}, {}, "2026-08-19.0")).toThrow(/ghost/);
  });
});

describe("renderResearchManifestMd", () => {
  it("covers every record with identity, missing fields, and targets", () => {
    const manifest = buildResearchManifest(
      ["abc123"],
      { abc123: dossier() },
      { abc123: queue() },
      { abc123: evidence() },
      "2026-08-19.0",
    );
    const md = renderResearchManifestMd(manifest);
    expect(md).toContain("# Batch-02 top-10 research manifest");
    expect(md).toContain("abc123");
    expect(md).toContain("Test Cafe");
    for (const field of MANIFEST_FIELDS) {
      expect(md).toContain(field);
    }
    expect(md).toContain("testcafe.example");
  });
});
