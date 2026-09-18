import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

// The Admin SDK resolves credentials lazily: missing credentials do NOT fail
// `initializeApp()` — they fail later, inside google-auth-library promise
// machinery that surfaces as an uncaught exception and kills the process
// (verified: it cannot be caught around the Firestore call). So check for a
// usable credential source BEFORE touching the Admin SDK.
function resolveCredentials(): { ok: true } | { ok: false; reason: string } {
  if (process.env["FIRESTORE_EMULATOR_HOST"]) {
    return { ok: true }; // Emulator needs no credentials.
  }
  const keyFile = process.env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (keyFile) {
    if (!existsSync(keyFile)) {
      return {
        ok: false,
        reason: `GOOGLE_APPLICATION_CREDENTIALS points at "${keyFile}", which does not exist.`,
      };
    }
    return { ok: true };
  }
  // Well-known ADC location from `gcloud auth application-default login`.
  const adcFile = process.env["APPDATA"]
    ? join(process.env["APPDATA"], "gcloud", "application_default_credentials.json")
    : join(homedir(), ".config", "gcloud", "application_default_credentials.json");
  if (existsSync(adcFile)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      "no Firestore credential source found (set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file, run `gcloud auth application-default login`, or set FIRESTORE_EMULATOR_HOST).",
  };
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

  const credentials = resolveCredentials();
  if (!credentials.ok) {
    firestoreUnavailable = true;
    logger.warn(
      `${credentials.reason} User preferences use in-memory storage and will not persist across restarts.`,
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

function isCredentialsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    typeof err === "object" && err !== null
      ? (err as { code?: unknown }).code
      : undefined;
  return (
    message.includes("Could not load the default credentials") ||
    code === 16 ||
    code === "UNAUTHENTICATED"
  );
}

function degradeToMemory(err: unknown, operation: "read" | "write"): void {
  // Missing/unusable credentials never recover without new config + restart,
  // so stop hitting Firestore (each attempt waits on slow metadata lookups
  // and can surface outside the request handler). Other failures may be
  // transient: serve this request from memory but retry Firestore next time.
  if (isCredentialsError(err)) {
    firestoreUnavailable = true;
  }
  logger.warn(
    { err },
    `Firestore ${operation} failed; serving user preferences from in-memory storage.`,
  );
}

export async function getPreferences(uid: string): Promise<UserPreferences | null> {
  const store = await getFirestore();
  if (!store) return memoryStore.get(uid) ?? null;
  try {
    const snapshot = await store.collection(COLLECTION).doc(uid).get();
    if (!snapshot.exists) return null;
    const prefs = snapshot.data() as UserPreferences;
    memoryStore.set(uid, prefs);
    return prefs;
  } catch (err) {
    degradeToMemory(err, "read");
    return memoryStore.get(uid) ?? null;
  }
}

export async function setPreferences(prefs: UserPreferences): Promise<void> {
  const store = await getFirestore();
  if (!store) {
    memoryStore.set(prefs.uid, prefs);
    return;
  }
  // Keep the in-memory copy warm so a later degradation serves fresh data.
  memoryStore.set(prefs.uid, prefs);
  try {
    // Firestore rejects `undefined` field values; the API contract omits them
    // from JSON responses anyway.
    await store.collection(COLLECTION).doc(prefs.uid).set(stripUndefined(prefs));
  } catch (err) {
    degradeToMemory(err, "write");
  }
}
