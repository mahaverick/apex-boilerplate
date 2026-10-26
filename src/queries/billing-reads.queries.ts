/**
 * @file The staff billing reads a route needs before its component loads:
 * the keys, the plans, settings and tenant billing reads, and the list
 * definitions a route's `validateSearch` reads (the Billing tab's and the
 * billing alerts page's). A route's `validateSearch`
 * and `loader` land in the entry chunk, so they import this small module and
 * never `billing-admin.queries.ts`, whose writes and list options stay with
 * the components that use them (`pnpm check:bundle` holds that line).
 */
import { queryOptions } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { analyticsKey } from '@/observability/telemetry'
import { retryList } from '@/queries/list.queries'
import { PLANS_KEY } from '@/queries/platform.queries'
import { defineList, listFilter } from '@/schemas/list.schemas'
import type { ApiSuccess } from '@/types/api.types'
import {
  BILLING_EVENT_STATUSES,
  BILLING_HISTORY_SOURCES,
  BILLING_PROVIDER_MODES,
  BILLING_PROVIDERS,
  type BillingSettings,
  type StaffPlans,
  type StaffTenantBilling,
} from '@/types/billing.types'

/**
 * `plans` and `settings` are the platform-wide reads; `alerts` prefixes
 * every alerts page; `tenant(id)` is one tenant's billing, a child of
 * `tenantAdminKeys.detail(id)`.
 */
export const billingAdminKeys = {
  plans: PLANS_KEY,
  settings: ['platform', 'billing-settings'] as const,
  alerts: ['platform', 'billing', 'alerts'] as const,
  tenant: (id: string) => ['platform', 'tenant', id, 'billing'] as const,
}

/**
 * The list reads' retry, typed for a single read: a 404 answers who is
 * asking and never changes on a retry, and `retryList` treats it, like every
 * 4xx but 408 and 429, as final. Typing the error as `Error` keeps the query's
 * error type `Error`.
 * @param failureCount - Failures so far.
 * @param error - The last failure.
 */
function retryRead(failureCount: number, error: Error): boolean {
  return retryList(failureCount, error)
}

/** `GET /platform/plans` (viewer): both plans with their prices and tenant counts, and the entitlement catalog. */
export function staffPlansQueryOptions() {
  return queryOptions({
    queryKey: billingAdminKeys.plans,
    queryFn: async ({ signal }) =>
      unwrap(await apiClient.get<ApiSuccess<StaffPlans>>('/platform/plans', { signal })),
    retry: retryRead,
  })
}

/** `GET /platform/billing-settings` (viewer): the trial and grace rules, with the version an edit sends back. */
export function billingSettingsQueryOptions() {
  return queryOptions({
    queryKey: billingAdminKeys.settings,
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<BillingSettings>>('/platform/billing-settings', { signal })
      ),
    retry: retryRead,
  })
}

/**
 * `GET /platform/tenants/:id/billing` (viewer). A 404 is a role refusal, an
 * unknown tenant, or `tenant_billing_not_found` for the platform tenant,
 * which has no billing; none changes on a retry.
 */
export function staffTenantBillingQueryOptions(tenantId: string) {
  return queryOptions({
    queryKey: billingAdminKeys.tenant(tenantId),
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<StaffTenantBilling>>(
          `/platform/tenants/${tenantId}/billing`,
          { signal }
        )
      ),
    retry: retryRead,
  })
}

/** The provider events list's URL contract on a tenant's Billing tab: newest received first, by status. */
export const billingEventsList = defineList({
  sorts: ['-at', 'at'],
  filters: { status: listFilter(BILLING_EVENT_STATUSES) },
  table: analyticsKey('billing_events'),
  prefix: 'events',
})

/** The held subscriptions list's URL contract on a tenant's Billing tab: newest first seen first, by provider and mode. */
export const billingSubscriptionsList = defineList({
  sorts: ['-firstSeen', 'firstSeen'],
  filters: {
    provider: listFilter(BILLING_PROVIDERS),
    mode: listFilter(BILLING_PROVIDER_MODES),
  },
  table: analyticsKey('billing_subscriptions'),
  prefix: 'subscriptions',
})

/**
 * The state history list's URL contract on a tenant's Billing tab: newest
 * first, by source. Each of the tab's three lists has its own prefix, and
 * this one carries the other two, so its `schema` is the route's one
 * `validateSearch`.
 */
export const billingHistoryList = defineList({
  sorts: ['-at', 'at'],
  filters: { source: listFilter(BILLING_HISTORY_SOURCES) },
  table: analyticsKey('billing_history'),
  prefix: 'history',
  also: [billingEventsList, billingSubscriptionsList],
})

/** The billing alerts list's URL contract on its own page: newest first, searched by message. */
export const billingAlertsList = defineList({
  sorts: ['-at', 'at'],
  filters: {},
  table: analyticsKey('billing_alerts'),
})
