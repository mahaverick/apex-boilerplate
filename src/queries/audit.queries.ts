import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { STORED_AUDIT_ACTIONS, type AuditAction } from '@/constants/audit-action-names'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { defineList, idFilter, listFilter } from '@/schemas/list.schemas'
import type {
  ApiSuccess,
  AuditAccess,
  AuditEntry,
  AuditPage,
  PlatformAuditEntry,
} from '@/types/api.types'
import type { ListRequest } from '@/types/list.types'

/** The platform audit log's filters; each narrows the entries the API returns. */
export interface PlatformAuditFilters {
  tenantId?: string
  actorUserId?: string
  /** The user or tenant the entries act on; the History card's filter. */
  targetId?: string
  action?: AuditAction
  access?: AuditAccess
}

/** The only filter `GET /tenants/:slug/audit-log` takes here; it is part of the query key. */
export interface TenantAuditFilters {
  action?: AuditAction
}

/**
 * The audit-log query keys. A tenant's log sits under `['tenants', slug]`, so
 * invalidating that prefix refreshes it too; an Apex tenant page adds its id.
 */
export const auditKeys = {
  /** Every page of the platform log, whatever its filters. */
  platformAll: ['platform', 'audit-log'] as const,
  /** Every page of one tenant's log, with or without an Apex tenant page's id. */
  tenantAll: (slug: string) => ['tenants', slug, 'audit-log'] as const,
  platform: (filters: PlatformAuditFilters) => ['platform', 'audit-log', filters] as const,
  tenant: (slug: string, filters: TenantAuditFilters, tenantId?: string) =>
    [
      'tenants',
      slug,
      'audit-log',
      filters,
      ...(tenantId === undefined ? [] : [{ tenantId }]),
    ] as const,
}

/** How an actor reached the tenant, as the API's `access` filter names it. */
const AUDIT_ACCESS_PATHS = ['member', 'platform', 'system'] as const

/**
 * The platform Activity list's URL contract: newest first, filtered by tenant,
 * actor, action and access path. The `action` URL param accepts the stored
 * names, the retired ones included, as the API does, so an old link still
 * filters; the facet offers only the written actions (`AUDIT_ACTIONS`).
 */
export const platformActivityList = defineList({
  sorts: ['-occurred', 'occurred'],
  filters: {
    tenant: idFilter(),
    actor: idFilter(),
    action: listFilter(STORED_AUDIT_ACTIONS),
    access: listFilter(AUDIT_ACCESS_PATHS),
  },
  table: analyticsKey('activity'),
})

/** A History card's URL contract (the user and tenant cards): prefixed, since the page holds other lists. The card's own filter is fixed by the page, never in the URL. */
export const historyList = defineList({
  sorts: ['-occurred', 'occurred'],
  filters: { action: listFilter(STORED_AUDIT_ACTIONS) },
  table: analyticsKey('history'),
  prefix: 'history',
})

/** A tenant's Activity tab: newest first, filtered by action. */
export const tenantActivityList = defineList({
  sorts: ['-occurred', 'occurred'],
  filters: { action: listFilter(STORED_AUDIT_ACTIONS) },
  table: analyticsKey('tenant_activity'),
})

/**
 * One page of the platform audit log (`GET /platform/audit-log`), for the
 * Activity list and the History cards. Never fresh, so returning to a view
 * shows what happened meanwhile.
 * @param request - From `listRequest(platformActivityList, …)`, or a History card's request with its fixed filter (`target`, or `tenant` and `access`).
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function platformAuditListOptions(request: ListRequest) {
  return listQueryOptions<PlatformAuditEntry>({
    key: auditKeys.platformAll,
    path: '/platform/audit-log',
    request,
    staleTime: 0,
  })
}

/**
 * One page of a tenant's audit log (`GET /tenants/:slug/audit-log`), under the
 * tenant's `['tenants', slug]` prefix. A 403 is not retried: the role check
 * passed on cached data, so a fresh one means the role changed since.
 * @param slug - The tenant.
 * @param tenantId - The Apex tenant page's id, which keeps a reused slug's cache apart.
 * @param request - From `listRequest(tenantActivityList, …)`.
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function tenantAuditListOptions(
  slug: string,
  tenantId: string | undefined,
  request: ListRequest
) {
  return listQueryOptions<AuditEntry>({
    key: [...auditKeys.tenantAll(slug), ...(tenantId === undefined ? [] : [{ tenantId }])],
    path: `/tenants/${slug}/audit-log`,
    request,
    staleTime: 0,
  })
}

/** The API's default page; its cap is 100. */
const PAGE_SIZE = 50

/** Every tenant's activity. Platform owners and admins only; anyone else gets a 404. */
export function usePlatformAuditLog(filters: PlatformAuditFilters) {
  return useInfiniteQuery({
    queryKey: auditKeys.platform(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await apiClient.get<ApiSuccess<AuditPage<PlatformAuditEntry>>>('/platform/audit-log', {
          params: { ...filters, cursor: pageParam, limit: PAGE_SIZE },
        })
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    /** A 404 answers who is asking, so a retry changes nothing. */
    retry: (failureCount, error) => statusFrom(error) !== 404 && failureCount < 1,
    /** Switching a filter away and back shows what changed meanwhile, not a cached page. */
    staleTime: 0,
  })
}

/** A tenant's activity. Effective owners and admins only; anyone else gets a 403. */
export function useTenantAuditLog(
  slug: string,
  filters: TenantAuditFilters,
  { enabled }: { enabled: boolean },
  tenantId?: string
) {
  return useInfiniteQuery({
    queryKey: auditKeys.tenant(slug, filters, tenantId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await apiClient.get<ApiSuccess<AuditPage<AuditEntry>>>(`/tenants/${slug}/audit-log`, {
          params: { ...filters, cursor: pageParam, limit: PAGE_SIZE },
        })
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    /** Switching a filter away and back shows what changed meanwhile, not a cached page. */
    staleTime: 0,
    /**
     * A 403 is not retried: the route's role check passed on cached data, so a
     * fresh 403 means the effective role changed server-side since.
     */
    retry: (failureCount, error) => statusFrom(error) !== 403 && failureCount < 1,
  })
}

/** Every loaded page, flattened. */
export function flattenAuditPages<T extends AuditEntry>(
  data: InfiniteData<AuditPage<T>> | undefined
): T[] {
  return data?.pages.flatMap((page) => page.entries) ?? []
}
