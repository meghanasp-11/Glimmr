import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAnalytics, type Analytics } from 'firebase/analytics';
import { getAuth, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const requiredConfigKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'] as const;
export const isFirebaseConfigured = requiredConfigKeys.every((key) => Boolean(firebaseConfig[key]));

let app: FirebaseApp | null = null;
let firestore: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;
let authInstance: Auth | null = null;
let analyticsInstance: Analytics | null = null;

function getApp(): FirebaseApp {
  if (!isFirebaseConfigured) throw new Error('Firebase is not configured. Set the VITE_FIREBASE_* variables before using Firebase services.');
  app ??= initializeApp(firebaseConfig);
  return app;
}

export function getDb(): Firestore { firestore ??= getFirestore(getApp()); return firestore; }
export function getStorageService(): FirebaseStorage { storageInstance ??= getStorage(getApp()); return storageInstance; }
export function getAuthService(): Auth { authInstance ??= getAuth(getApp()); return authInstance; }
export async function ensureFirebaseUser(): Promise<User> {
  const auth = getAuthService();
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}
export function getAnalyticsService(): Analytics | null {
  if (typeof window === 'undefined' || !isFirebaseConfigured) return null;
  analyticsInstance ??= getAnalytics(getApp());
  return analyticsInstance;
}

export default { get app() { return getApp(); } };
