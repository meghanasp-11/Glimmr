import { FormEvent, useState } from 'react';
import { ArrowRight, Car, CircleHelp, Footprints, TrainFront } from 'lucide-react';
import { useLocation } from 'wouter';
import { defaultRequest } from '@/data/mockData';
import { Header, LocationField } from '@/components/glimmr-ui';
import type { OutingType, PlannerRequest, TransportMode } from '@/types/glimmr';

const outingTypes: OutingType[] = ['Food crawl', 'Low-key day', 'Date night', 'Arts & culture', 'Fresh air'];
const transports: { id: TransportMode; label: string; icon: typeof Car }[] = [
  { id: 'walk', label: 'Walk', icon: Footprints },
  { id: 'bike', label: 'Bike', icon: Footprints },
  { id: 'transit', label: 'Transit', icon: TrainFront },
  { id: 'drive', label: 'Drive', icon: Car },
];
const timeOptions = [
  [30, '30 min'],
  [60, '1 hr'],
  [120, '2 hrs'],
  [180, '3 hrs'],
  [240, '4 hrs'],
  [300, '5+ hrs']
] as const;
const budgetOptions = [
  [100, '₹100 · keep it light'],
  [250, '₹250 · comfortable'],
  [500, '₹500 · make it count'],
  [1000, '₹1,000+ · stretch a little']
] as const;

export default function Planner() {
  const [, setLocation] = useLocation();
  const [form, setForm] = useState<PlannerRequest>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('glimmr-request') ?? JSON.stringify(defaultRequest)) as PlannerRequest;
    } catch {
      return defaultRequest;
    }
  });
  const [errors, setErrors] = useState<Partial<Record<'from' | 'to' | 'availableMinutes' | 'budget' | 'people', string>>>({});

  const update = <K extends keyof PlannerRequest>(key: K, value: PlannerRequest[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!form.from.trim()) nextErrors.from = 'Add a starting neighbourhood or location.';
    if (!form.to.trim()) nextErrors.to = 'Add a destination or neighbourhood.';
    if (!timeOptions.some(([value]) => value === form.availableMinutes)) nextErrors.availableMinutes = 'Choose an available time.';
    if (!budgetOptions.some(([value]) => value === form.budget)) nextErrors.budget = 'Choose a budget per person.';
    if (!Number.isInteger(form.people) || form.people < 1 || form.people > 6) nextErrors.people = 'Choose how many people are coming.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    sessionStorage.setItem('glimmr-request', JSON.stringify(form));
    setLocation('/results');
  };

  return (
    <div className="glimmr-app">
      <Header compact />
      <main className="page container-shell">
        <div className="stepper">
          <div className="step active"><strong>1</strong> Shape it</div>
          <div className="step-line" />
          <div className="step"><strong>2</strong> Pick a path</div>
          <div className="step-line" />
          <div className="step"><strong>3</strong> Go</div>
        </div>
        <div className="page-header">
          <div>
            <div className="eyebrow">a few useful constraints</div>
            <h1 className="display">What sounds good?</h1>
            <p className="muted" style={{ maxWidth: 500 }}>
              The more honest you are, the better the plan. You can change everything later.
            </p>
          </div>
        </div>
        <div className="planner-layout">
          <form className="surface planner-form" onSubmit={submit}>
            <section className="form-section">
              <h2>Where are you going?</h2>
              <p>Tell us where the outing starts and where you want to end up.</p>
              <div className="field-grid">
                <LocationField
                  id="from"
                  label="From"
                  value={form.from}
                  placeholder="Current location or neighbourhood"
                  onChange={(value) => update('from', value)}
                  error={errors.from}
                />
                <LocationField
                  id="to"
                  label="To"
                  value={form.to}
                  placeholder="Destination or neighbourhood"
                  onChange={(value) => update('to', value)}
                  error={errors.to}
                />
              </div>
            </section>

            <section className="form-section">
              <h2>Your situation</h2>
              <p>How much time and spend can we work with?</p>
              <div className="field-grid">
                <div className="field">
                  <label htmlFor="time">Available time</label>
                  <select
                    id="time"
                    className="select"
                    aria-invalid={Boolean(errors.availableMinutes)}
                    aria-describedby={errors.availableMinutes ? 'time-error' : undefined}
                    value={form.availableMinutes}
                    onChange={(event) => update('availableMinutes', Number(event.target.value))}
                    data-testid="select-time"
                  >
                    {timeOptions.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  {errors.availableMinutes && (
                    <span id="time-error" className="field-error" role="alert">
                      {errors.availableMinutes}
                    </span>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="budget">Budget per person</label>
                  <select
                    id="budget"
                    className="select"
                    aria-invalid={Boolean(errors.budget)}
                    aria-describedby={errors.budget ? 'budget-error' : undefined}
                    value={form.budget}
                    onChange={(event) => update('budget', Number(event.target.value))}
                    data-testid="select-budget"
                  >
                    {budgetOptions.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  {errors.budget && (
                    <span id="budget-error" className="field-error" role="alert">
                      {errors.budget}
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="form-section">
              <h2>Who's coming?</h2>
              <p>A couple of people changes the rhythm.</p>
              <div className="choice-grid" aria-describedby={errors.people ? 'people-error' : undefined}>
                {[1, 2, 3, 4, 5, 6].map((people) => (
                  <button
                    type="button"
                    key={people}
                    className={`choice ${form.people === people ? 'selected' : ''}`}
                    onClick={() => update('people', people)}
                    data-testid={`button-people-${people}`}
                  >
                    {people === 6 ? '6+' : people} {people === 1 ? 'person' : 'people'}
                  </button>
                ))}
              </div>
              {errors.people && (
                <span id="people-error" className="field-error" role="alert">
                  {errors.people}
                </span>
              )}
            </section>

            <section className="form-section">
              <h2>How are we moving?</h2>
              <p>We'll use this to keep the route realistic.</p>
              <div className="choice-grid">
                {transports.map(({ id, label, icon: Icon }) => (
                  <button
                    type="button"
                    key={id}
                    className={`choice ${form.transport === id ? 'selected' : ''}`}
                    onClick={() => update('transport', id)}
                    data-testid={`button-transport-${id}`}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="form-section">
              <h2>Choose the energy</h2>
              <p>Pick the headline; we'll fill in the details.</p>
              <div className="choice-grid">
                {outingTypes.map((type) => (
                  <button
                    type="button"
                    key={type}
                    className={`choice ${form.outingType === type ? 'selected' : ''}`}
                    onClick={() => update('outingType', type)}
                    data-testid={`button-type-${type.toLowerCase().replaceAll(' ', '-')}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </section>

            <section className="form-section">
              <h2>
                Anything you're in the mood for?{' '}
                <span className="muted" style={{ fontSize: '.7rem', fontFamily: 'var(--app-font-mono)' }}>
                  optional
                </span>
              </h2>
              <p>Keep it natural. GLIMMR will use this to shape the route.</p>
              <textarea
                className="input"
                value={form.preference}
                onChange={(event) => update('preference', event.target.value)}
                placeholder="Good food, somewhere peaceful, and nice for photos."
                data-testid="input-preference"
              />
            </section>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 25 }}>
              <button type="submit" className="btn btn-blue" data-testid="button-generate-plans">
                Plan an Outing <ArrowRight size={16} />
              </button>
            </div>
          </form>
          <aside className="planner-aside">
            <CircleHelp size={22} color="#fbbf24" />
            <h3>We'll do the thinking.</h3>
            <p>GLIMMR balances the details that make a plan feel possible, not just interesting.</p>
            <ul>
              <li>Route that fits your actual window</li>
              <li>Cost that won't surprise you</li>
              <li>Stops with different energy</li>
            </ul>
          </aside>
        </div>
      </main>
    </div>
  );
}
