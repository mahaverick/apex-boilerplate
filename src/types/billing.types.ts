/**
 * @file The staff half of the billing API contract
 * (docs/2026-10-24-billing-api-contract.md §1 and §5), as the server sends
 * it. Apex's own subset of react's `billing.types.ts`, whose text it copies:
 * apex reads no customer billing route, so the checkout, invoice, plan-page
 * and upgrade-request types stay react's. Money is integer minor units
 * (paise) plus `currency`; timestamps are ISO 8601 UTC strings.
 */

/** The plans the API serves. */
export type PlanKey = 'free' | 'paid'

/** Where a workspace is in its billing lifecycle, in express's order (`BILLING_STATES`). */
export const BILLING_STATES = ['trialing', 'free', 'active', 'past_due'] as const

/** Where a workspace is in its billing lifecycle. `trialing` and `active` and `past_due` are all on Paid. */
export type BillingState = (typeof BILLING_STATES)[number]

/** How often a Paid subscription charges, as express's `BILLING_INTERVALS`. */
export const BILLING_INTERVALS = ['month', 'year'] as const

/** How often a Paid subscription charges. */
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

/** What moved a workspace from one billing state to another, as express's `BILLING_HISTORY_SOURCES`. */
export const BILLING_HISTORY_SOURCES = [
  'webhook',
  'confirm',
  'reconcile',
  'job',
  'staff',
  'owner',
] as const

/** One source of a billing state change. */
export type BillingHistorySource = (typeof BILLING_HISTORY_SOURCES)[number]

/** How a provider event ended, as express's `BILLING_EVENT_STATUSES`. */
export const BILLING_EVENT_STATUSES = ['processed', 'unused', 'failed', 'pending'] as const

/**
 * How a provider event ended: `processed` synced the tenant, `unused`
 * changed nothing (its `error` says why), `failed` gave up after every retry
 * and alerted staff, `pending` is not handled yet.
 */
export type BillingEventStatus = (typeof BILLING_EVENT_STATUSES)[number]

/** The payment providers express runs, as its `BILLING_PROVIDERS`. */
export const BILLING_PROVIDERS = ['razorpay', 'fake'] as const

/** One payment provider. `fake` is express's test double. */
export type BillingProvider = (typeof BILLING_PROVIDERS)[number]

/** A provider's modes, as express's `BILLING_PROVIDER_MODES`. */
export const BILLING_PROVIDER_MODES = ['test', 'live'] as const

/** One provider mode. */
export type BillingProviderMode = (typeof BILLING_PROVIDER_MODES)[number]

/** How a subscription the tenant held compares with its billing record now. */
export const BILLING_SUBSCRIPTION_STANDINGS = ['current', 'pending', 'next', 'earlier'] as const

/** One subscription's standing: the record's current, pending or next one, or an earlier one. */
export type BillingSubscriptionStanding = (typeof BILLING_SUBSCRIPTION_STANDINGS)[number]

/** An invoice's status at the provider, as express's `INVOICE_STATUSES`. */
export const INVOICE_STATUSES = ['issued', 'paid', 'cancelled', 'expired'] as const

/** One invoice status. */
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/** The kinds of billing alert staff see, as express's `BILLING_ALERT_KINDS`. */
export const BILLING_ALERT_KINDS = [
  'duplicate_refunded',
  'webhook_failing',
  'reconcile_repair',
  'dispute',
  'subscription_completed',
  'tax_held_sez',
  'tax_issue_failed',
  'tax_invoice_late',
  'tax_credit_note_late',
] as const

/** One kind of billing alert. */
export type BillingAlertKind = (typeof BILLING_ALERT_KINDS)[number]

/** When a staff cancel ends the subscription, as express's `STAFF_CANCEL_WHEN`. */
export type StaffCancelWhen = 'cycle_end' | 'now'

/** A catalog entry is an on/off feature or a numeric limit. */
type EntitlementKind = 'feature' | 'limit'

/** One entitlement the catalog names, with the wording the app shows for it. */
export interface EntitlementCatalogEntry {
  key: string
  kind: EntitlementKind
  label: string
  description: string
}

/** A plan's value for one entitlement: a feature is a boolean, a limit is a number, and `null` is unlimited. */
export type EntitlementValue = boolean | number | null

/** One price of a plan. */
interface PriceView {
  id: string
  interval: BillingInterval
  amountMinor: number
  currency: 'INR'
}

/** One limit's use. `approaching` is `used >= ceil(limit * softAt)` and `used < limit`. */
interface LimitUsage {
  limit: number | null
  used: number
  approaching: boolean
}

/** A failed card payment. `graceEndsAt` is `null` while Razorpay is still retrying. */
interface PastDue {
  since: string
  graceEndsAt: string | null
  paused: boolean
}

/** What the workspace may use now, as `GET /tenants/:slug/entitlements` answers it. */
interface TenantEntitlements {
  /** The effective plan: Paid while trialing, active or past due. */
  plan: { key: PlanKey; name: string }
  /** The effective state: a lapsed trial reads `free` before the job runs. */
  state: BillingState
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDue: PastDue | null
  features: Record<string, boolean>
  limits: Record<string, LimitUsage>
}

/** The customer billing view the staff view extends. Owner-only fields are `null` for staff. */
interface TenantBilling {
  state: BillingState
  plan: { key: PlanKey; name: string }
  interval: BillingInterval | null
  /** The price this tenant pays, which may be a retired one. */
  price: PriceView | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDue: PastDue | null
  /** Set once the next subscription is authenticated: a switch, or a resubscribe while cancelling. */
  nextSwitch: { interval: BillingInterval; startsAt: string } | null
  /** Who pays. `isMember: false` means the payer left the workspace. */
  payer: { userId: string; name: string; isMember: boolean } | null
  /** Owner only, so always `null` for staff. */
  billingEmail: string | null
  paymentsEnabled: boolean
  dismissedBanners: string[]
  /** Registration is on: express can issue tax documents. */
  taxDocumentsEnabled: boolean
  /** The workspace has at least one tax document; real for staff. */
  hasTaxDocuments: boolean
}

/** An entitlement override staff granted a workspace. A feature grant's value is always `true`. */
interface Grant {
  id: string
  key: string
  value: EntitlementValue
  reason: string
  /** `null` when the account was purged or a script wrote the grant. */
  grantedBy: { userId: string; name: string } | null
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  status: 'active' | 'expired' | 'revoked'
}

/** `GET /platform/tenants/:id/billing`: the customer view plus provider ids, grants and history. */
export interface StaffTenantBilling extends TenantBilling {
  provider: BillingProvider | null
  providerMode: BillingProviderMode | null
  providerSubscriptionId: string | null
  pendingSubscriptionId: string | null
  nextSubscriptionId: string | null
  syncedAt: string | null
  disputeOpen: boolean
  entitlements: TenantEntitlements
  /** Unresolved held SEZ charges, for the Held: SEZ badge. */
  openHeldCharges: number
  sources: Record<string, 'plan' | 'grant'>
  grants: Grant[]
  /** The newest 20; the full list is `GET …/billing/history`. */
  history: Array<{
    from: BillingState | null
    to: BillingState
    cause: string
    source: BillingHistorySource
    at: string
  }>
  /** The newest 20; the full list is `GET …/billing/events`. */
  events: Array<{
    type: string
    receivedAt: string
    processedAt: string | null
    error: string | null
  }>
}

/** One row of `GET /platform/tenants/:id/billing/history`: a billing state change. `from` is `null` for the first. */
export interface StaffBillingHistoryItem {
  id: string
  from: BillingState | null
  to: BillingState
  cause: string
  source: BillingHistorySource
  at: string
}

/**
 * One row of `GET /platform/tenants/:id/billing/events`: a provider event
 * tied to this tenant. It never carries the provider's event id, the
 * subscription id or the payload; `id` is the stored row's.
 */
export interface StaffBillingEventItem {
  id: string
  type: string
  status: BillingEventStatus
  provider: BillingProvider
  mode: BillingProviderMode
  receivedAt: string
  processedAt: string | null
  /** How many times an outcome was written to the row: 0 or 1 in practice, not the job's attempts. */
  recordedOutcomes: number
  error: string | null
}

/** One row of `GET /platform/tenants/:id/billing/subscriptions`: a subscription the tenant held as its current one. */
export interface StaffBillingSubscriptionItem {
  id: string
  subscriptionId: string
  provider: BillingProvider
  mode: BillingProviderMode
  firstSeenAt: string
  standing: BillingSubscriptionStanding
}

/**
 * One row of `GET /platform/tenants/:id/billing/invoices`, read from the
 * provider. It has no `url`: the provider's invoice page shows the payer's
 * contact details, which staff never see.
 */
export interface StaffInvoiceItem {
  id: string
  subscriptionId: string
  amountMinor: number
  currency: 'INR'
  status: InvoiceStatus
  issuedAt: string
  paidAt: string | null
  /** The tax invoice for this row's payment. */
  taxDocument: TaxDocumentRef | null
  /** Its credit notes, oldest first. */
  creditNotes: TaxDocumentRef[]
  taxStatus: TaxStatus
}

/** One plan on the staff plans screen. */
export interface StaffPlan {
  id: string
  key: PlanKey
  name: string
  description: string
  version: number
  entitlements: Record<string, EntitlementValue>
  prices: Array<
    PriceView & {
      active: boolean
      createdAt: string
      retiredAt: string | null
      subscribers: number
    }
  >
  tenantCounts: Record<BillingState, number>
}

/** `GET /platform/plans`. */
export interface StaffPlans {
  plans: StaffPlan[]
  catalog: EntitlementCatalogEntry[]
  priceWarningAboveMinor: 1500000
}

/** `POST /platform/plans/:id/preview`: what a plan edit changes and who it touches. */
export interface PlanChangePreview {
  changes: Array<{
    key: string
    from: EntitlementValue
    to: EntitlementValue
    direction: 'increase' | 'decrease'
  }>
  affected: { trialing: number; active: number; past_due: number; free: number }
}

/** `GET /platform/billing-settings`. */
export interface BillingSettings {
  trialEnabled: boolean
  trialDays: number
  pastDueGraceDays: number
  version: number
  updatedAt: string
  updatedBy: { userId: string; name: string } | null
  /** Registration is on. */
  taxDocumentsEnabled: boolean
  /** At least one tax document exists on the platform, any tenant's, purged ones included. */
  hasTaxDocuments: boolean
  /** `BILLING_GST_EFFECTIVE_FROM` as a `YYYY-MM-DD` IST date, whether or not registration is on; `null` when unset. */
  gstEffectiveFrom: string | null
}

/** One row of `GET /platform/billing/alerts`. */
export interface BillingAlert {
  id: string
  kind: BillingAlertKind
  tenant: { id: string; name: string } | null
  message: string
  at: string
}

/** `code` on the 402 for a write the plan's limit refuses. `details` is `{ key, used, limit }`, and absent when an invitee's join is refused. */
export const PLAN_LIMIT_REACHED = 'PLAN_LIMIT_REACHED'

/** `code` on the 402 for a feature the plan does not include. `details` is `{ key }`. */
export const PLAN_FEATURE_REQUIRED = 'PLAN_FEATURE_REQUIRED'

/** The tax document kinds, as express's `TAX_DOCUMENT_TYPES`. */
export const TAX_DOCUMENT_TYPES = ['invoice', 'credit_note'] as const

/** The held charge statuses the list filters by. */
export const TAX_HELD_STATUSES = ['open', 'resolved'] as const

/** A held charge's status filter value. */
export type TaxHeldStatus = (typeof TAX_HELD_STATUSES)[number]

/** A tax document: a tax invoice or a credit note. */
export type TaxDocumentType = (typeof TAX_DOCUMENT_TYPES)[number]

/** `intra`: CGST 9% + SGST 9%; `inter`: IGST 18%. */
export type SupplyKind = 'intra' | 'inter'

/** Whether an invoice row has its tax invoice (GC§7): `pending` is one the next tax run issues. */
export type TaxStatus = 'issued' | 'held' | 'pending' | 'not_applicable'

/** A state, as GSTINs and places of supply name it. `code` is two digits, such as `'29'`. */
export interface GstState {
  code: string
  name: string
}

/** A workspace's tax details, as the contract's §2 sends them. */
export interface TaxDetails {
  /** 15 characters, upper case; `null` is an unregistered buyer (B2C). */
  gstin: string | null
  /** 1–100. */
  legalName: string
  /** 1–100. */
  addressLine1: string | null
  /** 1–100. */
  addressLine2: string | null
  /** 1–60. */
  city: string | null
  /** 6 digits, the first not 0. */
  pincode: string | null
  /** The billing-address state; every saved row has one. */
  state: GstState
  isSez: boolean
  /** Sent back on PATCH. */
  version: number
  updatedAt: string
}

/** Tax details as staff read them. */
export interface StaffTaxDetails extends TaxDetails {
  /** `null` for a purged account. */
  updatedBy: { userId: string; name: string } | null
}

/** A tax document named by its id and number. */
export interface TaxDocumentRef {
  id: string
  number: string
}

/** A tax document's money in paise. */
export interface TaxAmounts {
  /** GST-inclusive: taxable + cgst + sgst + igst. */
  totalMinor: number
  taxableMinor: number
  /** 0 for inter. */
  cgstMinor: number
  /** 0 for inter. */
  sgstMinor: number
  /** 0 for intra. */
  igstMinor: number
  ratePercent: 18
}

/** One tax invoice or credit note. */
export interface TaxDocumentView {
  id: string
  type: TaxDocumentType
  /** `INV/26-27/00001` or `CN/26-27/00001`; at most 16 characters. */
  number: string
  /** `26-27`. */
  financialYear: string
  issuedAt: string
  amounts: TaxAmounts
  supply: SupplyKind
  placeOfSupply: GstState
  /** The snapshot's, not today's tax details. */
  buyerGstin: string | null
  /** A credit note's invoice; `null` for an invoice. */
  invoice: TaxDocumentRef | null
  /** An invoice's credit notes, oldest first; `[]` for a credit note. */
  creditNotes: TaxDocumentRef[]
  /** An invoice's total credited so far, manual notes included; 0 for a credit note. */
  creditedMinor: number
  /** A credit note issued after the s.34(2) deadline; `false` for invoices. */
  noTaxReduction: boolean
  /** A credit note's reason; `null` for invoices. */
  reason: string | null
  /** The provider payment id: an invoice's, and an automatic credit note's invoice's. */
  paymentId: string | null
  /** An automatic credit note's refund. */
  refundId: string | null
}

/** One row of `GET /platform/tenants/:id/billing/tax-documents`. */
export interface StaffTaxDocumentItem extends TaxDocumentView {
  /** A staff credit note, with no refund behind it. */
  manual: boolean
  /** Manual notes only; `null` otherwise, or when the account was purged. */
  createdBy: { userId: string; name: string } | null
}

/** One row of `GET /platform/tenants/:id/billing/tax-held-charges`: an SEZ charge held instead of invoiced. */
export interface TaxHeldCharge {
  id: string
  paymentId: string
  subscriptionId: string | null
  amountMinor: number
  paidAt: string
  heldAt: string
  resolvedAt: string | null
  resolvedBy: { userId: string; name: string } | null
  /** The staff member's note, 1–500. */
  resolution: string | null
}

/** A tax details change as `PATCH …/billing/tax-details` takes it (GC§4): the changed fields and the version read. */
export interface TaxDetailsPatch {
  /** `null` to create when no row exists; else the current version. */
  version: number | null
  gstin?: string | null
  legalName?: string
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  pincode?: string | null
  /** Never null. */
  stateCode?: string
  isSez?: boolean
}

/** The staff PATCH body: a tax details change and the reason for it. */
export type StaffTaxDetailsPatch = TaxDetailsPatch & { reason: string }

/** `code` on the 404 for a tax route while registration is off and the workspace has no documents (or a write while it is off). */
export const TAX_DOCUMENTS_DISABLED = 'tax_documents_disabled'

/** `code` on the 404 for a tax document id that is unknown or another tenant's. */
export const TAX_DOCUMENT_NOT_FOUND = 'tax_document_not_found'

/** `code` on the 404 for a held charge id that is unknown or another tenant's. */
export const TAX_HELD_CHARGE_NOT_FOUND = 'tax_held_charge_not_found'

/** `code` on the 409 for a tax details save made against a stale version. */
export const TAX_DETAILS_VERSION_CONFLICT = 'TAX_DETAILS_VERSION_CONFLICT'

/** `code` on the 409 for a manual credit note against a credit note. */
export const NOT_AN_INVOICE = 'NOT_AN_INVOICE'

/** `code` on the 409 for a manual credit above what is left to credit. `details` is `{ remainingMinor }`. */
export const CREDIT_EXCEEDS_INVOICE = 'CREDIT_EXCEEDS_INVOICE'

/** `code` on the 409 for the same admin's repeat of a manual credit note within 10 minutes. */
export const CREDIT_NOTE_REPEATED = 'CREDIT_NOTE_REPEATED'

/** `code` on the 409 for resolving a held charge that is already resolved. */
export const HELD_CHARGE_RESOLVED = 'HELD_CHARGE_RESOLVED'

/** `code` on the 409 for a plan or billing settings edit made against a version another staff member replaced. */
export const PLAN_VERSION_CONFLICT = 'PLAN_VERSION_CONFLICT'

/**
 * `code` on the 400 for a list cursor the API refused. Apex's shared list
 * hook keeps its own copy; this one is for the invoices list, whose cursor
 * express also refuses once the tenant's subscriptions change or payments
 * are turned off.
 */
export const CURSOR_INVALID = 'CURSOR_INVALID'

/** `code` on the 404 for a staff billing read of a tenant with no billing record: the platform tenant. */
export const TENANT_BILLING_NOT_FOUND = 'tenant_billing_not_found'
