import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Clock3, Footprints, MapPin, RefreshCw, Route, Sparkles, Trash2, User, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import { places } from '@/data/mockData';
import type { LocationStatus, Plan, PlanStep } from '@/types/glimmr';
import { formatDuration, formatINR, placePrice } from '@/lib/glimmr-format';
import { duration as motionDuration, ease, useMatchMedia, usePrefersReducedMotion } from '@/lib/motion';

export function Logo() {
  return <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark" aria-hidden="true">G</span><span>glimmr</span></Link>;
}

export function Header({ compact = false }: { compact?: boolean }) {
  const { user, profile } = useAuth();
  const [, setLocation] = useLocation();

  return <header className="container-shell topbar">
    <Logo />
    {!compact && <nav className="nav-links" aria-label="Primary navigation">
      <Link href="/planner" data-testid="link-plan-a-day">Plan a day</Link>
      <a href="#how-it-works" data-testid="link-how-it-works">How it works</a>
    </nav>}
    <div className="flex items-center gap-2">
      {user ? (
        <>
          <button
            className="btn btn-ghost flex items-center gap-2"
            onClick={() => setLocation('/account')}
            data-testid="link-account"
            aria-label="Go to account"
          >
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
              {profile?.displayName?.[0] ?? user.email?.[0]?.toUpperCase() ?? 'G'}
            </div>
            <span className="hidden sm:inline">{profile?.displayName ?? user.email?.split('@')[0]}</span>
          </button>
          <Link href="/planner" className="btn btn-primary" data-testid="button-header-start">Plan an Outing <ArrowRight size={15} /></Link>
        </>
      ) : (
        <Link href="/planner" className="btn btn-primary" data-testid="button-header-start">Plan an Outing <ArrowRight size={15} /></Link>
      )}
    </div>
  </header>;
}

export function LocationField({
  id,
  label,
  value,
  placeholder,
  onChange,
  status = 'selected',
  error,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  status?: LocationStatus;
  error?: string;
}) {
  const stateCopy: Record<LocationStatus, string> = {
    idle: 'Enter a neighbourhood or destination',
    loading: 'Checking your location…',
    'permission-denied': 'Location permission was not granted',
    unavailable: 'Location services are unavailable',
    searching: 'Searching nearby places…',
    success: 'Location found · ready to route',
    empty: 'No matching places yet',
    error: 'Could not check this location',
    'search-success': 'Search results ready',
    'search-empty': 'No matching places yet',
    'search-error': 'Could not search this location',
    selected: 'Selected location · ready to route',
  };
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="location-input">
      <MapPin size={16} aria-hidden="true" />
      <input id={id} className="input" value={value} placeholder={placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : `${id}-state`} onChange={(event) => onChange(event.target.value)} data-testid={`input-${id}`} />
    </div>
    {error ? <span id={`${id}-error`} className="field-error" role="alert">{error}</span> : <span id={`${id}-state`} className={`location-state location-state-${status}`}>{stateCopy[status]}</span>}
  </div>;
}

export function RouteVisual({ small = false }: { small?: boolean }) {
  return <div className={small ? 'route-preview' : 'route-art'} aria-label="Decorative route through Bengaluru">
    {!small && <>
      <div className="route-card a"><strong>coffee first</strong><small>Blue Tokai · 35 min</small></div>
      <div className="route-card b"><strong>the long way</strong><small>Cubbon Park · 0.7 km</small></div>
      <div className="route-card c"><strong>table for four</strong><small>Toit · 7:35 PM</small></div>
    </>}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
      <path d="M11 29 C 25 10, 31 59, 44 57 S 51 16, 69 27 S 68 77, 88 71" fill="none" stroke="#3B82F6" strokeWidth="1.15" strokeDasharray="2 1" />
      <path d="M11 29 C 25 10, 31 59, 44 57" fill="none" stroke="#FBBF24" strokeWidth="1.8" />
      <circle cx="11" cy="29" r="3.3" className="route-dot" />
      <circle cx="44" cy="57" r="3.3" className="route-pulse" />
      <circle cx="88" cy="71" r="3.3" className="route-dot" />
    </svg>
  </div>;
}

export function PlanCard({ plan }: { plan: Plan }) {
  return <article className={`surface plan-card ${plan.recommendationLabel === 'Best fit' ? 'recommended' : ''}`} data-testid={`card-plan-${plan.id}`}>
    <div className="plan-top">
      <span className="recommend-label">{plan.recommendationLabel}</span>
      <span className="eyebrow" style={{ color: plan.recommendationLabel === 'Best fit' ? '#9ec2ff' : undefined }}>{plan.vibe}</span>
      <h2>{plan.title}</h2>
      <p>{plan.subtitle}</p>
    </div>
    <div className="plan-body">
      <div className="metrics">
        <div className="metric"><strong>{formatINR(plan.pricePerPerson)}</strong><span>per person</span></div>
        <div className="metric"><strong>{formatINR(plan.groupTotal)}</strong><span>group total</span></div>
        <div className="metric"><strong>{formatDuration(plan.totalMinutes)}</strong><span>total time</span></div>
        <div className="metric"><strong>{plan.travelMinutes}m</strong><span>travel time</span></div>
      </div>
      <ul className="mini-timeline">
        {plan.steps.map((step) => <li key={step.id}><span className="mini-dot" />{step.place.name}</li>)}
      </ul>
      <div className="plan-reason"><strong>Why we picked this</strong><ul>{plan.recommendationReason?.slice(0, 3).map((reason) => <li key={reason}>✓ {reason}</li>)}</ul></div>
    </div>
    <div className="plan-footer">
      <Link href={`/plan/${plan.id}`} className={`btn ${plan.recommendationLabel === 'Best fit' ? 'btn-blue' : 'btn-soft'}`} data-testid={`button-view-plan-${plan.id}`}>View Plan <ArrowRight size={15} /></Link>
      <div className="card-actions">
        <Link href={`/plan/${plan.id}`} className="btn btn-ghost" data-testid={`button-edit-plan-${plan.id}`}>Edit</Link>
      </div>
    </div>
  </article>;
}

export function TimelineStep({ step, index, onEdit, onReplace, onDelete, canDelete = true }: { step: PlanStep; index: number; onEdit: () => void; onReplace: () => void; onDelete: () => void; canDelete?: boolean }) {
  return <div className={`timeline-step ${index % 2 ? 'walk' : ''}`} data-testid={`timeline-step-${step.id}`}>
    <div className="timeline-marker">{index + 1}</div>
    <div className="timeline-info">
      <h3>{step.place.name}</h3>
      <p>{step.place.category} · {step.place.address}</p>
      <div className="timeline-meta"><span>{step.arrival}</span><span>{step.durationMinutes} min here</span><span>{placePrice(step.place) ? formatINR(placePrice(step.place)) : 'free'}</span></div>
      {step.note && <p style={{ marginTop: 9, color: '#2563eb' }}>{step.note}</p>}
    </div>
    <div className="timeline-actions">
      <button className="btn btn-icon btn-ghost" onClick={onEdit} aria-label={`Edit ${step.place.name}`} title={`Edit ${step.place.name}`} data-testid={`button-edit-${step.id}`}><Clock3 size={16} /></button>
      <button className="btn btn-icon btn-ghost" onClick={onReplace} aria-label={`Replace ${step.place.name}`} title={`Replace ${step.place.name}`} data-testid={`button-replace-${step.id}`}><RefreshCw size={16} /></button>
      <button className="btn btn-icon btn-ghost" onClick={onDelete} disabled={!canDelete} aria-label={`Delete ${step.place.name}`} title={canDelete ? `Delete ${step.place.name}` : 'A plan needs at least one stop'} data-testid={`button-delete-${step.id}`}><Trash2 size={16} /></button>
    </div>
  </div>;
}

type EditValue = { kind: 'place' | 'duration' | 'instruction'; value: string; instruction?: string };

export function EditDialog({ step, mode, onClose, onSave }: { step?: PlanStep; mode: 'edit' | 'replace' | 'add'; onClose: () => void; onSave: (value: EditValue) => void }) {
  // Same category as the stop being replaced, so a coffee stop swaps for
  // another coffee stop rather than a random category jump.
  const replaceOptions = step ? places.filter((place) => place.category === step.place.category && place.id !== step.place.id).slice(0, 6) : [];
  const addCategories = ['Food', 'Cafe', 'Dessert', 'Activity', 'Drinks', 'Custom'];
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const instructionId = mode === 'edit' ? 'edit-instruction' : 'place-instruction';
  const dialogRef = useRef<HTMLElement>(null);
  // Matches the .dialog-backdrop / .dialog bottom-sheet breakpoint in index.css exactly.
  const isSheetLayout = useMatchMedia('(max-width: 600px)');
  const reducedMotion = usePrefersReducedMotion();
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('button, input, textarea')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  // Desktop: fade + scale + small rise. Mobile: bottom-sheet slide-up.
  const dialogMotionProps = reducedMotion ? {} : isSheetLayout
    ? { initial: { opacity: 0, y: '100%' }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: '100%' }, transition: { duration: motionDuration.large, ease } }
    : { initial: { opacity: 0, scale: 0.96, y: 12 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.97, y: 8 }, transition: { duration: motionDuration.content, ease } };
  return <motion.div
    className="dialog-backdrop"
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    initial={reducedMotion ? undefined : { opacity: 0 }}
    animate={reducedMotion ? undefined : { opacity: 1 }}
    exit={reducedMotion ? undefined : { opacity: 0 }}
    transition={{ duration: motionDuration.interaction, ease }}
  >
    <motion.section
      ref={dialogRef}
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-dialog-title"
      aria-describedby="edit-dialog-description"
      {...dialogMotionProps}
    >
      <div className="dialog-head"><div><h2 id="edit-dialog-title">{mode === 'replace' ? 'Swap this stop' : mode === 'add' ? 'Add a stop' : 'Tune the timing'}</h2><p>{mode === 'replace' ? 'Keep the shape of your plan, change the feeling.' : mode === 'add' ? 'One more good idea, added to the route.' : 'Make a little room without starting over.'}</p></div><button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close dialog" data-testid="button-close-dialog"><X size={18} /></button></div>
      <p id="edit-dialog-description" className="sr-only">Choose a structured change or add a custom instruction. Your plan will recalculate after saving.</p>
       {mode === 'edit' && <div className="field"><label htmlFor="duration">Time at stop (minutes)</label><input id="duration" className="input" type="number" defaultValue={step?.durationMinutes ?? 30} min="10" max="180" onKeyDown={(event) => { if (event.key === 'Enter') onSave({ kind: 'duration', value: (event.target as HTMLInputElement).value }); }} /></div>}
      {mode === 'edit' && <div className="quick-edits"><span className="field-label">Quick changes</span><div className="choice-grid"><button type="button" className="choice" onClick={() => onSave({ kind: 'instruction', value: 'Make it cheaper' })}>Make it cheaper</button><button type="button" className="choice" onClick={() => onSave({ kind: 'instruction', value: 'Choose something farther' })}>Choose something farther</button><button type="button" className="choice" onClick={() => onSave({ kind: 'instruction', value: 'Change category' })}>Change category</button></div></div>}
       {mode === 'replace' && (replaceOptions.length ? <div className="choice-grid">{replaceOptions.map((place) => <button type="button" key={place.id} className="choice" onClick={() => onSave({ kind: 'place', value: place.id })} data-testid={`button-option-${place.id}`}>{place.name}</button>)}</div> : <p className="muted">No other {step?.place.category.toLowerCase()} spots in this area yet — try a custom instruction below.</p>)}
        {mode === 'add' && <div className="add-stop-picker"><span className="field-label">What kind of stop?</span><div className="choice-grid">{addCategories.map((category) => <button type="button" key={category} className={`choice ${selectedCategory === category ? 'selected' : ''}`} onClick={() => setSelectedCategory(category)} data-testid={`button-add-category-${category.toLowerCase()}`}>{category}</button>)}</div>{selectedCategory && selectedCategory !== 'Custom' && <div className="candidate-list"><span className="field-label">Candidates for {selectedCategory.toLowerCase()}</span><div className="choice-grid">{places.filter((place) => { if (selectedCategory === 'Food') return place.category === 'Dinner'; return place.category === selectedCategory; }).map((place) => <button type="button" key={place.id} className="choice" onClick={() => onSave({ kind: 'place', value: place.id })} data-testid={`button-candidate-${place.id}`}>{place.name}</button>)}</div></div>}{selectedCategory === 'Custom' && <p className="muted add-stop-note">Use the instruction below to describe a custom stop.</p>}</div>}
       <div className="field instruction-field"><label htmlFor={instructionId}>Custom instruction <span className="muted">optional</span></label><textarea id={instructionId} className="input" placeholder={mode === 'add' ? 'A bakery, a gallery, somewhere quiet...' : 'Make it cheaper, go farther, keep it outdoors...'} rows={3} /></div>
       <div className="dialog-actions"><button className="btn btn-soft" onClick={onClose} data-testid="button-cancel-dialog">Cancel</button>{mode === 'edit' && <button className="btn btn-blue" onClick={() => { const durationInput = document.getElementById('duration') as HTMLInputElement; const instructionInput = document.getElementById(instructionId) as HTMLTextAreaElement; onSave({ kind: 'duration', value: durationInput.value, instruction: instructionInput.value.trim() || undefined }); }} data-testid="button-save-dialog">Save changes <Check size={15} /></button>}{mode !== 'edit' && <button className="btn btn-blue" onClick={() => { const input = document.getElementById(instructionId) as HTMLTextAreaElement; if (input.value.trim()) onSave({ kind: 'instruction', value: input.value.trim() }); }} disabled={mode === 'add' && selectedCategory !== 'Custom'} data-testid="button-save-instruction">Use instruction <Check size={15} /></button>}</div>
    </motion.section>
  </motion.div>;
}

export function EmptyState({ onReset }: { onReset: () => void }) {
  return <div className="surface error-card"><Sparkles size={28} color="#3b82f6" style={{ margin: '0 auto 14px' }} /><h2 className="display">Nothing fits those constraints yet.</h2><p className="muted">Try widening your time window, raising the budget, or choosing a nearby destination. GLIMMR will keep your next attempt grounded.</p><button className="btn btn-blue" onClick={onReset} data-testid="button-empty-reset">Tune the constraints <ArrowRight size={15} /></button></div>;
}

export function RouteLegend() {
  return <div className="muted" style={{ display: 'flex', gap: 14, fontSize: '.7rem', alignItems: 'center' }}><span><Route size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />walking route</span><span><Footprints size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />live steps</span><span><MapPin size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />next up</span></div>;
}
