import { LoadError } from '@/components/features/load-error'
import { InviteMemberForm } from '@/components/features/tenant/invite-member-form'
import { PendingInvitations } from '@/components/features/tenant/pending-invitations'
import { ROLE_ERROR } from '@/components/features/tenant/role-error'
import { Note } from '@/components/shared/note'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { canManageTenant } from '@/constants/roles'
import { inDays } from '@/lib/link-lifetime'
import { useClientSettings } from '@/queries/client-settings.queries'
import { useMyRole } from '@/queries/tenant.queries'

/** A customer tenant's invite card: every invitee confirms by an emailed link. */
const DEFAULT_INVITE_NEXT_STEP = 'After they select Join, we email them a link to confirm.'

/**
 * Invite form and pending invitations. The invitation routes are owner/admin
 * (effective role), so for anyone else nothing is requested and the reason
 * is shown instead; `PendingInvitations` requests the list only once mounted.
 * Staff acting through platform access give an audited reason for each write.
 */
export function InvitationsSection({
  slug,
  inviteTitle = 'Invite a member',
  inviteNextStep = DEFAULT_INVITE_NEXT_STEP,
  tenantId,
  showRoleError = true,
  submitLabel,
}: {
  slug: string
  inviteTitle?: string
  /** What happens after the invitation, following the card's first sentence, which states the invitation's lifetime from the client settings. */
  inviteNextStep?: string
  /** The invite button's text; the form's own default when unset. */
  submitLabel?: string
  /** An Apex tenant page's id, scoping the cache; the Staff page passes none. */
  tenantId?: string
  /** False when a sibling section on the page reads the same role and reports its failure, so it shows once (the Staff page). Try again there retries this one too. */
  showRoleError?: boolean
}) {
  const { role, access, isPending, isError, retry } = useMyRole(slug, tenantId)
  const invitationTtl = useClientSettings()?.invitationTtlSeconds
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
          <CardDescription>
            {invitationTtl === undefined
              ? 'We email them an invitation.'
              : `We email them an invitation that expires in ${inDays(invitationTtl)}.`}{' '}
            {inviteNextStep}
          </CardDescription>
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
