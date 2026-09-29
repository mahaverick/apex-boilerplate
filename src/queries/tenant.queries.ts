import { useQuery } from '@tanstack/react-query'
import type { MembershipRole } from '@/constants/roles'
import { apiClient, unwrap } from '@/http/client'
import { fullName } from '@/lib/format'
import type { ApiSuccess } from '@/types/api.types'

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

/** The tenant query keys. Only a tenant's member list is cached here. */
export const tenantKeys = {
  members: (slug: string) => ['tenants', slug, 'members'] as const,
}

export function useMembers(slug: string) {
  return useQuery({
    queryKey: tenantKeys.members(slug),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantMember[]>>(`/tenants/${slug}/members`)),
  })
}

/** "Ada Lovelace", or the email when the member has no name on file. */
export function memberName(member: TenantMember): string {
  return fullName(member.user) ?? member.user.email
}
