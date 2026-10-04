/**
 * @file The user and tenant timelines (`GET /platform/users|tenants/:id/timeline`),
 * paged by express's opaque `before` cursor. Every first-page request writes
 * an audit entry and may spend PostHog query budget, so nothing here asks for
 * a first page the reader did not.
 */
import { infiniteQueryOptions, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type {
  ApiSuccess,
  TimelinePage,
  TimelineRange,
  TimelineRow,
  TimelineView,
} from '@/types/api.types'

/** Whose timeline: a user's or a tenant's. */
export type TimelineKind = 'user' | 'tenant'

export const timelineKeys = {
  /** Every timeline, whatever its subject, window or view. */
  all: ['timeline'] as const,
  page: (kind: TimelineKind, id: string, range: TimelineRange, view: TimelineView) =>
    ['timeline', kind, id, range, view] as const,
}

/** The API path for each kind. */
const PATHS: Record<TimelineKind, (id: string) => string> = {
  user: (id) => `/platform/users/${id}/timeline`,
  tenant: (id) => `/platform/tenants/${id}/timeline`,
}

/**
 * One timeline as an infinite query. Not retried: a retried first page would
 * be audited twice, and the error state offers Retry. Not refetched on window
 * focus, for the same reason; Refresh and a revisit after `staleTime` do.
 * @param kind - A user's or a tenant's.
 * @param id - The user or tenant id.
 * @param range - The window.
 * @param view - Everything, or key events only.
 * @returns Options for `useInfiniteQuery`.
 */
export function timelineInfiniteOptions(
  kind: TimelineKind,
  id: string,
  range: TimelineRange,
  view: TimelineView
) {
  return infiniteQueryOptions({
    queryKey: timelineKeys.page(kind, id, range, view),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await apiClient.get<ApiSuccess<TimelinePage>>(PATHS[kind](id), {
          params: { range, view, before: pageParam },
        })
      ),
    getNextPageParam: (page: TimelinePage) =>
      page.configured ? (page.nextCursor ?? undefined) : undefined,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

/**
 * A user's timeline: their own events (pre-login ones included, once
 * PostHog merged them) and staff actions on them.
 * @param userId - The user.
 * @param range - The window.
 * @param view - Everything, or key events only.
 * @returns Options for `useInfiniteQuery`.
 */
export function userTimelineInfiniteOptions(
  userId: string,
  range: TimelineRange,
  view: TimelineView
) {
  return timelineInfiniteOptions('user', userId, range, view)
}

/**
 * A tenant's timeline: every event in its PostHog group, and staff actions
 * on it, each row with its actor.
 * @param tenantId - The tenant.
 * @param range - The window.
 * @param view - Everything, or key events only.
 * @returns Options for `useInfiniteQuery`.
 */
export function tenantTimelineInfiniteOptions(
  tenantId: string,
  range: TimelineRange,
  view: TimelineView
) {
  return timelineInfiniteOptions('tenant', tenantId, range, view)
}

/**
 * Every loaded page's rows, newest first. A `configured: false` page has none.
 * @param data - The infinite query's data.
 * @returns The rows.
 */
export function flattenTimelinePages(data: InfiniteData<TimelinePage> | undefined): TimelineRow[] {
  return data?.pages.flatMap((page) => (page.configured ? page.rows : [])) ?? []
}

/**
 * Refresh: drop every page after the first, then refetch that one, so the
 * reader gets the newest events without re-reading older pages. The
 * refetch is a first page, so express audits it.
 * @param client - The query client.
 * @param key - The timeline's query key.
 * @returns When the refetch settles.
 */
export async function refreshTimeline(
  client: QueryClient,
  key: ReturnType<typeof timelineKeys.page>
): Promise<void> {
  client.setQueryData<InfiniteData<TimelinePage>>(key, (data) =>
    data === undefined
      ? data
      : { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
  )
  await client.refetchQueries({ queryKey: key, exact: true })
}
