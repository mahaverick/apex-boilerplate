/**
 * @file The staff flags inspector (`GET /platform/flags` and
 * `GET /platform/flags/evaluate`). An evaluation writes an audit entry
 * (throttled by express), so it never refetches on its own except a
 * remount after `staleTime`, and its cache is dropped when the page is left.
 * Keys sit under `platform`, apart from the app's own flag values.
 */
import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { isRoleDenied } from '@/lib/role-denied'
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { flagsSearchSchema } from '@/schemas/flags.schemas'
import { defineList, listFilter } from '@/schemas/list.schemas'
import {
  FLAG_STATES,
  type ApiSuccess,
  type FlagApp,
  type FlagRow,
  type FlagsEvaluateResponse,
  type FlagsMetaResponse,
  type UnregisteredRow,
} from '@/types/api.types'
import type { ListRequest } from '@/types/list.types'

/** Who to evaluate: a user, optionally in one of their tenants, as one app's client. */
export interface FlagEvaluateParams {
  userId: string
  tenantId?: string
  app: FlagApp
}

/** Keys under `['platform', 'flags']`, apart from the app's own flag values; invalidating `all` reaches every list, the meta read and every evaluation. */
export const flagInspectorKeys = {
  /** Every inspector read. */
  all: ['platform', 'flags'] as const,
  evaluate: ({ userId, tenantId, app }: FlagEvaluateParams) =>
    ['platform', 'flags', 'evaluate', userId, tenantId ?? null, app] as const,
}

/** The unregistered flags' URL contract on the Feature flags page: prefixed, since the registry shares the route. */
export const unregisteredFlagsList = defineList({
  sorts: ['key'],
  filters: {},
  table: analyticsKey('unregistered_flags'),
  prefix: 'unregistered',
})

/** The Feature flags page's URL contract: the registry's list, the unregistered list's keys, and who to evaluate. */
export const flagsList = defineList({
  sorts: ['key'],
  filters: {
    kind: listFilter(['boolean', 'multivariate']),
    state: listFilter(FLAG_STATES),
  },
  table: analyticsKey('flags'),
  extra: flagsSearchSchema.shape,
  also: [unregisteredFlagsList],
})

/**
 * One page of the flag registry with each flag's live state (`GET /platform/flags`).
 * Its key sits apart from the unregistered list's: both default to the request `{}`.
 * @param request - From `listRequest(flagsList, …)`, or `{ limit }`.
 * @param options - `total: false` for a read that never shows the total (the evaluate panel).
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function flagsListOptions(request: ListRequest, options: { total?: boolean } = {}) {
  return listQueryOptions<FlagRow>({
    key: [...flagInspectorKeys.all, 'registry'],
    path: '/platform/flags',
    request,
    ...options,
  })
}

/**
 * One page of the flags PostHog has that the registry lacks (`GET /platform/flags/unregistered`).
 * @param request - From `listRequest(unregisteredFlagsList, …)`.
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function unregisteredFlagsListOptions(request: ListRequest) {
  return listQueryOptions<UnregisteredRow>({
    key: [...flagInspectorKeys.all, 'unregistered'],
    path: '/platform/flags/unregistered',
    request,
  })
}

/**
 * The trait reference and the snapshot's freshness (`GET /platform/flags/meta`).
 * @returns Query options for `useQuery`.
 */
export function flagsMetaQueryOptions() {
  return queryOptions({
    queryKey: [...flagInspectorKeys.all, 'meta'] as const,
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<FlagsMetaResponse>>('/platform/flags/meta', { signal })
      ),
    /** A 404 answers who is asking, so a retry changes nothing. */
    retry: (failureCount, error) => !isRoleDenied(error) && failureCount < 1,
  })
}

/** The request for the registry's first hundred flags, the most one page holds. */
export const FLAG_REGISTRY_READ: ListRequest = { limit: 100 }

/** The registry's first hundred flags, for the evaluate panel and the tenant Flags tab. */
export function useFlagRegistry() {
  return useQuery({
    ...flagsListOptions(FLAG_REGISTRY_READ, { total: false }),
    select: (page) => page.items,
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
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<FlagsEvaluateResponse>>('/platform/flags/evaluate', {
          signal,
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
