import { STORED_AUDIT_ACTIONS } from '@/constants/audit-action-names'
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { defineList, idFilter, listFilter } from '@/schemas/list.schemas'
import type { AuditEntry, PlatformAuditEntry } from '@/types/api.types'
import type { ListRequest } from '@/types/list.types'

/**
 * The audit-log query keys. A tenant's log sits under `['tenants', slug]`, so
 * invalidating that prefix refreshes it too; an Apex tenant page adds its id.
 */
export const auditKeys = {
  /** Every page of the platform log, whatever its filters. */
  platformAll: ['platform', 'audit-log'] as const,
  /** Every page of one tenant's log, with or without an Apex tenant page's id. */
  tenantAll: (slug: string) => ['tenants', slug, 'audit-log'] as const,
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
