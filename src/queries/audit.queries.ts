import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { AuditAction } from '@/constants/audit-actions'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import type {
  ApiSuccess,
  AuditAccess,
  AuditEntry,
  AuditPage,
  PlatformAuditEntry,
} from '@/types/api.types'

export interface PlatformAuditFilters {
  tenantId?: string
  actorUserId?: string
  action?: AuditAction
  access?: AuditAccess
}

export interface TenantAuditFilters {
  action?: AuditAction
}

/**
 * The audit-log query keys. A tenant's log sits under `['tenants', slug]`, so
 * invalidating that prefix refreshes it too; an Apex tenant page adds its id.
 */
export const auditKeys = {
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
