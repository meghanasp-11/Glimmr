import { useEffect, useState } from 'react';
import { Plus, Save, MapPin, Calendar, Heart, ListCheck, User, Settings, ArrowLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import { Header } from '@/components/glimmr-ui';
import { useAuth } from '@/lib/auth';
import { toast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from 'wouter';

const tabs = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'saved-places', label: 'Saved Places', icon: MapPin },
  { id: 'saved-plans', label: 'Saved Plans', icon: ListCheck },
  { id: 'outing-history', label: 'Outing History', icon: Calendar },
  { id: 'preferences', label: 'Preferences', icon: Settings },
] as const;

export default function Account() {
  const [, setLocation] = useLocation();
  const { user, profile, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-pulse rounded-lg bg-primary/10 h-8 w-8" /></div>;
  }

  if (!user) return null;

  return (
    <div className="glimmr-app">
      <Header />
      <main className="page container-shell">
        <div className="mb-8">
          <Link href="/" className="btn btn-ghost" style={{ paddingLeft: 0 }}>
            <ArrowLeft size={15} /> Back home
          </Link>
          <div className="mt-4 flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
              {profile?.displayName?.[0] ?? user.email?.[0]?.toUpperCase() ?? 'G'}
            </div>
            <div>
              <h1 className="display" style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)' }}>
                {profile?.displayName ?? user.email ?? 'Account'}
              </h1>
              <p className="muted">{user.email}</p>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                <tab.icon size={14} />
                <span className="hidden sm:inline ml-2">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="profile">
            <AccountProfile />
          </TabsContent>
          <TabsContent value="saved-places">
            <SavedPlaces />
          </TabsContent>
          <TabsContent value="saved-plans">
            <SavedPlans />
          </TabsContent>
          <TabsContent value="outing-history">
            <OutingHistory />
          </TabsContent>
          <TabsContent value="preferences">
            <AccountPreferences />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function AccountProfile() {
  const { user, profile, updateDisplayName, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.displayName ?? user?.displayName ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDisplayName(name);
      toast({ title: 'Profile updated' });
    } catch {
      toast({ title: 'Failed to update profile', description: 'Please try again' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Manage your personal information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="field-label">Display Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </div>
        <div className="space-y-2">
          <label className="field-label">Email</label>
          <input className="input" value={user?.email ?? ''} disabled />
        </div>
        <button className="btn btn-blue" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : <><Save size={14} /> Save Changes</>}
        </button>
      </CardContent>
    </Card>
  );
}

function SavedPlaces() {
  const { profile } = useAuth();
  const [places, setPlaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!profile?.uid) return;
      const { getUserSavedPlaces } = await import('@/services/firebaseService');
      const saved = await getUserSavedPlaces(profile.uid);
      setPlaces(saved);
      setLoading(false);
    };
    load();
  }, [profile]);

  if (loading) return <Card><CardContent className="py-8"><div className="animate-pulse bg-primary/10 h-32 rounded" /></CardContent></Card>;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Saved Places</CardTitle>
        <CardDescription>Places you&apos;ve saved for later</CardDescription>
      </CardHeader>
      <CardContent>
        {places.length === 0 ? (
          <p className="muted">No saved places yet. Start planning an outing and save places you like.</p>
        ) : (
          <div className="space-y-2">
            {places.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="font-medium">{p.placeData?.name ?? 'Unknown'}</p>
                  <p className="text-sm text-muted-foreground">{p.placeData?.category ?? ''} · {p.notes || 'No notes'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SavedPlans() {
  const { profile } = useAuth();
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const load = async () => {
      if (!profile?.uid) return;
      const { getUserSavedPlans } = await import('@/services/firebaseService');
      const saved = await getUserSavedPlans(profile.uid);
      setPlans(saved);
      setLoading(false);
    };
    load();
  }, [profile]);

  if (loading) return <Card><CardContent className="py-8"><div className="animate-pulse bg-primary/10 h-32 rounded" /></CardContent></Card>;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Saved Plans</CardTitle>
        <CardDescription>Plans you&apos;ve saved for later</CardDescription>
      </CardHeader>
      <CardContent>
        {plans.length === 0 ? (
          <p className="muted">No saved plans yet. Create a plan and save it for later.</p>
        ) : (
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex-1">
                  <p className="font-medium">{p.title ?? 'Untitled Plan'}</p>
                  <p className="text-sm text-muted-foreground">{p.planData?.request ? `${p.planData.request.outingType} · ${p.planData.request.budgetPerPerson ? `₹${p.planData.request.budgetPerPerson}/person` : ''}` : ''}</p>
                </div>
                <button
                  className="btn btn-ghost text-sm"
                  onClick={() => setLocation(`/plan/${p.planId}`)}
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OutingHistory() {
  const { profile } = useAuth();
  const [outings, setOutings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!profile?.uid) return;
      const { getUserOutings } = await import('@/services/firebaseService');
      const userOutings = await getUserOutings(profile.uid);
      setOutings(userOutings);
      setLoading(false);
    };
    load();
  }, [profile]);

  if (loading) return <Card><CardContent className="py-8"><div className="animate-pulse bg-primary/10 h-32 rounded" /></CardContent></Card>;

  const statusColors: Record<string, string> = {
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    abandoned: 'bg-gray-100 text-gray-800',
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Outing History</CardTitle>
        <CardDescription>Your past and active outings</CardDescription>
      </CardHeader>
      <CardContent>
        {outings.length === 0 ? (
          <p className="muted">No outing history yet. Start an outing from a plan to see it here.</p>
        ) : (
          <div className="space-y-2">
            {outings.map((o) => (
              <div key={o.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex-1">
                  <p className="font-medium">{o.planData?.title ?? o.planId}</p>
                  <p className="text-sm text-muted-foreground">
                    {o.startedAt ? new Date(o.startedAt).toLocaleDateString() : 'Unknown date'}
                  </p>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[o.status] ?? 'bg-gray-100 text-gray-800'}`}>
                  {o.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccountPreferences() {
  const { profile, refreshProfile } = useAuth();
  const [prefs, setPrefs] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!profile?.uid) return;
      const { getUserPreferences } = await import('@/services/firebaseService');
      const p = await getUserPreferences(profile.uid);
      setPrefs(p);
      setNotifications(p?.notificationsEnabled ?? true);
      setEmailUpdates(p?.emailUpdates ?? false);
      setLoading(false);
    };
    load();
  }, [profile]);

  if (loading) return <Card><CardContent className="py-8"><div className="animate-pulse bg-primary/10 h-32 rounded" /></CardContent></Card>;

  const handleToggleNotifications = async (value: boolean) => {
    setNotifications(value);
    if (profile?.uid) {
      const { updateUserPreferences } = await import('@/services/firebaseService');
      await updateUserPreferences(profile.uid, { notificationsEnabled: value });
    }
  };

  const handleToggleEmail = async (value: boolean) => {
    setEmailUpdates(value);
    if (profile?.uid) {
      const { updateUserPreferences } = await import('@/services/firebaseService');
      await updateUserPreferences(profile.uid, { emailUpdates: value });
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>Customize your Glimmr experience</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Notifications</p>
            <p className="text-sm text-muted-foreground">Receive push notifications</p>
          </div>
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => void handleToggleNotifications(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Email Updates</p>
            <p className="text-sm text-muted-foreground">Receive email about your outings</p>
          </div>
          <input
            type="checkbox"
            checked={emailUpdates}
            onChange={(e) => void handleToggleEmail(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
        </div>
        <div className="space-y-2">
          <label className="field-label">Dietary Restrictions</label>
          <input className="input" placeholder="vegetarian, gluten-free, vegan" />
        </div>
        <div className="space-y-2">
          <label className="field-label">Accessibility Needs</label>
          <input className="input" placeholder="wheelchair accessible, quiet, etc." />
        </div>
      </CardContent>
    </Card>
  );
}
