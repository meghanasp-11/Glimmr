import { ArrowRight, CalendarClock, Crosshair, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { Header } from '@/components/glimmr-ui';
import InfiniteSpiral, { type SpiralItem } from '@/components/InfiniteSpiral';
import SpiralRestaurantCard from '@/components/SpiralRestaurantCard';
import TextLoop from '@/components/text-loop-simple';
import { places } from '@/data/places';
import type { Place } from '@/types/glimmr';
import { Suspense, lazy } from 'react';

const CARD_W = 240;
const CARD_H = 220;

// Essential spiral configuration - core visual parameters only
const SPIRAL_CONFIG = {
  speed: 0.32,
  radius: 1150,
  verticalSpacing: 160,
  cardsPerTurn: 15,
  centerScale: 1.15,
} as const;

export default function Home() {
  const spiralItems: (SpiralItem & Place)[] = places.map((place) => ({
    ...place,
    label: place.name,
    alt: `${place.name} — ${place.subcategory ?? place.category} in Indiranagar`,
  }));

  return (
    <div className="glimmr-app glimmr-app--spiral-bg">
      {/* Background spiral visualization */}
      <div className="spiral-fullpage" aria-hidden="true">
        <Suspense fallback={<div className="spiral-fullpage__fallback" />}>
          <InfiniteSpiral
            items={spiralItems}
            className="infinite-spiral--glimmr infinite-spiral--fullpage"
            animationMode="all"
            direction="up"
            cardWidth={CARD_W}
            cardHeight={CARD_H}
            pauseOnHover
            renderItem={(item) => (
              <SpiralRestaurantCard place={item as Place} index={0} />
            )}
            {...SPIRAL_CONFIG}
          />
        </Suspense>
        <div className="spiral-fullpage__vignette" aria-hidden="true" />
        <span className="spiral-caption spiral-caption--fp">places → movement → connection</span>
      </div>

      {/* Main content overlay */}
      <div className="spiral-overlay">
        <Header />

        <main className="spiral-overlay__main">
          {/* Hero Section */}
          <section className="hero-standalone container-shell" aria-labelledby="hero-title">
            <p className="eyebrow hero-standalone__eyebrow">for the plans that shift</p>
            <h1 id="hero-title" className="display hero-standalone__title">
              Make the next few hours <span className="hero-standalone__accent">glimmr.</span>
            </h1>
            <TextLoop />
            <p className="hero-copy hero-standalone__copy">
              Tell GLIMMR where you are, what time and energy you have, and where you want to end up.
              It builds a realistic outing you can still change later.
            </p>
            <p className="coverage-note" role="status">
              Currently available in Indiranagar, Bengaluru.
            </p>
            <div className="hero-actions">
              <Link 
                href="/planner" 
                className="btn btn-blue" 
                data-testid="button-hero-plan"
                aria-label="Start planning your outing"
              >
                Plan an Outing <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a 
                href="#how-it-works" 
                className="btn btn-ghost btn-ghost--light" 
                data-testid="link-hero-how"
                aria-label="Learn how Glimmr works"
              >
                See how it works
              </a>
            </div>
          </section>
        </main>

        {/* How it works section */}
        <section 
          className="feature-section container-shell feature-section--overlay" 
          id="how-it-works"
          aria-labelledby="features-title"
        >
          <div className="section-heading section-heading--light">
            <p className="eyebrow eyebrow--light">less browsing. more being there.</p>
            <h2 id="features-title" className="display">
              A little structure for spontaneous people.
            </h2>
            <p className="muted muted--light">
              Plans change. GLIMMR keeps the good part: an outing with a beginning, a middle, and somewhere worth ending up.
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature-card feature-card--glass feature-card--wide">
              <div className="feature-icon" aria-hidden="true">
                <Crosshair size={21} />
              </div>
              <div className="feature-card__content">
                <h3>Knows the shape of your time.</h3>
                <p>Budget, distance, group size, and the mood you actually have today—all in one quick input.</p>
              </div>
            </article>
            <article className="feature-card feature-card--glass feature-card--compact">
              <div className="feature-icon" aria-hidden="true">
                <Zap size={21} />
              </div>
              <div className="feature-card__content">
                <h3>Three paths. One clear pick.</h3>
                <p>Different energy levels, not three versions of the same list.</p>
              </div>
            </article>
            <article className="feature-card feature-card--glass feature-card--accent">
              <div className="feature-icon" aria-hidden="true">
                <CalendarClock size={21} />
              </div>
              <div className="feature-card__content">
                <h3>Changes without the reset.</h3>
                <p>Swap a stop, add a detour, and see the route recalculate in place.</p>
              </div>
            </article>
          </div>
        </section>

        {/* Bottom CTA section */}
        <section className="container-shell cta-section" aria-labelledby="cta-title">
          <div className="surface surface--cta cta-panel">
            <div className="cta-panel__copy">
              <p className="eyebrow cta-panel__eyebrow">ready when you are</p>
              <h2 id="cta-title" className="display cta-panel__title">The plan can be easy.</h2>
            </div>
            <Link 
              href="/planner" 
              className="btn btn-primary" 
              data-testid="button-bottom-plan"
              aria-label="Start planning your outing"
            >
              Plan an Outing <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="footer footer--overlay" role="contentinfo">
          <div className="container-shell footer-inner">
            <span className="brand">
              <span className="brand-mark" aria-hidden="true">G</span>glimmr
            </span>
            <small>Good plans for right now.</small>
          </div>
        </footer>
      </div>
    </div>
  );
}
