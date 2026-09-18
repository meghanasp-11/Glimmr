/**
 * Curate normalized Overture discovery records into a Glimmr candidate dataset.
 *
 * Pure functions (no network, no Firestore, no external APIs):
 * - Deduplicate globally by stable Overture id plus normalized
 *   name+address+coordinates (rounded), so chains/branches with distinct
 *   addresses survive while true duplicates collapse.
 * - Drop obvious non-outing entities via an explicit, evidence-based list
 *   (grounded in the 2026-08-19 extract for the V1 areas).
 * - Map Overture categories into the existing Glimmr planning categories
 *   (Cafe, Dessert, Dinner, Activity, Culture, Outdoor, Drinks) — the same
 *   closed set the recommendation engine's buckets already use. Records with
 *   no honest mapping keep `glimmr_category: null` for human curation.
 * - Preserve provenance (Overture id, sources, release, confidence) on every
 *   retained record.
 *
 * Nothing is invented: candidate records carry NO price, hours, visit
 * duration, vibe, activities, suitability, ratings, or experience scores.
 * Those only ever come from real verification during production curation.
 */

import type { RawDiscoveryPlace } from "./overture";

export type GlimmrCategory =
  | "Cafe"
  | "Dessert"
  | "Dinner"
  | "Activity"
  | "Culture"
  | "Outdoor"
  | "Drinks";

export interface CandidatePlace {
  overture_id: string;
  service_area: string;
  name: string;
  address_freeform: string | null;
  locality: string | null;
  lat: number;
  lng: number;
  glimmr_category: GlimmrCategory | null;
  category_match: "primary" | "basic" | "rule" | "none";
  overture_primary: string | null;
  overture_basic: string | null;
  taxonomy_primary: string | null;
  websites: string[];
  operating_status: string | null;
  confidence: number | null;
  provenance: {
    sources: unknown[];
    overture_release: string;
  };
}

export interface CurateCounts {
  fetched: number;
  kept: number;
  mapped: number;
  unmapped: number;
  dropped_duplicates: number;
  dropped_non_outing: number;
}

export interface CurateResult {
  candidates: CandidatePlace[];
  counts: CurateCounts;
  byCategory: Record<string, number>;
}

/**
 * Obvious non-outing entities that survived discovery normalization, keyed
 * by Overture primary category (basic_category is checked too). Grounded in
 * the real extract: B2B/industrial vendors, repair/errand trades, retail
 * that is never a destination (phone/computer/electronics/furniture/
 * grocery/hardware), clinics and care facilities, bureaucratic services,
 * media production, and lodging-adjacent leftovers. Anything ambiguous
 * (bookstores, tattoo, astrologers, spas, liquor shops, markets) stays.
 */
export const CURATION_DROP: ReadonlySet<string> = new Set([
  // Core obvious non-outing entities (also filtered at discovery time;
  // repeated here so curation holds on any input, not just ours)
  "hospital", "dentist", "pharmacy",
  "bank_credit_union", "banks", "atms", "financial_service",
  "school", "preschool", "high_school", "elementary_school", "college_university",
  "hotel", "hostel", "resort", "lodging", "bed_and_breakfast", "guest_house",
  "service_apartments", "private_lodging", "lodge", "inn", "holiday_rental_home",
  "gas_station", "fueling_station", "parking",
  "car_dealer", "automotive_repair",
  "police_station", "post_office", "courthouse", "embassy",
  // Destination-never retail and errand trades
  "mobile_phone_store", "mobile_phone_accessories", "computer_store", "electronics",
  "electronics_store", "appliance_store", "hardware_store", "hardware_home_and_garden_store",
  "office_supply_store", "vehicle_parts_store", "furniture_store", "furniture_manufacturers",
  "home_goods_store", "home_decor", "bedding_and_bath_stores", "mattress_store",
  "building_supply_store", "kitchen_and_bath", "kitchen_supply_store",
  "tile_store", "carpet_store", "paint_store", "lighting_store", "window_treatment_store",
  "window_supplier", "windows_installation",
  "grocery_store", "indian_grocery_store", "organic_grocery_store", "korean_grocery_store",
  "fruits_and_vegetables", "butcher_shop",
  "printing_service", "printing_services", "sign_making",
  "shipping_or_delivery_service", "shipping_center", "freight_and_cargo_service",
  "freight_forwarding_agency", "food_delivery_service",
  "caterer", "session_photography", "videographer",
  "movers",
  // B2B / industrial / production leftovers
  "business_to_business", "supplier_or_distributor", "b2b_service",
  "b2b_office_and_professional_service", "b2b_industrial_and_machine_service",
  "b2b_energy_and_utility_service", "b2b_transportation_and_storage_service",
  "b2b_science_and_technology_service", "b2b_textiles", "b2b_electronic_equipment",
  "b2b_oil_and_gas_extraction_and_services", "commercial_industrial", "industrial_company",
  "chemical_plant", "cement_supplier", "metal_fabricator", "machine_shop",
  "weaving_mill", "textile_mill", "grain_production", "pipeline_transportation",
  "architect", "architectural_designer", "interior_design", "product_design",
  "graphic_designer", "web_designer", "marketing_consultant", "business_consulting",
  "consultant",
  "music_production", "broadcasting_media_production", "movie_television_studio",
  "animation_studio", "radio_station", "newspaper_advertising", "print_media",
  "e_commerce_service", "web_hosting_service", "it_consultant",
  "translating_and_interpreting_services", "secretarial_services", "paralegal_services",
  "patent_law", "ip_and_internet_law", "divorce_and_family_law", "real_estate_law",
  "process_servers", "appraisal_services",
  "human_resource_services", "executive_search_consultants", "public_relations",
  "custom_t_shirt_store", "screen_printing_t_shirt_printing",
  "gold_buyer",
  // Care facilities and clinical leftovers
  "reproductive_perinatal_and_womens_care", "complementary_and_alternative_medicine",
  "behavioral_or_mental_health_clinic", "specialized_health_care",
  "physical_medicine_and_rehabilitation", "pediatric_clinic", "pediatric_endocrinology",
  "pediatric_pulmonology", "nephrologist", "cardiologist", "gastroenterologist",
  "pulmonologist", "oncologist", "psychiatrist", "psychologist", "psychotherapist",
  "chiropractor", "audiologist", "allergist", "naturopathic_holistic",
  "surgery", "fertility", "sex_therapist", "nutritionist",
  "blood_and_plasma_donation_center", "medical_spa",
  "weight_loss_center", "hair_loss_center", "laser_hair_removal", "hair_replacement",
  "maternity_centers", "senior_living_facility", "assisted_living_facility", "retirement_home",
  "life_coach", "marriage_or_relationship_counselor", "career_counseling",
  "passport_and_visa_services", "visa_agent", "customs_broker", "immigration_law",
  "mortgage_lender", "insurance_agency",
  "internet_cafe",
  // Review-round exclusions: clearly non-outing groups surfaced by the
  // unmapped audit (research institutes, civic/environmental orgs,
  // transport infra, construction trades, supplement/smoke shops,
  // medical-supply retail). Retail browsing, beauty/wellness services,
  // bookstores, markets, and uncategorized records stay for human review.
  "educational_research_institute", "medical_research_and_development", "research_institute",
  "non_governmental_association", "charity_organization", "civic_organization",
  "environmental_and_ecological_services_for_businesses",
  "environmental_conservation_organization", "environmental_or_ecological_service",
  "transportation", "travel_and_transportation",
  "construction_services", "engineering_services", "building_or_construction_service",
  "health_food_store", "vitamins_and_supplements",
  "tobacco_shop", "e_cigarette_store",
  "medical_supply", "hearing_aid_provider",
]);

const EXPLICIT_MAP: Readonly<Record<string, GlimmrCategory>> = {
  // Cafe
  cafe: "Cafe", coffee_shop: "Cafe", tea_room: "Cafe", smoothie_juice_bar: "Cafe",
  bubble_tea: "Cafe", bakery: "Cafe", patisserie_cake_shop: "Cafe", donuts: "Cafe",
  cupcake_shop: "Cafe", breakfast_and_brunch_restaurant: "Cafe", diner: "Cafe",
  // Dessert
  ice_cream_shop: "Dessert", desserts: "Dessert", gelato: "Dessert", chocolatier: "Dessert",
  candy_store: "Dessert", frozen_yoghurt_shop: "Dessert",
  // Dinner (cuisines not listed fall through to the *_restaurant rule)
  indian_restaurant: "Dinner", restaurant: "Dinner", fast_food_restaurant: "Dinner",
  vegetarian_restaurant: "Dinner", food_truck: "Dinner", food_truck_stand: "Dinner",
  buffet_restaurant: "Dinner", food: "Dinner", food_and_drink: "Dinner",
  eat_and_drink: "Dinner", sandwich_shop: "Dinner", casual_eatery: "Dinner",
  // Drinks
  bar: "Drinks", pub: "Drinks", lounge: "Drinks", brewery: "Drinks", winery: "Drinks",
  hookah_bar: "Drinks", sports_bar: "Drinks", cocktail_bar: "Drinks", beer_bar: "Drinks",
  dance_club: "Drinks", wine_bar: "Drinks", non_alcoholic_beverage_venue: "Drinks",
  gastropub: "Drinks",
  // Activity
  gym: "Activity", yoga_studio: "Activity", sport_or_fitness_facility: "Activity",
  sport_court: "Activity", swimming_pool: "Activity", arcade: "Activity",
  bowling_alley: "Activity", pool_billiards: "Activity", karaoke: "Activity",
  escape_rooms: "Activity", miniature_golf_course: "Activity", rock_climbing_spot: "Activity",
  amusement_attraction: "Activity", gaming_venue: "Activity", stadium_arena: "Activity",
  movie_theater: "Activity", cinema: "Activity", theatre: "Activity", theatre_venue: "Activity",
  performing_arts_venue: "Activity", auditorium: "Activity", comedy_club: "Activity",
  music_venue: "Activity", circus: "Activity", zoo: "Activity", aquarium: "Activity",
  sports_and_recreation: "Activity", sports_and_recreation_venue: "Activity",
  sport_or_recreation_club: "Activity", sport_league: "Activity",
  martial_arts_club: "Activity", karate_club: "Activity",
  dance_school: "Activity", music_school: "Activity", art_school: "Activity",
  cooking_school: "Activity", tours: "Activity", sightseeing_tour_agency: "Activity",
  recreational_equipment_rental: "Activity", bike_rentals: "Activity",
  arts_and_entertainment: "Activity", event_venue: "Activity",
  // Culture
  museum: "Culture", art_gallery: "Culture", library: "Culture",
  hindu_temple: "Culture", church_cathedral: "Culture", mosque: "Culture",
  catholic_church: "Culture", pentecostal_church: "Culture", anglican_church: "Culture",
  jewish_place_of_worship: "Culture", religious_organization: "Culture",
  landmark_and_historical_building: "Culture", historic_site: "Culture", monument: "Culture",
  cultural_center: "Culture", community_center: "Culture", history_museum: "Culture",
  // Outdoor
  park: "Outdoor",
  garden: "Outdoor", botanical_garden: "Outdoor", beach: "Outdoor",
  campground: "Outdoor", fairgrounds: "Outdoor", cricket_ground: "Outdoor",
};

function normalizeToken(value: string | null): string | null {
  if (value === null) return null;
  const token = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return token.length > 0 ? token : null;
}

/**
 * Map an Overture category into a Glimmr planning category: explicit table
 * first, then cuisine (*_restaurant) and bar (*_bar) suffix rules, trying the
 * primary category before the coarser basic_category. Null when nothing
 * maps honestly — never forced.
 */
export function mapGlimmrCategory(
  primary: string | null,
  basic: string | null,
): { category: GlimmrCategory | null; match: "primary" | "basic" | "rule" | "none" } {
  const tryToken = (token: string | null): { category: GlimmrCategory | null; rule: boolean } => {
    if (token === null) return { category: null, rule: false };
    const exact = EXPLICIT_MAP[token];
    if (exact) return { category: exact, rule: false };
    if (token === "restaurant" || token.endsWith("_restaurant")) return { category: "Dinner", rule: true };
    if (token.endsWith("_bar")) return { category: "Drinks", rule: true };
    return { category: null, rule: false };
  };
  const fromPrimary = tryToken(normalizeToken(primary));
  if (fromPrimary.category) {
    return { category: fromPrimary.category, match: fromPrimary.rule ? "rule" : "primary" };
  }
  const fromBasic = tryToken(normalizeToken(basic));
  if (fromBasic.category) {
    return { category: fromBasic.category, match: fromBasic.rule ? "rule" : "basic" };
  }
  return { category: null, match: "none" };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable dedup key: normalized name + address + coordinates rounded to ~11 m. */
export function dedupKey(name: string, address: string | null, lat: number, lng: number): string {
  return `${normalizeText(name)}|${address === null ? "" : normalizeText(address)}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
}

export function curateRecords(records: RawDiscoveryPlace[]): CurateResult {
  const candidates: CandidatePlace[] = [];
  const counts: CurateCounts = {
    fetched: records.length,
    kept: 0,
    mapped: 0,
    unmapped: 0,
    dropped_duplicates: 0,
    dropped_non_outing: 0,
  };
  const byCategory: Record<string, number> = {};
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  for (const record of records) {
    if (seenIds.has(record.overture_id)) {
      counts.dropped_duplicates += 1;
      continue;
    }
    const key = dedupKey(record.name, record.address_freeform, record.lat, record.lng);
    if (seenKeys.has(key)) {
      counts.dropped_duplicates += 1;
      continue;
    }
    const primary = normalizeToken(record.primary_category);
    const basic = normalizeToken(record.basic_category);
    if ((primary !== null && CURATION_DROP.has(primary)) || (basic !== null && CURATION_DROP.has(basic))) {
      counts.dropped_non_outing += 1;
      continue;
    }
    seenIds.add(record.overture_id);
    seenKeys.add(key);

    const mapped = mapGlimmrCategory(record.primary_category, record.basic_category);
    const candidate: CandidatePlace = {
      overture_id: record.overture_id,
      service_area: record.service_area,
      name: record.name,
      address_freeform: record.address_freeform,
      locality: record.locality,
      lat: record.lat,
      lng: record.lng,
      glimmr_category: mapped.category,
      category_match: mapped.match,
      overture_primary: record.primary_category,
      overture_basic: record.basic_category,
      taxonomy_primary: record.taxonomy_primary,
      websites: record.websites,
      operating_status: record.operating_status,
      confidence: record.confidence,
      provenance: {
        sources: record.sources,
        overture_release: record.overture_release,
      },
    };
    candidates.push(candidate);
    counts.kept += 1;
    if (mapped.category) {
      counts.mapped += 1;
    } else {
      counts.unmapped += 1;
    }
    const bucket = mapped.category ?? "unmapped";
    byCategory[bucket] = (byCategory[bucket] ?? 0) + 1;
  }

  return { candidates, counts, byCategory };
}
