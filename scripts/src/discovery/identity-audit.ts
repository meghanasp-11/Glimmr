/**
 * Batch-02 top-10 venue identity audit (read-only report).
 *
 * Compares each record's Overture name/address/coordinates against its
 * cited website/source identity without fetching or inventing anything:
 * every verdict cites on-file values, dossier field statuses, and fetched
 * page titles already present in the dossier. Chains sharing a normalized
 * base name are treated as separate branch entities citing only their own
 * source; renames are preserved verbatim and flagged; coordinates are
 * checked against V1 bounds math but never corrected here. Identity marks
 * are `verified`, `conflicting`, or `needs_manual_review` — never anything
 * stricter than the evidence supports, never silent.
 *
 * Pure functions (no network, no Firestore). Inputs are never mutated.
 * Enrichment fields (price, hours, duration, activities, suitableFor,
 * vibe, experienceScore) are out of scope and untouched.
 */

import { pointInBounds, type AreaBounds } from "./audit-areas";
import { chainBase } from "./research-manifest";

export type IdentityVerdict = "verified" | "conflicting" | "needs_manual_review";

export type DossierFieldStatus = "verified" | "missing" | "conflicting" | "needs_manual_review";

export interface IdentityRecordInput {
  overture_id: string;
  name: string;
  service_area: string;
  nameStatus: DossierFieldStatus;
  nameValue: unknown;
  addressValue: unknown;
  addressStatus: DossierFieldStatus;
  latValue: unknown;
  latStatus: DossierFieldStatus;
  lngValue: unknown;
  lngStatus: DossierFieldStatus;
  websiteUrl: string | null;
  websiteReachable: boolean;
  pageTitle: string | null;
  flags: string[];
}

export interface IdentityBranchPeer {
  overture_id: string;
  name: string;
}

export interface IdentitySeparateRef {
  overture_id: string;
  name: string;
}

export interface IdentityAuditContext {
  boundsByArea: Record<string, AreaBounds>;
  peers: IdentityBranchPeer[];
  separateFrom: IdentitySeparateRef[];
  explicitReview: boolean;
  reviewNotes?: string[];
}

export interface IdentityFinding {
  overture_id: string;
  overture_name: string;
  service_area: string;
  verdict: IdentityVerdict;
  reasons: string[];
  coordinates: { lat: number | null; lng: number | null };
  address: unknown;
  sources: { website_url: string | null; page_title: string | null; reachable: boolean };
  branch_notes: string[];
  separate_entity_notes: string[];
  explicit_review: boolean;
  review_notes: string[];
  recommended_action: string;
}

export interface DossierLike {
  overture_id: string;
  name: string;
  service_area: string;
  fields: Record<string, { value?: unknown; status?: unknown }>;
  flags: string[];
  provenance: { overture_confidence?: unknown };
}

/** Map one dossier record to an audit input. Overture identity is carried verbatim. */
export function toIdentityInput(record: DossierLike, website: { url: string | null; reachable: boolean; title: string | null }): IdentityRecordInput {
  const field = (key: string): { value: unknown; status: DossierFieldStatus } => {
    const entry = record.fields[key];
    const status = entry?.status;
    return {
      value: entry?.value ?? null,
      status: status === "verified" || status === "conflicting" || status === "needs_manual_review" ? status : "missing",
    };
  };
  return {
    overture_id: record.overture_id,
    name: record.name,
    service_area: record.service_area,
    nameStatus: field("name").status,
    nameValue: field("name").value,
    addressValue: field("address").value,
    addressStatus: field("address").status,
    latValue: field("lat").value,
    latStatus: field("lat").status,
    lngValue: field("lng").value,
    lngStatus: field("lng").status,
    websiteUrl: website.url,
    websiteReachable: website.reachable,
    pageTitle: website.title,
    flags: [...record.flags],
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasRenameHistory(name: string): boolean {
  return /previously|formerly|earlier/i.test(name);
}

/** Distinctive tokens (len ≥ 4) used to test whether a source mentions another entity. */
function distinctiveTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

function sourceTokens(url: string | null, title: string | null): Set<string> {
  const parts: string[] = [];
  if (url !== null) {
    try {
      const parsed = new URL(url);
      parts.push(parsed.hostname, parsed.pathname);
    } catch {
      parts.push(url);
    }
  }
  if (title !== null) parts.push(title);
  return new Set(parts.join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0));
}

export function auditIdentity(record: IdentityRecordInput, ctx: IdentityAuditContext): IdentityFinding {
  const reasons: string[] = [];
  const branch_notes: string[] = [];
  const separate_entity_notes: string[] = [];

  const lat = finiteNumber(record.latValue);
  const lng = finiteNumber(record.lngValue);

  // 1. Name vs cited source.
  let verdict: IdentityVerdict | null = null;
  if (record.nameStatus === "conflicting") {
    verdict = "conflicting";
    reasons.push(
      `Recorded name is conflicting in dossier${record.pageTitle ? `: fetched page title "${record.pageTitle}" does not corroborate "${record.name}"` : ""}. Resolve the operating name against the cited source before enrichment.`,
    );
  } else if (record.nameStatus === "verified") {
    reasons.push(`Recorded name corroborated by cited source${record.pageTitle ? ` ("${record.pageTitle}")` : ""}.`);
  } else {
    reasons.push(`Recorded name unconfirmed (status: ${record.nameStatus}); confirm the operating name on the cited site.`);
  }

  // 2. Branch separation: same chain base, different record — own source only.
  for (const peer of ctx.peers) {
    if (peer.overture_id !== record.overture_id && chainBase(peer.name) === chainBase(record.name)) {
      branch_notes.push(
        `Treat as a separate entity from ${peer.overture_id} (${peer.name}); each branch cites only its own source below.`,
      );
    }
  }

  // 3. Rename history preserved verbatim, flagged for confirmation.
  if (hasRenameHistory(record.name)) {
    reasons.push(`Name records rename history ("${record.name}"); confirm the current operating name on site, keep the Overture original.`);
  }

  // 4. Explicit separate-entity checks: link exists only if the record's own
  // source mentions the other entity. Either way the record stays separate.
  for (const other of ctx.separateFrom) {
    const tokens = sourceTokens(record.websiteUrl, record.pageTitle);
    const hits = distinctiveTokens(other.name).filter((token) => tokens.has(token));
    if (hits.length > 0) {
      separate_entity_notes.push(
        `Possible on-file link to ${other.overture_id} (${other.name}) via shared token(s) ${hits.join(", ")} — a human must decide; stays a separate entity until its own source proves identity.`,
      );
    } else {
      separate_entity_notes.push(
        `No on-file link to ${other.overture_id} (${other.name}) in this record's own source — stays a separate entity.`,
      );
    }
  }

  // 5. Coordinates: checked against V1 bounds math, never corrected here.
  const bounds = ctx.boundsByArea[record.service_area];
  if (lat === null || lng === null) {
    reasons.push("No finite on-file coordinates; pin must be confirmed on site, not invented.");
  } else if (bounds === undefined) {
    reasons.push(`No V1 bounds on file for area "${record.service_area}"; bounds check skipped.`);
  } else if (pointInBounds(lat, lng, bounds)) {
    reasons.push(
      `On-file pin (${lat}, ${lng}) falls inside "${record.service_area}" V1 bounds ` +
        `(lat ${bounds.south}..${bounds.north}, lng ${bounds.west}..${bounds.east}); pin itself still needs human confirmation.`,
    );
  } else if (verdict === null) {
    verdict = "conflicting";
    reasons.push(
      `On-file pin (${lat}, ${lng}) falls outside "${record.service_area}" V1 bounds ` +
        `(lat ${bounds.south}..${bounds.north}, lng ${bounds.west}..${bounds.east}); resolve area assignment before enrichment.`,
    );
  }

  // 6. Address corroboration (carried verbatim either way).
  if (record.addressStatus === "verified") {
    reasons.push("Recorded address corroborated by excerpts; preserved verbatim.");
  } else {
    reasons.push(`Recorded address unconfirmed (status: ${record.addressStatus}); confirm on site, do not rewrite.`);
  }

  if (verdict === null) {
    const fullyCorroborated =
      record.nameStatus === "verified" &&
      record.addressStatus === "verified" &&
      record.latStatus === "verified" &&
      record.lngStatus === "verified" &&
      lat !== null &&
      lng !== null &&
      record.websiteReachable;
    verdict = fullyCorroborated ? "verified" : "needs_manual_review";
    if (verdict === "verified") {
      reasons.push("Name, address, and pin corroborated with a reachable cited source.");
    }
  }

  const actions: string[] = [];
  if (verdict === "conflicting") actions.push("resolve the conflict(s) above against the cited source");
  if (record.addressStatus !== "verified") actions.push("confirm the address on site");
  if (record.latStatus !== "verified" || record.lngStatus !== "verified") actions.push("confirm the pin on site");
  if (branch_notes.length > 0) actions.push("confirm this branch outlet (never merge branches)");
  if (ctx.separateFrom.length === 1) actions.push("keep separate from the listed entity until its own source proves identity");
  if (ctx.separateFrom.length > 1) actions.push("keep separate from the listed entities until its own source proves identity");
  actions.push("verify independently of the service-area assignment");
  const recommended_action = actions.length > 0
    ? `Before enrichment: ${actions.join("; ")}.`
    : "Identity corroborated; proceed to field verification.";

  return {
    overture_id: record.overture_id,
    overture_name: record.name,
    service_area: record.service_area,
    verdict,
    reasons,
    coordinates: { lat, lng },
    address: record.addressValue,
    sources: { website_url: record.websiteUrl, page_title: record.pageTitle, reachable: record.websiteReachable },
    branch_notes,
    separate_entity_notes,
    explicit_review: ctx.explicitReview,
    review_notes: [...(ctx.reviewNotes ?? [])],
    recommended_action,
  };
}

export interface IdentityAudit {
  source: "glimmr_batch_02_identity_audit";
  overture_release: string;
  generated_at_utc: string;
  counts: { total: number; verified: number; conflicting: number; needs_manual_review: number };
  places: (IdentityFinding & { rank: number })[];
}

export function buildIdentityAudit(
  top10: string[],
  records: Record<string, IdentityRecordInput>,
  ctx: {
    boundsByArea: Record<string, AreaBounds>;
    peersById: Record<string, { overture_id: string; name: string }[]>;
    separateById: Record<string, { overture_id: string; name: string }[]>;
    explicitIds: Set<string>;
    notesById?: Record<string, string[]>;
  },
  generatedAtUtc: string = new Date().toISOString(),
): IdentityAudit {
  const places = top10.map((id, index) => {
    const record = records[id];
    if (!record) throw new Error(`Identity audit: no record for top-10 id "${id}".`);
    const finding = auditIdentity(record, {
      boundsByArea: ctx.boundsByArea,
      peers: ctx.peersById[id] ?? [],
      separateFrom: ctx.separateById[id] ?? [],
      explicitReview: ctx.explicitIds.has(id),
      reviewNotes: ctx.notesById?.[id] ?? [],
    });
    return { ...finding, rank: index + 1 };
  });
  const counts = {
    total: places.length,
    verified: places.filter((p) => p.verdict === "verified").length,
    conflicting: places.filter((p) => p.verdict === "conflicting").length,
    needs_manual_review: places.filter((p) => p.verdict === "needs_manual_review").length,
  };
  return {
    source: "glimmr_batch_02_identity_audit",
    overture_release: "",
    generated_at_utc: generatedAtUtc,
    counts,
    places,
  };
}

export function renderIdentityAuditMd(
  audit: IdentityAudit,
  overtureRelease: string,
): string {
  const lines = [
    "# Batch-02 top-10 venue identity audit",
    "",
    `Exact-identity check for the 10 records ranked highest for production readiness (Overture release ${overtureRelease}).`,
    "Overture name/address/coordinates compared against each record's cited website/source identity. No fetching, no invented facts, no enrichment.",
    "Original Overture identity is preserved verbatim; nothing here corrects records.",
    "",
    `Counts — verified: ${audit.counts.verified}, conflicting: ${audit.counts.conflicting}, needs_manual_review: ${audit.counts.needs_manual_review}.`,
    "",
  ];
  for (const place of audit.places) {
    lines.push(
      `## #${place.rank} ${place.overture_name}`,
      "",
      `- Overture ID: ${place.overture_id} · Area: ${place.service_area} · Identity: ${place.verdict}${place.explicit_review ? " · Explicit review case" : ""}`,
      ...place.review_notes.map((note) => `- Review direction: ${note}`),
      `- Overture address: ${typeof place.address === "string" && place.address.length > 0 ? place.address : "none on file"}`,
      `- Overture coordinates: ${place.coordinates.lat ?? "?"}, ${place.coordinates.lng ?? "?"}`,
      `- Cited source: ${place.sources.website_url ?? "none on file"}${place.sources.page_title ? ` ("${place.sources.page_title}")` : ""} · reachable: ${place.sources.reachable}`,
      `- Evidence:`,
      ...place.reasons.map((reason) => `  - ${reason}`),
    );
    if (place.branch_notes.length > 0) {
      lines.push(`- Branches:`, ...place.branch_notes.map((note) => `  - ${note}`));
    }
    if (place.separate_entity_notes.length > 0) {
      lines.push(`- Separate entities:`, ...place.separate_entity_notes.map((note) => `  - ${note}`));
    }
    lines.push(`- Recommended action: ${place.recommended_action}`, "");
  }
  return `${lines.join("\n")}\n`;
}
