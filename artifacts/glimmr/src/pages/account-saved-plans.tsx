import { useEffect, useState } from 'react';
import { ArrowLeft, ListCheck, OpenInNew, Trash2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { Header } from '@/components/glimmr-ui';
import { useAuth } from '@/lib/auth';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getUserSavedPlans,
  deleteSavedPlan,
  type SavedPlan,
} from '@/services/firebaseService';

export default function AccountSavedPlans() {
  const { profile } = useAuth();
  const [, setLocation] = useLocation();
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!profile?.uid) return;
      const plans = await getUserSavedPlans(profile.uid);
      setSavedPlans(plans);
      setLoading(false);
    };
    load();
  }, [profile]);

  const handleDelete = async (id: string) => {
    await deleteSavedPlan(id);
    toast({ title: 'Plan removed' });
    if (profile?.uid) {
      const updated = await getUserSavedPlans(profile.uid);
      setSavedPlans(updated);
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
          <h1 className="display">Saved Plans</h1>
          <p className="muted">Plans you&apos;ve saved for later</p>
        </div>

        {savedPlans.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ListCheck size={32} className="mx-auto mb-4 text-muted" />
              <p className="muted">No saved plans yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create a plan and save it</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {savedPlans.map((sp) => (
              <Card key={sp.id}>
                <CardContent className="pt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <ListCheck size={18} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{sp.title ?? 'Untitled Plan'}</p>
                      <p className="text-sm text-muted-foreground">
                        {sp.savedAt ? new Date(sp.savedAt).toLocaleDateString() : ''}
                      </p>
                      {sp.tags?.length ? (
                        <div className="flex gap-1 mt-1">
                          {sp.tags.map((tag, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-muted text-xs">{tag}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-icon btn-ghost"
                      onClick={() => setLocation(`/plan/${sp.planId}`)}
                      aria-label="Open plan"
                      title="Open plan"
                    >
                      <OpenInNew size={16} />
                    </button>
                    <button
                      className="btn btn-icon btn-ghost text-destructive"
                      onClick={() => handleDelete(sp.id)}
                      aria-label="Delete plan"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
