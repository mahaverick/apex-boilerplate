/**
 * @file Billing fixtures as express's staff routes serve them, with the
 * catalog of express's entitlement registry. Apex's own: react's
 * `tests/fixtures/billing.ts` holds the customer views. `testPlans` keeps
 * react's name, so the shared `plural.test.ts` reads it in both apps.
 */
import { STAFF_USER_ID, USER_ID } from '@/tests/fixtures/ids'
import type {
  BillingSettings,
  StaffBillingEventItem,
  StaffBillingHistoryItem,
  StaffBillingSubscriptionItem,
  StaffInvoiceItem,
  StaffPlans,
  StaffTenantBilling,
} from '@/types/billing.types'

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
 * synced from Razorpay in test mode, with one state change and one provider
 * event. Its active members grant of 50 changes nothing, because Paid has no
 * members limit and a grant never lowers one (express's
 * `mergeEntitlements`), so members stay unlimited from the plan.
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
    limits: { members: { limit: null, used: 4, approaching: false } },
  },
  sources: { members: 'plan', advanced_example: 'plan' },
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

/**
 * `GET /platform/tenants/:id/billing` for a tenant on Free after its trial
 * ended, with no subscription. Its active members grant raises Free's limit
 * of 3 to 50, so members come from the grant.
 */
export const testFreeTenantBilling: StaffTenantBilling = {
  ...testTenantBilling,
  state: 'free',
  plan: { key: 'free', name: 'Free' },
  interval: null,
  price: null,
  currentPeriodEnd: null,
  payer: null,
  providerSubscriptionId: null,
  entitlements: {
    plan: { key: 'free', name: 'Free' },
    state: 'free',
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDue: null,
    features: { advanced_example: false },
    limits: { members: { limit: 50, used: 4, approaching: false } },
  },
  sources: { members: 'grant', advanced_example: 'plan' },
  history: [
    {
      from: 'trialing',
      to: 'free',
      cause: 'trial_ended',
      source: 'job',
      at: '2026-10-15T00:00:00.000Z',
    },
  ],
  events: [],
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

/** `GET …/billing/history` rows for the Paid tenant, newest first: created in a trial, then paid. */
export const testBillingHistory: StaffBillingHistoryItem[] = [
  {
    id: '93000000-0000-4000-8000-000000000002',
    from: 'trialing',
    to: 'active',
    cause: 'subscription_activated',
    source: 'webhook',
    at: '2026-10-20T09:00:00.000Z',
  },
  {
    id: '93000000-0000-4000-8000-000000000001',
    from: null,
    to: 'trialing',
    cause: 'created',
    source: 'staff',
    at: '2026-10-06T09:00:00.000Z',
  },
]

/** `GET …/billing/events` rows for the Paid tenant, newest first: one processed charge, one event that gave up. */
export const testBillingEvents: StaffBillingEventItem[] = [
  {
    id: '94000000-0000-4000-8000-000000000002',
    type: 'subscription.charged',
    status: 'processed',
    provider: 'razorpay',
    mode: 'test',
    receivedAt: '2026-10-20T09:00:00.000Z',
    processedAt: '2026-10-20T09:00:01.000Z',
    recordedOutcomes: 1,
    error: null,
  },
  {
    id: '94000000-0000-4000-8000-000000000001',
    type: 'subscription.activated',
    status: 'failed',
    provider: 'razorpay',
    mode: 'test',
    receivedAt: '2026-10-19T09:00:00.000Z',
    processedAt: null,
    recordedOutcomes: 1,
    error: 'Provider timed out on every retry',
  },
]

/** `GET …/billing/subscriptions` rows for the Paid tenant: its current subscription. */
export const testBillingSubscriptions: StaffBillingSubscriptionItem[] = [
  {
    id: '95000000-0000-4000-8000-000000000001',
    subscriptionId: 'sub_TestActive0001',
    provider: 'razorpay',
    mode: 'test',
    firstSeenAt: '2026-10-20T09:00:00.000Z',
    standing: 'current',
  },
]

/** `GET …/billing/invoices` rows for the Paid tenant: its first monthly charge, paid. */
export const testInvoices: StaffInvoiceItem[] = [
  {
    id: 'inv_TestPaid0001',
    subscriptionId: 'sub_TestActive0001',
    amountMinor: 99_900,
    currency: 'INR',
    status: 'paid',
    issuedAt: '2026-10-20T09:00:00.000Z',
    paidAt: '2026-10-20T09:00:01.000Z',
  },
]
