import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Plus, RefreshCw } from 'lucide-react';
import { Link, useParams, useLocation } from 'wouter';
import { EditDialog, Header, RouteLegend, TimelineStep } from '@/components/glimmr-ui';
import { PlanMap } from '@/components/plan-map';
import { ValueTransition } from '@/components/motion/ValueTransition';
import { duration as motionDuration, ease } from '@/lib/motion';
import { editPlan, getPlanById } from '@/services/glimmrService';
import { places } from '@/data/mockData';
import type { Plan, PlanStatus, PlanStep } from '@/types/glimmr';
import { formatDuration, formatINR } from '@/lib/glimmr-format';

type DialogState = { mode: 'edit' | 'replace' | 'add'; step?: PlanStep } | null;

export default function PlanDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<PlanStatus>('idle');
  const [changeNotice, setChangeNotice] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPlanById(id ?? '').then((loadedPlan) => { if (!cancelled) setPlan(loadedPlan); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);
  if (loading) return <div className="glimmr-app"><Header compact /><main className="page container-shell"><div className="skeleton" /></main></div>;
  if (!plan) return <div className="glimmr-app"><Header compact /><main className="page container-shell"><div className="surface error-card"><h2 className="display">That plan wandered off.</h2><Link href="/results" className="btn btn-blue">Back to plans</Link></div></main></div>;
  const applyEdit = async (value: { kind: 'place' | 'duration' | 'instruction'; value: string; instruction?: string }) => {
    if (!dialog) return;
    const edit = dialog.mode === 'add'
      ? { type: 'add' as const, placeId: value.kind === 'place' ? value.value : undefined, instruction: value.kind === 'instruction' ? value.value : undefined }
      : dialog.mode === 'replace' && value.kind === 'place'
        ? { type: 'replace' as const, stepId: dialog.step?.id, placeId: value.value }
        : { type: 'edit' as const, stepId: dialog.step?.id, changes: value.kind === 'duration' ? { durationMinutes: Number(value.value) } : { note: value.value }, instruction: value.instruction ?? (value.kind === 'instruction' ? value.value : undefined) };
    const nextOperation: PlanStatus = dialog.mode === 'add' ? 'adding' : dialog.mode === 'replace' ? 'replacing' : 'editing';
    setOperation(nextOperation);
    setPlan((current) => current ? { ...current, status: nextOperation } : current);
    try {
       const nextPlan = await editPlan({ ...plan, status: 'recalculating' }, edit);
       const priceDelta = nextPlan.pricePerPerson - plan.pricePerPerson;
       const timeDelta = nextPlan.totalMinutes - plan.totalMinutes;
       const priceText = `${formatINR(Math.abs(priceDelta))}/person`;
       const timeText = formatDuration(Math.abs(timeDelta));
       setChangeNotice(dialog.mode === 'add'
         ? `This adds ${timeText} and ${priceText}.`
         : `Plan updated: ${timeDelta === 0 ? 'no time change' : `${timeDelta > 0 ? '+' : '-'}${timeText}`} · ${priceDelta === 0 ? 'no spend change' : `${priceDelta > 0 ? '+' : '-'}${priceText}`}.`);
       setPlan(nextPlan);
      setOperation('success');
      setDialog(null);
    } catch {
      setOperation('error');
      setPlan((current) => current ? { ...current, status: 'error' } : current);
    }
  };
  const deleteStep = async (step: PlanStep) => {
    if (plan.steps.length <= 1) return;
    if (!window.confirm(`Remove ${step.place.name} from this plan?`)) return;
    setOperation('deleting');
    setPlan((current) => current ? { ...current, status: 'deleting' } : current);
    try {
       const nextPlan = await editPlan({ ...plan, status: 'recalculating' }, { type: 'delete', stepId: step.id });
       const priceDelta = plan.pricePerPerson - nextPlan.pricePerPerson;
       const timeDelta = plan.totalMinutes - nextPlan.totalMinutes;
       setChangeNotice(`Removed ${step.place.name}: saves ${formatDuration(Math.abs(timeDelta))} and ${formatINR(Math.abs(priceDelta))}/person.`);
       setPlan(nextPlan);
      setOperation('success');
    } catch {
      setOperation('error');
      setPlan((current) => current ? { ...current, status: 'error' } : current);
    }
  };
  const isBusy = operation !== 'idle' && operation !== 'success' && operation !== 'error';
   const operationCopy = operation === 'adding' ? 'Checking if this fits...' : operation === 'deleting' ? 'Recalculating your outing...' : operation === 'replacing' ? 'Finding a replacement...' : operation === 'editing' ? 'Updating the stop...' : 'Recalculating your outing...';
  return <div className="glimmr-app"><Header compact /><main className="page container-shell">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, gap: 12, flexWrap: 'wrap' }}><Link href="/results" className="btn btn-ghost" style={{ paddingLeft: 0 }} data-testid="link-plan-back"><ArrowLeft size={15} /> All plans</Link><Link href={`/outing/${plan.id}`} className="btn btn-blue" data-testid="button-start-outing">Start this outing <ArrowRight size={15} /></Link></div>
     <AnimatePresence mode="wait">
       {isBusy ? <motion.div key="recalc" className="recalc-banner" role="status" aria-live="polite" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: motionDuration.interaction, ease }}><RefreshCw size={15} /> {operationCopy}</motion.div>
       : changeNotice ? <motion.div key="change" className="change-banner" role="status" aria-live="polite" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: motionDuration.interaction, ease }}>{changeNotice}</motion.div>
       : null}
     </AnimatePresence>
      <div className="plan-layout"><section className="surface timeline"><div className="timeline-head"><div><div className="eyebrow">editable route</div><h1>{plan.title}</h1><p className="muted">{plan.subtitle}</p></div><button className="btn btn-soft" onClick={() => setDialog({ mode: 'add' })} disabled={isBusy} data-testid="button-add-stop"><Plus size={15} /> Add stop</button></div>
      <div>
        <AnimatePresence initial={false}>
          {plan.steps.map((step, index) => (
            <motion.div
              key={step.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: motionDuration.content, ease }}
            >
              <TimelineStep step={step} index={index} onEdit={() => setDialog({ mode: 'edit', step })} onReplace={() => setDialog({ mode: 'replace', step })} onDelete={() => void deleteStep(step)} canDelete={plan.steps.length > 1} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <RouteLegend />
    </section>
     <aside className="surface summary-card"><h3>Plan math</h3><div className="summary-stat"><span>Per person</span><strong data-testid="text-plan-cost"><ValueTransition value={formatINR(plan.pricePerPerson)} /></strong></div><div className="summary-stat"><span>Group total</span><strong data-testid="text-plan-group-total"><ValueTransition value={formatINR(plan.groupTotal)} /></strong></div><div className="summary-stat"><span>Total time</span><strong data-testid="text-plan-duration"><ValueTransition value={formatDuration(plan.totalMinutes)} /></strong></div><div className="summary-stat"><span>Travel time</span><strong data-testid="text-plan-travel"><ValueTransition value={`${plan.travelMinutes} min`} /></strong></div><div className="summary-stat"><span>Route distance</span><strong data-testid="text-plan-distance"><ValueTransition value={`${plan.totalDistanceKm} km`} /></strong></div><div className={`feasibility ${plan.feasible ? '' : 'warning'}`} data-testid="status-feasibility">{plan.feasible ? 'Fits your window with room to breathe.' : `This adds ${formatDuration(plan.totalMinutes - plan.request.availableMinutes)} beyond your available time. Trim a stop or widen your window.`}</div><PlanMap steps={plan.steps} /></aside></div>
    <AnimatePresence>
      {dialog && <EditDialog step={dialog.step} mode={dialog.mode} onClose={() => setDialog(null)} onSave={(value) => void applyEdit(value)} />}
    </AnimatePresence>
  </main></div>;
}
