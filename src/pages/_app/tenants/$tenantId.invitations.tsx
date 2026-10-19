import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { InvitationsSection } from '@/components/features/tenant/invitations-section'
import { FrozenTenant } from '@/components/features/tenants/frozen-tenant'
import { DetailTabPending } from '@/components/shared/pending-templates'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { invitationsList } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

/** A tenant's Invitations tab: pending invitations with invite, resend and revoke, or a frozen notice when the tenant is not active. */
export const Route = createFileRoute('/_app/tenants/$tenantId/invitations')({
  validateSearch: invitationsList.schema,
  head: () => ({ meta: [{ title: pageTitle('Tenant invitations') }] }),
  staticData: { crumb: 'Invitations' },
  component: TenantInvitationsTab,
  pendingComponent: DetailTabPending,
})

/** Invitations through the tenant's own routes; a non-active tenant renders frozen and asks nothing. */
function TenantInvitationsTab() {
  const { tenantId } = Route.useParams()
  const { data } = useQuery(platformTenantQueryOptions(tenantId))
  const isAdmin = platformRoleAtLeast(
    useAuthStore((state) => state.user?.platformRole),
    'admin'
  )
  if (!data) return null
  if (data.lifecycleState !== 'active') {
    return <FrozenTenant state={data.lifecycleState} canReactivate={isAdmin} />
  }
  return <InvitationsSection slug={data.slug} tenantId={data.id} />
}
