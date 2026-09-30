import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { MembersCard } from '@/components/features/tenant/members-card'
import { FrozenTenant } from '@/components/features/tenants/frozen-tenant'
import { pageTitle } from '@/constants/app'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'

export const Route = createFileRoute('/_app/tenants/$tenantId/members')({
  head: () => ({ meta: [{ title: pageTitle('Tenant members') }] }),
  staticData: { crumb: 'Members' },
  component: TenantMembersTab,
})

/** Members through the tenant's own routes; a non-active tenant renders frozen and asks nothing. */
function TenantMembersTab() {
  const { tenantId } = Route.useParams()
  const { data } = useQuery(platformTenantQueryOptions(tenantId))
  if (!data) return null
  if (data.lifecycleState !== 'active') return <FrozenTenant state={data.lifecycleState} />
  return <MembersCard slug={data.slug} tenantId={data.id} />
}
