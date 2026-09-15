# GLIMMR Schema Migration Status

## ✅ COMPLETED

### 1. Schema Files Created
- ✅ `src/schemas/glimmr.schema.ts` - Authoritative Zod schemas
- ✅ `src/types/glimmr.ts` - Type exports (Zod-inferred)
- ✅ `src/lib/schema-compat.ts` - Backward compatibility adapter
- ✅ `src/schemas/glimmr.schema.test.ts` - Focused validation tests

### 2. Schemas Created (9 domain types)
- ✅ **ServiceArea** - with bounds field
- ✅ **Place** - all required fields + validation
- ✅ **Location** - geocoded locations
- ✅ **OutingRequest** - replaces PlannerRequest
- ✅ **TravelInfo** - distance/duration/mode
- ✅ **Stop** - individual plan stops
- ✅ **Plan** - complete plans with stops
- ✅ **EditAction** - discriminated union (replace|delete|add|edit|regenerate)
- ✅ **PlanConflict** - constraint violations

### 3. Mock Data Migrated
- ✅ `src/data/places.ts` - Indiranagar places updated to new schema
- ✅ `src/data/mockData.ts` - Updated with deprecation notice
- ✅ All 3 service areas present: indiranagar, koramangala, church-street
- ✅ 18 representative Indiranagar places with full schema compliance

### 4. Validation
- ✅ Lat/long ranges (-90 to 90, -180 to 180)
- ✅ Non-negative prices
- ✅ Positive durations
- ✅ Valid group size (1-20)
- ✅ Valid enums
- ✅ URL validation when present
- ✅ Score ranges (0-1)
- ✅ Rating ranges (0-5)
- ✅ priceMax >= priceMin refinement

## ⚠️ ISSUE REQUIRING DECISION

### TypeScript Compilation Errors: 97 errors in 10 files

The **new authoritative schema** is complete and correct. However, the **existing UI code** uses different field names:

#### Schema Field Names (NEW - Authoritative):
```typescript
Place {
  latitude, longitude        // Geographic coordinates
  serviceAreaId              // FK to ServiceArea
  typicalVisitDurationMinutes // Duration in minutes
}
```

#### UI Code Expectations (OLD - Legacy):
```typescript
Place {
  lat, lng                  // Legacy coordinate names
  serviceArea               // Direct string (not ID)
  typicalVisitDuration      // Legacy field name
  description               // Not in schema
}

Plan {
  steps                     // Legacy - should be 'stops'
  vibe, subtitle            // UI-only fields, not in domain
  recommendationLabel       // UI-only
  recommendationReason      // UI-only
  totalMinutes              // Legacy - should be 'totalDurationMinutes'
  travelMinutes             // Legacy - should be 'totalTravelTimeMinutes'
}
```

### Files Requiring Migration:
1. `src/components/glimmr-ui.tsx` - 12 errors (Plan UI fields)
2. `src/components/SpiralRestaurantCard.tsx` - 2 errors (Place fields)
3. `src/lib/recommendationEngine.ts` - 18 errors (lat/lng, typicalVisitDuration)
4. `src/pages/outing.tsx` - 14 errors (steps vs stops)
5. `src/pages/plan-detail.tsx` - 16 errors (steps vs stops)
6. `src/services/glimmrService.ts` - 30 errors (all legacy field names)
7. Other files - 5 errors

## 📋 DECISIONS NEEDED

### Option 1: Complete UI Migration (Recommended but violates constraint)
- Update all UI components to use new schema field names
- Estimated: ~20 files to modify
- **Violates your rule**: "Do not redesign frontend"

### Option 2: Add Backward Compatibility Layer
- Keep schema authoritative
- Add computed properties/getters for legacy field names
- Create adapter functions to transform data
- **Impact**: Temporary tech debt, clean schemas remain intact

### Option 3: Hybrid Schema with Legacy Aliases
- Add legacy field names to schema as deprecated
- Both `latitude` and `lat` exist
- **Impact**: Schema includes UI concerns

## 💡 RECOMMENDATION

**Use Option 2: Backward Compatibility Layer**

### Implementation:
1. ✅ Already created: `src/lib/schema-compat.ts`
2. Update data layer to use adapters when serving UI
3. UI continues working with legacy names
4. Schema remains clean and authoritative
5. Incremental UI migration possible later

### Benefits:
- ✅ Schema is authoritative source of truth
- ✅ No frontend redesign required
- ✅ AI systems work with clean schema
- ✅ UI works with legacy names
- ✅ Gradual migration path

## 📦 DELIVERABLES

### Files Added:
- `src/schemas/glimmr.schema.ts` (401 lines)
- `src/schemas/glimmr.schema.test.ts` (367 lines)
- `src/lib/schema-compat.ts` (39 lines)
- `SCHEMA_MIGRATION_STATUS.md` (this file)

### Files Modified:
- `src/types/glimmr.ts` - Now imports from schema
- `src/data/places.ts` - Updated to new schema
- `src/data/mockData.ts` - Updated with deprecation

### Not Modified (Awaiting Decision):
- UI components (97 compilation errors)
- Service layer
- Recommendation engine

## 🎯 NEXT STEPS

**Awaiting your decision:**

1. Should I proceed with Option 2 (backward compatibility layer)?
2. Or would you prefer Option 1 (full UI migration despite constraint)?
3. Or some other approach?

Once decided, I can:
- Apply the chosen approach
- Fix all compilation errors
- Run full validation (typecheck + build)
- Provide clean summary
