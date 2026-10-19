import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { platformRoleAtLeast } from '@/constants/roles'
import { formatDate, fullName } from '@/lib/format'
import { activeOwnerCount } from '@/queries/tenant-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformTenantDetail } from '@/types/api.types'

/**
 * The next step for a tenant with no active owner and no pending invitation,
 * by its state and whether the reader is an admin, who can take it.
 */
function ownerlessNextStep(state: PlatformTenantDetail['lifecycleState'], isAdmin: boolean) {
  if (state === 'archived') return 'An archived tenant can’t get a new owner.'
  if (state === 'suspended') {
    return isAdmin
      ? 'Reactivate the tenant from the Actions menu, then send an owner invitation.'
      : 'An admin can reactivate the tenant and send an owner invitation.'
  }
  return isAdmin
    ? 'Send an owner invitation from the Actions menu.'
    : 'An admin can send an owner invitation.'
}

/**
 * The tenant's owners. A deactivated owner is listed but marked, because the
 * API does not count them: with no active owner the tenant is
 * effectively ownerless, and the sentence below says what the reader can do,
 * by their role and the tenant's state.
 */
export function TenantOwners({ tenant }: { tenant: PlatformTenantDetail }) {
  const isAdmin = platformRoleAtLeast(
    useAuthStore((s) => s.user?.platformRole),
    'admin'
  )
  const invitation = tenant.pendingOwnerInvitation
  const ownerless = activeOwnerCount(tenant) === 0
  return (
    <div className="grid gap-3">
      {tenant.owners.length > 0 && (
        <ItemGroup className="gap-2 has-data-[size=xs]:gap-2">
          {tenant.owners.map((owner) => (
            <Item key={owner.userId} size="xs" role="listitem" className="p-0">
              <ItemContent>
                <ItemTitle className="line-clamp-none">
                  <span className="flex items-center gap-2">
                    <Pii>{fullName(owner) ?? owner.email}</Pii>
                    {!owner.active && <Badge variant="outline">Inactive</Badge>}
                  </span>
                </ItemTitle>
                <ItemDescription className="line-clamp-none break-all">
                  <Pii>{owner.email}</Pii>
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      )}
      {ownerless && (
        <EmptyState
          size="compact"
          title={tenant.owners.length === 0 ? 'No owner yet.' : 'No active owner.'}
          description={
            invitation ? (
              <>
                An invitation to <Pii>{invitation.email}</Pii> expires{' '}
                {formatDate(invitation.expiresAt, 'medium') ?? 'soon'}.
              </>
            ) : (
              ownerlessNextStep(tenant.lifecycleState, isAdmin)
            )
          }
        />
      )}
    </div>
  )
}
