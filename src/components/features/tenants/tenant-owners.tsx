import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { formatDate, fullName } from '@/lib/format'
import { activeOwnerCount } from '@/queries/tenant-admin.queries'
import type { PlatformTenantDetail } from '@/types/api.types'

/**
 * The tenant's owners. A deactivated owner is listed but marked, because the
 * API no longer counts them: with no active owner the tenant is
 * effectively ownerless, and the sentence below says what staff can do.
 */
export function TenantOwners({ tenant }: { tenant: PlatformTenantDetail }) {
  const invitation = tenant.pendingOwnerInvitation
  const ownerless = activeOwnerCount(tenant) === 0
  return (
    <div className="grid gap-3">
      {tenant.owners.length > 0 && (
        <ul className="grid gap-2">
          {tenant.owners.map((owner) => (
            <li key={owner.userId} className="grid gap-0.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Pii>{fullName(owner) ?? owner.email}</Pii>
                {!owner.active && <Badge variant="outline">Inactive</Badge>}
              </span>
              <Pii className="text-sm break-all text-muted-foreground">{owner.email}</Pii>
            </li>
          ))}
        </ul>
      )}
      {ownerless && (
        <Pii as="p" className="text-sm text-muted-foreground">
          {tenant.owners.length === 0 ? 'No owner yet.' : 'No active owner.'}
          {invitation
            ? ` An invitation to ${invitation.email} expires ${formatDate(invitation.expiresAt, 'medium') ?? 'soon'}.`
            : ' Send an owner invitation from the Actions menu.'}
        </Pii>
      )}
    </div>
  )
}
