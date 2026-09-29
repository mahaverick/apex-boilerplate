/**
 * @file Staff reads and writes on tenants across the platform
 * (`/platform/tenants*`). A single tenant's internals (members, invitations,
 * settings) go through `/tenants/:slug/*` in tenant.queries.ts, its audit log
 * in audit.queries.ts.
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
import { statusFrom } from '@/lib/api-error'
import { isRoleDenied, PLATFORM_PAGE_SIZE } from '@/queries/platform.queries'
import type { CreatePlatformTenantInput } from '@/schemas/tenant.schemas'
import type {
  ApiSuccess,
  EmailSentResult,
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

/**
 * `GET /platform/tenants/:id`: one tenant in any lifecycle state. A 404 is an
 * unknown id (or a caller no longer staff), and asking again changes nothing.
 */
export function platformTenantQueryOptions(id: string) {
  return queryOptions({
    queryKey: tenantAdminKeys.detail(id),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<PlatformTenantDetail>>(`/platform/tenants/${id}`)),
    retry: (failureCount, error) => statusFrom(error) !== 404 && failureCount < 1,
  })
}

type LifecycleAction = 'suspend' | 'reactivate' | 'archive'

/**
 * A lifecycle transition with its audit reason. The API answers the tenant as
 * it now is, which replaces the cached detail; lists refresh, since the
 * tenant may have left the current filter. A 409 means the cached state was
 * already stale, so the detail is refetched to show the real one.
 */
function useLifecycle(id: string, action: LifecycleAction) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (reason: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<PlatformTenantDetail>>(
          `/platform/tenants/${id}/${action}`,
          { reason }
        )
      ),
    onSuccess: async (tenant) => {
      queryClient.setQueryData(tenantAdminKeys.detail(id), tenant)
      // The transition is a new audit entry, so cached platform audit pages are stale.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tenantAdminKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['platform', 'audit-log'] }),
      ])
    },
    onError: async (error) => {
      if (statusFrom(error) === 409) {
        await queryClient.invalidateQueries({ queryKey: tenantAdminKeys.detail(id) })
      }
    },
  })
}

/** active → suspended. Platform admin or owner; behind step-up. */
export function useSuspendTenant(id: string) {
  return useLifecycle(id, 'suspend')
}

/** suspended → active. Platform admin or owner. */
export function useReactivateTenant(id: string) {
  return useLifecycle(id, 'reactivate')
}

/** active or suspended → archived, terminal. Platform admin or owner; behind step-up. */
export function useArchiveTenant(id: string) {
  return useLifecycle(id, 'archive')
}

/**
 * Re-issue the owner invitation of a tenant with no active owner, revoking
 * any pending one; audited with its reason, behind step-up. `emailSent:
 * false` means the invitation exists but its email failed.
 */
export function useReissueOwnerInvitation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { email: string; reason: string }) =>
      unwrap(
        await apiClient.post<ApiSuccess<EmailSentResult>>(
          `/platform/tenants/${id}/owner-invitation`,
          input
        )
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantAdminKeys.detail(id) }),
  })
}

/**
 * Permanently delete an archived tenant (platform owner; behind step-up).
 * Nothing about it is left to show, so its cached detail is dropped rather
 * than refetched into a 404, and the lists refresh.
 */
export function usePurgeTenant(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (reason: string) => {
      await apiClient.post(`/platform/tenants/${id}/purge`, { reason })
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: tenantAdminKeys.detail(id) })
      await queryClient.invalidateQueries({ queryKey: tenantAdminKeys.all })
    },
  })
}

/** Owners the API counts: a deactivated owner is not one. */
export function activeOwnerCount(tenant: PlatformTenantDetail): number {
  return tenant.owners.filter((owner) => owner.active).length
}
