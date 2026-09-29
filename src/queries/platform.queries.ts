import {
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  type InfiniteData,
} from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import type { ApiSuccess, PlatformTenantPage, PlatformTenantRow } from '@/types/api.types'

/** How long a tenant search box waits for typing to stop before asking the API. */
export const SEARCH_DEBOUNCE_MS = 250

/** The API refuses a longer term. */
const MAX_QUERY_LENGTH = 100

export const platformKeys = {
  /** The infinite search the Activity filter uses. */
  tenants: (q: string) => ['platform', 'tenants', q] as const,
  /** One keyset page, for the Tenants table and the palette. */
  tenantPage: (q: string, cursor: string | undefined, limit: number) =>
    ['platform', 'tenant-page', { q, cursor, limit }] as const,
  stats: (range: string) => ['platform', 'stats', range] as const,
}

/** The API's default page; its cap is 50. */
export const PLATFORM_PAGE_SIZE = 20

/**
 * Whether a platform endpoint refused the caller's role. `/platform/*` answers
 * 404, not 403, to non-staff and to staff below the route's role, so a 404 here
 * means "not available to you", never "missing".
 * @param error - A query or mutation error.
 * @returns True for a 404.
 */
export function isRoleDenied(error: unknown): boolean {
  return statusFrom(error) === 404
}

/**
 * One keyset page of every customer tenant, for staff.
 * @param q - Name or slug substring; empty sends no `q`.
 * @param cursor - The previous page's `nextCursor`, or undefined for the first page.
 * @param limit - Page size, at most 50.
 * @returns Query options for `useQuery` or a route loader.
 */
export function platformTenantsQueryOptions(
  q: string,
  cursor: string | undefined,
  limit: number = PLATFORM_PAGE_SIZE
) {
  const term = q.trim().slice(0, MAX_QUERY_LENGTH)
  return queryOptions({
    queryKey: platformKeys.tenantPage(term, cursor, limit),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<PlatformTenantPage>>('/platform/tenants', {
          params: { q: term === '' ? undefined : term, cursor, limit },
        })
      ),
    /** A 404 answers who is asking, so a retry changes nothing. */
    retry: (failureCount, error) => !isRoleDenied(error) && failureCount < 1,
  })
}

/**
 * Every tenant on the platform, for staff: case-insensitive substring of the
 * name or slug, the platform tenant itself excluded by the API.
 *
 * Non-staff get a 404 here, so the caller passes `enabled: false` for them
 * rather than asking. An empty term sends no `q` at all.
 *
 * While a new term's first page loads, `data` is the previous term's results
 * and `isPlaceholderData` is true, so a caller that shows a searching state
 * checks that as well as `isPending`.
 */
export function usePlatformTenantSearch(q: string, { enabled }: { enabled: boolean }) {
  const term = q.trim().slice(0, MAX_QUERY_LENGTH)
  return useInfiniteQuery({
    queryKey: platformKeys.tenants(term),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await apiClient.get<ApiSuccess<PlatformTenantPage>>('/platform/tenants', {
          params: {
            q: term === '' ? undefined : term,
            cursor: pageParam,
            limit: PLATFORM_PAGE_SIZE,
          },
        })
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    /** The previous term's results stay listed, and pickable, while the next term loads. */
    placeholderData: keepPreviousData,
    /** A 404 answers who is asking (non-staff), so a retry changes nothing. */
    retry: (failureCount, error) => !isRoleDenied(error) && failureCount < 1,
  })
}

/** Every loaded page of the search, flattened. */
export function flattenTenantPages(
  data: InfiniteData<PlatformTenantPage> | undefined
): PlatformTenantRow[] {
  return data?.pages.flatMap((page) => page.tenants) ?? []
}
