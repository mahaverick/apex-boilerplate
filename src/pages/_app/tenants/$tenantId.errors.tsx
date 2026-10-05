import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ErrorsPanel } from '@/components/features/errors/errors-panel'
import { RoleDenied } from '@/components/features/role-denied'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app/tenants/$tenantId/errors')({
  head: () => ({ meta: [{ title: pageTitle('Tenant errors') }] }),
  staticData: { crumb: 'Errors' },
  component: TenantErrorsTab,
})

/**
 * The PostHog error issues a tenant's people hit in the last 30 days, from
 * their browsers and from the API acting in the tenant. Admins and up; below
 * that the tab says so without asking the API. Read from the platform API,
 * so it shows in every lifecycle state. The layout handles an unknown tenant.
 */
function TenantErrorsTab() {
  const { tenantId } = Route.useParams()
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  const { data } = useQuery(platformTenantQueryOptions(tenantId))
  if (!data) return null
  return (
    <section aria-labelledby="tenant-errors" className="grid gap-4">
      <h2 id="tenant-errors" className="text-lg font-semibold">
        Errors
      </h2>
      {platformRoleAtLeast(platformRole, 'admin') ? (
        <ErrorsPanel kind="tenant" id={data.id} />
      ) : (
        <RoleDenied />
      )}
    </section>
  )
}
