/**
 * GLIMMR TypeScript Types
 * 
 * All domain types are inferred from Zod schemas.
 * Do not maintain duplicate type definitions.
 */

import type { z } from 'zod';

export type {
  ServiceArea,
  Place,
  Location,
  OutingRequest,
  TravelInfo,
  Stop,
  Plan,
  EditAction,
  PlanConflict,
  UserProfile,
  UserPreferences,
  SavedPlace,
  SavedPlan,
  OutingRecord,
} from '@/schemas/glimmr.schema';

export {
  ServiceAreaSchema,
  PlaceSchema,
  LocationSchema,
  OutingRequestSchema,
  TravelInfoSchema,
  StopSchema,
  PlanSchema,
  EditActionSchema,
  PlanConflictSchema,
  UserProfileSchema,
  UserPreferencesSchema,
  SavedPlaceSchema,
  SavedPlanSchema,
  OutingRecordSchema,
  TransportModeSchema,
  OutingTypeSchema,
  PriceBasisSchema,
  VerificationStatusSchema,
  validateSchema,
} from '@/schemas/glimmr.schema';

// Type exports for enums
export type TransportMode = z.infer<typeof import('@/schemas/glimmr.schema').TransportModeSchema>;
export type OutingType = z.infer<typeof import('@/schemas/glimmr.schema').OutingTypeSchema>;

// ============================================================================
// UI-SPECIFIC TYPES (not part of domain model)
// ============================================================================

export type PlanStatus = 
  | 'idle' 
  | 'loading' 
  | 'ready' 
  | 'editing' 
  | 'adding' 
  | 'deleting' 
  | 'replacing' 
  | 'regenerating' 
  | 'recalculating' 
  | 'success' 
  | 'error';

export type LocationStatus = 
  | 'idle' 
  | 'loading' 
  | 'permission-denied' 
  | 'unavailable' 
  | 'searching' 
  | 'success' 
  | 'empty' 
  | 'error' 
  | 'search-success' 
  | 'search-empty' 
  | 'search-error' 
  | 'selected';

// ============================================================================
// LEGACY COMPATIBILITY (to be migrated)
// ============================================================================

/**
 * @deprecated Use OutingRequest instead
 */
export interface PlannerRequest {
  from: string;
  to: string;
  availableMinutes: number;
  budget: number;
  people: number;
  transport: 'walk' | 'bike' | 'transit' | 'drive';
  outingType: 'Food crawl' | 'Low-key day' | 'Date night' | 'Arts & culture' | 'Fresh air';
  preference?: string;
}

/**
 * @deprecated Legacy UI type
 */
export interface PlanStep {
  id: string;
  place: import('@/schemas/glimmr.schema').Place;
  arrival: string;
  durationMinutes: number;
  travelMinutes: number;
  distanceKm: number;
  note?: string;
}

/**
 * @deprecated Legacy UI type
 */
export interface LegacyPlan {
  id: string;
  title: string;
  subtitle: string;
  vibe: string;
  totalMinutes: number;
  pricePerPerson: number;
  groupTotal: number;
  totalDistanceKm: number;
  travelMinutes: number;
  feasible: boolean;
  feasibilityNote?: string;
  recommendationLabel: string;
  recommendationReason: string[];
  status: PlanStatus;
  steps: PlanStep[];
  request: PlannerRequest;
}

/**
 * @deprecated Legacy UI type
 */
export interface PlanEdit {
  type: 'replace' | 'edit' | 'delete' | 'add';
  stepId?: string;
  placeId?: string;
  changes?: Partial<PlanStep>;
  instruction?: string;
}

/**
 * @deprecated Legacy UI type
 */
export interface Outing {
  id: string;
  planId: string;
  startedAt: string;
  currentStepId: string;
  completedStepIds: string[];
}
