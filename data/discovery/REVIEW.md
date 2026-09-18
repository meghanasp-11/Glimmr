# Unmapped candidate review — 2026-08-19 Overture release

Audit of the 1,622 candidate records the curator could not map into a
Glimmr planning category. Groups are ranked by record count and classified
**by taxonomy meaning only** — never by guessing from business names.
Raw data and provenance are untouched; this report drives mapping changes only.

## Decision summary

| Decision | Records | What happened |
|---|---|---|
| Map → `Dinner` | 7 | `sandwich_shop` (6), `casual_eatery` with no primary (1). Sandwich/food stops; same standing as existing casual dinner spots. Implemented in `curate.ts`. |
| Exclude (new) | 115 | Supplement/smoke shops, medical-supply retail, research institutes, civic/environmental orgs, transport infra, construction trades (full list below). Implemented in `curate.ts` `CURATION_DROP`. |
| Review (stay unmapped) | 1,500 | Kept with `glimmr_category: null` for human curation. No bucket fits honestly. |

Post-review dataset: 3,236 candidates — Dinner 770, Cafe 298, Drinks 196,
Activity 207, Culture 140, Dessert 94, Outdoor 31, unmapped 1,500.

## Mapped (implemented)

| Group (basic / primary) | Count | Glimmr mapping |
|---|---|---|
| `*` / `sandwich_shop` | 6 | Dinner |
| `casual_eatery` / *(none)* | 1 | Dinner |

## Newly excluded (implemented)

| Group | Count | Rationale |
|---|---|---|
| `building_or_construction_service` / `construction_services`, `engineering_services` | 41 | B2B trades, consistent with existing contractor exclusion |
| `travel_and_transportation` / `transportation` | 20 | Transport infra, not a stop |
| `civic_organization` / `non_governmental_association`, `charity_organization`; `environmental_*` orgs | 17 | NGO offices, not stops |
| `research_institute` / `educational_research_institute`, `medical_research_and_development` | 12 | Institutions, not stops |
| `specialty_store` / `medical_supply`, `hearing_aid_provider` | 11 | Medical retail, consistent with medical exclusion |
| `food_and_beverage_store` / `health_food_store`, `vitamins_and_supplements` | 10 | Supplement/errand retail, consistent with grocery exclusion |
| `*` / `tobacco_shop`, `e_cigarette_store` | 4 | Smoke shops, not outing stops |

## Review (kept unmapped, with counts)

| Bloc | Count | Why it stays |
|---|---|---|
| Retail browsing (`shopping`, fashion/apparel, malls, department/second-hand/discount stores, night market) | 864 | Shopping trips are real outings, but Glimmr has no Shopping bucket — forcing these into Dinner/Activity would corrupt planning. Top groups: `shopping/shopping` 430, `clothing_store` 127, `jewelry_store` 53, `shoe_store` 41, `womens/mens_clothing_store` 40 each. Candidate for a future Shopping category, not this review. |
| Beauty/wellness (`personal_or_beauty_service`, `personal_care_and_beauty_store`, `wellness_service`: salons, spas, tattoo, nail, barber) | 305 | Grooming/wellness appointments are outing-adjacent but fit no existing bucket. Forcing them into Activity would pollute adventure plans. |
| No taxonomy at all (`None` / `None`) | 194 | Nothing to judge by — inventing semantics from names is forbidden. Human curation only. |
| Books/music/video, arts & crafts, toys, sporting goods | 69 | Browsing these stores is outing-adjacent (bookstore 22, arts_and_crafts 11, toy_store 8); no bucket fits. |
| Gifts/flowers/florist | 26 | Gift shopping, same reasoning as retail. |
| Liquor / beer-wine-spirits retail | 11 | Bottle shops are borderline social; the Drinks bucket means bars/venues. Left for curation, not forced. |
| Psychic / astrologer | 17 | Culturally outing-like in Bengaluru, but no bucket fits. Left for curation. |
| Miscellaneous singletons (`specialty_foods`, `ethical_grocery`, `musical_instrument_store`, `motorsport_vehicle_dealer`, `food_service` with no primary, etc.) | 14 | Too small to rule on; kept for curation. |

## Proposed future mappings (not implemented)

- If a Shopping planning category is ever added to the engine buckets: map
  the 864-record retail bloc (primary list in the table above) to it.
- `bookstore` → Culture is the closest existing fit, but it stretches the
  museum/temple/theatre meaning — deliberately left for human curation, not
  auto-mapped here.
- `night_market` is clearly outing-relevant yet fits no existing category;
  same treatment as retail.

## Reproducing

```bash
npm run discovery:curate -w @glimmr/scripts -- --dry-run   # counts only
```
