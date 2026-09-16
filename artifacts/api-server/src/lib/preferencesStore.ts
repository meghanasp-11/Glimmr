import type { Firestore } from "firebase-admin/firestore";
import { logger } from "./logger";

export interface UserPreferences {
  id: string;
  uid: string;
  defaultTransport?: string;
  defaultBudget?: number;
  defaultTime?: number;
  dietaryRestrictions: string[];
  accessibilityNeeds: string[];
  favoriteCategories: string[];
  notificationsEnabled: boolean;
  emailUpdates: boolean;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION = "userPreferences";

// Degraded-mode fallback when Firestore is not configured or unreachable.
// Same contract, process-local only (previous behavior).
const memoryStore = new Map<string, UserPreferences>();

let firestore: Firestore | null = null;
let firestoreUnavailable = false;

function resolveProjectId(): string | undefined {
  return (
    process.env["FIREBASE_PROJECT_ID"] ??
    process.env["GOOGLE_CLOUD_PROJECT"] ??
    (process.env["FIRESTORE_EMULATOR_HOST"] ? "demo-glimmr" : undefined)
  );
}

async function getFirestore(): Promise<Firestore | null> {
  if (firestore) return firestore;
  if (firestoreUnavailable) return null;

  const projectId = resolveProjectId();
  if (!projectId) {
    firestoreUnavailable = true;
    logger.warn(
      "FIREBASE_PROJECT_ID is not set; user preferences use in-memory storage and will not persist across restarts.",
    );
    return null;
  }

  try {
    const [{ getApps, getApp, initializeApp, applicationDefault }, { getFirestore }] =
      await Promise.all([import("firebase-admin"), import("firebase-admin/firestore")]);
    const app =
      getApps().length > 0
        ? getApp()
        : initializeApp(
            process.env["FIRESTORE_EMULATOR_HOST"]
              ? { projectId }
              : {
                  projectId,
                  credential: applicationDefault(),
                },
          );
    firestore = getFirestore(app);
    logger.info({ projectId }, "User preferences using Firestore persistence");
    return firestore;
  } catch (err) {
    firestoreUnavailable = true;
    logger.warn({ err }, "Firestore unavailable; user preferences use in-memory storage.");
    return null;
  }
}

export function defaultPreferences(uid: string): UserPreferences {
  const now = new Date().toISOString();
  return {
    id: `prefs-${uid}`,
    uid,
    defaultTransport: undefined,
    defaultBudget: undefined,
    defaultTime: undefined,
    dietaryRestrictions: [],
    accessibilityNeeds: [],
    favoriteCategories: [],
    notificationsEnabled: true,
    emailUpdates: false,
    createdAt: now,
    updatedAt: now,
  };
}

function stripUndefined(value: UserPreferences): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  );
}

export async function getPreferences(uid: string): Promise<UserPreferences | null> {
  const store = await getFirestore();
  if (!store) return memoryStore.get(uid) ?? null;
  const snapshot = await store.collection(COLLECTION).doc(uid).get();
  if (!snapshot.exists) return null;
  return snapshot.data() as UserPreferences;
}

export async function setPreferences(prefs: UserPreferences): Promise<void> {
  const store = await getFirestore();
  if (!store) {
    memoryStore.set(prefs.uid, prefs);
    return;
  }
  // Firestore rejects `undefined` field values; the API contract omits them
  // from JSON responses anyway.
  await store.collection(COLLECTION).doc(prefs.uid).set(stripUndefined(prefs));
}
