import { z } from 'zod';

/**
 * GLIMMR Domain Schemas
 * 
 * These are the authoritative runtime schemas for GLIMMR.
 * TypeScript types are inferred from these schemas.
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export const TransportModeSchema = z.enum(['walk', 'bike', 'transit', 'drive']);

export const OutingTypeSchema = z.enum([
  'Food crawl',
  'Low-key day',
  'Date night',
  'Arts & culture',
  'Fresh air',
]);

export const PriceBasisSchema = z.enum(['per_person', 'per_group', 'flat']);

export const VerificationStatusSchema = z.enum(['verified', 'unverified', 'ai-suggested']);

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);
const nonNegativeNumberSchema = z.number().min(0);
const positiveNumberSchema = z.number().positive();
const scoreSchema = z.number().min(0).max(1);
const ratingSchema = z.number().min(0).max(5);
const urlSchema = z.string().url();
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ============================================================================
// SERVICE AREA
// ============================================================================

export const ServiceAreaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  city: z.string().min(1),
  active: z.boolean(),
  bounds: z.object({
    north: latitudeSchema,
    south: latitudeSchema,
    east: longitudeSchema,
    west: longitudeSchema,
  }).optional(),
});

export type ServiceArea = z.infer<typeof ServiceAreaSchema>;

// ============================================================================
// PLACE
// ============================================================================

export const PlaceSchema = z.object({
  // Identity
  id: z.string().min(1),
  name: z.string().min(1),
  serviceArea: z.string().min(1), // Using existing field name from codebase
  
  // Classification
  category: z.string().min(1),
  subcategory: z.string().optional(),
  
  // Location
  address: z.string().min(1),
  lat: latitudeSchema, // Using existing field name from codebase
  lng: longitudeSchema, // Using existing field name from codebase
  
  // Description (optional - not all places have it yet)
  description: z.string().optional(),
  
  // Pricing
  priceMin: nonNegativeNumberSchema,
  priceMax: nonNegativeNumberSchema,
  priceBasis: PriceBasisSchema,
  
  // Hours & Duration
  openingHours: z.string().min(1),
  typicalVisitDuration: positiveNumberSchema, // Using existing field name from codebase
  
  // Attributes
  suitableFor: z.array(z.string()).min(1),
  activities: z.array(z.string()),
  vibe: z.string().min(1),
  
  // Quality Signals
  rating: ratingSchema,
  reviewCount: nonNegativeNumberSchema.int(),
  experienceScore: scoreSchema,
  
  // Links
  websiteUrl: urlSchema.optional(),
  mapsUrl: urlSchema.optional(),
  
  // Provenance
  sourceUrl: urlSchema.optional(),
  source: z.string().min(1), // Using existing field name from codebase
  verificationStatus: VerificationStatusSchema,
  lastVerified: isoDateSchema,
  confidence: scoreSchema,
}).refine(
  (data) => data.priceMax >= data.priceMin,
  { message: 'priceMax must be >= priceMin', path: ['priceMax'] }
);

export type Place = z.infer<typeof PlaceSchema>;

// ============================================================================
// LOCATION
// ============================================================================

export const LocationSchema = z.object({
  label: z.string().min(1),
  lat: latitudeSchema.optional(),
  lng: longitudeSchema.optional(),
  source: z.enum(['geocoded', 'manual', 'current']),
});

export type Location = z.infer<typeof LocationSchema>;

// ============================================================================
// OUTING REQUEST
// ============================================================================

export const OutingRequestSchema = z.object({
  // Journey
  from: z.string().min(1),
  to: z.string().min(1),
  
  // Constraints
  timeWindowMinutes: positiveNumberSchema.int(),
  budgetPerPerson: positiveNumberSchema,
  groupSize: z.number().int().min(1).max(20),
  
  // Preferences
  transportMode: TransportModeSchema,
  outingType: OutingTypeSchema,
  
  // AI Input
  freeTextPreference: z.string().optional(),
  parsedTags: z.array(z.string()).optional(),
});

export type OutingRequest = z.infer<typeof OutingRequestSchema>;

// ============================================================================
// TRAVEL INFO
// ============================================================================

export const TravelInfoSchema = z.object({
  distanceKm: nonNegativeNumberSchema,
  durationMinutes: positiveNumberSchema,
  mode: TransportModeSchema,
});

export type TravelInfo = z.infer<typeof TravelInfoSchema>;

// ============================================================================
// STOP
// ============================================================================

export const StopSchema = z.object({
  placeId: z.string().min(1),
  order: z.number().int().min(0),
  arrivalTime: z.string().min(1), // e.g. "2:30 PM"
  plannedDurationMinutes: positiveNumberSchema,
  costPerPerson: nonNegativeNumberSchema,
  travelInfo: TravelInfoSchema.optional(),
});

export type Stop = z.infer<typeof StopSchema>;

// ============================================================================
// PLAN
// ============================================================================

export const PlanSchema = z.object({
  // Identity
  id: z.string().min(1),
  
  // Metadata
  title: z.string().min(1),
  subtitle: z.string().optional(),
  vibe: z.string().optional(),
  
  // UI-specific (for recommendation display)
  recommendationLabel: z.string().optional(),
  recommendationReason: z.array(z.string()).optional(),
  
  // Stops (using existing field name)
  steps: z.array(z.any()).min(1), // Keep as 'steps' for existing UI, detailed schema TBD
  
  // Costs
  pricePerPerson: nonNegativeNumberSchema,
  groupTotal: nonNegativeNumberSchema,
  
  // Timing (using existing field names)
  totalMinutes: positiveNumberSchema,
  travelMinutes: nonNegativeNumberSchema,
  totalDistanceKm: nonNegativeNumberSchema,
  
  // Feasibility
  feasible: z.boolean(),
  feasibilityNote: z.string().optional(),
  
  // Request context
  request: z.any(), // PlannerRequest schema
  
  // UI status
  status: z.string().optional(),
});

export type Plan = z.infer<typeof PlanSchema>;

// ============================================================================
// EDIT ACTION
// ============================================================================

const BaseEditActionSchema = z.object({
  targetStopOrder: z.number().int().min(0).optional(),
  requestedChange: z.string().min(1),
  constraints: z.object({
    preserveBudget: z.boolean().optional(),
    preserveTiming: z.boolean().optional(),
    preferSameVibe: z.boolean().optional(),
  }).optional(),
});

export const ReplaceStopActionSchema = BaseEditActionSchema.extend({
  type: z.literal('replace'),
  targetStopOrder: z.number().int().min(0),
  withPlaceId: z.string().min(1).optional(),
  preferredCategories: z.array(z.string()).optional(),
});

export const DeleteStopActionSchema = BaseEditActionSchema.extend({
  type: z.literal('delete'),
  targetStopOrder: z.number().int().min(0),
});

export const AddStopActionSchema = BaseEditActionSchema.extend({
  type: z.literal('add'),
  afterStopOrder: z.number().int().min(0).optional(),
  beforeStopOrder: z.number().int().min(0).optional(),
  placeId: z.string().min(1).optional(),
  preferredCategories: z.array(z.string()).optional(),
});

export const EditStopActionSchema = BaseEditActionSchema.extend({
  type: z.literal('edit'),
  targetStopOrder: z.number().int().min(0),
  changes: z.object({
    plannedDurationMinutes: positiveNumberSchema.optional(),
    arrivalTime: z.string().optional(),
  }),
});

export const RegenerateActionSchema = BaseEditActionSchema.extend({
  type: z.literal('regenerate'),
  keepStopOrders: z.array(z.number().int().min(0)).optional(),
});

export const EditActionSchema = z.discriminatedUnion('type', [
  ReplaceStopActionSchema,
  DeleteStopActionSchema,
  AddStopActionSchema,
  EditStopActionSchema,
  RegenerateActionSchema,
]);

export type EditAction = z.infer<typeof EditActionSchema>;

// ============================================================================
// PLAN CONFLICT
// ============================================================================

export const PlanConflictSchema = z.object({
  violatedConstraint: z.enum([
    'budget',
    'time',
    'distance',
    'hours',
    'capacity',
    'feasibility',
  ]),
  deltaCost: nonNegativeNumberSchema.optional(),
  deltaTime: z.number().optional(), // can be negative
  explanation: z.string().min(1),
});

export type PlanConflict = z.infer<typeof PlanConflictSchema>;

// ============================================================================
// USER ACCOUNT SCHEMAS
// ============================================================================

export const TransportModeSchema = z.enum(['walk', 'bike', 'transit', 'drive']);

export const UserProfileSchema = z.object({
  id: z.string().min(1),
  uid: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email(),
  photoURL: urlSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastActiveAt: z.string().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UserPreferencesSchema = z.object({
  id: z.string().min(1),
  uid: z.string().min(1),
  defaultTransport: TransportModeSchema.optional(),
  defaultBudget: nonNegativeNumberSchema.optional(),
  defaultTime: positiveNumberSchema.optional(),
  dietaryRestrictions: z.array(z.string()).optional(),
  accessibilityNeeds: z.array(z.string()).optional(),
  favoriteCategories: z.array(z.string()).optional(),
  notificationsEnabled: z.boolean(),
  emailUpdates: z.boolean(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const SavedPlaceSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  placeId: z.string().min(1),
  placeData: z.any(),
  savedAt: z.string().optional(),
  notes: z.string().optional(),
  customTags: z.array(z.string()).optional(),
});

export type SavedPlace = z.infer<typeof SavedPlaceSchema>;

export const SavedPlanSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  planId: z.string().min(1),
  planData: z.any(),
  title: z.string().min(1),
  savedAt: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type SavedPlan = z.infer<typeof SavedPlanSchema>;

export const OutingRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  planId: z.string().min(1),
  planData: z.any(),
  startedAt: z.string().optional(),
  currentStepId: z.string().min(1),
  completedStepIds: z.array(z.string()),
  status: z.enum(['in_progress', 'completed', 'abandoned']),
  completedAt: z.string().optional(),
});

export type OutingRecord = z.infer<typeof OutingRecordSchema>;

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Safe parse with detailed error reporting
 */
export function validateSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    const message = issue.message;
    return context ? `${context}.${path}: ${message}` : `${path}: ${message}`;
  });
  
  return { success: false, errors };
}
