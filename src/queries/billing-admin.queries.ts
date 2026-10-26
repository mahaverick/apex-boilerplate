/**
 * @file Staff reads and writes on billing (`/platform/plans*`,
 * `/platform/billing-settings`, `/platform/billing/alerts` and
 * `/platform/tenants/:id/billing*`), over express's staff billing routes.
 * Every write but the plan preview runs inside `useStepUp().run` at its call
 * site and carries a reason. A tenant's billing key sits under its detail
 * key, so `invalidateDirectory` reaches it with the rest of the tenant. The
 * keys, the reads a loader starts and the Billing tab's list definitions are
 * in `billing-reads.queries.ts`, so a route never pulls this module into the
 * entry chunk.
 */
import {
  infiniteQueryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { analyticsKey } from '@/observability/telemetry'
import { auditKeys } from '@/queries/audit.queries'
import { billingAdminKeys } from '@/queries/billing-reads.queries'
import { listQueryOptions, retryList } from '@/queries/list.queries'
import { invalidateDirectory } from '@/queries/platform.queries'
import { tenantAdminKeys } from '@/queries/tenant-admin.queries'
import { defineList } from '@/schemas/list.schemas'
import type { ApiSuccess } from '@/types/api.types'
import {
  GRANT_NOT_FOUND,
  PLAN_VERSION_CONFLICT,
  type BillingAlert,
  type BillingInterval,
  type BillingSettings,
  type EntitlementValue,
  type PlanChangePreview,
  type StaffBillingEventItem,
  type StaffBillingHistoryItem,
  type StaffBillingSubscriptionItem,
  type StaffCancelWhen,
  type StaffInvoiceItem,
  type StaffPlan,
  type StaffPlans,
  type StaffTenantBilling,
} from '@/types/billing.types'
import type { ListPage, ListRequest } from '@/types/list.types'

/**
 * The billing alerts list's URL contract: newest first, searched by message.
 * Its keys carry the `alerts` prefix, since the list shares the Plans page.
 */
export const billingAlertsList = defineList({
  sorts: ['-at', 'at'],
  filters: {},
  prefix: 'alerts',
  table: analyticsKey('billing_alerts'),
})

/**
 * One page of `GET /platform/billing/alerts` (admin), for the Overview card
 * (`{ limit: 5 }`) and the full list.
 * @param request - From `listRequest(billingAlertsList, …)`, or `{ limit }`.
 * @param options - `total: false` for the card, which never shows the total.
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function billingAlertsListOptions(request: ListRequest, options: { total?: boolean } = {}) {
  return listQueryOptions<BillingAlert>({
    key: billingAdminKeys.alerts,
    path: '/platform/billing/alerts',
    request,
    ...options,
  })
}

/**
 * One page of a tenant's billing list, under the tenant's billing key, so
 * every billing write and directory refresh refetches it.
 * @param tenantId - The tenant.
 * @param name - The list's route under the tenant's billing.
 * @param request - From `listRequest`.
 */
function tenantBillingListOptions<T>(tenantId: string, name: string, request: ListRequest) {
  return listQueryOptions<T>({
    key: [...billingAdminKeys.tenant(tenantId), name],
    path: `/platform/tenants/${tenantId}/billing/${name}`,
    request,
  })
}

/**
 * One page of `GET /platform/tenants/:id/billing/history` (viewer): search
 * matches the from and to states and the cause as stored.
 * @param tenantId - The tenant.
 * @param request - From `listRequest(billingHistoryList, …)`.
 * @returns Query options for `useListQuery` or a route loader.
 */
export function billingHistoryListOptions(tenantId: string, request: ListRequest) {
  return tenantBillingListOptions<StaffBillingHistoryItem>(tenantId, 'history', request)
}

/**
 * One page of `GET /platform/tenants/:id/billing/events` (viewer): search
 * matches the event type and the error.
 * @param tenantId - The tenant.
 * @param request - From `listRequest(billingEventsList, …)`.
 * @returns Query options for `useListQuery` or a route loader.
 */
export function billingEventsListOptions(tenantId: string, request: ListRequest) {
  return tenantBillingListOptions<StaffBillingEventItem>(tenantId, 'events', request)
}

/**
 * One page of `GET /platform/tenants/:id/billing/subscriptions` (viewer):
 * search matches the subscription id.
 * @param tenantId - The tenant.
 * @param request - From `listRequest(billingSubscriptionsList, …)`.
 * @returns Query options for `useListQuery` or a route loader.
 */
export function billingSubscriptionsListOptions(tenantId: string, request: ListRequest) {
  return tenantBillingListOptions<StaffBillingSubscriptionItem>(tenantId, 'subscriptions', request)
}

/**
 * `GET /platform/tenants/:id/billing/invoices` (viewer), read from the
 * provider forward only: each page asks for the last page's cursor and the
 * status filter, and nothing else, since the route ignores search, sort,
 * direction, limit and total. A page may be short or empty while `hasNext`
 * holds, so the reader keeps paging until it does not. With payments off the
 * first page is empty, which means the provider can't be read, so the
 * caller asks nothing then.
 * @param tenantId - The tenant.
 * @param status - A comma list of invoice statuses, or `undefined` for every status.
 * @returns Infinite query options, a page per cursor.
 */
export function staffInvoicesQueryOptions(tenantId: string, status: string | undefined) {
  return infiniteQueryOptions({
    queryKey: [...billingAdminKeys.tenant(tenantId), 'invoices', { status }] as const,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<ListPage<StaffInvoiceItem>>>(
          `/platform/tenants/${tenantId}/billing/invoices`,
          {
            params: {
              ...(pageParam === undefined ? {} : { cursor: pageParam }),
              ...(status === undefined ? {} : { status }),
            },
            signal,
          }
        )
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ListPage<StaffInvoiceItem>) =>
      last.page.hasNext && last.page.nextCursor !== null ? last.page.nextCursor : undefined,
    retry: retryList,
    // Every loaded page is a provider read (up to 10 calls each), so a focus refetch would re-read them all.
    refetchOnWindowFocus: false,
  })
}

/** Every open tenant's billing view: a plan or settings edit changes what each tenant on it gets. */
function invalidateTenantBillingViews(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: ['platform', 'tenant'],
    predicate: (query) => query.queryKey[3] === 'billing',
  })
}

/**
 * A write on one tenant's billing. Each answers the tenant's staff view,
 * which replaces the cached one; the rest of the tenant's directory
 * refreshes (its detail, the tenants list's plan column, the audit log,
 * and the plans, whose tenant counts may have moved). A 409 means the
 * cached state was stale (a trial that is no longer extendable, a
 * subscription already ending), so the view, the tenants list and the plan
 * counts refetch to show the real state. A 404 `grant_not_found` means the
 * grant shown is gone, so the view refetches. Any other failure changed
 * nothing, so the cache stays.
 * @param tenantId - The tenant's id.
 * @param post - Sends the write and returns the answered view.
 */
function useTenantBillingWrite<Input>(
  tenantId: string,
  post: (input: Input) => Promise<StaffTenantBilling>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: post,
    onSuccess: async (view) => {
      queryClient.setQueryData(billingAdminKeys.tenant(tenantId), view)
      await invalidateDirectory(queryClient, billingAdminKeys.tenant(tenantId))
    },
    onError: async (error) => {
      if (statusFrom(error) === 409) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: billingAdminKeys.tenant(tenantId) }),
          queryClient.invalidateQueries({ queryKey: tenantAdminKeys.all }),
          queryClient.invalidateQueries({ queryKey: billingAdminKeys.plans }),
        ])
      } else if (codeFrom(error) === GRANT_NOT_FOUND) {
        await queryClient.invalidateQueries({ queryKey: billingAdminKeys.tenant(tenantId) })
      }
    },
  })
}

/**
 * `POST /platform/tenants/:id/billing/<path>` with `body`, answered with the tenant's staff view.
 * @param tenantId - The tenant's id.
 * @param path - The route under the tenant's billing, such as `resync`.
 * @param body - The write's body, its reason included.
 */
async function postTenantBilling(
  tenantId: string,
  path: string,
  body: object
): Promise<StaffTenantBilling> {
  return unwrap(
    await apiClient.post<ApiSuccess<StaffTenantBilling>>(
      `/platform/tenants/${tenantId}/billing/${path}`,
      body
    )
  )
}

/** `POST …/billing/resync` (manager): reads the tenant's subscriptions from the provider and stores the result. */
export function useResyncBilling(tenantId: string) {
  return useTenantBillingWrite(tenantId, (input: { reason: string }) =>
    postTenantBilling(tenantId, 'resync', input)
  )
}

/**
 * `POST …/billing/extend-trial` (manager): adds `days` to a running trial, or
 * starts one on a Free tenant. 409 `TRIAL_NOT_EXTENDABLE` on a paying or
 * past-due tenant.
 */
export function useExtendTrial(tenantId: string) {
  return useTenantBillingWrite(tenantId, (input: { days: number; reason: string }) =>
    postTenantBilling(tenantId, 'extend-trial', input)
  )
}

/** A grant as `POST …/billing/grants` takes it: `grantSchema`'s parsed output. */
interface GrantInput {
  key: string
  value: EntitlementValue
  /** An ISO date-time in the future, or null for no end. */
  expiresAt: string | null
  reason: string
}

/** `POST …/billing/grants` (manager): raises a limit or turns on a feature beyond the plan. */
export function useAddGrant(tenantId: string) {
  return useTenantBillingWrite(tenantId, (input: GrantInput) =>
    postTenantBilling(tenantId, 'grants', input)
  )
}

/**
 * `POST …/billing/grants/:grantId/revoke` (manager). A grant already revoked
 * answers 200 with nothing written; another tenant's grant answers 404
 * `grant_not_found`.
 */
export function useRevokeGrant(tenantId: string) {
  return useTenantBillingWrite(
    tenantId,
    ({ grantId, reason }: { grantId: string; reason: string }) =>
      postTenantBilling(tenantId, `grants/${grantId}/revoke`, { reason })
  )
}

/**
 * `POST …/billing/cancel` (admin): ends the subscription at its cycle end or
 * now. 409 `NO_SUBSCRIPTION` with nothing to cancel, or for a cycle-end cancel
 * already scheduled; 502 or 503 when the provider can't be reached.
 */
export function useCancelBillingByStaff(tenantId: string) {
  return useTenantBillingWrite(tenantId, (input: { when: StaffCancelWhen; reason: string }) =>
    postTenantBilling(tenantId, 'cancel', input)
  )
}

/**
 * `POST /platform/plans/:id/preview` (admin): what an entitlement edit
 * changes, and how many tenants the plan serves in each state. It writes
 * nothing, so it takes no reason, no step-up and no cache change.
 */
export function usePreviewPlanChange(planId: string) {
  return useMutation({
    mutationFn: async (entitlements: Record<string, EntitlementValue>) =>
      unwrap(
        await apiClient.post<ApiSuccess<PlanChangePreview>>(`/platform/plans/${planId}/preview`, {
          entitlements,
        })
      ),
  })
}

/**
 * The plan an edit answered, put into the cached plans in its place.
 * @param queryClient - The app's query client.
 * @param plan - The plan as the write answered it.
 */
function cachePlan(queryClient: QueryClient, plan: StaffPlan): void {
  queryClient.setQueryData<StaffPlans>(billingAdminKeys.plans, (plans) =>
    plans === undefined
      ? plans
      : { ...plans, plans: plans.plans.map((cached) => (cached.id === plan.id ? plan : cached)) }
  )
}

/** A plan edit as `PATCH /platform/plans/:id` takes it: only the changed fields, with the version read. */
interface UpdatePlanInput {
  version: number
  name?: string
  description?: string
  /** Only the changed keys; the server merges them over the stored values. */
  entitlements?: Record<string, EntitlementValue>
  reason: string
}

/**
 * `PATCH /platform/plans/:id` (admin). The answered plan replaces the cached
 * one; the plans refetch for their counts, and every tenant on the plan
 * gets new entitlements, so the tenant lists, their billing views and the
 * audit log refresh. A 409 `PLAN_VERSION_CONFLICT` means another staff
 * member saved first, so the plans reload.
 */
export function useUpdatePlan(planId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdatePlanInput) =>
      unwrap(await apiClient.patch<ApiSuccess<StaffPlan>>(`/platform/plans/${planId}`, input)),
    onSuccess: async (plan) => {
      cachePlan(queryClient, plan)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: billingAdminKeys.plans }),
        queryClient.invalidateQueries({ queryKey: tenantAdminKeys.all }),
        invalidateTenantBillingViews(queryClient),
        queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
      ])
    },
    onError: async (error) => {
      if (codeFrom(error) === PLAN_VERSION_CONFLICT) {
        await queryClient.invalidateQueries({ queryKey: billingAdminKeys.plans })
      }
    },
  })
}

/**
 * `POST /platform/plans/:id/prices` (admin): a new price, which retires the
 * active price of its interval. Subscribers keep what they pay, so only the
 * plans and the audit log refresh. A 409 means another price change won the
 * slot, so the plans reload.
 */
export function useCreatePrice(planId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { interval: BillingInterval; amountMinor: number; reason: string }) =>
      unwrap(
        await apiClient.post<ApiSuccess<StaffPlan>>(`/platform/plans/${planId}/prices`, input)
      ),
    onSuccess: async (plan) => {
      cachePlan(queryClient, plan)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: billingAdminKeys.plans }),
        queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
      ])
    },
    onError: async (error) => {
      if (statusFrom(error) === 409) {
        await queryClient.invalidateQueries({ queryKey: billingAdminKeys.plans })
      }
    },
  })
}

/** A settings edit as `PATCH /platform/billing-settings` takes it: only the changed fields, with the version read. */
interface UpdateBillingSettingsInput {
  version: number
  trialEnabled?: boolean
  trialDays?: number
  pastDueGraceDays?: number
  reason: string
}

/**
 * `PATCH /platform/billing-settings` (admin). The answer replaces the cached
 * settings. A grace change moves the end of every failed payment's grace, so
 * the tenants' billing views refresh, and the audit log. A 409
 * `PLAN_VERSION_CONFLICT` means another staff member saved first, so the
 * settings reload.
 */
export function useUpdateBillingSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateBillingSettingsInput) =>
      unwrap(
        await apiClient.patch<ApiSuccess<BillingSettings>>('/platform/billing-settings', input)
      ),
    onSuccess: async (settings) => {
      queryClient.setQueryData(billingAdminKeys.settings, settings)
      await Promise.all([
        invalidateTenantBillingViews(queryClient),
        queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
      ])
    },
    onError: async (error) => {
      if (codeFrom(error) === PLAN_VERSION_CONFLICT) {
        await queryClient.invalidateQueries({ queryKey: billingAdminKeys.settings })
      }
    },
  })
}
