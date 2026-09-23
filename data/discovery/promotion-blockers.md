# Promotion blocker report — 10-place review batch

Generated 2026-09-20 from dry runs only. Nothing was written to Firestore
or to production data. Sources:
- `npm run discovery:readiness -w @glimmr/scripts` (recommendation readiness)
- `npm run discovery:promote -w @glimmr/scripts -- --dry-run` (production importer)
- Candidate output: `data/discovery/production-candidates.json` (0 records)

## Headline

- **Recommendation-ready: 0 of 9** (1 record rejected and excluded).
- **Production-ready (importer): 0 of 10**, 1 rejected and excluded.
- **Production candidates written: 0.**
- Enrichment applied this pass (rubric-validated curation, 26 fields across
  9 reviews): typicalVisitDuration, activities, suitableFor, vibe where the
  existing evidence directly supports them. Every remaining blocker below is
  a verification-gated or evidence-free field — deliberately left missing,
  never guessed.

## Per-place blockers (recommendation readiness)

### Amoeba (church-street, `9ca66fd1`) — NOT READY
- priceMin, priceMax, priceBasis: missing (needs menu verification)
- experienceScore: missing (needs craft-signal evidence; ratings must never justify it)
- verificationStatus: missing (needs verification workflow)

### The Amazing Escape (indiranagar, `b0e262d1`) — NOT READY
- priceMin, priceMax, priceBasis: missing
- openingHours: missing (needs hours verification)
- experienceScore: missing
- verificationStatus: missing

### Third Wave Coffee, Indiranagar (`ecd46ce8`) — NOT READY
- priceMin, priceMax, priceBasis: missing
- suitableFor: missing (left uncurated — no direct evidence)
- vibe: missing (left uncurated — no direct evidence)
- experienceScore: missing
- verificationStatus: missing

### Dyu Art Cafe (koramangala, `282cffac`) — NOT READY
- priceMin, priceMax, priceBasis: missing
- suitableFor: missing (left uncurated — no direct evidence)
- experienceScore: missing
- verificationStatus: missing

### Smoor Lounge (koramangala, `5ae1d62d`) — NOT READY
- serviceArea, address: missing (ambiguous-address flag; needs confirmation)
- priceMin, priceMax, priceBasis: missing
- openingHours: missing
- suitableFor: missing (left uncurated — no direct evidence)
- experienceScore: missing
- verificationStatus: missing

### Polar Bear Ice Cream (koramangala, `5e0b86a0`) — NOT READY
- address, lat, lng: missing (ambiguous-address flag; needs confirmation)
- priceMin, priceMax, priceBasis: missing
- openingHours: missing
- suitableFor: missing (left uncurated — no direct evidence)
- vibe: missing (left uncurated — no direct evidence)
- experienceScore: missing
- verificationStatus: missing

### The Grid (koramangala, `7ef6492f`) — NOT READY
- address, lat, lng: missing (ambiguous-address flag; needs confirmation)
- experienceScore: missing
- verificationStatus: missing

### The Reservoire (koramangala, `b4c6442a`) — NOT READY
- priceMin, priceMax, priceBasis: missing
- suitableFor: missing (left uncurated — no direct evidence)
- experienceScore: missing
- verificationStatus: missing

### Shades Creative Gallery (koramangala, `debcb6e0`) — NOT READY
- lat, lng: missing (needs confirmation)
- priceMin, priceMax, priceBasis: missing
- suitableFor: missing (left uncurated — no direct evidence)
- experienceScore: missing
- verificationStatus: missing

### Third Wave Coffee, Koramangala (`23d14932`) — REJECTED, excluded
- Permanently closed per the official store page. Never a candidate.

## Verification notes (all 9 non-rejected)

- Schema: every enriched review still assembles; no schema errors beyond
  the missing-field blockers above.
- Service-area bounds: no coordinate-out-of-bounds findings (wherever
  coordinates are verified, they fall inside their area bounds).
- Source provenance: `sourceUrl` verified on all 9; `source` carried over
  from Overture on all 9.
- Verification status: `verified` on 0 of 9 — the verification workflow
  (field/menu/hours checks), not curation, must close these.
- Confidence: verified carry-over on all 9 (0–1 range intact).

## Importer dry-run (production profile) deltas

The production importer additionally flags `rating`/`reviewCount` as
missing on all 9 (schema-required, readiness-optional). Those are
informational for planning — the engine never scores on them — and were
likewise left missing rather than invented.

## What unblocks promotion

1. Verify prices (min/max/basis) from menus for all 9.
2. Verify hours for Amazing Escape, Smoor, Polar Bear.
3. Confirm addresses/coordinates for Smoor, Polar Bear, Grid, Shades.
4. Confirm serviceArea for Smoor.
5. Run the verification workflow to set `verificationStatus: verified`
   with `lastVerified` dates.
6. Gather craft-signal evidence (not ratings) for `experienceScore`.
