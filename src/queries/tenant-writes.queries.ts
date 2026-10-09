/**
 * @file A tenant's member and invitation writes, leaving included, apart
 * from the reads in `tenant.queries.ts`, which the first visit loads: only
 * the members and invitations screens, lazy routes' components, write.
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { MembershipRole } from '@/constants/roles'
import { PLATFORM_TENANT_SLUG } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { auditKeys } from '@/queries/audit.queries'
import { invalidateEmails } from '@/queries/email.queries'
import { invalidateDirectory } from '@/queries/platform.queries'
import { refreshProfile } from '@/queries/profile.queries'
import { tenantKeys, type TenantMembership } from '@/queries/tenant.queries'
import type { InviteMemberInput } from '@/schemas/tenant.schemas'
import { useAuthStore } from '@/states/auth.store'
import { INVITATION_CONFLICT, REASON_REQUIRED, type ApiSuccess } from '@/types/api.types'

/**
 * The audit reason a staff write to a customer tenant carries: the API
 * requires one (and a recent sign-in) when the caller acts through platform
 * access, and a member leaves it out. Left `undefined` in a JSON body, it is
 * not sent at all.
 */
export interface StaffReason {
  reason?: string
}

/**
 * A DELETE's request config: the reason as a JSON body (express reads it
 * there, DELETE included), or no body at all when there is none.
 * @param reason - The staff reason, or `undefined` for a member.
 * @returns The axios config, or `undefined`.
 */
function reasonBody(reason: string | undefined): { data: { reason: string } } | undefined {
  return reason === undefined ? undefined : { data: { reason } }
}

/**
 * After a refused write: a 400 `REASON_REQUIRED` means the API now reaches
 * the caller through platform access (their membership went meanwhile) while
 * the page still shows member controls, so the tenant's detail refetches and
 * `useMyRole`'s `access` switches them to the staff ones, which ask for a
 * reason.
 * @param queryClient - The app's query client.
 * @param slug - The tenant written to.
 * @param error - The write's failure.
 */
async function refreshAccessIfReasonRequired(
  queryClient: QueryClient,
  slug: string,
  error: unknown
): Promise<void> {
  if (codeFrom(error) !== REASON_REQUIRED) return
  await queryClient.invalidateQueries({ queryKey: tenantKeys.detail(slug) })
}

/**
 * Answers 202 with `data: null` whether or not the address has an account,
 * so a success never says whether one exists. Refusals still differ: 409
 * `already_member` or `invitation_conflict`, 403 for a role the caller can't
 * grant, 400 for an invalid body. `reason` goes only under platform access.
 */
export function useInviteMember(slug: string, tenantId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    onError: (error) => refreshAccessIfReasonRequired(queryClient, slug, error),
    mutationFn: async (input: InviteMemberInput & StaffReason) =>
      unwrap(await apiClient.post<ApiSuccess<null>>(`/tenants/${slug}/invitations`, input)),
    /** A conflict means another invite for this address just landed, so the list is stale; a success also mailed someone and added an entry to both audit logs. */
    onSettled: async (_data, error) => {
      if (error && codeFrom(error) !== INVITATION_CONFLICT) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tenantKeys.invitations(slug, tenantId) }),
        ...(error
          ? []
          : [
              invalidateEmails(queryClient),
              queryClient.invalidateQueries({ queryKey: auditKeys.tenantAll(slug) }),
              queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
            ]),
      ])
    },
  })
}

/** A new link and a fresh expiry; the old link stops working. `reason` goes only under platform access. */
export function useResendInvitation(slug: string, tenantId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    onError: (error) => refreshAccessIfReasonRequired(queryClient, slug, error),
    mutationFn: async ({ invitationId, reason }: { invitationId: string } & StaffReason) =>
      unwrap(
        await apiClient.post<ApiSuccess<null>>(
          `/tenants/${slug}/invitations/${invitationId}/resend`,
          reason === undefined ? undefined : { reason }
        )
      ),
    /**
     * Settled, not success: a 404 means the row is no longer pending, so the
     * list is stale. A resend is also a new message on the Emails pages and
     * an entry in both audit logs.
     */
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: tenantKeys.invitations(slug, tenantId) }),
        queryClient.invalidateQueries({ queryKey: auditKeys.tenantAll(slug) }),
        queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
        invalidateEmails(queryClient),
      ])
    },
  })
}

/** Revokes a pending invitation; its link stops working. `reason` goes only under platform access, in the body. */
export function useRevokeInvitation(slug: string, tenantId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    onError: (error) => refreshAccessIfReasonRequired(queryClient, slug, error),
    mutationFn: async ({ invitationId, reason }: { invitationId: string } & StaffReason) =>
      unwrap(
        await apiClient.delete<ApiSuccess<null>>(
          `/tenants/${slug}/invitations/${invitationId}`,
          reasonBody(reason)
        )
      ),
    /** Settled, not success: a 404 means the row is no longer pending, so the list is stale. */
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: tenantKeys.invitations(slug, tenantId) }),
  })
}

/**
 * Changes a member's role. The staff directory refreshes: the member list and
 * the tenant's detail (the caller may have changed their own role, which it
 * carries), the member's user page and the tenant's owners. A self change in
 * the platform tenant also refreshes the stored user's platformRole. `reason`
 * goes only under platform access.
 */
export function useUpdateMemberRole(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    onError: (error) => refreshAccessIfReasonRequired(queryClient, slug, error),
    mutationFn: async ({
      userId,
      role,
      reason,
    }: { userId: string; role: MembershipRole } & StaffReason) =>
      unwrap(
        await apiClient.patch<ApiSuccess<TenantMembership>>(`/tenants/${slug}/members/${userId}`, {
          role,
          reason,
        })
      ),
    onSuccess: async (_data, { userId }) => {
      await invalidateDirectory(queryClient)
      if (slug === PLATFORM_TENANT_SLUG && userId === useAuthStore.getState().user?.id) {
        await refreshProfile(queryClient)
      }
    },
  })
}

/**
 * Removes another member; the rest of the staff directory refreshes (the
 * member's user page, the tenant's owners). Leaving, which removes yourself,
 * is `useLeaveTenant`. `reason` goes only under platform access, in the body.
 */
export function useRemoveMember(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    onError: (error) => refreshAccessIfReasonRequired(queryClient, slug, error),
    mutationFn: async ({ userId, reason }: { userId: string } & StaffReason) =>
      apiClient.delete<ApiSuccess<null>>(`/tenants/${slug}/members/${userId}`, reasonBody(reason)),
    onSuccess: () => invalidateDirectory(queryClient),
  })
}

/**
 * Leaves a tenant: `DELETE /tenants/:slug/membership`, open to every role but
 * the tenant's last owner (409 `LAST_OWNER`). On success, or on a 404 (the
 * membership was already gone), the staff directory refreshes:
 *
 * - A customer tenant refreshes with it. The caller is staff, so its routes
 *   still answer, through platform access, with their row gone.
 * - The platform tenant is only marked stale. Its membership was the
 *   caller's platform role, so its routes now answer 404, and the still-mounted
 *   Staff page would refetch them; the stored user's platformRole refreshes,
 *   and the page drops the tenant's cache with `dropTenantCache` once it has
 *   left the tenant's routes.
 *
 * A 409 refetches the member list, since another owner changed under the page.
 */
export function useLeaveTenant(slug: string) {
  const queryClient = useQueryClient()
  const afterLeaving = async () => {
    if (slug !== PLATFORM_TENANT_SLUG) {
      await invalidateDirectory(queryClient)
      return
    }
    await invalidateDirectory(queryClient, undefined, tenantKeys.detail(slug))
    await refreshProfile(queryClient)
  }
  return useMutation({
    mutationFn: async () => apiClient.delete<ApiSuccess<null>>(`/tenants/${slug}/membership`),
    onSuccess: afterLeaving,
    onError: async (error) => {
      const status = statusFrom(error)
      if (status === 404) await afterLeaving()
      else if (status === 409) {
        await queryClient.invalidateQueries({ queryKey: tenantKeys.members(slug) })
      }
    },
  })
}

/**
 * Drops a tenant's whole cache prefix (detail, members, invitations), for a
 * tenant the caller can no longer read: the platform tenant, once left. Call
 * it after navigating away from the tenant's routes, so no mounted query
 * refetches what it drops.
 * @param queryClient - The app's query client.
 * @param slug - The tenant left.
 */
export function dropTenantCache(queryClient: QueryClient, slug: string): void {
  queryClient.removeQueries({ queryKey: tenantKeys.detail(slug) })
}
