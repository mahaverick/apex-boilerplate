import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { InvitationsSection } from '@/components/features/tenant/invitations-section'
import { FrozenTenant } from '@/components/features/tenants/frozen-tenant'
import { pageTitle } from '@/constants/app'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'

export const Route = createFileRoute('/_app/tenants/$tenantId/invitations')({
  head: () => ({ meta: [{ title: pageTitle('Tenant invitations') }] }),
  staticData: { crumb: 'Invitations' },
  component: TenantInvitationsTab,
})

/** Invitations through the tenant's own routes; a non-active tenant renders frozen and asks nothing. */
function TenantInvitationsTab() {
  const { tenantId } = Route.useParams()
  const { data } = useQuery(platformTenantQueryOptions(tenantId))
  if (!data) return null
  if (data.lifecycleState !== 'active') return <FrozenTenant state={data.lifecycleState} />
  return <InvitationsSection slug={data.slug} tenantId={data.id} />
}
