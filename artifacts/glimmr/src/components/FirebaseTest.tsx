import { useEffect, useState } from 'react';
import { getDb, getStorageService, isFirebaseConfigured } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { ref, listAll } from 'firebase/storage';

/**
 * Firebase Connection Test Component
 * Shows Firebase connectivity status and basic info
 */
export function FirebaseTest() {
  const [status, setStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [error, setError] = useState<string>('');
  const [info, setInfo] = useState({
    firestoreConnected: false,
    storageConnected: false,
  });

  useEffect(() => {
    const testConnection = async () => {
      try {
        if (!isFirebaseConfigured) throw new Error('Firebase environment variables are not configured.');
        // Test Firestore connection
        let firestoreOk = false;
        try {
          const testCollection = collection(getDb(), '_test_connection');
          await getDocs(testCollection);
          firestoreOk = true;
        } catch (e: any) {
          // Even if collection doesn't exist, a proper connection will give specific errors
          if (e.code !== 'permission-denied' && e.code !== 'unavailable') {
            firestoreOk = true;
          }
        }

        // Test Storage connection
        let storageOk = false;
        try {
          const storageRef = ref(getStorageService(), '/');
          await listAll(storageRef);
          storageOk = true;
        } catch (e: any) {
          // Permission denied means connection works but no access
          if (e.code === 'storage/unauthorized') {
            storageOk = true;
          }
        }

        setInfo({
          firestoreConnected: firestoreOk,
          storageConnected: storageOk,
        });

        if (firestoreOk && storageOk) {
          setStatus('connected');
        } else {
          setStatus('error');
          setError('Some services are not accessible');
        }
      } catch (err: any) {
        setStatus('error');
        setError(err.message || 'Failed to connect to Firebase');
      }
    };

    testConnection();
  }, []);

  return (
    <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border-2 max-w-sm z-50">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-3 h-3 rounded-full ${
            status === 'checking'
              ? 'bg-yellow-500 animate-pulse'
              : status === 'connected'
                ? 'bg-green-500'
                : 'bg-red-500'
          }`}
        />
        <h3 className="font-semibold text-sm">
          {status === 'checking' && 'Connecting to Firebase...'}
          {status === 'connected' && 'Firebase Connected ✓'}
          {status === 'error' && 'Firebase Connection Issue'}
        </h3>
      </div>

      {status !== 'checking' && (
        <div className="text-xs space-y-1 text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <span className={info.firestoreConnected ? 'text-green-600' : 'text-red-600'}>
              {info.firestoreConnected ? '✓' : '✗'}
            </span>
            <span>Firestore</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={info.storageConnected ? 'text-green-600' : 'text-red-600'}>
              {info.storageConnected ? '✓' : '✗'}
            </span>
            <span>Storage</span>
          </div>
          {error && (
            <div className="mt-2 text-red-600 text-xs">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
