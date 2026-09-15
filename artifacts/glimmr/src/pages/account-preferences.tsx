import { useEffect, useState } from 'react';
import { ArrowLeft, Bell, Mail, Settings } from 'lucide-react';
import { useLocation } from 'wouter';
import { Header } from '@/components/glimmr-ui';
import { useAuth } from '@/lib/auth';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  getUserPreferences,
  updateUserPreferences,
  type UserPreferences,
} from '@/services/firebaseService';

export default function AccountPreferences() {
  const { profile } = useAuth();
  const [, setLocation] = useLocation();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!profile?.uid) return;
      const p = await getUserPreferences(profile.uid);
      setPrefs(p);
      setNotifications(p?.notificationsEnabled ?? true);
      setEmailUpdates(p?.emailUpdates ?? false);
      setLoading(false);
    };
    load();
  }, [profile]);

  const handleToggleNotifications = async (value: boolean) => {
    setNotifications(value);
    if (profile?.uid) {
      await updateUserPreferences(profile.uid, { notificationsEnabled: value });
      toast({ title: 'Preferences updated' });
    }
  };

  const handleToggleEmail = async (value: boolean) => {
    setEmailUpdates(value);
    if (profile?.uid) {
      await updateUserPreferences(profile.uid, { emailUpdates: value });
      toast({ title: 'Preferences updated' });
    }
  };

  if (loading) return <div className="animate-pulse bg-primary/10 h-40 rounded-lg" />;

  return (
    <div className="glimmr-app">
      <Header />
      <main className="page container-shell">
        <div className="mb-6">
          <button className="btn btn-ghost" onClick={() => setLocation('/account')}>
            <ArrowLeft size={15} /> Account
          </button>
        </div>
        <div className="mb-6">
          <h1 className="display">Preferences</h1>
          <p className="muted">Customize your Glimmr experience</p>
        </div>

        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Control how you hear from Glimmr</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell size={16} />
                <div>
                  <p className="font-medium">Push Notifications</p>
                  <p className="text-sm text-muted-foreground">Receive push notifications</p>
                </div>
              </div>
              <Switch
                checked={notifications}
                onCheckedChange={handleToggleNotifications}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail size={16} />
                <div>
                  <p className="font-medium">Email Updates</p>
                  <p className="text-sm text-muted-foreground">Receive email about your outings</p>
                </div>
              </div>
              <Switch
                checked={emailUpdates}
                onCheckedChange={handleToggleEmail}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="max-w-lg mt-4">
          <CardHeader>
            <CardTitle>Dietary Restrictions</CardTitle>
            <CardDescription>Tags used when recommending places</CardDescription>
          </CardHeader>
          <CardContent>
            <input className="input w-full" placeholder="vegetarian, gluten-free, vegan" />
          </CardContent>
        </Card>

        <Card className="max-w-lg mt-4">
          <CardHeader>
            <CardTitle>Accessibility Needs</CardTitle>
            <CardDescription>Tags used when recommending places</CardDescription>
          </CardHeader>
          <CardContent>
            <input className="input w-full" placeholder="wheelchair accessible, quiet, etc." />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
