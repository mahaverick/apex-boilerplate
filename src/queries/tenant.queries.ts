import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MembershipRole } from '@/constants/roles'
import { PLATFORM_TENANT_SLUG } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { auditKeys } from '@/queries/audit.queries'
import { invalidateEmails } from '@/queries/email.queries'
import { invalidateDirectory } from '@/queries/platform.queries'
import { refreshProfile } from '@/queries/profile.queries'
import type { InviteMemberInput, UpdateTenantInput } from '@/schemas/tenant.schemas'
import { useAuthStore } from '@/states/auth.store'
import {
  INVITATION_CONFLICT,
  type ApiSuccess,
  type TenantAccess,
  type TenantInvitation,
} from '@/types/api.types'

/**
 * A whole `tenants` row, as the API returns it: no projection, so every column
 * is on the wire, the soft-delete bookkeeping included.
 */
export interface Tenant {
  id: string
  name: string
  slug: string
  description: string | null
  logo: string | null
  website: string | null
  /** 'active' | 'suspended' | 'archived'. */
  lifecycleState: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  /** The one platform tenant. Never reachable through platform access. */
  isPlatform: boolean
}

/** A `user_memberships` row. */
export interface TenantMembership {
  id: string
  userId: string
  tenantId: string
  role: MembershipRole
  createdAt: string
  updatedAt: string
}

/**
 * One row of `GET /tenants/:slug/members`. `user` is a four-column projection
 * on the server, never the whole users row, so no `passwordHash`.
 */
export interface TenantMember {
  membership: TenantMembership
  user: { id: string; email: string; firstName: string | null; lastName: string | null }
}

/**
 * `GET /tenants/:slug`: the row plus the caller's effective role there and
 * how they reached it. A member's role wins over any platform role, so
 * `access: 'platform'` only appears in a tenant the caller is not in.
 */
export interface TenantDetail extends Tenant {
  role: MembershipRole
  access: TenantAccess
}

/** The id segment an Apex tenant page adds to its keys; nothing for the Staff and Activity pages. */
function scope(tenantId: string | undefined): [] | [{ tenantId: string }] {
  return tenantId === undefined ? [] : [{ tenantId }]
}

/**
 * A tenant's own query keys, under `['tenants', slug]`. Separate from the
 * platform keys (`tenant-admin.queries.ts`): these are what the tenant's own
 * routes answer, which a suspended or archived tenant does not. A tenant
 * opened from its Apex page also carries its id: archiving frees a
 * slug for reuse, and a new tenant with that slug must never be shown the
 * archived one's cached members. Invalidating `['tenants', slug]` still
 * reaches both shapes, since it is a prefix of each.
 */
export const tenantKeys = {
  detail: (slug: string, tenantId?: string) => ['tenants', slug, ...scope(tenantId)] as const,
  members: (slug: string, tenantId?: string) =>
    ['tenants', slug, 'members', ...scope(tenantId)] as const,
  invitations: (slug: string, tenantId?: string) =>
    ['tenants', slug, 'invitations', ...scope(tenantId)] as const,
}

/**
 * One tenant, where a 404 resolves to `null` rather than rejecting.
 * `GET /tenants/:slug` answers the same 404 for "no such tenant" and "no
 * access", and a caller renders both the same way. A rejection would be
 * retried (the query client's `retry: 1`) and refetched on mount. Every other
 * failure still rejects.
 */
export function tenantQueryOptions(slug: string, tenantId?: string) {
  return queryOptions({
    queryKey: tenantKeys.detail(slug, tenantId),
    queryFn: async () => {
      try {
        return unwrap(await apiClient.get<ApiSuccess<TenantDetail>>(`/tenants/${slug}`))
      } catch (error) {
        if (statusFrom(error) === 404) return null
        throw error
      }
    },
  })
}

export function useTenant(slug: string, tenantId?: string) {
  return useQuery(tenantQueryOptions(slug, tenantId))
}

/**
 * The caller's effective role in one tenant, and how they reached it, read off
 * `GET /tenants/:slug`: staff visiting a tenant they are not in have no
 * membership, and the detail carries the role the API enforces. Every
 * role-gated control reads this.
 *
 * Three states. `isPending` is not known yet (render a skeleton). `isError` is
 * a failed load (say so and offer a retry). A `role` of `undefined` after a
 * successful load is a 404: the tenant is gone or the caller has no access.
 */
export function useMyRole(
  slug: string,
  tenantId?: string
): {
  role: MembershipRole | undefined
  access: TenantAccess | undefined
  isPending: boolean
  isError: boolean
  /** Refetch the tenant. Hand this to the error state's retry control. */
  retry: () => void
} {
  const tenant = useTenant(slug, tenantId)
  const { refetch } = tenant
  return {
    role: tenant.data?.role,
    access: tenant.data?.access,
    isPending: tenant.isPending,
    isError: tenant.isError,
    retry: () => void refetch(),
  }
}

/** Updates the tenant, refreshing its detail. */
export function useUpdateTenant(slug: string, tenantId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateTenantInput) =>
      unwrap(await apiClient.patch<ApiSuccess<Tenant>>(`/tenants/${slug}`, input)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tenantKeys.detail(slug, tenantId) })
    },
  })
}

export function useMembers(slug: string, tenantId?: string) {
  return useQuery({
    queryKey: tenantKeys.members(slug, tenantId),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantMember[]>>(`/tenants/${slug}/members`)),
  })
}

/** Pending invitations. Owner and admin only: anyone else gets a 403. */
export function useInvitations(slug: string, tenantId?: string) {
  return useQuery({
    queryKey: tenantKeys.invitations(slug, tenantId),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantInvitation[]>>(`/tenants/${slug}/invitations`)),
  })
}

/**
 * Answers 202 with `data: null` whether or not the address has an account,
 * so a success never says whether one exists. Refusals still differ: 409
 * `already_member` or `invitation_conflict`, 403 for a role the caller can't
 * grant, 400 for an invalid body.
 */
export function useInviteMember(slug: string, tenantId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: InviteMemberInput) =>
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

/** A new link and a fresh expiry; the old link stops working. */
export function useResendInvitation(slug: string, tenantId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (invitationId: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<null>>(
          `/tenants/${slug}/invitations/${invitationId}/resend`
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

/** Revokes a pending invitation; its link stops working. */
export function useRevokeInvitation(slug: string, tenantId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (invitationId: string) =>
      unwrap(
        await apiClient.delete<ApiSuccess<null>>(`/tenants/${slug}/invitations/${invitationId}`)
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
 * the platform tenant also refreshes the stored user's platformRole.
 */
export function useUpdateMemberRole(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: MembershipRole }) =>
      unwrap(
        await apiClient.patch<ApiSuccess<TenantMembership>>(`/tenants/${slug}/members/${userId}`, {
          role,
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
 * Removes a member. Removing yourself drops the tenant's whole cache prefix
 * rather than refetching queries a former member cannot read, and a self
 * removal from the platform tenant refreshes the stored user's platformRole.
 * Either way the rest of the staff directory refreshes (the member's user
 * page, the tenant's owners).
 */
export function useRemoveMember(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) =>
      apiClient.delete<ApiSuccess<null>>(`/tenants/${slug}/members/${userId}`),
    onSuccess: async (_data, userId) => {
      const isSelf = userId === useAuthStore.getState().user?.id
      if (isSelf) queryClient.removeQueries({ queryKey: ['tenants', slug] })
      await invalidateDirectory(queryClient)
      if (isSelf && slug === PLATFORM_TENANT_SLUG) {
        await refreshProfile(queryClient)
      }
    },
  })
}

/** How many owners a member list holds — the last-owner guard's input. */
export function ownerCount(members: TenantMember[] | undefined): number {
  return (members ?? []).filter((member) => member.membership.role === 'owner').length
}

/** "Ada Lovelace", or the email when the member has no name on file. */
export function memberName(member: TenantMember): string {
  return fullName(member.user) ?? member.user.email
}
