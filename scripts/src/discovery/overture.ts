/**
 * Normalize raw Overture Places snapshots into Glimmr's raw discovery format.
 *
 * Pure functions (no network, no Firestore). The downloader
 * (scripts/src/discovery/download_overture.py) preserves Overture fields
 * faithfully; this module shapes them into reviewable discovery records and
 * drops only what is clearly unusable for outings:
 * - permanently closed places (exact operating_status match; unknown/null kept),
 * - obviously outing-irrelevant POI categories (evidence-based exclusion
 *   list below, matched against categories.primary and basic_category;
 *   uncategorized records are kept for human curation),
 * - records with no usable name or no point geometry.
 *
 * This is deliberately NOT a conversion to production Place records — no
 * prices, hours, vibes, or ratings are invented here. Real curation turns
 * discovery records into production places later.
 */

/** One Overture record as preserved by the downloader (loose: fields may be null). */
export interface OvertureRecord {
  overture_id?: unknown;
  names?: { primary?: unknown; common?: unknown } | null;
  categories?: { primary?: unknown } | null;
  basic_category?: unknown;
  taxonomy?: { primary?: unknown } | null;
  addresses?: { freeform?: unknown; locality?: unknown }[] | null;
  websites?: unknown;
  operating_status?: unknown;
  confidence?: unknown;
  sources?: unknown;
  geometry?: { lng?: unknown; lat?: unknown } | null;
}

export interface OvertureSnapshot {
  source?: unknown;
  overture_release?: unknown;
  service_area?: unknown;
  fetched_at_utc?: unknown;
  records?: unknown;
}

/** Reviewable discovery record. No invented facts — only Overture content. */
export interface RawDiscoveryPlace {
  overture_id: string;
  service_area: string;
  name: string;
  address_freeform: string | null;
  locality: string | null;
  lat: number;
  lng: number;
  basic_category: string | null;
  primary_category: string | null;
  taxonomy_primary: string | null;
  websites: string[];
  operating_status: string | null;
  confidence: number | null;
  sources: unknown[];
  overture_release: string;
}

export interface NormalizeCounts {
  fetched: number;
  kept: number;
  dropped_closed: number;
  dropped_irrelevant: number;
  dropped_unusable: number;
}

export interface NormalizeResult {
  places: RawDiscoveryPlace[];
  counts: NormalizeCounts;
}

const CLOSED_STATUSES = new Set(["permanently_closed"]);

/**
 * Outing-irrelevant primary/basic categories, grounded in the actual
 * 2026-08-19 Overture extract for the V1 areas (7,066 records surveyed).
 * Conservative: financial/automotive/government/school/medical/lodging/
 * vendor infrastructure only. Temples, clinics of fun (spas, salons, gyms,
 * tattoo), bars, venues, parks, and uncategorized records are all kept.
 */
export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  // Money
  "bank_credit_union", "bank_or_credit_union", "banks", "atms", "financial_service",
  "credit_union", "currency_exchange", "installment_loans", "stock_and_bond_brokers",
  "mortgage_lender", "tax_services", "investing", "life_insurance",
  "health_insurance_office", "insurance_agency",
  // Legal, accounting, hiring
  "attorney_or_law_firm", "lawyer", "legal_services", "legal_service",
  "accountant", "employment_agencies",
  // Cars, fuel, parking, transport infra
  "car_dealer", "motorcycle_dealer", "used_car_dealer", "auto_parts_and_supply_store",
  "automotive_services_and_repair", "automotive_repair", "tire_dealer_and_repair",
  "tire_shop", "gas_station", "fueling_station", "car_wash", "auto_detailing",
  "auto_body_shop", "engine_repair_service", "motorcycle_repair", "auto_customization",
  "car_stereo_store", "car_rental_agency", "motorcycle_rentals", "parking",
  "taxi_service", "taxi_or_ride_share_service", "ev_charging_station",
  "emergency_roadside_service", "airport", "train_station", "bus_station",
  "public_transit_facility_or_service", "rail_facility_or_service", "trains",
  "airline", "flight_school", "auto_company",
  // Government and civic infrastructure
  "central_government_office", "police_department", "police_station", "post_office",
  "courthouse", "embassy", "public_service_and_government",
  // Schools, tutoring, daycare, driving schools (institutions, not stops)
  "school", "preschool", "high_school", "elementary_school", "college_university",
  "specialty_school", "tutoring_center", "tutoring_service", "computer_coaching",
  "language_school", "test_preparation", "education", "educational_services",
  "vocational_and_technical_school", "day_care_preschool", "child_care_and_day_care",
  "driving_school", "campus_building", "private_school", "public_school",
  "nursing_school", "medical_school", "business_schools", "dentistry_schools",
  "cosmetology_school", "student_union",
  // Medical (doctors, dentists, diagnostics, pharmacies)
  "hospital", "dentist", "general_dentistry", "dental_clinic", "cosmetic_dentist",
  "orthodontist", "pediatric_dentist", "periodontist", "diagnostic_services",
  "diagnostic_imaging", "laboratory_testing", "pharmacy", "pharmaceutical_companies",
  "medical_center", "health_and_medical", "medical_service", "medical_service_organizations",
  "specialized_medical_facility", "walk_in_clinic", "primary_care_or_general_clinic",
  "outpatient_care_facility", "eye_care_clinic", "vision_or_eye_care_clinic",
  "optometrist", "ophthalmologist", "dermatologist", "pediatrician", "surgeon",
  "plastic_surgeon", "cosmetic_surgeon", "doctor", "clinics",
  "obstetrician_and_gynecologist", "ear_nose_and_throat", "urologist", "neurologist",
  // Bureaucratic services
  "passport_and_visa_services", "visa_agent", "customs_broker", "immigration_law",
  // Lodging (not drop-in outing stops)
  "hotel", "hostel", "resort", "lodging", "bed_and_breakfast", "guest_house",
  "service_apartments", "private_lodging", "lodge", "inn", "holiday_rental_home",
  // Event vendors (planners, caterers — not venues, which are kept)
  "party_and_event_planning", "event_or_party_service", "wedding_planning",
  "event_photography", "dj_service", "caterer",
  // Travel agencies (tour operators kept separately as potential outings)
  "travel_services", "travel_service", "travel_agents", "travel_company",
  // B2B / professional / industrial services
  "professional_services", "professional_service", "software_development", "information_technology_company",
  "marketing_agency", "advertising_agency", "business_management_services",
  "corporate_office", "corporate_or_business_office", "manufacturer", "wholesaler", "contractor",
  "electrician", "media_service", "social_or_community_service",
  // Coarse basic-category spellings observed in the extract
  "auto_dealer", "government_office", "automotive_service", "place_of_learning",
  "educational_service", "technical_service", "home_service", "tutoring_service",
  "pharmacy_and_drug_store", "rental_service", "vehicle_service",
  "animal_and_pet_store", "animal_or_pet_service", "diagnostics_imaging_or_lab_service",
  "health_care", "family_service",
  // Real estate
  "real_estate_service", "real_estate_agent", "property_management", "home_developer",
  "commercial_real_estate",
  // Carriers, utilities, civic services
  "telecommunications_service", "telecommunications", "telecommunications_company",
  "internet_service_provider", "television_service_providers",
  "electric_utility_provider", "natural_gas_utility_provider",
  "garbage_collection_service", "recycling_center", "public_utility",
  // Repair trades and errand services
  "it_service_and_computer_repair", "mobile_phone_repair", "appliance_repair_service",
  "laundry_service", "dry_cleaning", "laundromat",
  // Medical-adjacent personal services
  "veterinarian", "pet_groomer", "pet_boarding", "pet_breeder",
  "animal_shelter", "animal_rescue_service",
  // Industrial agriculture and funerals
  "farm", "agriculture", "rice_mill", "poultry_farm", "funeral_services_and_cemeteries",
  // Storage and wholesale clubs
  "storage_facility", "warehouse_club_store",
  // Work, not outings
  "coworking_space",
]);

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function websiteList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function sourceList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeOvertureSnapshot(snapshot: OvertureSnapshot): NormalizeResult {
  const serviceArea = asNonEmptyString(snapshot.service_area) ?? "unknown";
  const release = asNonEmptyString(snapshot.overture_release) ?? "unknown";
  const rawRecords = Array.isArray(snapshot.records) ? snapshot.records : [];

  const places: RawDiscoveryPlace[] = [];
  const counts: NormalizeCounts = {
    fetched: rawRecords.length,
    kept: 0,
    dropped_closed: 0,
    dropped_irrelevant: 0,
    dropped_unusable: 0,
  };

  for (const candidate of rawRecords) {
    const record = (candidate ?? {}) as OvertureRecord;

    const status = asNonEmptyString(record.operating_status);
    if (status !== null && CLOSED_STATUSES.has(status)) {
      counts.dropped_closed += 1;
      continue;
    }

    const primary = asNonEmptyString(record.categories?.primary);
    const basic = asNonEmptyString(record.basic_category);
    if ((primary !== null && EXCLUDED_CATEGORIES.has(primary)) || (basic !== null && EXCLUDED_CATEGORIES.has(basic))) {
      counts.dropped_irrelevant += 1;
      continue;
    }

    const name =
      asNonEmptyString(record.names?.primary) ?? asNonEmptyString(record.names?.common);
    const lat = asFiniteNumber(record.geometry?.lat);
    const lng = asFiniteNumber(record.geometry?.lng);
    const overtureId = asNonEmptyString(record.overture_id);
    if (name === null || lat === null || lng === null || overtureId === null) {
      counts.dropped_unusable += 1;
      continue;
    }

    const firstAddress = Array.isArray(record.addresses) ? record.addresses[0] : undefined;
    const confidence = asFiniteNumber(record.confidence);
    places.push({
      overture_id: overtureId,
      service_area: serviceArea,
      name,
      address_freeform: asNonEmptyString(firstAddress?.freeform),
      locality: asNonEmptyString(firstAddress?.locality),
      lat,
      lng,
      basic_category: basic,
      primary_category: primary,
      taxonomy_primary: asNonEmptyString(record.taxonomy?.primary),
      websites: websiteList(record.websites),
      operating_status: status,
      confidence: confidence !== null && confidence >= 0 && confidence <= 1 ? confidence : null,
      sources: sourceList(record.sources),
      overture_release: release,
    });
    counts.kept += 1;
  }

  return { places, counts };
}
