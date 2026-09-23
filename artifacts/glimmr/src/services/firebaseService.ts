import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  WhereFilterOp,
  QueryConstraint,
  DocumentData,
  Timestamp,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { getDb } from '../lib/firebase';
import { OutingRecordSchema, ServiceAreaSchema } from '../schemas/glimmr.schema';
import type { OutingRecord } from '../schemas/glimmr.schema';

export type { OutingRecord } from '../schemas/glimmr.schema';

/**
 * Firestore service for managing data
 */

// Generic CRUD operations

/**
 * Get a document by ID
 */
export const getDocument = async <T = DocumentData>(
  collectionName: string,
  docId: string
): Promise<T | null> => {
  const docRef = doc(getDb(), collectionName, docId);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as T;
  }
  return null;
};

/**
 * Get all documents from a collection
 */
export const getDocuments = async <T = DocumentData>(
  collectionName: string
): Promise<T[]> => {
  const querySnapshot = await getDocs(collection(getDb(), collectionName));
  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as T[];
};

/**
 * Query documents with filters
 */
export const queryDocuments = async <T = DocumentData>(
  collectionName: string,
  filters: Array<{
    field: string;
    operator: WhereFilterOp;
    value: any;
  }>,
  orderByField?: string,
  limitCount?: number
): Promise<T[]> => {
  const constraints: QueryConstraint[] = filters.map((filter) =>
    where(filter.field, filter.operator, filter.value)
  );

  if (orderByField) {
    constraints.push(orderBy(orderByField));
  }

  if (limitCount) {
    constraints.push(limit(limitCount));
  }

  const q = query(collection(getDb(), collectionName), ...constraints);
  const querySnapshot = await getDocs(q);

  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as T[];
};

/**
 * Add a new document
 */
export const addDocument = async <T = DocumentData>(
  collectionName: string,
  data: T
): Promise<string> => {
  const docRef = await addDoc(collection(getDb(), collectionName), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
};

/**
 * Update a document
 */
export const updateDocument = async (
  collectionName: string,
  docId: string,
  data: Partial<DocumentData>
): Promise<void> => {
  const docRef = doc(getDb(), collectionName, docId);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
};

/**
 * Delete a document
 */
export const deleteDocument = async (
  collectionName: string,
  docId: string
): Promise<void> => {
  const docRef = doc(getDb(), collectionName, docId);
  await deleteDoc(docRef);
};

/** Write a document with an application-controlled ID. */
export const setDocument = async <T = DocumentData>(
  collectionName: string,
  docId: string,
  data: T,
): Promise<void> => {
  await setDoc(doc(getDb(), collectionName, docId), {
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

// Glimmr-specific functions

/**
 * Save a place to Firestore
 */
export const savePlace = async (placeData: any) => {
  return await addDocument('places', placeData);
};

/**
 * Get all places (raw documents; callers validate against PlaceSchema).
 */
export const getPlaces = async () => {
  return await getDocuments('places');
};

/**
 * Get places by service area.
 */
export const getPlacesByArea = async (serviceAreaId: string) => {
  return await queryDocuments('places', [
    { field: 'serviceArea', operator: '==', value: serviceAreaId },
  ]);
};

/**
 * Get service areas, dropping documents that fail ServiceAreaSchema so one
 * bad record cannot break area resolution. Returns only schema-valid areas.
 */
export const getServiceAreas = async () => {
  const valid = [];
  for (const doc of await getDocuments('serviceAreas')) {
    const parsed = ServiceAreaSchema.safeParse(doc);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      console.warn('[glimmr] Ignoring invalid serviceArea record:', (doc as { id?: unknown }).id ?? '(missing id)');
    }
  }
  return valid;
};

/**
 * Save an outing plan
 */
export const saveOutingPlan = async (planData: any) => {
  return await addDocument('outings', planData);
};

/**
 * Update outing status
 */
export const updateOutingStatus = async (
  outingId: string,
  status: string
) => {
  await updateDocument('outings', outingId, { status });
};

// Utility to convert Firestore Timestamp to Date
export const timestampToDate = (timestamp: Timestamp): Date => {
  return timestamp.toDate();
};

// ============================================================================
// USER PROFILE
// ============================================================================

export interface UserProfile {
  id: string;
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastActiveAt: Timestamp;
}

export const createUserProfile = async (profile: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  return await addDocument('users', profile);
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  const profiles = await queryDocuments<UserProfile>('users', [
    { field: 'uid', operator: '==', value: uid },
  ], undefined, 1);
  return profiles[0] ?? null;
};

export const updateUserProfile = async (uid: string, data: Partial<UserProfile>): Promise<void> => {
  const profile = await getUserProfile(uid);
  if (profile) {
    await updateDocument('users', profile.id, data);
  }
};

export const ensureUserProfile = async (uid: string, displayName: string, email: string, photoURL?: string): Promise<UserProfile> => {
  let profile = await getUserProfile(uid);
  if (!profile) {
    const profileData: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'> = {
      uid,
      displayName,
      email,
      photoURL,
      lastActiveAt: serverTimestamp() as any,
    };
    const id = await createUserProfile(profileData);
    profile = { id, ...profileData } as UserProfile;
  }
  return profile;
};

// ============================================================================
// SAVED PLANS
// ============================================================================

export interface SavedPlan {
  id: string;
  userId: string;
  planId: string; // Reference to the original plan
  planData: any; // Serialized Plan object
  title: string;
  savedAt: Timestamp;
  tags?: string[];
}

export const savePlan = async (userId: string, plan: any): Promise<string> => {
  const planData = JSON.parse(JSON.stringify(plan));
  return await addDocument('savedPlans', {
    userId,
    planId: plan.id,
    planData,
    title: plan.title,
    savedAt: serverTimestamp(),
    tags: [],
  });
};

export const getUserSavedPlans = async (userId: string): Promise<SavedPlan[]> => {
  return await queryDocuments<SavedPlan>(
    'savedPlans',
    [{ field: 'userId', operator: '==', value: userId }],
    'savedAt'
  );
};

export const deleteSavedPlan = async (savedPlanId: string): Promise<void> => {
  await deleteDocument('savedPlans', savedPlanId);
};

export const updateSavedPlanTags = async (savedPlanId: string, tags: string[]): Promise<void> => {
  await updateDocument('savedPlans', savedPlanId, { tags });
};

// ============================================================================
// USER PREFERENCES
// ============================================================================

export interface UserPreferences {
  id: string;
  uid: string;
  defaultTransport?: string;
  defaultBudget?: number;
  defaultTime?: number;
  dietaryRestrictions?: string[];
  accessibilityNeeds?: string[];
  favoriteCategories?: string[];
  notificationsEnabled: boolean;
  emailUpdates: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const getUserPreferences = async (uid: string): Promise<UserPreferences | null> => {
  const prefs = await queryDocuments<UserPreferences>('userPreferences', [
    { field: 'uid', operator: '==', value: uid },
  ], undefined, 1);
  return prefs[0] ?? null;
};

export const updateUserPreferences = async (uid: string, data: Partial<UserPreferences>): Promise<void> => {
  const prefs = await getUserPreferences(uid);
  if (prefs) {
    await updateDocument('userPreferences', prefs.id, data);
  } else {
    await setDocument('userPreferences', uid, {
      uid,
      notificationsEnabled: true,
      emailUpdates: false,
      ...data,
    });
  }
};

export const getOrCreateUserPreferences = async (uid: string): Promise<UserPreferences> => {
  let prefs = await getUserPreferences(uid);
  if (!prefs) {
    const defaultPrefs: Omit<UserPreferences, 'id' | 'createdAt' | 'updatedAt'> = {
      uid,
      notificationsEnabled: true,
      emailUpdates: false,
      dietaryRestrictions: [],
      accessibilityNeeds: [],
      favoriteCategories: [],
    };
    await setDocument('userPreferences', uid, defaultPrefs);
    prefs = { id: uid, ...defaultPrefs } as UserPreferences;
  }
  return prefs;
};

// ============================================================================
// SAVED PLACES (USER'S PERSONAL LIST)
// ============================================================================

export interface SavedPlace {
  id: string;
  userId: string;
  placeId: string;
  placeData: any; // Serialized Place object
  savedAt: Timestamp;
  notes?: string;
  customTags?: string[];
}

export const savePlaceForUser = async (userId: string, place: any, notes?: string): Promise<string> => {
  const placeData = JSON.parse(JSON.stringify(place));
  return await addDocument('userSavedPlaces', {
    userId,
    placeId: place.id,
    placeData,
    savedAt: serverTimestamp(),
    notes: notes ?? '',
    customTags: [],
  });
};

export const getUserSavedPlaces = async (userId: string): Promise<SavedPlace[]> => {
  return await queryDocuments<SavedPlace>(
    'userSavedPlaces',
    [{ field: 'userId', operator: '==', value: userId }],
    'savedAt'
  );
};

export const deleteUserSavedPlace = async (savedPlaceId: string): Promise<void> => {
  await deleteDocument('userSavedPlaces', savedPlaceId);
};

export const updateUserSavedPlace = async (savedPlaceId: string, data: Partial<SavedPlace>): Promise<void> => {
  await updateDocument('userSavedPlaces', savedPlaceId, data);
};

export const isPlaceSavedByUser = async (userId: string, placeId: string): Promise<boolean> => {
  const results = await queryDocuments('userSavedPlaces', [
    { field: 'userId', operator: '==', value: userId },
    { field: 'placeId', operator: '==', value: placeId },
  ], undefined, 1);
  return results.length > 0;
};

// ============================================================================
// OUTINGS (unified shape: see OutingRecordSchema — ISO-string timestamps)
// ============================================================================

/**
 * Firestore `Timestamp`/`Date`/string → ISO string. Stored outing copies
 * written by older clients or server timestamps normalize to the same
 * shape the live flow persists, so resume compares identically.
 */
function timestampToISO(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'object' && value !== null && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Validate + normalize a raw outing document to the canonical shape. */
export function normalizeOutingRecord(doc: unknown): OutingRecord | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const raw = doc as Record<string, unknown>;
  const parsed = OutingRecordSchema.safeParse({
    ...raw,
    startedAt: timestampToISO(raw.startedAt) ?? raw.startedAt,
    updatedAt: timestampToISO(raw.updatedAt) ?? raw.updatedAt,
    completedAt: timestampToISO(raw.completedAt) ?? raw.completedAt,
  });
  if (!parsed.success) {
    console.warn('[glimmr] Ignoring outing record that fails OutingRecordSchema:', (raw as { id?: unknown }).id ?? '(missing id)');
    return null;
  }
  return parsed.data;
}

export const saveOuting = async (userId: string, plan: any, currentStepId: string): Promise<string> => {
  const planData = JSON.parse(JSON.stringify(plan));
  const now = new Date().toISOString();
  return await addDocument('outings', {
    userId,
    planId: plan.id,
    planData,
    startedAt: now,
    updatedAt: now,
    currentStepId,
    completedStepIds: [],
    status: 'in_progress',
  });
};

export const getUserOutings = async (userId: string): Promise<OutingRecord[]> => {
  const docs = await queryDocuments(
    'outings',
    [{ field: 'userId', operator: '==', value: userId }],
    'startedAt'
  );
  const records: OutingRecord[] = [];
  for (const doc of docs) {
    const record = normalizeOutingRecord(doc);
    if (record) records.push(record);
  }
  return records;
};

export const updateOutingProgress = async (
  outingId: string,
  currentStepId: string,
  completedStepIds: string[]
): Promise<void> => {
  await updateDocument('outings', outingId, { currentStepId, completedStepIds, updatedAt: new Date().toISOString() });
};

export const completeOuting = async (outingId: string): Promise<void> => {
  const now = new Date().toISOString();
  await updateDocument('outings', outingId, {
    status: 'completed',
    completedAt: now,
    updatedAt: now,
  });
};

// ============================================================================
// MIGRATION: Anonymous -> Authenticated
// ============================================================================

export const migrateAnonymousData = async (uid: string): Promise<void> => {
  const db = getDb();
  const batch = writeBatch(db);

  // Migrate plans from sessionStorage to Firestore
  // This will be called from the client after sign-up
  // The actual sessionStorage data is passed from the client
  // This function just ensures the user profile exists
  await ensureUserProfile(uid, '', '');
};

export const migrateSessionPlansToFirestore = async (
  uid: string, 
  plans: any[], 
  outings: Record<string, any>
): Promise<void> => {
  const db = getDb();
  const batch = writeBatch(db);

  for (const plan of plans) {
    const planData = JSON.parse(JSON.stringify(plan));
    const savedPlanRef = doc(collection(db, 'savedPlans'));
    batch.set(savedPlanRef, {
      userId: uid,
      planId: plan.id,
      planData,
      title: plan.title,
      savedAt: serverTimestamp(),
      tags: [],
    });
  }

  for (const [planId, outing] of Object.entries(outings)) {
    const outingRef = doc(collection(db, 'outings'));
    const now = new Date().toISOString();
    batch.set(outingRef, {
      userId: uid,
      planId,
      planData: outing.planData ?? {},
      startedAt: timestampToISO(outing.startedAt) ?? now,
      updatedAt: timestampToISO(outing.updatedAt) ?? now,
      currentStepId: outing.currentStepId,
      completedStepIds: outing.completedStepIds ?? [],
      status: outing.status ?? 'in_progress',
      ...(timestampToISO(outing.completedAt) ? { completedAt: timestampToISO(outing.completedAt) } : {}),
    });
  }

  await batch.commit();
};
