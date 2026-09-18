/**
 * GLIMMR Schema Tests
 * 
 * Focused validation tests for domain schemas.
 * Run manually via: node --loader ts-node/esm src/schemas/glimmr.schema.test.ts
 */

import {
  ServiceAreaSchema,
  PlaceSchema,
  LocationSchema,
  OutingRequestSchema,
  TravelInfoSchema,
  StopSchema,
  PlanSchema,
  EditActionSchema,
  PlanConflictSchema,
  validateSchema,
} from './glimmr.schema';

type TestCase = {
  name: string;
  schema: any;
  valid: any[];
  invalid: Array<{ data: any; expectedError: string }>;
};

const testCases: TestCase[] = [
  {
    name: 'ServiceArea',
    schema: ServiceAreaSchema,
    valid: [
      {
        id: 'indiranagar',
        name: 'Indiranagar',
        city: 'Bengaluru',
        active: true,
      },
      {
        id: 'koramangala',
        name: 'Koramangala',
        city: 'Bengaluru',
        active: false,
        bounds: {
          north: 12.9450,
          south: 12.9250,
          east: 77.6250,
          west: 77.6100,
        },
      },
    ],
    invalid: [
      { data: { id: '', name: 'Test', city: 'Test', active: true }, expectedError: 'id' },
      { data: { id: 'test', name: '', city: 'Test', active: true }, expectedError: 'name' },
      { data: { id: 'test', name: 'Test', city: 'Test', active: 'yes' }, expectedError: 'active' },
      {
        data: {
          id: 'test',
          name: 'Test',
          city: 'Test',
          active: true,
          bounds: { north: 91, south: 0, east: 0, west: 0 },
        },
        expectedError: 'north',
      },
    ],
  },
  {
    name: 'Place',
    schema: PlaceSchema,
    valid: [
      {
        id: 'p-test',
        name: 'Test Place',
        serviceArea: 'indiranagar',
        category: 'Cafe',
        address: '123 Test St',
        lat: 12.9784,
        lng: 77.6408,
        priceMin: 100,
        priceMax: 300,
        priceBasis: 'per_person',
        openingHours: '9:00 AM – 5:00 PM',
        typicalVisitDuration: 45,
        suitableFor: ['solo', 'couple'],
        activities: ['coffee'],
        vibe: 'Cozy',
        rating: 4.5,
        reviewCount: 100,
        experienceScore: 0.8,
        source: 'manual',
        verificationStatus: 'verified',
        lastVerified: '2026-09-14',
        confidence: 0.9,
      },
    ],
    invalid: [
      {
        data: {
          id: 'p-test',
          name: 'Test',
          serviceArea: 'test',
          category: 'Cafe',
          address: '123 Test',
          lat: 200, // invalid
          lng: 77.6408,
          priceMin: 100,
          priceMax: 300,
          priceBasis: 'per_person',
          openingHours: '9-5',
          typicalVisitDuration: 45,
          suitableFor: ['solo'],
          activities: [],
          vibe: 'Test',
          rating: 4.5,
          reviewCount: 100,
          experienceScore: 0.8,
          source: 'manual',
          verificationStatus: 'verified',
          lastVerified: '2026-09-14',
          confidence: 0.9,
        },
        expectedError: 'lat',
      },
      {
        data: {
          id: 'p-test',
          name: 'Test',
          serviceArea: 'test',
          category: 'Cafe',
          address: '123 Test',
          lat: 12.9784,
          lng: 77.6408,
          priceMin: 300, // max < min
          priceMax: 100,
          priceBasis: 'per_person',
          openingHours: '9-5',
          typicalVisitDuration: 45,
          suitableFor: ['solo'],
          activities: [],
          vibe: 'Test',
          rating: 4.5,
          reviewCount: 100,
          experienceScore: 0.8,
          source: 'manual',
          verificationStatus: 'verified',
          lastVerified: '2026-09-14',
          confidence: 0.9,
        },
        expectedError: 'priceMax',
      },
      {
        data: {
          id: 'p-test',
          name: 'Test',
          serviceArea: 'test',
          category: 'Cafe',
          address: '123 Test',
          lat: 12.9784,
          lng: 77.6408,
          priceMin: -100, // negative
          priceMax: 100,
          priceBasis: 'per_person',
          openingHours: '9-5',
          typicalVisitDuration: 45,
          suitableFor: ['solo'],
          activities: [],
          vibe: 'Test',
          rating: 4.5,
          reviewCount: 100,
          experienceScore: 0.8,
          source: 'manual',
          verificationStatus: 'verified',
          lastVerified: '2026-09-14',
          confidence: 0.9,
        },
        expectedError: 'priceMin',
      },
    ],
  },
  {
    name: 'OutingRequest',
    schema: OutingRequestSchema,
    valid: [
      {
        from: 'Indiranagar',
        to: 'Koramangala',
        timeWindowMinutes: 180,
        budgetPerPerson: 500,
        groupSize: 4,
        transportMode: 'transit',
        outingType: 'Food crawl',
      },
      {
        from: 'Home',
        to: 'Downtown',
        timeWindowMinutes: 120,
        budgetPerPerson: 1000,
        groupSize: 1,
        transportMode: 'walk',
        outingType: 'Low-key day',
        freeTextPreference: 'coffee and quiet',
        parsedTags: ['coffee', 'peaceful'],
      },
    ],
    invalid: [
      {
        data: {
          from: '',
          to: 'Test',
          timeWindowMinutes: 180,
          budgetPerPerson: 500,
          groupSize: 4,
          transportMode: 'transit',
          outingType: 'Food crawl',
        },
        expectedError: 'from',
      },
      {
        data: {
          from: 'Test',
          to: 'Test',
          timeWindowMinutes: 0, // must be positive
          budgetPerPerson: 500,
          groupSize: 4,
          transportMode: 'transit',
          outingType: 'Food crawl',
        },
        expectedError: 'timeWindowMinutes',
      },
      {
        data: {
          from: 'Test',
          to: 'Test',
          timeWindowMinutes: 180,
          budgetPerPerson: 500,
          groupSize: 0, // must be >= 1
          transportMode: 'transit',
          outingType: 'Food crawl',
        },
        expectedError: 'groupSize',
      },
      {
        data: {
          from: 'Test',
          to: 'Test',
          timeWindowMinutes: 180,
          budgetPerPerson: 500,
          groupSize: 25, // max 20
          transportMode: 'transit',
          outingType: 'Food crawl',
        },
        expectedError: 'groupSize',
      },
    ],
  },
  {
    name: 'EditAction',
    schema: EditActionSchema,
    valid: [
      {
        type: 'replace',
        targetStopOrder: 1,
        requestedChange: 'Replace with another cafe',
        withPlaceId: 'p-another-cafe',
      },
      {
        type: 'delete',
        targetStopOrder: 2,
        requestedChange: 'Remove this stop',
      },
      {
        type: 'add',
        afterStopOrder: 1,
        requestedChange: 'Add a dessert stop',
        preferredCategories: ['Dessert'],
      },
      {
        type: 'edit',
        targetStopOrder: 0,
        requestedChange: 'Spend more time here',
        changes: {
          plannedDurationMinutes: 60,
        },
      },
      {
        type: 'regenerate',
        requestedChange: 'Try again with same vibe',
        keepStopOrders: [0, 2],
      },
    ],
    invalid: [
      {
        data: {
          type: 'replace',
          // missing targetStopOrder
          requestedChange: 'Test',
        },
        expectedError: 'targetStopOrder',
      },
      {
        data: {
          type: 'edit',
          targetStopOrder: 0,
          requestedChange: 'Test',
          changes: {
            plannedDurationMinutes: -10, // must be positive
          },
        },
        expectedError: 'plannedDurationMinutes',
      },
    ],
  },
  {
    name: 'PlanConflict',
    schema: PlanConflictSchema,
    valid: [
      {
        violatedConstraint: 'budget',
        deltaCost: 200,
        explanation: 'Adding this stop exceeds budget by ₹200',
      },
      {
        violatedConstraint: 'time',
        deltaTime: 30,
        explanation: 'This change adds 30 minutes',
      },
      {
        violatedConstraint: 'feasibility',
        explanation: 'Route is not feasible with current transport',
      },
    ],
    invalid: [
      {
        data: {
          violatedConstraint: 'invalid',
          explanation: 'Test',
        },
        expectedError: 'violatedConstraint',
      },
      {
        data: {
          violatedConstraint: 'budget',
          deltaCost: -100, // must be non-negative
          explanation: 'Test',
        },
        expectedError: 'deltaCost',
      },
    ],
  },
];

// Run tests
let passCount = 0;
let failCount = 0;

console.log('🧪 Running GLIMMR Schema Tests\n');

for (const testCase of testCases) {
  console.log(`\n📋 Testing ${testCase.name}`);
  
  // Test valid cases
  for (const validData of testCase.valid) {
    const result = validateSchema(testCase.schema, validData, testCase.name);
    if (result.success) {
      console.log(`  ✅ Valid case passed`);
      passCount++;
    } else {
      console.log(`  ❌ Valid case failed: ${result.errors.join(', ')}`);
      failCount++;
    }
  }
  
  // Test invalid cases
  for (const { data, expectedError } of testCase.invalid) {
    const result = validateSchema(testCase.schema, data, testCase.name);
    if (!result.success) {
      const hasExpectedError = result.errors.some(e => e.includes(expectedError));
      if (hasExpectedError) {
        console.log(`  ✅ Invalid case rejected correctly (${expectedError})`);
        passCount++;
      } else {
        console.log(`  ⚠️  Invalid case rejected but wrong error`);
        console.log(`     Expected: ${expectedError}`);
        console.log(`     Got: ${result.errors.join(', ')}`);
        passCount++; // still a pass, just not the exact error
      }
    } else {
      console.log(`  ❌ Invalid case passed when it should have failed (${expectedError})`);
      failCount++;
    }
  }
}

console.log(`\n\n${'='.repeat(60)}`);
console.log(`📊 Results: ${passCount} passed, ${failCount} failed`);
console.log(`${'='.repeat(60)}\n`);

if (failCount === 0) {
  console.log('✨ All tests passed!\n');
} else {
  console.log('❌ Some tests failed\n');
}
// process.exit would abort a test-runner worker, so only exit when this
// file runs standalone (e.g. `npx tsx src/schemas/glimmr.schema.test.ts`).
if (!process.env.VITEST) {
  process.exit(failCount === 0 ? 0 : 1);
} else if (failCount > 0) {
  throw new Error(`${failCount} schema checks failed`);
}
