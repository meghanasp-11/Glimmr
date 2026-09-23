/**
 * Focused regression tests for the planner default state.
 *
 * The untouched default planner (fresh visit, no session entry) must pass
 * the current submit gate and persist a valid request — no manual
 * correction by the user. Also pins the existing edge-case behavior.
 *
 * Run with: npm run test -w @glimmr/app
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { defaultRequest } from '@/data/mockData';
import {
  PLANNER_REQUEST_KEY,
  budgetOptions,
  outingTypes,
  persistPlannerRequest,
  readPlannerRequest,
  timeOptions,
  transports,
  validatePlannerRequest,
} from '@/pages/planner';
import type { PlannerRequest } from '@/types/glimmr';

/** Map-backed sessionStorage so persistence paths run in node. */
function installSessionShim(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
  return store;
}

const store = installSessionShim();

function makeForm(overrides: Partial<PlannerRequest> = {}): PlannerRequest {
  return { ...defaultRequest, ...overrides };
}

beforeEach(() => {
  store.clear();
});

describe('default request passes the current submit gate', () => {
  it('has zero validation errors untouched', () => {
    expect(validatePlannerRequest(defaultRequest)).toEqual({});
  });

  it('clears the submit gate (Object.keys check used by submit)', () => {
    expect(Object.keys(validatePlannerRequest(defaultRequest)).length).toBe(0);
  });

  it('uses only currently selectable option values', () => {
    expect(timeOptions.map(([value]) => value)).toContain(defaultRequest.availableMinutes);
    expect(budgetOptions.map(([value]) => value)).toContain(defaultRequest.budget);
    expect(transports.map(({ id }) => id)).toContain(defaultRequest.transport);
    expect(outingTypes).toContain(defaultRequest.outingType);
  });

  it('has non-empty locations and a valid group size', () => {
    expect(defaultRequest.from.trim().length).toBeGreaterThan(0);
    expect(defaultRequest.to.trim().length).toBeGreaterThan(0);
    expect(Number.isInteger(defaultRequest.people)).toBe(true);
    expect(defaultRequest.people).toBeGreaterThanOrEqual(1);
    expect(defaultRequest.people).toBeLessThanOrEqual(6);
  });
});

describe('session request persistence', () => {
  it('creates the stored request from the untouched defaults', () => {
    persistPlannerRequest(defaultRequest);
    expect(readPlannerRequest()).toEqual(defaultRequest);
  });

  it('writes the exact submit payload under the planner key', () => {
    persistPlannerRequest(defaultRequest);
    expect(store.get(PLANNER_REQUEST_KEY)).toBe(JSON.stringify(defaultRequest));
  });

  it('falls back to defaults on first visit (no session entry)', () => {
    expect(readPlannerRequest()).toEqual(defaultRequest);
  });

  it('falls back to defaults on a corrupt session entry', () => {
    store.set(PLANNER_REQUEST_KEY, '{not-json');
    expect(readPlannerRequest()).toEqual(defaultRequest);
  });
});

describe('existing edge cases still hold', () => {
  it('rejects an empty start', () => {
    expect(validatePlannerRequest(makeForm({ from: '' }))).toEqual({
      from: 'Add a starting neighbourhood or location.',
    });
  });

  it('rejects a whitespace-only destination', () => {
    expect(validatePlannerRequest(makeForm({ to: '   ' }))).toEqual({
      to: 'Add a destination or neighbourhood.',
    });
  });

  it('rejects a time outside the current options', () => {
    expect(validatePlannerRequest(makeForm({ availableMinutes: 45 }))).toEqual({
      availableMinutes: 'Choose an available time.',
    });
  });

  it('rejects a budget outside the current options', () => {
    expect(validatePlannerRequest(makeForm({ budget: 999 }))).toEqual({
      budget: 'Choose a budget per person.',
    });
  });

  it.each([0, 7, 2.5, Number.NaN])('rejects people=%s', (people) => {
    expect(validatePlannerRequest(makeForm({ people }))).toEqual({
      people: 'Choose how many people are coming.',
    });
  });

  it.each([1, 6])('accepts boundary group size %s', (people) => {
    expect(validatePlannerRequest(makeForm({ people }))).toEqual({});
  });

  it('reports every problem at once', () => {
    const errors = validatePlannerRequest(
      makeForm({ from: '', to: '', availableMinutes: 45, budget: 999, people: 0 }),
    );
    expect(Object.keys(errors).sort()).toEqual(
      ['availableMinutes', 'budget', 'from', 'people', 'to'].sort(),
    );
  });
});
