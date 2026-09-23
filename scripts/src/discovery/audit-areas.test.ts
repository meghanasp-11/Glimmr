/**
 * Tests for the V1 service-area audit (bounds math, not labels).
 *
 * Pure functions with synthetic fixtures (no network, no Firestore, no
 * production data). Covers: inclusive bounds edges, out-of-bounds verdicts
 * with evidence, unverifiable coordinates (never mislabeled
 * out-of-bounds), unknown areas, address/area cross-checks, explicit
 * review cases, same-area/category replacement from rank order, coverage
 * and duplicate re-checks.
 * Run with: npm run test -w @glimmr/scripts
 */

import { describe, expect, it } from "vitest";
import {
  addressNamesArea,
  auditRecord,
  buildRankedList,
  coverageCounts,
  findDuplicatePairs,
  pointInBounds,
  renderAreaAuditReport,
  selectReplacement,
  type AreaInfo,
  type AuditRecordInput,
  type RankDossierInput,
} from "./audit-areas";

const CHURCH_STREET: AreaInfo = {
  id: "church-street",
  name: "Church Street",
  bounds: { north: 12.975, south: 12.97, east: 77.61, west: 77.6 },
};
const INDIRANAGAR: AreaInfo = {
  id: "indiranagar",
  name: "Indiranagar",
  bounds: { north: 12.985, south: 12.97, east: 77.645, west: 77.635 },
};
const AREAS = new Map([
  ["church-street", CHURCH_STREET],
  ["indiranagar", INDIRANAGAR],
]);
const AREA_LIST = [CHURCH_STREET, INDIRANAGAR];

let recordCounter = 0;
function record(overrides: Partial<AuditRecordInput> = {}): AuditRecordInput {
  recordCounter += 1;
  const overture_id = overrides.overture_id ?? `test-${recordCounter}`;
  return {
    name: `Place ${overture_id}`,
    service_area: "church-street",
    lat: 12.972,
    lng: 77.605,
    address: "1 Test Road",
    ...overrides,
    overture_id,
  };
}

describe("pointInBounds", () => {
  const bounds = CHURCH_STREET.bounds!;
  it("accepts points strictly inside", () => {
    expect(pointInBounds(12.972, 77.605, bounds)).toBe(true);
  });
  it("treats every edge as inclusive", () => {
    expect(pointInBounds(12.97, 77.605, bounds)).toBe(true);
    expect(pointInBounds(12.975, 77.605, bounds)).toBe(true);
    expect(pointInBounds(12.972, 77.6, bounds)).toBe(true);
    expect(pointInBounds(12.972, 77.61, bounds)).toBe(true);
  });
  it("rejects points outside on any side", () => {
    expect(pointInBounds(12.969999, 77.605, bounds)).toBe(false);
    expect(pointInBounds(12.975001, 77.605, bounds)).toBe(false);
    expect(pointInBounds(12.972, 77.599999, bounds)).toBe(false);
    expect(pointInBounds(12.972, 77.610001, bounds)).toBe(false);
  });
  it("rejects non-finite coordinates", () => {
    expect(pointInBounds(Number.NaN, 77.605, bounds)).toBe(false);
    expect(pointInBounds(12.972, Number.POSITIVE_INFINITY, bounds)).toBe(false);
  });
});

describe("addressNamesArea", () => {
  it("matches a V1 area named in the address", () => {
    expect(addressNamesArea("MSK Plaza, 100 Feet Rd, Indiranagar", AREA_LIST)).toBe("indiranagar");
    expect(addressNamesArea("Church Street Side Entrance, M G Road", AREA_LIST)).toBe("church-street");
  });
  it("returns null when no V1 area is named", () => {
    expect(addressNamesArea("At Museum Road", AREA_LIST)).toBeNull();
    expect(addressNamesArea(null, AREA_LIST)).toBeNull();
    expect(addressNamesArea("", AREA_LIST)).toBeNull();
  });
});

describe("auditRecord", () => {
  it("passes an in-bounds record with a consistent address", () => {
    const finding = auditRecord(
      record({ address: "Church Street Side Entrance, M G Road" }),
      AREAS,
      AREA_LIST,
      false,
    );
    expect(finding.verdict).toBe("in-bounds");
    expect(finding.detail).toContain("12.972");
    expect(finding.address_note).toContain("names its assigned area");
  });

  it("fails an out-of-bounds record with values and bounds as evidence", () => {
    const finding = auditRecord(record({ lat: 12.98, lng: 77.62 }), AREAS, AREA_LIST, false);
    expect(finding.verdict).toBe("out-of-bounds");
    expect(finding.detail).toContain("12.98");
    expect(finding.detail).toContain("church-street");
  });

  it("never mislabels missing coordinates as out-of-bounds", () => {
    const cases: { overture_id: string; lat: unknown; lng: unknown }[] = [
      { overture_id: "n1", lat: null, lng: null },
      { overture_id: "n2", lat: 12.972, lng: null },
      { overture_id: "n3", lat: "x", lng: 77.605 },
    ];
    for (const coords of cases) {
      const finding = auditRecord(record({ ...coords }), AREAS, AREA_LIST, false);
      expect(finding.verdict).toBe("unverifiable");
    }
  });

  it("flags an unknown assigned area instead of checking bounds", () => {
    const finding = auditRecord(record({ service_area: "whitefield" }), AREAS, AREA_LIST, false);
    expect(finding.verdict).toBe("area-unknown");
    expect(finding.detail).toContain("whitefield");
  });

  it("flags an address naming a different V1 area", () => {
    const finding = auditRecord(
      record({ address: "MSK Plaza, 100 Feet Rd, Indiranagar" }),
      AREAS,
      AREA_LIST,
      false,
    );
    expect(finding.verdict).toBe("in-bounds");
    expect(finding.address_note).toContain("indiranagar");
    expect(finding.address_note).toContain("mismatch");
  });

  it("marks explicit review cases without changing the verdict math", () => {
    const plain = auditRecord(record({}), AREAS, AREA_LIST, false);
    const focused = auditRecord(record({}), AREAS, AREA_LIST, true);
    expect(plain.verdict).toBe(focused.verdict);
    expect(plain.explicit_review).toBe(false);
    expect(focused.explicit_review).toBe(true);
    expect(focused.detail).toContain("Explicit review case");
  });
});

describe("selectReplacement", () => {
  const pool = [
    { overture_id: "r1", name: "Out Place", service_area: "church-street", glimmr_category: "Dinner", lat: 13.0, lng: 77.7 },
    { overture_id: "r2", name: "Good Place", service_area: "church-street", glimmr_category: "Dinner", lat: 12.972, lng: 77.605 },
    { overture_id: "r3", name: "Wrong Cat", service_area: "church-street", glimmr_category: "Cafe", lat: 12.972, lng: 77.605 },
    { overture_id: "r4", name: "Wrong Area", service_area: "indiranagar", glimmr_category: "Dinner", lat: 12.978, lng: 77.64 },
  ];
  it("picks the first in-bounds same-area/category record in rank order", () => {
    const pick = selectReplacement("bad", "church-street", "Dinner", pool, AREAS, new Set(["bad"]));
    expect(pick?.overture_id).toBe("r2");
  });
  it("skips out-of-bounds, category, area, and excluded records", () => {
    const pick = selectReplacement("bad", "indiranagar", "Dinner", pool, AREAS, new Set(["bad"]));
    expect(pick?.overture_id).toBe("r4");
  });
  it("returns null when no valid replacement exists", () => {
    const pick = selectReplacement("bad", "church-street", "Outdoor", pool, AREAS, new Set(["bad"]));
    expect(pick).toBeNull();
  });
});

describe("coverageCounts", () => {
  it("tallies areas and categories", () => {
    const counts = coverageCounts([
      { service_area: "church-street", glimmr_category: "Dinner" },
      { service_area: "church-street", glimmr_category: "Cafe" },
      { service_area: "indiranagar", glimmr_category: "Dinner" },
    ]);
    expect(counts).toEqual({
      areas: { "church-street": 2, indiranagar: 1 },
      categories: { Dinner: 2, Cafe: 1 },
    });
  });
});

describe("findDuplicatePairs", () => {
  it("detects normalized name+address+coordinate duplicates", () => {
    const pairs = findDuplicatePairs([
      { overture_id: "a", name: "Test Eatery", address: "1 Test Rd", lat: 12.978, lng: 77.64 },
      { overture_id: "b", name: "test eatery", address: "1  test rd", lat: 12.978001, lng: 77.640001 },
      { overture_id: "c", name: "Other Place", address: "2 Test Rd", lat: 12.978, lng: 77.64 },
    ]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].idA, pairs[0].idB]).toEqual(["a", "b"]);
  });
  it("ignores records without finite coordinates", () => {
    const pairs = findDuplicatePairs([
      { overture_id: "a", name: "Same Name", address: "Same Rd", lat: null, lng: null },
      { overture_id: "b", name: "Same Name", address: "Same Rd", lat: null, lng: null },
    ]);
    expect(pairs).toEqual([]);
  });
});

describe("renderAreaAuditReport", () => {
  it("reports verdicts, replacements, coverage, and duplicates", () => {
    const md = renderAreaAuditReport(
      {
        overture_release: "2026-08-19.0",
        findings: [
          {
            overture_id: "a",
            name: "Place A",
            assigned_area: "church-street",
            lat: 12.972,
            lng: 77.605,
            address: "1 Test Rd",
            verdict: "in-bounds",
            detail: "ok",
            address_note: "names no V1 area",
            explicit_review: false,
          },
          {
            overture_id: "b",
            name: "Place B",
            assigned_area: "church-street",
            lat: 13.0,
            lng: 77.7,
            address: "Far Away",
            verdict: "out-of-bounds",
            detail: "outside",
            address_note: "names no V1 area",
            explicit_review: true,
          },
        ],
        replacements: [
          {
            rejected_id: "b",
            rejected_name: "Place B",
            reason: "outside",
            replacement_id: "c",
            replacement_name: "Place C",
            replacement_area: "church-street",
            replacement_category: "Dinner",
          },
        ],
        coverage: { areas: { "church-street": 2 }, categories: { Dinner: 2 } },
        duplicates: [],
      },
      ["a", "c"],
    );
    expect(md).toContain("Place A");
    expect(md).toContain("out-of-bounds");
    expect(md).toContain("Place C");
    expect(md).toContain("Explicit review");
  });
});

describe("buildRankedList", () => {
  function dossierRec(id: string, blockerCount: number, pricing = false): RankDossierInput {
    return {
      overture_id: id,
      name: `Place ${id}`,
      service_area: "koramangala",
      completeness: 0.2,
      flags: [],
      fields: {
        category: { value: "Dinner" },
        priceMin: { evidence: { pricing: pricing ? ["₹500"] : [] } },
        priceMax: { evidence: {} },
        priceBasis: { evidence: {} },
        openingHours: { evidence: {} },
        websiteUrl: { evidence: { website: { reachable: false } } },
      },
    };
  }
  it("returns the full readiness ranking with evidence signals attached", () => {
    const ranked = buildRankedList(
      [dossierRec("a", 9), dossierRec("b", 3, true), dossierRec("c", 5)],
      new Map([
        ["a", { blockerCount: 9, blockers: ["x"] }],
        ["b", { blockerCount: 3, blockers: ["y"] }],
        ["c", { blockerCount: 5, blockers: ["z"] }],
      ]),
    );
    expect(ranked.map((r) => r.overture_id)).toEqual(["b", "c", "a"]);
    expect(ranked[0]).toMatchObject({ hasPricingEvidence: true, glimmr_category: "Dinner" });
  });
  it("skips dossier records with no readiness result", () => {
    const ranked = buildRankedList([dossierRec("a", 9)], new Map());
    expect(ranked).toEqual([]);
  });
});
