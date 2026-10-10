import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MembershipRole } from '@/constants/roles'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import type { UpdateTenantInput } from '@/schemas/tenant.schemas'
import type { ApiSuccess, TenantAccess, TenantInvitation } from '@/types/api.types'

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
 * One row of `GET /tenants/:slug/members`. `user` is a narrow projection on
 * the server, never the whole users row, so no `passwordHash`.
 */
export interface TenantMember {
  membership: TenantMembership
  user: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    /**
     * False for a deactivated account. Only the platform tenant's list
     * carries it (express 2.1.0 or later); a missing value means active.
     */
    active?: boolean
  }
}

/**
 * `GET /tenants/:slug`: the row plus the caller's effective role there and
 * how they reached it. A member's role wins over any platform role, so
 * `access: 'platform'` only appears in a tenant the caller is not in.
 */
interface TenantDetail extends Tenant {
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
function tenantQueryOptions(slug: string, tenantId?: string) {
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

function useTenant(slug: string, tenantId?: string) {
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
 * How many owners besides `userId` express counts toward the last-owner rule,
 * the last-owner guard's input: on a customer tenant every listed owner,
 * deactivated or not (`countOwners`); on the platform tenant only those whose
 * account is active, a missing `active` counting as active
 * (`countActiveOwners`).
 * @param members - The member list.
 * @param userId - The owner acting on their own membership.
 * @param isPlatform - Whether this is the platform tenant (the Staff page).
 * @returns The other owners that count.
 */
export function otherOwnerCount(
  members: TenantMember[] | undefined,
  userId: string | undefined,
  isPlatform: boolean
): number {
  return (members ?? []).filter(
    (member) =>
      member.membership.role === 'owner' &&
      member.user.id !== userId &&
      (!isPlatform || member.user.active !== false)
  ).length
}

/** "Ada Lovelace", or the email when the member has no name on file. */
export function memberName(member: TenantMember): string {
  return fullName(member.user) ?? member.user.email
}
