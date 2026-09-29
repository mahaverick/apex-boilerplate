import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import type { ApiSuccess, PlatformStats, StatsRange } from '@/types/api.types'

/** How long a tenant search box waits for typing to stop before asking the API. */
export const SEARCH_DEBOUNCE_MS = 250

/** Tenant search and paging live in tenant-admin.queries.ts. */
export const platformKeys = {
  stats: (range: string) => ['platform', 'stats', range] as const,
}

/** The API's default page; its cap is 50. */
export const PLATFORM_PAGE_SIZE = 20

/**
 * Whether a platform endpoint refused the caller's role. `/platform/*` answers
 * 404, not 403, to non-staff and to staff below the route's role, so a 404 here
 * means "not available to you", never "missing". Against express before 1.1.0
 * `/platform/stats` does not exist and 404s, so it reads as role-denied: Apex
 * needs express 1.1.0 or newer.
 * @param error - A query or mutation error.
 * @returns True for a 404.
 */
export function isRoleDenied(error: unknown): boolean {
  return statusFrom(error) === 404
}

/** The windows the Overview offers, in toggle order. */
export const STATS_RANGES = ['7d', '30d'] as const satisfies readonly StatsRange[]

/**
 * The staff Overview for one window.
 * @param range - The window.
 * @returns Query options for `useQuery` and the route loader.
 */
export function platformStatsQueryOptions(range: StatsRange) {
  return queryOptions({
    queryKey: platformKeys.stats(range),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<PlatformStats>>('/platform/stats', { params: { range } })
      ),
    /** Switching the window keeps the current figures up until the new ones land, rather than flashing skeletons. */
    placeholderData: keepPreviousData,
    /** A 404 answers who is asking, so a retry changes nothing. */
    retry: (failureCount, error) => !isRoleDenied(error) && failureCount < 1,
  })
}
