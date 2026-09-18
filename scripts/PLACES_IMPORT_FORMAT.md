# Glimmr Places Import Format

Production-ready JSON format for importing real Bengaluru place data into the
Firestore `places` and `serviceAreas` collections. Validated by
`scripts/src/place-import.ts`, written by `scripts/src/seed-places.ts`.
A fill-in template lives at `scripts/src/data/places.production.example.json`.

> Do not invent businesses. Every production record must describe a real,
> verifiable place and carry a `sourceUrl` proving it. Sample/development
> data lives separately in `scripts/src/data/places.seed.json` and is
> rejected by production validation.

## File shape

```json
{
  "serviceAreas": [ { "id": "indiranagar", "name": "Indiranagar", "city": "Bengaluru", "active": true } ],
  "places": [ { "id": "p-example", ... } ]
}
```

Service areas are data, not code: the importer resolves area ids from this
file, so the three V1 areas (`indiranagar`, `koramangala`, `church-street`)
— or any future area — work with no code branches. Each place's
`serviceArea` must match an area id in the same file.

## Validation modes

| Check | Standard (default) | `--production` |
|---|---|---|
| Zod `PlaceSchema` / `ServiceAreaSchema` | ✅ | ✅ |
| Duplicate place ids | ✅ reject | ✅ reject |
| Duplicate name + address | ✅ reject | ✅ reject |
| Unknown `serviceArea` | ✅ reject | ✅ reject |
| All recommendation-critical fields present (below) | — | ✅ reject |
| `sourceUrl` present, valid http(s) URL | — | ✅ reject |
| `verificationStatus` must be `"verified"` | — | ✅ reject |
| `openingHours` parseable by the engine grammar | — | ✅ reject |
| Coordinates inside the area `bounds` (when present) | — | ✅ reject |
| Sample-marked records (`source: "sample-seed"`, `[SAMPLE]` names) | accepted | ✅ reject |

Any failure rejects the whole file: nothing is written, exit code is 1.

## Recommendation-critical fields (required in production)

`id`, `name`, `serviceArea`, `category`, `address`, `lat`, `lng`,
`priceMin`, `priceMax`, `priceBasis`, `openingHours`,
`typicalVisitDuration`, `suitableFor` (≥1), `activities` (≥1), `vibe`,
`experienceScore`, `verificationStatus`, `confidence`, `sourceUrl`.

Field rules:

- **Coordinates**: valid latitude/longitude ranges (schema), and inside the
  declared area's `bounds` rectangle when the area defines one. Coordinates
  must be real verified geocodes, not block approximations.
- **Prices**: `priceMin >= 0`, `priceMax >= priceMin`, `priceBasis` one of
  `per_person` / `per_group` / `flat`. Use real menu/guide figures.
- **Hours**: one of `"<h>[:mm] AM|PM - <h>[:mm] AM|PM"` (e.g.
  `"9:00 AM - 9:00 PM"`, overnight `"12:00 PM - 1:00 AM"`), or
  `"Always open"`. This is the exact grammar the recommendation engine
  parses — anything else means the place can never be matched to its hours.
- **Duplicates**: ids must be unique; `name` + `address` pairs must be
  unique (case-insensitive). One record per real place.
- **Confidence/verification**: `confidence` is 0–1; production records must
  have `verificationStatus: "verified"` plus a `sourceUrl` pointing at the
  page the facts were verified against. `lastVerified` is the `YYYY-MM-DD`
  that check happened.

## Commands

```bash
# Validate only (no writes, no credentials needed)
npm run seed:places:dry-run -w @glimmr/scripts -- --file ./my-places.json
npm run seed:places:dry-run -w @glimmr/scripts -- --file ./my-places.json --production

# Write to the local Firestore emulator
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-glimmr \
  npm run seed:places -w @glimmr/scripts -- --file ./my-places.json --production

# Write to the real project (key file lives OUTSIDE the repo, never committed)
FIREBASE_PROJECT_ID=glimmr-3b56a GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/key.json \
  npm run seed:places -w @glimmr/scripts -- --file ./my-places.json --production
```

Writes use fixed document ids (`serviceAreas/{id}`, `places/{id}`), so
re-running an import overwrites the same documents instead of duplicating
them. The sample seed command is unchanged:

```bash
npm run seed:places -w @glimmr/scripts   # standard mode, sample data only
```

## Production area files (`data/production/`)

Real verified data lives per area — one file per service area, never mixed
with samples:

```text
data/production/
  indiranagar.json      # { serviceArea: {...}, places: [...] }
  koramangala.json      # { serviceArea: {...}, places: [...] }
  church-street.json    # { serviceArea: {...}, places: [...] }
  merged.production.json  # generated output (see below), not hand-edited
```

Each file carries its own `serviceArea` row plus that area's `places`.
A place whose `serviceArea` does not match its file is rejected as misfiled.
Sample seed data stays in `scripts/src/data/places.seed.json` and must never
be copied here — production validation rejects sample-marked records.

Combine and validate the three files with:

```bash
# Validate only (no writes)
npm run merge:production -w @glimmr/scripts -- --dry-run

# Merge + validate + write data/production/merged.production.json
npm run merge:production -w @glimmr/scripts

# Custom locations (discovery still applies: every *.json except the output)
npm run merge:production -w @glimmr/scripts -- --dir ./other-dir --out ./out.json --dry-run
```

The merge discovers area files (no hard-coded list), rejects malformed
files and misfiled places, then runs the merged dataset through production
validation — duplicate ids and duplicate name+address pairs are rejected
globally across all areas. Nothing is written unless everything passes.
Feed the merged file to the seed command to import it:

```bash
npm run seed:places -w @glimmr/scripts -- --file data/production/merged.production.json --production
```

## Discovery pipeline (Overture Places → raw discovery)

Real-world candidates come from Overture Places (free, no keys), never from
Nominatim, Google, food-delivery apps, or paid APIs:

1. **Download** (`scripts/src/discovery/download_overture.py`, official
   `overturemaps` Python client, `pip install -r scripts/src/discovery/requirements.txt`):
   reads area bounds from `data/production/*.json` — exactly the V1 areas,
   no hard-coded list — and writes one raw snapshot per area to
   `data/discovery/raw/<area>.overture.json`, preserving Overture id,
   names, geometry, `basic_category`, taxonomy, addresses, websites,
   `operating_status`, confidence, and sources, plus the release
   (e.g. `2026-08-19.0`), bbox, fetch time, and columns in metadata.
   ```bash
   python scripts/src/discovery/download_overture.py [--release YYYY-MM-DD]
   ```
2. **Normalize** (`scripts/src/discovery/overture.ts`, tested):
   shapes snapshots into reviewable `data/discovery/<area>.json` records and
   drops permanently closed places, obviously outing-irrelevant POI
   categories (banks, fuel, schools, hospitals, hotels, … — evidence-based
   list in code; uncategorized records are kept), and records with no name
   or geometry. Nothing is converted to production `Place` records here —
   no prices, hours, or vibes are invented.
   ```bash
   npm run discovery:normalize -w @glimmr/scripts [--dry-run]
   ```
3. **Curate** (`scripts/src/discovery/curate.ts`, tested): deduplicates
   globally by stable Overture id plus normalized name+address+coordinates,
   drops obvious non-outing entities (explicit evidence-based list, no
   external APIs), maps Overture categories into the existing Glimmr
   planning categories (Cafe, Dessert, Dinner, Activity, Culture, Outdoor,
   Drinks; honest `null` when nothing maps), and preserves provenance and
   confidence on every record. No prices, hours, or scores are invented —
   candidates are not production places. Writes per-area
   `data/discovery/candidates/<area>.json` plus a counts-by-area-and-category
   `summary.json`; raw discovery files are only read, never modified.
   ```bash
   npm run discovery:curate -w @glimmr/scripts [--dry-run]
   ```
4. **Shortlist** (`scripts/src/discovery/shortlist.ts`, tested): ranks
   curated candidates for manual verification priority using only existing
   source data — Glimmr category base (food-first), listed-open status,
   scaled source confidence, website availability — with per-area quotas
   (all V1 areas represented) and a per-category floor plus a grid-cell cap
   for geographic spread. Unmapped records are excluded from the shortlist,
   never force-mapped. Writes a single ranked
   `data/discovery/shortlist.json` (~180 records); every pick carries
   `verification_rank`, `verification_score`, and `verification_reasons`.
   The full candidate dataset stays unchanged.
   ```bash
   npm run discovery:shortlist -w @glimmr/scripts [--target 180] [--dry-run]
   ```
5. **Verify** (`scripts/src/discovery/verify.ts`, tested): maps every
   shortlisted record into the production Place shape with explicit nulls
   for anything unverified — price, hours, duration, activities,
   suitability, vibe, and scores stay unknown until a human verifies or
   curates them. Source-verified facts (name, address, coordinates,
   category, website, confidence, Overture provenance) are kept separate
   from curated attributes via per-field sources. Writes per-place
   `data/discovery/verification/<area>/<overture_id>.json` drafts, each
   with a checklist and its incomplete production blockers
   (`sourceUrl`, `verificationStatus`, `confidence`, `lastVerified`
   required), plus a rollup summary with the missing-field histogram. Raw
   discovery data is only read, never modified; no facts are invented or
   scraped.
   ```bash
   npm run discovery:verify -w @glimmr/scripts [--dry-run]
   ```
6. **Queue** (`scripts/src/discovery/queue.ts`, tested): selects the top
   40 shortlisted places for manual verification — rank order first, with
   guaranteed coverage of all V1 areas and all Glimmr categories. Each
   entry carries name, area, category, coordinates, website, Overture
   sources, confidence, the fields still requiring verification, an
   explicit priority reason, and source-priority guidance (official
   website → another reliable public source → unknown). Curated
   attributes stay empty. Writes machine-readable
   `data/discovery/verification-queue.json` plus human-readable
   `data/discovery/verification-queue.md`; all 180 drafts and raw data
   stay unchanged.
   ```bash
   npm run discovery:queue -w @glimmr/scripts [--size 40] [--dry-run]
   ```
7. **Evidence** (`scripts/src/discovery/evidence.ts`, tested): fetches only
   URLs already on file (official website first, then secondary URLs) with
   politeness delay, timeout, and retries. Blocked hosts (Google Maps,
   Zomato, Swiggy, Instagram) are never fetched; every outcome including
   failures becomes a record, so the pipeline never crashes. Stores source
   URL, fetch date, page title, and raw keyword excerpts for hours,
   pricing, address, and status — never converted into curated facts.
   Writes `data/discovery/evidence.json` plus human-readable
   `data/discovery/evidence-report.md` (verified vs missing). Queue,
   drafts, and raw data stay unchanged.
   ```bash
   npm run discovery:evidence -w @glimmr/scripts [--limit N] [--delay-ms 2000] [--dry-run]
   ```
8. **Dossier** (`scripts/src/discovery/dossier.ts`, tested): joins drafts
   with evidence into one ranked review record per queued place in
   `data/discovery/dossier.json`. Every production Place field carries its
   value beside the relevant evidence with a status of `verified`,
   `missing`, `conflicting`, or `needs_manual_review`; curated attributes
   are never inferred. Flags call out stale, ambiguous, unreachable, or
   contradictory evidence; records rank by completeness. Drafts, evidence,
   and raw data stay unchanged; nothing is promoted to production data.
   ```bash
   npm run discovery:dossier -w @glimmr/scripts [--dry-run]
   ```
10. **Batch** (`scripts/src/discovery/batch.ts`, tested): takes the top 10
   dossier records by verification completeness and writes one review file
   per place to `data/discovery/reviews/<area>/<overture_id>.json` in the
   reviewed-place format, plus ranked `data/discovery/review-batch.md`.
   Dossier-verified values are preserved with cited sources; everything
   else — including all curated attributes — stays missing-with-reason.
   No fetching, no invention, no promotion.
   ```bash
   npm run discovery:batch -w @glimmr/scripts [--size 10] [--dry-run]
   ```
12. **Recommendation-readiness profile** (`scripts/src/discovery/readiness.ts`,
   tested, additive only): `evaluateRecommendationReadiness()` judges each
   reviewed place on the engine-critical field set (identity, area,
   category, address, coordinates, price range/basis, parseable opening
   hours, visit duration, activities, suitableFor, vibe, experienceScore,
   plus sourceUrl, verified verificationStatus, confidence, lastVerified).
   Rating, reviewCount, description, subcategory, and mapsUrl stay optional
   and never block. Verified and curated values are reported separately;
   nothing is auto-filled. The existing production profile is untouched.
   ```bash
   npm run discovery:readiness -w @glimmr/scripts
   ```

11. **Enrichment rubric v1** (`scripts/src/discovery/rubric.ts`, tested):
   deterministic rules for curated attributes, applied to synthetic test
   records only — never to real places yet.
   - `typicalVisitDuration`: positive whole minutes inside the per-category
     planning band (Cafe 20–45, Dessert 15–30, Dinner 45–90, Drinks 45–90,
     Activity 45–120, Culture 30–90, Outdoor 20–60); outside the band needs
     a cited official figure. A duration is a planning estimate, never an
     official fact unless explicitly sourced.
   - `activities`: 1+ tags from the engine set (peaceful, food,
     photography, coffee, outdoor, drinks, culture, active, chill, art).
   - `suitableFor`: 1+ of solo, couple, friends, family.
   - `vibe`: non-empty, ≤140 characters.
   - `experienceScore`: 0–1 with named quality-signal basis; ratings,
     review counts, popularity, stars, or trending language anywhere in the
     basis or reason is rejected — scores are never popularity by proxy.
   - Every attribute needs an explicit curation reason (≥10 chars).
   - Verification-gated keys (identity, prices, hours, coordinates,
     verificationStatus, sourceUrl, …) are rejected here: curation can
     never bypass the verification workflow.
   Applied to Batch-01 via `npm run discovery:propose -w @glimmr/scripts`,
   which validates every proposal through the rubric and emits
   `data/discovery/curation-proposals.json` plus a reason-and-blockers
   report. A human still enters values into review files by hand.
9. **Promotion (dry-run only)** (`scripts/src/discovery/promote.ts`, tested):
   human reviewers enter verified facts and Glimmr-curated fields in
   reviewed-place files (`data/discovery/reviews/<area>/<overture_id>.json`):

   ```json
   {
     "overture_id": "<uuid>",
     "service_area": "indiranagar",
     "reviewer": "name (optional)",
     "reviewed_at": "2026-09-16 (optional)",
     "fields": {
       "name": { "value": "Real Name", "status": "verified", "source": "https://venue.example/" },
       "vibe": { "value": "Lively", "status": "curated", "source": "reviewer judgment" },
       "priceMin": { "value": null, "status": "missing", "reason": "menu not found yet" },
       "description": { "value": null, "status": "rejected", "reason": "duplicate of p-other" }
     }
   }
   ```

   Field statuses are `verified` (checked against the cited source),
   `curated` (entered by hand), `missing` (with a reason), or `rejected`
   (with a reason). Curated attributes stay empty until explicitly supplied
   here — nothing is defaulted or fetched. `discovery:promote` assembles
   each Place from verified/curated values only and runs it through the
   existing production validator; passing records report ready, the rest
   stay in review with named blockers. Nothing is ever written to
   production data.
   ```bash
   npm run discovery:promote -w @glimmr/scripts [--reviews-dir <path>] [--dry-run]
   ```
