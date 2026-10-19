import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { MembersCard } from '@/components/features/tenant/members-card'
import { FrozenTenant } from '@/components/features/tenants/frozen-tenant'
import { DetailTabPending } from '@/components/shared/pending-templates'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { membersList } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

/** A tenant's Members tab: the member list with role changes and removal, or a frozen notice when the tenant is not active. */
export const Route = createFileRoute('/_app/tenants/$tenantId/members')({
  validateSearch: membersList.schema,
  head: () => ({ meta: [{ title: pageTitle('Tenant members') }] }),
  staticData: { crumb: 'Members' },
  component: TenantMembersTab,
  pendingComponent: DetailTabPending,
})

/** Members through the tenant's own routes; a non-active tenant renders frozen and asks nothing. */
function TenantMembersTab() {
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
  return <MembersCard slug={data.slug} tenantId={data.id} />
}
