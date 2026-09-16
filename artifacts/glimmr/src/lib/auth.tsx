import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  User,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
  linkWithCredential,
  EmailAuthProvider,
  type Auth
} from 'firebase/auth';
import { getAuthService, ensureFirebaseUser, isFirebaseConfigured } from './firebase';
import { getUserProfile, ensureUserProfile as ensureFirestoreProfile, type UserProfile } from '@/services/firebaseService';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInAnonymously: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  linkAnonymousAccount: (email: string, password: string) => Promise<void>;
  migrateAnonymousData: (uid: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (uid: string) => {
    const firestoreProfile = await getUserProfile(uid);
    setProfile(firestoreProfile);
  };

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    const auth = getAuthService();
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      try {
        if (currentUser) {
          await loadProfile(currentUser.uid);
        } else {
          setProfile(null);
        }
      } catch {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signInAnon = async () => {
    const auth = getAuthService();
    await signInAnonymously(auth);
  };

  const signInWithEmail = async (email: string, password: string) => {
    const auth = getAuthService();
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUpWithEmail = async (email: string, password: string, displayName?: string) => {
    const auth = getAuthService();
    const result = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName && result.user) {
      await updateProfile(result.user, { displayName });
    }
  };

  const signInWithGoogle = async () => {
    const auth = getAuthService();
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const doSignOut = async () => {
    const auth = getAuthService();
    await signOut(auth);
  };

  const updateDisplayName = async (name: string) => {
    if (!user) return;
    await updateProfile(user, { displayName: name });
    setUser({ ...user, displayName: name });
    setProfile((prev) => prev ? { ...prev, displayName: name } : null);
  };

  const linkAnonymousAccount = async (email: string, password: string) => {
    if (!user || !user.isAnonymous) return;
    const auth = getAuthService();
    const credential = EmailAuthProvider.credential(email, password);
    await linkWithCredential(user, credential);
  };

  const migrateAnonymousData = async (uid: string) => {
    await import('@/services/glimmrService').then(({ migrateAnonymousData }) => 
      migrateAnonymousData(uid)
    );
  };

  const refreshProfile = async () => {
    if (!user) return;
    await loadProfile(user.uid);
  };

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      signInAnonymously: signInAnon,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOut: doSignOut,
      updateDisplayName,
      linkAnonymousAccount,
      migrateAnonymousData,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}