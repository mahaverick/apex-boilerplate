/**
 * @file Staff reads and writes on tenants across the platform
 * (`/platform/tenants*`). A single tenant's own routes (`/tenants/:slug/*`)
 * are in tenant.queries.ts (its reads, and the tenant PATCH) and
 * tenant-writes.queries.ts (member and invitation writes), its audit log in
 * audit.queries.ts.
 */
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import { analyticsKey } from '@/observability/telemetry'
import { auditKeys } from '@/queries/audit.queries'
import { invalidateEmails } from '@/queries/email.queries'
import { listQueryOptions } from '@/queries/list.queries'
import { invalidateOnboarding } from '@/queries/onboarding.queries'
import { invalidateDirectory } from '@/queries/platform.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { defineList, listFilter } from '@/schemas/list.schemas'
import type { CreatePlatformTenantInput } from '@/schemas/tenant.schemas'
import {
  TENANT_LIFECYCLE_STATES,
  type ApiSuccess,
  type EmailSentResult,
  type PlatformTenantDetail,
  type PlatformTenantRow,
} from '@/types/api.types'
import type { ListRequest } from '@/types/list.types'

/**
 * `all` prefixes every list and page key, so a write that changes what lists
 * show invalidates it once. A detail is outside that prefix, so refreshing
 * the lists alone never refetches an open detail; `invalidateDirectory`
 * reaches both.
 */
export const tenantAdminKeys = {
  all: ['platform', 'tenants'] as const,
  detail: (id: string) => ['platform', 'tenant', id] as const,
}

/** The Tenants list's URL contract: name order by default, filtered by lifecycle state. */
export const tenantsList = defineList({
  sorts: ['name', 'created', '-created'],
  filters: { state: listFilter(TENANT_LIFECYCLE_STATES) },
  table: analyticsKey('tenants'),
})

/**
 * One page of every customer tenant (`GET /platform/tenants`), for the
 * Tenants table, the palette and the activity tenant facet.
 * @param request - From `listRequest(tenantsList, …)`, or `{ search, limit }`.
 * @param options - `total: false` for a read that never shows the total (the palette and pickers).
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function tenantsListOptions(request: ListRequest, options: { total?: boolean } = {}) {
  return listQueryOptions<PlatformTenantRow>({
    key: tenantAdminKeys.all,
    path: '/platform/tenants',
    request,
    ...options,
  })
}

/**
 * `POST /platform/tenants`: a tenant with no members, and an owner invitation
 * to `ownerEmail`. The created tenant's detail is seeded into the cache, so opening the
 * tenant needs no second request; every tenant list, email query and audit
 * log refreshes, and the onboarding lists, where it awaits its owner.
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tenantAdminKeys.all }),
        invalidateEmails(queryClient),
        invalidateOnboarding(queryClient),
        queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
        queryClient.invalidateQueries({ queryKey: auditKeys.tenantAll(tenant.slug) }),
      ])
    },
  })
}

/**
 * `GET /platform/tenants/:id`: one tenant in any lifecycle state. A 404 is an
 * unknown id (or a caller demoted from staff), and asking again changes nothing.
 */
export function platformTenantQueryOptions(id: string) {
  return queryOptions({
    queryKey: tenantAdminKeys.detail(id),
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<PlatformTenantDetail>>(`/platform/tenants/${id}`, { signal })
      ),
    retry: (failureCount, error) => statusFrom(error) !== 404 && failureCount < 1,
  })
}

/** The lifecycle moves a staff admin can make; each is a `POST /platform/tenants/:id/<action>`. */
type LifecycleAction = 'suspend' | 'reactivate' | 'archive'

/**
 * A lifecycle transition with its audit reason. The API answers the tenant as
 * it stands, which replaces the cached detail; the rest of the directory
 * refreshes, since the tenant may have left the current filter and its
 * members' pages show its state. A tenant left suspended or archived has its
 * own routes marked stale without refetching them: they would answer 404, and
 * that error would show for a moment if it were reactivated. A 409 means the
 * cached state was already stale, so the detail is refetched to show the real
 * one.
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
      await invalidateDirectory(
        queryClient,
        tenantAdminKeys.detail(id),
        tenant.lifecycleState === 'active' ? undefined : tenantKeys.detail(tenant.slug)
      )
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
    // A refusal may mean the cached detail was stale; a success is an audit entry and a pending invitation on the invitee's page.
    onSettled: () => invalidateDirectory(queryClient),
  })
}

/**
 * Permanently delete an archived tenant (platform owner; behind step-up).
 * Nothing about it is left to show, so `onPurged` leaves the page first, and
 * only then is its cached detail dropped: dropped while the page still showed
 * it, the page would refetch it into a 404. The rest of the directory then
 * refreshes.
 * @param id - The tenant's id.
 * @param onPurged - Leaves the purged tenant's page; resolves once it has.
 */
export function usePurgeTenant(id: string, { onPurged }: { onPurged: () => Promise<unknown> }) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (reason: string) => {
      await apiClient.post(`/platform/tenants/${id}/purge`, { reason })
    },
    onSuccess: async () => {
      await onPurged()
      queryClient.removeQueries({ queryKey: tenantAdminKeys.detail(id) })
      await invalidateDirectory(queryClient)
    },
  })
}

/** Owners the API counts: a deactivated owner is not one. */
export function activeOwnerCount(tenant: PlatformTenantDetail): number {
  return tenant.owners.filter((owner) => owner.active).length
}
