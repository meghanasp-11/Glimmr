import { useEffect, useState } from 'react';
import type { Transition, Variants } from 'framer-motion';

/**
 * Central motion tokens for GLIMMR.
 * Keep every animated component reading from here so timing stays consistent
 * across the app instead of being re-guessed per component.
 */
export const duration = {
  micro: 0.15, // hover/press feedback
  interaction: 0.22, // choice pills, small state toggles
  content: 0.36, // cards, dialogs, list add/remove
  large: 0.55, // page transitions, sheets
} as const;

export const ease = [0.16, 1, 0.3, 1] as const; // calm, decisive ease-out

export const springSnappy: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 };

/** Fade + small rise. The default entrance for content that appears in place. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: duration.content, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: duration.interaction, ease } },
};

/** Scale-in for dialogs and cards that need slightly more presence than a fade. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  show: { opacity: 1, scale: 1, transition: { duration: duration.content, ease } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: duration.interaction, ease } },
};

/**
 * One shared reduced-motion source of truth. glimmr-preloader, text-loop and
 * route-three each used to poll matchMedia themselves — this replaces that
 * duplication without changing their behavior.
 */
/** Generic matchMedia hook, SSR-safe. Used where a component's JS-driven
 * animation choice needs to line up with an existing CSS breakpoint exactly
 * (e.g. the dialog's mobile bottom-sheet layout, defined at 600px in
 * index.css) rather than the app's general 768px mobile hook. */
export function useMatchMedia(query: string) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}
