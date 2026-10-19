import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { PlatformUserRow } from '@/types/api.types'

/**
 * Account state, and "Never signed in" while the address is unverified (the
 * first sign-in verifies it), as badges. Tokens as on the tenants table. A deleted account
 * shows only "Deleted": whether it was active does not matter.
 */
export function UserStatusBadges({
  user,
}: {
  user: Pick<PlatformUserRow, 'active' | 'emailVerifiedAt' | 'deletedAt'>
}) {
  if (user.deletedAt !== null) {
    return (
      <span className="flex flex-wrap gap-1">
        <Badge className="border-transparent bg-muted text-muted-foreground">Deleted</Badge>
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1">
      <Badge
        className={cn(
          'border-transparent',
          user.active ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'
        )}
      >
        {user.active ? 'Active' : 'Inactive'}
      </Badge>
      {user.emailVerifiedAt === null && (
        <Badge className="border-transparent bg-warning text-warning-foreground">
          Never signed in
        </Badge>
      )}
    </span>
  )
}
