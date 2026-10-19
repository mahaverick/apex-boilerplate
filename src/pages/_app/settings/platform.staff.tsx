import { createFileRoute } from '@tanstack/react-router'
import { SettingsRouteError } from '@/components/features/route-error'
import { InvitationsSection } from '@/components/features/tenant/invitations-section'
import { MembersCard } from '@/components/features/tenant/members-card'
import { SettingsPagePending } from '@/components/shared/pending-templates'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { PLATFORM_TENANT_SLUG } from '@/constants/routes'
import { membersList } from '@/queries/tenant.queries'

/** The Staff page: the platform tenant's members and invitations. */
export const Route = createFileRoute('/_app/settings/platform/staff')({
  validateSearch: membersList.schema,
  head: () => ({ meta: [{ title: pageTitle('Staff') }] }),
  staticData: { crumb: 'Staff' },
  component: StaffPage,
  pendingComponent: SettingsPagePending,
  /**
   * Kept out of a lazy chunk, as the router's default error screen is: a failed
   * fetch could not load it. Splitting it would also pull the error listener
   * out of the entry chunk (pnpm check:bundle). A page chunk that imported its
   * `Route` back would split it out too, which is why the lists read their
   * search with `useListSearch`, which needs no `Route`.
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
        showRoleError={false}
        inviteTitle="Invite staff"
        inviteDescription="We email them a link that signs them in to Apex as staff. The link creates their account if they don’t have one, and expires in 3 days."
        submitLabel="Invite staff"
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
            On the server, <code>pnpm platform:grant</code> gives an account any platform role. It
            creates the account if none exists. Use it to create the first owner.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
