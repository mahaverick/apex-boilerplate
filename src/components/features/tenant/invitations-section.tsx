import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { InviteMemberForm } from '@/components/features/tenant/invite-member-form'
import { PendingInvitations } from '@/components/features/tenant/pending-invitations'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { canManageTenant } from '@/constants/roles'
import { useMyRole } from '@/queries/tenant.queries'

const DEFAULT_INVITE_DESCRIPTION =
  'We email them a link to join. Someone without an account can create one with that address, then open the link again.'

/**
 * Invite form and pending invitations. The invitation routes are owner/admin
 * (effective role), so for anyone else nothing is requested and the reason
 * is shown instead; `PendingInvitations` requests the list only once mounted.
 * Staff acting through platform access give an audited reason for each write.
 */
export function InvitationsSection({
  slug,
  inviteTitle = 'Invite a member',
  inviteDescription = DEFAULT_INVITE_DESCRIPTION,
  tenantId,
}: {
  slug: string
  inviteTitle?: string
  inviteDescription?: string
  /** An Apex tenant page's id, scoping the cache; the Staff page passes none. */
  tenantId?: string
}) {
  const { role, access, isPending, isError, retry } = useMyRole(slug, tenantId)
  const asStaff = access === 'platform'
  if (isPending) return <Skeleton className="h-40 w-full" />
  if (isError || !role) return <LoadError message={ROLE_ERROR} onRetry={retry} />
  if (!canManageTenant(role)) {
    return (
      <p className="text-sm text-muted-foreground">
        Invitations are managed by owners and admins. Your role here can’t see them.
      </p>
    )
  }
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{inviteTitle}</h2>
          </CardTitle>
          <CardDescription>{inviteDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <InviteMemberForm slug={slug} myRole={role} asStaff={asStaff} tenantId={tenantId} />
        </CardContent>
      </Card>
      <PendingInvitations slug={slug} myRole={role} asStaff={asStaff} tenantId={tenantId} />
    </div>
  )
}
