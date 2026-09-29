import { createFileRoute } from '@tanstack/react-router'
import { InvitationsSection } from '@/components/features/tenant/invitations-section'
import { MembersCard } from '@/components/features/tenant/members-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { PLATFORM_TENANT_SLUG } from '@/constants/routes'

export const Route = createFileRoute('/_app/staff')({
  head: () => ({ meta: [{ title: pageTitle('Staff') }] }),
  staticData: { crumb: 'Staff' },
  component: StaffPage,
})

/**
 * The staff are the platform tenant's members, managed through the same
 * `/tenants/platform/*` routes a customer tenant's owners use. The sections
 * gate themselves on the viewer's platform membership role (`useMyRole`), the
 * same role those routes check: role changes are owner-only, removal and
 * invitations admin or owner, and the API's last-owner guard applies.
 */
function StaffPage() {
  return (
    <div className="grid max-w-4xl gap-4">
      <h1 className="text-2xl font-semibold">Staff</h1>
      <MembersCard
        slug={PLATFORM_TENANT_SLUG}
        title="Staff members"
        description="Everyone with platform access, and their platform role."
      />
      <InvitationsSection
        slug={PLATFORM_TENANT_SLUG}
        inviteTitle="Invite staff"
        inviteDescription="We email them a link to join as staff. The link opens Apex; someone without an account creates one with that address."
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Other ways in</h2>
          </CardTitle>
          <CardDescription>Invitations are not the only way someone becomes staff.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            Verified addresses on the domains in <code>PLATFORM_EMAIL_DOMAINS</code> join as viewers
            automatically when they sign in.
          </p>
          <p>
            On the server, <code>pnpm platform:grant</code> gives an existing, verified account any
            platform role; it is how the first owner is made.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
