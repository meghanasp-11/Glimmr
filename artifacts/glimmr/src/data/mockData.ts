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
  // Must stay a member of the planner's budgetOptions (100/250/500/1000);
  // 500 ("make it count") is the closest selectable tier to the old 700.
  budget: 500,
  people: 4,
  transport: 'transit',
  outingType: 'Food crawl',
  preference: 'Good food, somewhere peaceful, and nice for photos.',
};
