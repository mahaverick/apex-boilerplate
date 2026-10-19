import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { InviteMemberForm } from '@/components/features/tenant/invite-member-form'
import { PendingInvitations } from '@/components/features/tenant/pending-invitations'
import { Note } from '@/components/shared/note'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { canManageTenant } from '@/constants/roles'
import { useMyRole } from '@/queries/tenant.queries'

/** A customer tenant's invite card: a new address joins on the click, an existing account confirms by a sign-in link. */
const DEFAULT_INVITE_DESCRIPTION =
  'We email them an invitation that expires in 3 days. Someone new joins in one click. Someone with an account gets a sign-in link to confirm.'

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
  showRoleError = true,
  submitLabel,
}: {
  slug: string
  inviteTitle?: string
  inviteDescription?: string
  /** The invite button's text; the form's own default when unset. */
  submitLabel?: string
  /** An Apex tenant page's id, scoping the cache; the Staff page passes none. */
  tenantId?: string
  /** False when a sibling section on the page reads the same role and reports its failure, so it shows once (the Staff page). Try again there retries this one too. */
  showRoleError?: boolean
}) {
  const { role, access, isPending, isError, retry } = useMyRole(slug, tenantId)
  const asStaff = access === 'platform'
  if (isPending) return <Skeleton className="h-40 w-full" />
  if (isError || !role) {
    return showRoleError ? <LoadError message={ROLE_ERROR} onRetry={retry} /> : null
  }
  if (!canManageTenant(role)) {
    return (
      <Note tone="passive">
        Invitations are managed by owners and admins. Your role here can’t see them.
      </Note>
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
          <InviteMemberForm
            slug={slug}
            myRole={role}
            asStaff={asStaff}
            tenantId={tenantId}
            submitLabel={submitLabel}
          />
        </CardContent>
      </Card>
      <PendingInvitations slug={slug} myRole={role} asStaff={asStaff} tenantId={tenantId} />
    </div>
  )
}
