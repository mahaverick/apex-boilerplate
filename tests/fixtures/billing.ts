import { STAFF_USER_ID, USER_ID } from '@/tests/fixtures/ids'
/**
 * @file Billing fixtures as express's staff routes serve them, with the
 * catalog of express's entitlement registry. Apex's own: react's
 * `tests/fixtures/billing.ts` holds the customer views. `testPlans` keeps
 * react's name, so the shared `plural.test.ts` reads it in both apps.
 */
import type { BillingSettings, StaffPlans, StaffTenantBilling } from '@/types/billing.types'

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
      description: 'People in the workspace, counting pending invitations.',
    },
    {
      key: 'advanced_example',
      kind: 'feature',
      label: 'Workspace insights',
      description: 'Who joined and how many invitations went out in the last 30 days.',
    },
  ],
  priceWarningAboveMinor: 1500000,
}

/**
 * `GET /platform/tenants/:id/billing` for a tenant paying monthly for Paid:
 * synced from Razorpay in test mode, one active members grant, and one
 * state change and provider event each.
 */
export const testTenantBilling: StaffTenantBilling = {
  state: 'active',
  plan: { key: 'paid', name: 'Paid' },
  interval: 'month',
  price: {
    id: '91000000-0000-4000-8000-000000000001',
    interval: 'month',
    amountMinor: 99_900,
    currency: 'INR',
  },
  trialEndsAt: null,
  currentPeriodEnd: '2026-11-20T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  pastDue: null,
  nextSwitch: null,
  payer: { userId: USER_ID, name: 'A B', isMember: true },
  billingEmail: null,
  paymentsEnabled: true,
  dismissedBanners: [],
  provider: 'razorpay',
  providerMode: 'test',
  providerSubscriptionId: 'sub_TestActive0001',
  pendingSubscriptionId: null,
  nextSubscriptionId: null,
  syncedAt: '2026-10-20T09:00:00.000Z',
  disputeOpen: false,
  entitlements: {
    plan: { key: 'paid', name: 'Paid' },
    state: 'active',
    trialEndsAt: null,
    currentPeriodEnd: '2026-11-20T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    pastDue: null,
    features: { advanced_example: true },
    limits: { members: { limit: 50, used: 4, approaching: false } },
  },
  sources: { members: 'grant', advanced_example: 'plan' },
  grants: [
    {
      id: '92000000-0000-4000-8000-000000000001',
      key: 'members',
      value: 50,
      reason: 'Pilot with a large team',
      grantedBy: { userId: STAFF_USER_ID, name: 'Staff Admin' },
      createdAt: '2026-10-10T09:00:00.000Z',
      expiresAt: null,
      revokedAt: null,
      status: 'active',
    },
  ],
  history: [
    {
      from: 'trialing',
      to: 'active',
      cause: 'subscription_activated',
      source: 'webhook',
      at: '2026-10-20T09:00:00.000Z',
    },
  ],
  events: [
    {
      type: 'subscription.charged',
      receivedAt: '2026-10-20T09:00:00.000Z',
      processedAt: '2026-10-20T09:00:01.000Z',
      error: null,
    },
  ],
}

/** `GET /platform/billing-settings`: a 14-day trial for new workspaces, and 7 days of Paid after a failed payment. */
export const testBillingSettings: BillingSettings = {
  trialEnabled: true,
  trialDays: 14,
  pastDueGraceDays: 7,
  version: 1,
  updatedAt: '2026-10-01T00:00:00.000Z',
  updatedBy: null,
}
