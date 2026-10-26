/**
 * @file Billing fixtures as express's staff routes serve them. Apex's own:
 * react's `tests/fixtures/billing.ts` holds the customer views. `testPlans`
 * keeps react's name and catalog, so the shared `plural.test.ts` reads the
 * same limit labels in both apps.
 */
import type { StaffPlans } from '@/types/billing.types'

/**
 * `GET /platform/plans` as express serves it: Free (3 members, no
 * `advanced_example`) and Paid (unlimited members, `advanced_example`, ₹999 a
 * month or ₹9,990 a year), with the tenants each plan serves.
 */
export const testPlans: StaffPlans = {
  plans: [
    {
      id: '90000000-0000-4000-8000-000000000001',
      key: 'free',
      name: 'Free',
      description: 'For small teams getting started.',
      version: 1,
      entitlements: { members: 3, advanced_example: false },
      prices: [],
      tenantCounts: { trialing: 0, free: 4, active: 0, past_due: 0 },
    },
    {
      id: '90000000-0000-4000-8000-000000000002',
      key: 'paid',
      name: 'Paid',
      description: 'For teams that need more members and every feature.',
      version: 1,
      entitlements: { members: null, advanced_example: true },
      prices: [
        {
          id: '91000000-0000-4000-8000-000000000001',
          interval: 'month',
          amountMinor: 99_900,
          currency: 'INR',
          active: true,
          createdAt: '2026-10-01T00:00:00.000Z',
          retiredAt: null,
          subscribers: 2,
        },
        {
          id: '91000000-0000-4000-8000-000000000002',
          interval: 'year',
          amountMinor: 999_000,
          currency: 'INR',
          active: true,
          createdAt: '2026-10-01T00:00:00.000Z',
          retiredAt: null,
          subscribers: 1,
        },
      ],
      tenantCounts: { trialing: 2, free: 0, active: 3, past_due: 1 },
    },
  ],
  catalog: [
    {
      key: 'members',
      kind: 'limit',
      label: 'Members',
      description: 'People in the workspace, pending invitations included.',
    },
    {
      key: 'advanced_example',
      kind: 'feature',
      label: 'Insights',
      description: 'Joins and invitations over the last 30 days.',
    },
  ],
  priceWarningAboveMinor: 1500000,
}
