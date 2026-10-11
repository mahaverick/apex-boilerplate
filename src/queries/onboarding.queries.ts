/**
 * @file Staff reads and writes on onboarding (`/platform/onboarding/*`,
 * `/platform/tenants/:id/onboarding*`). Imports nothing from
 * platform.queries.ts, whose `invalidateDirectory` reaches these keys.
 */
import {
  hashKey,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import { auditKeys } from '@/queries/audit.queries'
import { invalidateEmails } from '@/queries/email.queries'
import type {
  ApiSuccess,
  OnboardingFunnel,
  OnboardingListState,
  OnboardingRange,
  OnboardingReminderResult,
  OnboardingTenantPage,
  PageDirection,
  TenantOnboardingDetail,
} from '@/types/api.types'

/** The API's default page; its cap is 50. */
const ONBOARDING_PAGE_SIZE = 20

/** `GET /platform/onboarding/tenants` params, in the API's own names. */
export interface OnboardingTenantsParams {
  state: OnboardingListState
  cursor?: string
  /** Which way `cursor` pages. Sent only with a cursor. */
  direction?: PageDirection
  limit?: number
}

/**
 * Every onboarding query sits under `all`: the funnel, the lists and each
 * tenant's detail, so one prefix refreshes them all.
 */
export const onboardingKeys = {
  all: ['platform', 'onboarding'] as const,
  funnel: (range: OnboardingRange) => ['platform', 'onboarding', 'funnel', range] as const,
  tenants: (params: OnboardingTenantsParams) =>
    ['platform', 'onboarding', 'tenants', params] as const,
  tenant: (id: string) => ['platform', 'onboarding', 'tenant', id] as const,
}

/** The Overview's figures carry `totals.stuckTenants`, which a staff action can change. */
const STATS_PREFIX = ['platform', 'stats'] as const

/** A 404 answers who is asking (or an unknown tenant), so a retry changes nothing. */
function retryUnlessDenied(failureCount: number, error: unknown): boolean {
  return statusFrom(error) !== 404 && failureCount < 1
}

/**
 * The funnel for one window. The previous window's figures stay up while the
 * next loads.
 * @param range - The window.
 * @returns Query options for `useQuery` and the route loader.
 */
export function onboardingFunnelQueryOptions(range: OnboardingRange) {
  return queryOptions({
    queryKey: onboardingKeys.funnel(range),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<OnboardingFunnel>>('/platform/onboarding/funnel', {
          params: { range },
        })
      ),
    placeholderData: keepPreviousData,
    retry: retryUnlessDenied,
  })
}

/**
 * One keyset page of tracked tenants in one state: stuck ones by days stuck,
 * the rest newest first, as the API orders them.
 * @param params - The state, and the cursor to page from.
 * @returns Query options for `useQuery` or a route loader.
 */
export function onboardingTenantsQueryOptions({
  state,
  cursor,
  direction,
  limit = ONBOARDING_PAGE_SIZE,
}: OnboardingTenantsParams) {
  const sent: OnboardingTenantsParams = {
    state,
    ...(cursor ? { cursor, direction: direction ?? 'next' } : {}),
    limit,
  }
  return queryOptions({
    queryKey: onboardingKeys.tenants(sent),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<OnboardingTenantPage>>('/platform/onboarding/tenants', {
          params: sent,
        })
      ),
    placeholderData: keepPreviousData,
    retry: retryUnlessDenied,
  })
}

/** One tenant's steps, member statuses and reminders, in any lifecycle state. */
export function tenantOnboardingQueryOptions(id: string) {
  return queryOptions({
    queryKey: onboardingKeys.tenant(id),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<TenantOnboardingDetail>>(
          `/platform/tenants/${id}/onboarding`
        )
      ),
    retry: retryUnlessDenied,
  })
}

/**
 * When the API will take the next reminder, from a 409 `reminded_recently`:
 * express sends it as `errors.retryAfter`, an ISO instant.
 * @param error - A failed reminder.
 * @returns The instant, or `undefined` for any other failure.
 */
export function retryAfterFrom(error: unknown): string | undefined {
  if (!(error instanceof AxiosError)) return undefined
  const body = error.response?.data as { code?: unknown; errors?: unknown } | undefined
  if (body?.code !== 'reminded_recently') return undefined
  const errors = body.errors as { retryAfter?: unknown } | null | undefined
  return typeof errors?.retryAfter === 'string' ? errors.retryAfter : undefined
}

/**
 * Mark every onboarding query stale. Only the queries on screen refetch.
 * @param queryClient - The app's query client.
 * @returns Resolves once the on-screen queries have refetched.
 */
export async function invalidateOnboarding(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: onboardingKeys.all })
}

/**
 * What a staff onboarding write leaves stale, whether or not the API took it.
 * @param queryClient - The app's query client.
 * @param slug - The tenant's slug, which keys its own audit log.
 * @param fresh - A key the caller just replaced from the write's own answer, left as it is.
 */
async function afterStaffWrite(
  queryClient: QueryClient,
  slug: string,
  fresh?: QueryKey
): Promise<void> {
  const skip = fresh === undefined ? undefined : hashKey(fresh)
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: onboardingKeys.all,
      predicate: (query) => query.queryHash !== skip,
    }),
    queryClient.invalidateQueries({ queryKey: STATS_PREFIX }),
    queryClient.invalidateQueries({ queryKey: auditKeys.tenantAll(slug) }),
    queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
  ])
}

/**
 * Mark one of the tenant's own steps complete, with an audited reason
 * (admin). The API answers the tenant's onboarding as it now is, which
 * replaces the cached detail. Settled, not success: a 409
 * (`already_complete`, `not_tracked`, `tenant_state_conflict`) means the
 * cached detail was stale, so it refreshes either way, with the funnel, the
 * lists, both audit logs and the Overview's stuck count.
 * @param tenantId - The tenant's id.
 * @param slug - Its slug, which keys its own audit log.
 */
export function useCompleteOnboardingStep(tenantId: string, slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ stepKey, reason }: { stepKey: string; reason: string }) =>
      unwrap(
        await apiClient.post<ApiSuccess<TenantOnboardingDetail>>(
          `/platform/tenants/${tenantId}/onboarding/steps/${encodeURIComponent(stepKey)}/complete`,
          { reason }
        )
      ),
    onSettled: async (detail) => {
      if (detail === undefined) {
        await afterStaffWrite(queryClient, slug)
        return
      }
      queryClient.setQueryData(onboardingKeys.tenant(tenantId), detail)
      await afterStaffWrite(queryClient, slug, onboardingKeys.tenant(tenantId))
    },
  })
}

/**
 * Email every active owner a reminder, with an audited reason (admin). The
 * emails are tracked like any other, so the email queries refresh too; a 409
 * (`reminded_recently`, `no_owner`, `not_in_progress`) refreshes the same.
 * @param tenantId - The tenant's id.
 * @param slug - Its slug, which keys its own audit log.
 */
export function useSendOnboardingReminder(tenantId: string, slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (reason: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<OnboardingReminderResult>>(
          `/platform/tenants/${tenantId}/onboarding/remind`,
          { reason }
        )
      ),
    onSettled: async () => {
      await Promise.all([afterStaffWrite(queryClient, slug), invalidateEmails(queryClient)])
    },
  })
}
