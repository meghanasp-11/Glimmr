import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, ArrowLeft, MapPin } from 'lucide-react';
import { useLocation } from 'wouter';
import { Header } from '@/components/glimmr-ui';
import { useAuth } from '@/lib/auth';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { places } from '@/data/places';
import {
  savePlaceForUser,
  getUserSavedPlaces,
  deleteUserSavedPlace,
  type SavedPlace,
} from '@/services/firebaseService';

export default function AccountSavedPlaces() {
  const { user, profile } = useAuth();
  const [, setLocation] = useLocation();
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!profile?.uid) return;
      const saved = await getUserSavedPlaces(profile.uid);
      setSavedPlaces(saved);
      setLoading(false);
    };
    load();
  }, [profile]);

  const handleAddPlace = async () => {
    if (!profile?.uid || !selectedPlaceId) return;
    const place = places.find((p) => p.id === selectedPlaceId);
    if (!place) return;
    await savePlaceForUser(profile.uid, place, notes);
    toast({ title: 'Place saved' });
    setShowAdd(false);
    setSelectedPlaceId('');
    setNotes('');
    const updated = await getUserSavedPlaces(profile.uid);
    setSavedPlaces(updated);
  };

  const handleDelete = async (id: string) => {
    if (!profile?.uid) return;
    await deleteUserSavedPlace(id);
    toast({ title: 'Place removed' });
    const updated = await getUserSavedPlaces(profile.uid);
    setSavedPlaces(updated);
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="display">Saved Places</h1>
            <p className="muted">Places you&apos;ve saved for future outings</p>
          </div>
          <button className="btn btn-blue" onClick={() => setShowAdd(!showAdd)}>
            <Plus size={14} /> {showAdd ? 'Cancel' : 'Add Place'}
          </button>
        </div>

        {showAdd && (
          <Card className="mb-6 max-w-lg">
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <label className="field-label">Select Place</label>
                <select
                  className="select w-full"
                  value={selectedPlaceId}
                  onChange={(e) => setSelectedPlaceId(e.target.value)}
                >
                  <option value="">Choose a place...</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {p.category}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="field-label">Notes (optional)</label>
                <textarea
                  className="input min-h-[80px]"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Why this place is interesting..."
                />
              </div>
              <button className="btn btn-blue" onClick={handleAddPlace} disabled={!selectedPlaceId}>
                <Save size={14} /> Save
              </button>
            </CardContent>
          </Card>
        )}

        {savedPlaces.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <MapPin size={32} className="mx-auto mb-4 text-muted" />
              <p className="muted">No saved places yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add places from your plans</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {savedPlaces.map((sp) => (
              <Card key={sp.id}>
                <CardContent className="pt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <MapPin size={18} className="text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{sp.placeData?.name ?? 'Unknown Place'}</p>
                      <p className="text-sm text-muted-foreground">{sp.placeData?.category ?? ''} · {sp.notes || 'No notes'}</p>
                      {sp.customTags?.length ? (
                        <div className="flex gap-1 mt-1">
                          {sp.customTags.map((tag, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-muted text-xs">{tag}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <button
                    className="btn btn-icon btn-ghost text-destructive"
                    onClick={() => handleDelete(sp.id)}
                    aria-label={`Remove ${sp.placeData?.name ?? 'place'}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
