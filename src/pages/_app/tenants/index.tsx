import { IconBuilding } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef } from 'react'
import { CreateTenantDialog } from '@/components/features/tenants/create-tenant-dialog'
import { TenantsTable } from '@/components/features/tenants/tenants-table'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { useArrivalFocus } from '@/hooks/use-arrival-focus'
import { tenantsList, tenantsListOptions } from '@/queries/tenant-admin.queries'
import { listRequest, listValues } from '@/schemas/list-request.schemas'
import { useAuthStore } from '@/states/auth.store'

/** The Tenants page: every customer tenant, with everything that picks the rows in the URL. */
export const Route = createFileRoute('/_app/tenants/')({
  validateSearch: tenantsList.schema,
  loaderDeps: ({ search }) => listRequest(tenantsList, listValues(tenantsList, search)),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(tenantsListOptions(deps))
  },
  head: () => ({ meta: [{ title: pageTitle('Tenants') }] }),
  staticData: { crumb: 'Tenants' },
  component: TenantsPage,
})

/**
 * Every customer tenant. The view is the URL's (`?search`, `?state`, `?sort`,
 * and the page as `?cursor`), so it can be shared and Back walks through it.
 * The table owns the loading, error and empty states. The heading takes
 * focus on arrival after a tenant is deleted for good.
 */
function TenantsPage() {
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)
  useArrivalFocus(heading, true)
  const canCreate = platformRoleAtLeast(
    useAuthStore((s) => s.user?.platformRole),
    'admin'
  )
  const list = useListSearch(tenantsList)
  const query = useListQuery(list, tenantsListOptions)

  return (
    <div className="grid grid-cols-1 gap-4">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
        Tenants
      </h1>
      <TenantsTable
        query={query}
        errorMessage="We couldn’t load the tenants. Select Try again."
        empty={
          <EmptyState
            icon={<IconBuilding aria-hidden="true" />}
            title="No tenants yet."
            description="Tenants appear here once customers or staff create them."
          />
        }
        toolbar={
          canCreate && (
            <CreateTenantDialog
              onCreated={(tenant) =>
                void navigate({ to: ROUTES.tenant, params: { tenantId: tenant.id } })
              }
            />
          )
        }
      />
    </div>
  )
}
