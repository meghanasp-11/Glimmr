/**
 * Batch-02 top-10 research manifest: what a verifier must check per place.
 *
 * Pure builders over on-file inputs only (dossier + queue + evidence +
 * readiness top-10 order). No fetching, no invention: every value shown is
 * either carried from the inputs or a static search-guidance template
 * grounded in the on-file site. Missing stays missing; leads stay labeled
 * as unverified Overture values.
 */

import { hostOf } from "./evidence";

export const MANIFEST_FIELDS = [
  "address",
  "coordinates",
  "openingHours",
  "priceMin",
  "priceMax",
  "priceBasis",
  "verificationStatus",
  "experienceScore",
] as const;

export type ManifestFieldName = (typeof MANIFEST_FIELDS)[number];

export interface DossierFieldLike {
  status: string;
  value: unknown;
}

export interface DossierLike {
  overture_id: string;
  name: string;
  service_area: string;
  completeness: number;
  flags: string[];
  fields: Record<string, DossierFieldLike>;
  provenance: {
    overture_confidence: number | null;
    evidence_source_url: string | null;
  };
}

export interface QueueLike {
  overture_id: string;
  glimmr_category: string | null;
  website: string | null;
  confidence: number | null;
}

export interface EvidenceLike {
  overture_id: string;
  source_url: string | null;
  page_title: string | null;
  website_reachable: boolean;
  fetched_at_utc: string | null;
  failure: { reason: string } | null;
}

export interface AmbiguityFlag {
  type: "shared-chain" | "rename-history" | "dossier-flag";
  detail: string;
}

export interface ManifestFieldTarget {
  field: ManifestFieldName;
  status: string;
  current_lead: string | null;
  search_target: string;
}

export interface ManifestPlace {
  rank: number;
  overture_id: string;
  name: string;
  service_area: string;
  glimmr_category: string;
  address: { value: string | null; status: string };
  coordinates: {
    lat: number | null;
    lng: number | null;
    lat_status: string;
    lng_status: string;
    status: string;
  };
  source_urls: {
    website_url: string | null;
    website_host: string | null;
    website_reachable: boolean;
    evidence_source_url: string | null;
    evidence_page_title: string | null;
    evidence_fetched_at_utc: string | null;
  };
  source_confidence: number | null;
  ambiguity_flags: AmbiguityFlag[];
  missing_fields: ManifestFieldTarget[];
}

export interface ResearchManifest {
  source: "glimmr_batch_02_research_manifest";
  overture_release: string;
  generated_at_utc: string;
  ranked: string;
  count: number;
  places: ManifestPlace[];
}

/**
 * Chain base for branch detection: the venue name before any outlet
 * qualifier ("Name | Outlet…" → "name"). Conservative — only an exact
 * normalized base match counts as the same chain.
 */
export function chainBase(name: string): string {
  return name.split("|")[0].split(",")[0].trim().toLowerCase();
}

function hasRenameHistory(name: string): boolean {
  return /previously|formerly|earlier/i.test(name);
}

function scalarLead(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length > 0) return value;
  return null;
}

function coordinateNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Combined coordinate status: conflicting > missing > needs review > verified. */
function combinedCoordinateStatus(latStatus: string, lngStatus: string): string {
  for (const status of [latStatus, lngStatus]) {
    if (status === "conflicting") return "conflicting";
  }
  for (const status of [latStatus, lngStatus]) {
    if (status !== "verified") return status;
  }
  return "verified";
}

interface SiteContext {
  siteUrl: string | null;
  siteHost: string | null;
  unreachableReason: string | null;
}

function targetFor(field: ManifestFieldName, site: SiteContext): string {
  const onFile = site.siteUrl !== null ? ` On-file site: ${site.siteUrl}` : " No on-file site on record.";
  const prefix =
    site.unreachableReason !== null && site.siteUrl !== null
      ? `Site unreachable (${site.unreachableReason}) — retry, then fall back to a map listing or established guide and record the actual sourceUrl. `
      : "";
  const host = site.siteHost ?? "the venue site";
  switch (field) {
    case "address":
      return site.siteUrl === null
        ? `Find the venue site or a map listing first, then confirm the street address.${onFile}`
        : `${prefix}Location / find-us / contact section of ${host}; cross-check pin on a map listing.${onFile}`;
    case "coordinates":
      return site.siteUrl === null
        ? `Find the venue site or a map listing first, then verify the pin.${onFile}`
        : `${prefix}Verify pin via ${host} location page + map listing cross-check.${onFile}`;
    case "openingHours":
      return site.siteUrl === null
        ? `Find the venue site or a map listing first, then confirm hours in engine format (e.g. 9:00 AM - 9:00 PM).${onFile}`
        : `${prefix}Hours / timings section of ${host} (engine format, e.g. 9:00 AM - 9:00 PM).${onFile}`;
    case "priceMin":
    case "priceMax":
    case "priceBasis":
      return site.siteUrl === null
        ? `Find the venue site or an established guide first, then confirm the per-person band and basis.${onFile}`
        : `${prefix}Menu / pricing page of ${host} (per-person band + basis).${onFile}`;
    case "verificationStatus":
      return `Flip only after every required field above is confirmed against its cited source.${onFile}`;
    case "experienceScore":
      return `On-site quality signals only (craft, ambience, service) — never ratings or review counts.${onFile}`;
  }
}

function fieldTarget(
  field: ManifestFieldName,
  dossier: DossierLike,
  site: SiteContext,
): ManifestFieldTarget {
  if (field === "coordinates") {
    const lat = dossier.fields["lat"];
    const lng = dossier.fields["lng"];
    const latStatus = lat?.status ?? "missing";
    const lngStatus = lng?.status ?? "missing";
    const latLead = scalarLead(lat?.value);
    const lngLead = scalarLead(lng?.value);
    return {
      field,
      status: combinedCoordinateStatus(latStatus, lngStatus),
      current_lead: latLead !== null || lngLead !== null ? `${latLead ?? "?"}${", "}${lngLead ?? "?"}` : null,
      search_target: targetFor(field, site),
    };
  }
  const entry = dossier.fields[field];
  return {
    field,
    status: entry?.status ?? "missing",
    current_lead: scalarLead(entry?.value),
    search_target: targetFor(field, site),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Build one manifest entry. `peers` are the other top-10 dossiers, used
 * only to detect shared chains — evidence is never merged across records.
 */
export function buildManifestEntry(
  rank: number,
  dossier: DossierLike,
  queue: QueueLike | undefined,
  evidence: EvidenceLike | undefined,
  peers: DossierLike[],
): ManifestPlace {
  const siteUrl = queue?.website ?? null;
  const site: SiteContext = {
    siteUrl,
    siteHost: siteUrl !== null ? hostOf(siteUrl) : null,
    unreachableReason:
      evidence !== undefined && !evidence.website_reachable ? (evidence.failure?.reason ?? "fetch failed") : null,
  };

  const ambiguity_flags: AmbiguityFlag[] = [];
  for (const flag of dossier.flags) {
    ambiguity_flags.push({ type: "dossier-flag", detail: flag });
  }
  const base = chainBase(dossier.name);
  for (const peer of peers) {
    if (peer.overture_id !== dossier.overture_id && chainBase(peer.name) === base) {
      ambiguity_flags.push({
        type: "shared-chain",
        detail: `Shares outlet chain with ${peer.overture_id} (${peer.name}); verify this branch independently — never merge evidence across branches.`,
      });
    }
  }
  if (hasRenameHistory(dossier.name)) {
    ambiguity_flags.push({
      type: "rename-history",
      detail: `Name records a rename ("${dossier.name}"); confirm the current operating name on site.`,
    });
  }

  const lat = coordinateNumber(dossier.fields["lat"]?.value);
  const lng = coordinateNumber(dossier.fields["lng"]?.value);
  const latStatus = dossier.fields["lat"]?.status ?? "missing";
  const lngStatus = dossier.fields["lng"]?.status ?? "missing";
  const categoryValue = dossier.fields["category"]?.value;
  const addressValue = dossier.fields["address"]?.value;

  return {
    rank,
    overture_id: dossier.overture_id,
    name: dossier.name,
    service_area: dossier.service_area,
    glimmr_category:
      queue?.glimmr_category ?? (typeof categoryValue === "string" ? categoryValue : "unknown"),
    address: { value: stringOrNull(addressValue), status: dossier.fields["address"]?.status ?? "missing" },
    coordinates: {
      lat,
      lng,
      lat_status: latStatus,
      lng_status: lngStatus,
      status: combinedCoordinateStatus(latStatus, lngStatus),
    },
    source_urls: {
      website_url: siteUrl,
      website_host: site.siteHost,
      website_reachable: evidence?.website_reachable ?? false,
      evidence_source_url: evidence?.source_url ?? dossier.provenance.evidence_source_url,
      evidence_page_title: evidence?.page_title ?? null,
      evidence_fetched_at_utc: evidence?.fetched_at_utc ?? null,
    },
    source_confidence: queue?.confidence ?? dossier.provenance.overture_confidence,
    ambiguity_flags,
    missing_fields: MANIFEST_FIELDS.map((field) => fieldTarget(field, dossier, site)),
  };
}

export function buildResearchManifest(
  top10: string[],
  dossiers: Record<string, DossierLike>,
  queues: Record<string, QueueLike>,
  evidences: Record<string, EvidenceLike>,
  overtureRelease: string,
  generatedAtUtc: string = new Date().toISOString(),
): ResearchManifest {
  const places = top10.map((id, index) => {
    const dossier = dossiers[id];
    if (!dossier) throw new Error(`Research manifest: no dossier for top-10 record "${id}".`);
    const peers = top10.filter((peer) => peer !== id).map((peer) => dossiers[peer]).filter((p) => p !== undefined);
    return buildManifestEntry(index + 1, dossier, queues[id], evidences[id], peers);
  });
  return {
    source: "glimmr_batch_02_research_manifest",
    overture_release: overtureRelease,
    generated_at_utc: generatedAtUtc,
    ranked: "batch-02/readiness.json top10 order",
    count: places.length,
    places,
  };
}

export function renderResearchManifestMd(manifest: ResearchManifest): string {
  const lines = [
    "# Batch-02 top-10 research manifest",
    "",
    `Research targets for the 10 records ranked highest for production readiness (Overture release ${manifest.overture_release}).`,
    "Verify each field against its cited source; fill curated attributes by hand.",
    "Never invent a fact that is not on the cited source; never merge evidence across branches.",
    "",
  ];
  for (const place of manifest.places) {
    lines.push(
      `## #${place.rank} ${place.name}`,
      "",
      `- Overture ID: ${place.overture_id} · Area: ${place.service_area} · Category: ${place.glimmr_category}`,
      `- Address on file: ${place.address.value ?? "none"} (status: ${place.address.status})`,
      `- Coordinates on file: ${
        place.coordinates.lat !== null || place.coordinates.lng !== null
          ? `${place.coordinates.lat ?? "?"}, ${place.coordinates.lng ?? "?"}`
          : "none"
      } (status: ${place.coordinates.status})`,
      `- Sources: ${place.source_urls.website_url ?? "no on-file site"}` +
        ` (host: ${place.source_urls.website_host ?? "n/a"}, reachable: ${place.source_urls.website_reachable})` +
        ` · evidence: ${place.source_urls.evidence_page_title ?? "untitled"}`,
      `- Source confidence: ${place.source_confidence ?? "unknown"}`,
      place.ambiguity_flags.length > 0
        ? `- Ambiguity flags: ${place.ambiguity_flags.map((f) => `[${f.type}] ${f.detail}`).join(" | ")}`
        : `- Ambiguity flags: none`,
      `- Verification fields (verify each against its cited source):`,
      ...place.missing_fields.map(
        (f) => `  - ${f.field} (status: ${f.status}${f.current_lead !== null ? `, lead: ${f.current_lead}` : ""}): ${f.search_target}`,
      ),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
