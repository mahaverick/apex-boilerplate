import { createFileRoute } from '@tanstack/react-router'
import { SettingsRouteError } from '@/components/features/route-error'
import { InvitationsSection } from '@/components/features/tenant/invitations-section'
import { MembersCard } from '@/components/features/tenant/members-card'
import { SettingsPagePending } from '@/components/shared/pending-templates'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { PLATFORM_TENANT_SLUG } from '@/constants/routes'

/** The Staff page: the platform tenant's members and invitations. */
export const Route = createFileRoute('/_app/settings/platform/staff')({
  head: () => ({ meta: [{ title: pageTitle('Staff') }] }),
  staticData: { crumb: 'Staff' },
  component: StaffPage,
  pendingComponent: SettingsPagePending,
  /**
   * Kept out of a lazy chunk, as the router's default error screen is: a failed
   * fetch could not load it. Splitting it would also pull the error listener
   * out of the entry chunk (pnpm check:bundle).
   */
  codeSplitGroupings: [['component']],
  errorComponent: SettingsRouteError,
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
    <div className="grid gap-4">
      <MembersCard
        slug={PLATFORM_TENANT_SLUG}
        title="Staff members"
        description="Their platform role. Only an owner can change it."
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
