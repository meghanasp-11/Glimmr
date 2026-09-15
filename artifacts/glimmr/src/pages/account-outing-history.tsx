import { useEffect, useState } from 'react';
import { ArrowLeft, Calendar, CheckCircle2, Clock, MapPin } from 'lucide-react';
import { useLocation } from 'wouter';
import { Header } from '@/components/glimmr-ui';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getUserOutings,
  type OutingRecord,
} from '@/services/firebaseService';
import { formatDuration, formatINR } from '@/lib/glimmr-format';

const statusConfig: Record<string, { label: string; color: string }> = {
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-800' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800' },
  abandoned: { label: 'Abandoned', color: 'bg-gray-100 text-gray-800' },
};

export default function AccountOutingHistory() {
  const { profile } = useAuth();
  const [, setLocation] = useLocation();
  const [outings, setOutings] = useState<OutingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!profile?.uid) return;
      const data = await getUserOutings(profile.uid);
      setOutings(data);
      setLoading(false);
    };
    load();
  }, [profile]);

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
          <h1 className="display">Outing History</h1>
          <p className="muted">Your past and active outings</p>
        </div>

        {outings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Calendar size={32} className="mx-auto mb-4 text-muted" />
              <p className="muted">No outing history yet</p>
              <p className="text-sm text-muted-foreground mt-1">Start an outing from a plan</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {outings.map((o) => {
              const status = statusConfig[o.status] ?? statusConfig.abandoned;
              return (
                <Card key={o.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{o.planData?.title ?? o.planId}</p>
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                          {o.startedAt ? (
                            <span className="flex items-center gap-1">
                              <Calendar size={12} />
                              {new Date(o.startedAt).toLocaleDateString()}
                            </span>
                          ) : null}
                          {o.planData?.pricePerPerson ? (
                            <span className="flex items-center gap-1">
                              <MapPin size={12} />
                              {formatINR(o.planData.pricePerPerson)}/person
                            </span>
                          ) : null}
                          {o.planData?.totalMinutes ? (
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              {formatDuration(o.planData.totalMinutes)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${status.color}`}>
                          {status.label}
                        </span>
                        {o.status === 'completed' ? (
                          <CheckCircle2 size={16} className="text-green-600" />
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
