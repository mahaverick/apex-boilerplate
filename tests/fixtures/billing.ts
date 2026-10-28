import type {
  BillingAlert,
  BillingSettings,
  StaffBillingEventItem,
  StaffBillingHistoryItem,
  StaffBillingSubscriptionItem,
  StaffInvoiceItem,
  StaffPlans,
  StaffTaxDetails,
  StaffTaxDocumentItem,
  StaffTenantBilling,
  TaxHeldCharge,
} from '@/types/billing.types'
/**
 * @file Billing fixtures as express's staff routes serve them, with the
 * catalog of express's entitlement registry. Apex's own: react's
 * `tests/fixtures/billing.ts` holds the customer views. `testPlans` keeps
 * react's name, so the shared `plural.test.ts` reads it in both apps. The
 * harness and the capture manifest import it too, where the `@/tests` alias
 * does not resolve, so it imports `ids` by path.
 */
import { STAFF_USER_ID, TENANT_ID, USER_ID } from './ids'

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
  taxDocumentsEnabled: false,
  hasTaxDocuments: false,
  openHeldCharges: 0,
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
  // Express keeps the trial's end after the trial, which its history says ended.
  trialEndsAt: '2026-10-15T00:00:00.000Z',
  currentPeriodEnd: null,
  payer: null,
  providerSubscriptionId: null,
  entitlements: {
    plan: { key: 'free', name: 'Free' },
    state: 'free',
    trialEndsAt: '2026-10-15T00:00:00.000Z',
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
  taxDocumentsEnabled: false,
  hasTaxDocuments: false,
  gstEffectiveFrom: null,
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
    taxDocument: null,
    creditNotes: [],
    taxStatus: 'not_applicable',
  },
]

/**
 * `GET /platform/billing/alerts` rows, newest first: a refunded duplicate for
 * Acme Corp, and a provider event still failing, which names no tenant.
 */
export const testBillingAlerts: BillingAlert[] = [
  {
    id: '94000000-0000-4000-8000-000000000001',
    kind: 'duplicate_refunded',
    tenant: { id: TENANT_ID, name: 'Acme Corp' },
    message: 'Acme Corp paid twice for one checkout. We refunded ₹999 for the second payment.',
    at: '2026-10-26T09:00:00.000Z',
  },
  {
    id: '94000000-0000-4000-8000-000000000002',
    kind: 'webhook_failing',
    tenant: null,
    message:
      'A provider event is still retrying after an hour of provider outage. It retries for 24 hours. Check the provider’s status page.',
    at: '2026-10-25T18:30:00.000Z',
  },
]

/** `GET …/billing/tax-details` for Acme Corp: a registered Karnataka buyer, saved three times. */
export const testTaxDetails: StaffTaxDetails = {
  gstin: '29ABCDE1234F1ZW',
  legalName: 'Acme Corp Private Limited',
  addressLine1: '12 MG Road',
  addressLine2: null,
  city: 'Bengaluru',
  pincode: '560001',
  state: { code: '29', name: 'Karnataka' },
  isSez: false,
  version: 3,
  updatedAt: '2026-10-22T09:00:00.000Z',
  updatedBy: { userId: STAFF_USER_ID, name: 'Cleo D' },
}

/**
 * `GET …/billing/tax-documents` rows, newest first as express would sort
 * them by issue date: a ₹999 intra-state invoice with ₹500 credited by one
 * automatic credit note, that note, a manual ₹100 credit note, and an
 * inter-state invoice credited in full.
 */
export const testTaxDocuments: StaffTaxDocumentItem[] = [
  {
    id: '96000000-0000-4000-8000-000000000001',
    type: 'invoice',
    number: 'INV/26-27/00001',
    financialYear: '26-27',
    issuedAt: '2026-10-20T09:00:05.000Z',
    amounts: {
      totalMinor: 99_900,
      taxableMinor: 84_661,
      cgstMinor: 7619,
      sgstMinor: 7620,
      igstMinor: 0,
      ratePercent: 18,
    },
    supply: 'intra',
    placeOfSupply: { code: '29', name: 'Karnataka' },
    buyerGstin: '29ABCDE1234F1ZW',
    invoice: null,
    creditNotes: [{ id: '96000000-0000-4000-8000-000000000002', number: 'CN/26-27/00001' }],
    creditedMinor: 50_000,
    noTaxReduction: false,
    reason: null,
    paymentId: 'pay_TestPaid0001',
    refundId: null,
    manual: false,
    createdBy: null,
  },
  {
    id: '96000000-0000-4000-8000-000000000002',
    type: 'credit_note',
    number: 'CN/26-27/00001',
    financialYear: '26-27',
    issuedAt: '2026-10-21T09:00:00.000Z',
    amounts: {
      totalMinor: 50_000,
      taxableMinor: 42_373,
      cgstMinor: 3813,
      sgstMinor: 3814,
      igstMinor: 0,
      ratePercent: 18,
    },
    supply: 'intra',
    placeOfSupply: { code: '29', name: 'Karnataka' },
    buyerGstin: '29ABCDE1234F1ZW',
    invoice: { id: '96000000-0000-4000-8000-000000000001', number: 'INV/26-27/00001' },
    creditNotes: [],
    creditedMinor: 0,
    noTaxReduction: false,
    reason: 'Refund of ₹500',
    paymentId: 'pay_TestPaid0001',
    refundId: 'rfnd_TestRefund0001',
    manual: false,
    createdBy: null,
  },
  {
    id: '96000000-0000-4000-8000-000000000003',
    type: 'credit_note',
    number: 'CN/26-27/00002',
    financialYear: '26-27',
    issuedAt: '2026-10-22T09:00:00.000Z',
    amounts: {
      totalMinor: 10_000,
      taxableMinor: 8475,
      cgstMinor: 762,
      sgstMinor: 763,
      igstMinor: 0,
      ratePercent: 18,
    },
    supply: 'intra',
    placeOfSupply: { code: '29', name: 'Karnataka' },
    buyerGstin: '29ABCDE1234F1ZW',
    invoice: { id: '96000000-0000-4000-8000-000000000001', number: 'INV/26-27/00001' },
    creditNotes: [],
    creditedMinor: 0,
    noTaxReduction: false,
    reason: 'Chargeback lost on 20 Oct 2026',
    paymentId: null,
    refundId: null,
    manual: true,
    createdBy: { userId: STAFF_USER_ID, name: 'Cleo D' },
  },
  {
    id: '96000000-0000-4000-8000-000000000004',
    type: 'invoice',
    number: 'INV/26-27/00002',
    financialYear: '26-27',
    issuedAt: '2026-10-23T09:00:05.000Z',
    amounts: {
      totalMinor: 99_900,
      taxableMinor: 84_661,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 15_239,
      ratePercent: 18,
    },
    supply: 'inter',
    placeOfSupply: { code: '27', name: 'Maharashtra' },
    buyerGstin: null,
    invoice: null,
    creditNotes: [],
    creditedMinor: 99_900,
    noTaxReduction: false,
    reason: null,
    paymentId: 'pay_TestPaid0002',
    refundId: null,
    manual: false,
    createdBy: null,
  },
]

/** `GET …/billing/tax-held-charges` rows: an open SEZ hold, and one staff resolved by issuing the invoice by hand. */
export const testHeldCharges: TaxHeldCharge[] = [
  {
    id: '97000000-0000-4000-8000-000000000002',
    paymentId: 'pay_TestHeld0002',
    subscriptionId: 'sub_TestActive0001',
    amountMinor: 99_900,
    paidAt: '2026-10-24T09:00:00.000Z',
    heldAt: '2026-10-24T09:00:05.000Z',
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
  },
  {
    id: '97000000-0000-4000-8000-000000000001',
    paymentId: 'pay_TestHeld0001',
    subscriptionId: 'sub_TestActive0001',
    amountMinor: 99_900,
    paidAt: '2026-10-20T09:00:00.000Z',
    heldAt: '2026-10-20T09:00:05.000Z',
    resolvedAt: '2026-10-21T09:00:00.000Z',
    resolvedBy: { userId: STAFF_USER_ID, name: 'Cleo D' },
    resolution: 'Issued SEZ invoice by hand, emailed 21 Oct 2026',
  },
]

/** The `tax_held_sez` alert for the open hold above, with express's text. */
export const testHeldSezAlert: BillingAlert = {
  id: '94000000-0000-4000-8000-000000000003',
  kind: 'tax_held_sez',
  tenant: { id: TENANT_ID, name: 'Acme Corp' },
  message:
    'Payment pay_TestHeld0002 of ₹999 is held: this workspace is an SEZ unit. Issue its tax invoice by hand, then mark it resolved on the workspace’s Billing tab.',
  at: '2026-10-24T09:00:05.000Z',
}

/** The `tax_held_sez` alert for a held charge's payment that was refunded, with express's text. */
export const testHeldRefundAlert: BillingAlert = {
  id: '94000000-0000-4000-8000-000000000004',
  kind: 'tax_held_sez',
  tenant: { id: TENANT_ID, name: 'Acme Corp' },
  message:
    'Payment pay_TestHeld0001 of a held SEZ invoice was refunded ₹500 (refund rfnd_TestRefund0002). Issue a credit note by hand.',
  at: '2026-10-25T09:00:00.000Z',
}
