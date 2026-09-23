import { useEffect, useState } from 'react';
import { Check, ChevronRight, MapPin, Navigation } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { Header } from '@/components/glimmr-ui';
import { PlanMap } from '@/components/plan-map';
import { formatDuration, formatINR } from '@/lib/glimmr-format';
import { completeStep, getOuting, getPlanById, readGeocodeCache } from '@/services/glimmrService';
import type { Outing as OutingRecord, Plan } from '@/types/glimmr';

export default function Outing() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [outing, setOuting] = useState<OutingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPlanById(id ?? '').then((loadedPlan) => {
      if (cancelled || !loadedPlan) return;
      setPlan(loadedPlan);
      void getOuting(loadedPlan.id).then((loadedOuting) => {
        if (!cancelled && loadedOuting) setOuting(loadedOuting);
      }).catch((err) => {
        console.warn('[glimmr] Outing load failed.', err);
      });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="glimmr-app"><Header compact /><main className="page container-shell"><p className="muted" role="status">Loading your outing…</p></main></div>;
  if (!plan || !outing) return <div className="glimmr-app"><Header compact /><main className="page container-shell"><div className="surface error-card"><h1 className="display">That outing is no longer available.</h1><p className="muted">Create or open a plan first, then start the outing from there.</p><Link href="/results" className="btn btn-blue">Back to plans</Link></div></main></div>;

  const currentIndex = Math.max(0, plan.steps.findIndex((step) => step.id === outing.currentStepId));
  const currentStep = plan.steps[currentIndex];
  const completedCount = outing.completedStepIds.length;
  const done = outing.status === 'completed' || completedCount >= plan.steps.length;
  const progress = plan.steps.length ? Math.round((completedCount / plan.steps.length) * 100) : 0;
  const geocode = readGeocodeCache(plan.request.from, plan.request.to);
  const origin = geocode?.from ? `${geocode.from.lat},${geocode.from.lng}` : undefined;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${currentStep.place.lat},${currentStep.place.lng}${origin ? `&origin=${origin}` : ''}`;
  const completeCurrentStop = () => {
    if (marking || done) return;
    setMarking(true);
    void completeStep(plan.id, currentStep.id)
      .then((next) => { if (next) setOuting(next); })
      .catch((err) => console.warn('[glimmr] Completing the stop failed; keeping local progress.', err))
      .finally(() => setMarking(false));
  };

  return <div className="glimmr-app"><Header compact /><main className="page container-shell"><div className="outing-layout">
    <section className="map-panel" aria-label="Route map"><div className="map-chip"><Navigation size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Live route · {progress}% complete</div><PlanMap steps={plan.steps} activeStepId={done ? undefined : currentStep.id} completedStepIds={outing.completedStepIds} /></section>
    <section className="surface outlining-card"><span className="outing-status"><i className="status-dot" />{done ? 'outing complete' : 'outing in progress'}</span><h1>{plan.title}</h1><p className="muted">Keep the route loose. GLIMMR will keep the next thing obvious.</p><div className="outing-summary"><span>{formatINR(plan.pricePerPerson)} / person</span><span>{formatINR(plan.groupTotal)} group total</span><span>{formatDuration(plan.totalMinutes)}</span></div><div className="next-stop"><span>{done ? 'outing complete' : 'next stop'}</span><h2>{currentStep.place.name}</h2><p className="muted">{currentStep.place.address}</p><div className="progress-bar"><i style={{ width: `${progress}%` }} /></div><small className="muted">{currentStep.travelMinutes ? `${currentStep.travelMinutes} min · ${currentStep.distanceKm} km` : 'You’re at the first stop'}</small></div><ul className="stop-list">{plan.steps.map((step, index) => <li key={step.id} className={outing.completedStepIds.includes(step.id) ? 'done' : ''}><b>{outing.completedStepIds.includes(step.id) ? <Check size={13} /> : index + 1}</b><span>{step.place.name}</span>{step.id === outing.currentStepId && !done && <ChevronRight size={15} color="#3b82f6" style={{ marginLeft: 'auto' }} />}</li>)}</ul><div className="outing-actions"><a href={directionsUrl} target="_blank" rel="noreferrer" className="btn btn-blue" style={{ flex: 1 }} data-testid="button-open-directions"><MapPin size={15} /> Open directions</a><button className="btn btn-soft" onClick={completeCurrentStop} disabled={done || marking} data-testid="button-complete-stop">{marking ? 'Saving…' : done ? 'Outing complete' : 'Mark complete'}</button><Link href={`/plan/${plan.id}`} className="btn btn-soft" data-testid="button-edit-active-plan">Edit plan</Link></div></section>
  </div></main></div>;
}
