/**
 * @file Staff reads and writes on tenants across the platform
 * (`/platform/tenants*`). A single tenant's internals (members, invitations,
 * settings, its audit log) go through `/tenants/:slug/*` in tenant.queries.ts.
 */
import {
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { isRoleDenied, PLATFORM_PAGE_SIZE } from '@/queries/platform.queries'
import type { CreatePlatformTenantInput } from '@/schemas/tenant.schemas'
import type {
  ApiSuccess,
  PageDirection,
  PlatformTenantDetail,
  PlatformTenantPage,
  PlatformTenantRow,
  TenantStateFilter,
} from '@/types/api.types'

/** The API refuses a longer term. */
const MAX_QUERY_LENGTH = 100

/** One page request: the search, the state filter and the cursor it pages from. */
export interface TenantPageParams {
  q: string
  /** Omitted: the API's default (active and suspended). */
  state?: TenantStateFilter
  /** Omitted: the first page. */
  cursor?: string
  /** Which way `cursor` pages. Ignored without a cursor. */
  dir?: PageDirection
  limit?: number
}

/**
 * `all` prefixes every list and page key, so a write that changes what lists
 * show invalidates it once. A detail is outside that prefix: a list refresh
 * never refetches an open detail, and each write updates its own detail.
 */
export const tenantAdminKeys = {
  all: ['platform', 'tenants'] as const,
  /** The infinite search the Activity filter uses. */
  search: (q: string) => ['platform', 'tenants', 'search', q] as const,
  page: (params: TenantPageParams) => ['platform', 'tenants', 'page', params] as const,
  detail: (id: string) => ['platform', 'tenant', id] as const,
}

/** A 404 answers who is asking, so a retry changes nothing. */
function retryUnlessDenied(failureCount: number, error: unknown): boolean {
  return !isRoleDenied(error) && failureCount < 1
}

/**
 * One keyset page of every customer tenant, for the Tenants table and the
 * palette. `direction` is sent only with a cursor.
 * @param params - Search term, state filter, cursor and direction, page size (at most 50).
 * @returns Query options for `useQuery` or a route loader.
 */
export function platformTenantsQueryOptions({
  q,
  state,
  cursor,
  dir,
  limit = PLATFORM_PAGE_SIZE,
}: TenantPageParams) {
  const term = q.trim().slice(0, MAX_QUERY_LENGTH)
  const key: TenantPageParams = {
    q: term,
    state,
    cursor,
    dir: cursor ? (dir ?? 'next') : undefined,
    limit,
  }
  return queryOptions({
    queryKey: tenantAdminKeys.page(key),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<PlatformTenantPage>>('/platform/tenants', {
          params: {
            q: term === '' ? undefined : term,
            state,
            cursor,
            direction: key.dir,
            limit,
          },
        })
      ),
    retry: retryUnlessDenied,
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
    queryKey: tenantAdminKeys.search(term),
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
    retry: retryUnlessDenied,
  })
}

/** Every loaded page of the search, flattened. */
export function flattenTenantPages(
  data: InfiniteData<PlatformTenantPage> | undefined
): PlatformTenantRow[] {
  return data?.pages.flatMap((page) => page.tenants) ?? []
}

/**
 * `POST /platform/tenants`: a tenant with no members, and an owner invitation
 * to `ownerEmail`. The new detail is seeded into the cache, so opening the
 * tenant needs no second request; every list refreshes.
 */
export function useCreatePlatformTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreatePlatformTenantInput) =>
      unwrap(
        await apiClient.post<ApiSuccess<{ tenant: PlatformTenantDetail; emailSent: boolean }>>(
          '/platform/tenants',
          input
        )
      ),
    onSuccess: async ({ tenant }) => {
      queryClient.setQueryData(tenantAdminKeys.detail(tenant.id), tenant)
      await queryClient.invalidateQueries({ queryKey: tenantAdminKeys.all })
    },
  })
}
