/**
 * @file The staff flags inspector (`GET /platform/flags` and
 * `GET /platform/flags/evaluate`). An evaluation writes an audit entry
 * (throttled by express), so it never refetches on its own except a
 * remount after `staleTime`, and its cache is dropped when the page is left.
 * Keys sit under `platform`, apart from the app's own flag values.
 */
import { queryOptions } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { isRoleDenied } from '@/queries/platform.queries'
import type {
  ApiSuccess,
  FlagApp,
  FlagsEvaluateResponse,
  FlagsListResponse,
} from '@/types/api.types'

/** Who to evaluate: a user, optionally in one of their tenants, as one app's client. */
export interface FlagEvaluateParams {
  userId: string
  tenantId?: string
  app: FlagApp
}

export const flagInspectorKeys = {
  /** Every inspector read. */
  all: ['platform', 'flags'] as const,
  list: ['platform', 'flags', 'list'] as const,
  evaluate: ({ userId, tenantId, app }: FlagEvaluateParams) =>
    ['platform', 'flags', 'evaluate', userId, tenantId ?? null, app] as const,
}

/**
 * Every registered flag with its live state, PostHog's unregistered flags
 * and the trait reference. Viewers and up.
 * @returns Query options for `useQuery`.
 */
export function flagsListQueryOptions() {
  return queryOptions({
    queryKey: flagInspectorKeys.list,
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<FlagsListResponse>>('/platform/flags')),
    /** A 404 answers who is asking, so a retry changes nothing. */
    retry: (failureCount, error) => !isRoleDenied(error) && failureCount < 1,
  })
}

/**
 * One person's evaluation of every registered flag, with the traits
 * express used. Admins and up. Not retried and not refetched on focus or
 * reconnect: each request is an audited read, and the error state offers
 * Try again. The cache is dropped when the page unmounts (`gcTime: 0`).
 * @param params - The user, the optional tenant and the app.
 * @returns Query options for `useQuery`.
 */
export function flagsEvaluateQueryOptions(params: FlagEvaluateParams) {
  return queryOptions({
    queryKey: flagInspectorKeys.evaluate(params),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<FlagsEvaluateResponse>>('/platform/flags/evaluate', {
          params: {
            userId: params.userId,
            ...(params.tenantId === undefined ? {} : { tenantId: params.tenantId }),
            app: params.app,
          },
        })
      ),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  })
}
