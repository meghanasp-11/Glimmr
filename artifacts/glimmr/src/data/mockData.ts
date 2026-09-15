import type { PlannerRequest } from '@/types/glimmr';

export { places, serviceAreas } from '@/data/places';

/**
 * Default planner request for development
 * @deprecated Use OutingRequest schema instead
 */
export const defaultRequest: PlannerRequest = {
  from: 'Indiranagar',
  to: 'Church Street',
  availableMinutes: 180,
  budget: 700,
  people: 4,
  transport: 'transit',
  outingType: 'Food crawl',
  preference: 'Good food, somewhere peaceful, and nice for photos.',
};
