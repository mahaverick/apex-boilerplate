/**
 * @file A user's or a tenant's PostHog error issues
 * (`GET /platform/users|tenants/:id/errors`). Every request writes an audit
 * entry (throttled by express) and may spend PostHog query budget, so
 * nothing here refetches on its own except a remount after `staleTime`, and
 * the cache is dropped as soon as the page is left.
 */
import { queryOptions } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { TimelineKind } from '@/queries/timeline.queries'
import type { ApiSuccess, ErrorIssuesPage } from '@/types/api.types'

export const errorsKeys = {
  /** Every error list, whatever its subject. */
  all: ['errors'] as const,
  list: (kind: TimelineKind, id: string) => ['errors', kind, id] as const,
}

/** The API path for each kind. */
const PATHS: Record<TimelineKind, (id: string) => string> = {
  user: (id) => `/platform/users/${id}/errors`,
  tenant: (id) => `/platform/tenants/${id}/errors`,
}

/**
 * One user's or tenant's error issues. Not retried: a retry would be a
 * second audited read, and the error state offers Retry. Not refetched on
 * window focus or on reconnect, for the same reason. The cache is dropped
 * when the page unmounts (`gcTime: 0`).
 * @param kind - A user's or a tenant's.
 * @param id - The user or tenant id.
 * @returns Options for `useQuery`.
 */
export function errorIssuesQueryOptions(kind: TimelineKind, id: string) {
  return queryOptions({
    queryKey: errorsKeys.list(kind, id),
    queryFn: async () => unwrap(await apiClient.get<ApiSuccess<ErrorIssuesPage>>(PATHS[kind](id))),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  })
}
