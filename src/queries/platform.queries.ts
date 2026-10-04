import {
  hashKey,
  keepPreviousData,
  queryOptions,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { SYSTEM_STATUS_REFETCH_MS } from '@/constants/errors.constants'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import { invalidateEmails } from '@/queries/email.queries'
import { onboardingKeys } from '@/queries/onboarding.queries'
import type { ApiSuccess, PlatformStats, StatsRange, SystemStatus } from '@/types/api.types'

/** How long a tenant search box waits for typing to stop before asking the API. */
export const SEARCH_DEBOUNCE_MS = 250

/** Tenant search and paging live in tenant-admin.queries.ts. */
export const platformKeys = {
  stats: (range: string) => ['platform', 'stats', range] as const,
  systemStatus: ['platform', 'system', 'status'] as const,
}

/** The API's default page; its cap is 50. */
export const PLATFORM_PAGE_SIZE = 20

/**
 * Whether a platform endpoint refused the caller's role. `/platform/*` answers
 * 404, not 403, to non-staff and to staff below the route's role, so a 404 here
 * means "not available to you", never "missing". A route an older express
 * lacks 404s too (`/platform/stats` before 1.1.0, `/platform/users` and
 * `/platform/tenants/:id` before 1.2.0, `/platform/emails*` and
 * `/platform/email-suppressions` before 1.3.0, `/platform/onboarding/*` and
 * `/platform/tenants/:id/onboarding` before 1.4.0, the user and tenant
 * `timeline` routes before 1.6.0, the `errors` routes and
 * `/platform/system/status` before 1.7.0), so it reads as role-denied: Apex
 * needs express 1.4.0 or newer, 1.6.0 for timelines and 1.7.0 for errors.
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

/**
 * The API's release and error-tracking health, for the Overview's status
 * card (admins and up). Asked again every minute, and only while the tab is
 * visible: TanStack Query pauses `refetchInterval` in a hidden tab.
 * @returns Query options for `useQuery`.
 */
export function systemStatusQueryOptions() {
  return queryOptions({
    queryKey: platformKeys.systemStatus,
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<SystemStatus>>('/platform/system/status')),
    refetchInterval: SYSTEM_STATUS_REFETCH_MS,
    /** A 404 answers who is asking, so a retry changes nothing. */
    retry: (failureCount, error) => !isRoleDenied(error) && failureCount < 1,
  })
}

/**
 * The cache prefixes a staff write can make stale beyond its own record: the
 * users list and pages, the tenants list and pages, every tenant's own routes
 * (members, invitations, detail, log; the Staff page is the platform tenant's),
 * the platform audit log, since every staff write is an entry there, and the
 * onboarding funnel, lists and tenant pages, which count active tenants only.
 * The email queries are marked stale beside these (`invalidateEmails`): a
 * write may send mail, and a purge deletes the mail it held.
 */
const DIRECTORY_PREFIXES: readonly QueryKey[] = [
  ['platform', 'users'],
  ['platform', 'user'],
  ['platform', 'tenants'],
  ['platform', 'tenant'],
  ['tenants'],
  ['platform', 'audit-log'],
  onboardingKeys.all,
]

/** Whether `key` starts with every part of `prefix`. */
function startsWith(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((part, index) => hashKey([key[index]]) === hashKey([part]))
}

/**
 * Mark the whole staff directory stale after a write. A user's state, role or
 * membership shows on their own page, on the tenants they belong to (owners,
 * members) and on the Staff page; a tenant's state shows on its members'
 * pages. Only the queries on screen refetch; the rest refetch when next shown.
 * @param queryClient - The app's query client.
 * @param fresh - A key the caller just replaced from the write's own answer, left as it is.
 * @param idle - A prefix marked stale but not refetched now, even on screen: a
 *   tenant the write froze, whose own routes would answer 404 and cache that
 *   error for the moment it is next shown.
 * @returns Resolves once the on-screen queries have refetched.
 */
export async function invalidateDirectory(
  queryClient: QueryClient,
  fresh?: QueryKey,
  idle?: QueryKey
): Promise<void> {
  const skip = fresh === undefined ? undefined : hashKey(fresh)
  if (idle !== undefined) {
    await queryClient.invalidateQueries({ queryKey: idle, refetchType: 'none' })
  }
  await Promise.all([
    ...DIRECTORY_PREFIXES.map((queryKey) =>
      queryClient.invalidateQueries({
        queryKey,
        predicate: (query) =>
          query.queryHash !== skip && (idle === undefined || !startsWith(query.queryKey, idle)),
      })
    ),
    invalidateEmails(queryClient),
  ])
}
