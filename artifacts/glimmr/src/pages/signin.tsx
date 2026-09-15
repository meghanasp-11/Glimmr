import { useState, FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { Mail, Lock, Eye, EyeOff, Loader2, Chrome } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Header } from '@/components/glimmr-ui';
import { toast } from '@/hooks/use-toast';

type Mode = 'signin' | 'signup';

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, signInAnonymously, migrateAnonymousData } = useAuth();
  const [, setLocation] = useLocation();

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!validateEmail(email)) {
      setError('Enter a valid email address');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (mode === 'signup' && !displayName.trim()) {
      setError('Enter your name');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, displayName);
      }
      toast({ title: mode === 'signin' ? 'Welcome back!' : 'Account created!' });
      await migrateAnonymousData('');
      setLocation('/planner');
    } catch (err: any) {
      const code = err.code;
      if (code === 'auth/email-already-in-use') setError('An account with this email already exists');
      else if (code === 'auth/invalid-email') setError('Invalid email address');
      else if (code === 'auth/weak-password') setError('Password should be at least 6 characters');
      else if (code === 'auth/user-not-found' || code === 'auth/wrong-password') setError('Invalid email or password');
      else if (code === 'auth/popup-closed-by-user') return;
      else setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
      toast({ title: 'Signed in with Google!' });
      await migrateAnonymousData('');
      setLocation('/planner');
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Google sign-in failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAnonymousSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInAnonymously();
      toast({ title: 'Continuing as guest' });
      setLocation('/planner');
    } catch (err: any) {
      setError(err.message || 'Failed to continue as guest');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glimmr-app">
      <Header compact />
      <main className="page container-shell">
        <div className="surface" style={{ maxWidth: 420, margin: '40px auto', padding: '40px' }}>
          <div className="text-center mb-8">
            <h1 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
              {mode === 'signin' ? 'Welcome back' : 'Create your account'}
            </h1>
            <p className="muted mt-2">
              {mode === 'signin' 
                ? 'Sign in to save plans and track outings across devices'
                : 'Save your plans, track outings, and access from anywhere'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div className="field">
                <label htmlFor="displayName" className="field-label">Name</label>
                <input
                  id="displayName"
                  type="text"
                  className="input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  disabled={loading}
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="email" className="field-label">Email</label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={loading}
              />
            </div>

            <div className="field">
              <label htmlFor="password" className="field-label">Password</label>
              <div className="location-input">
                <Lock size={16} aria-hidden="true" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="btn btn-icon btn-ghost"
                  style={{ position: 'absolute', right: '8px' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {mode === 'signup' && (
              <div className="field">
                <label htmlFor="confirmPassword" className="field-label">Confirm Password</label>
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>
            )}

            {error && (
              <div className="field-error" role="alert">{error}</div>
            )}

            <button
              type="submit"
              className="btn btn-blue w-full"
              disabled={loading}
              style={{ marginTop: 8 }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {mode === 'signin' ? 'Signing in...' : 'Creating account...'}
                </>
              ) : (
                mode === 'signin' ? 'Sign in' : 'Create account'
              )}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="btn btn-soft w-full gap-2"
            style={{ marginBottom: 12 }}
          >
            <Chrome size={18} />
            Continue with Google
          </button>

          <button
            onClick={handleAnonymousSignIn}
            disabled={loading}
            className="btn btn-ghost w-full"
          >
            Continue as guest
          </button>

          <p className="text-center text-sm text-muted-foreground mt-6">
            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}
            {' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError('');
              }}
              className="text-primary font-medium hover:underline"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>

          <p className="text-center text-xs text-muted-foreground mt-4 max-w-sm mx-auto">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </main>
    </div>
  );
}