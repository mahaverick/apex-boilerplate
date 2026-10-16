import { IconSearchOff } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { useRef } from 'react'
import { LoadError } from '@/components/features/load-error'
import { TenantActionsMenu } from '@/components/features/tenants/tenant-actions-menu'
import { TenantStateBadge } from '@/components/features/tenants/tenant-state-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { DetailPending } from '@/components/shared/pending-templates'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { TENANT_DETAIL_TABS } from '@/constants/tenant-tabs'
import { statusFrom } from '@/lib/api-error'
import { formatDate } from '@/lib/format'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { useAuthStore } from '@/states/auth.store'

/** The layout of one tenant's pages: the header and the tab nav around the active tab. */
export const Route = createFileRoute('/_app/tenants/$tenantId')({
  // Started, not awaited: the header renders its skeleton while this runs.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(platformTenantQueryOptions(params.tenantId))
  },
  head: () => ({ meta: [{ title: pageTitle('Tenant') }] }),
  staticData: { crumb: TenantCrumb, crumbParent: { label: 'Tenants', to: ROUTES.tenants } },
  component: TenantLayout,
  pendingComponent: DetailPending,
})

/** The tenant's name in the trail, once its detail has loaded. */
function TenantCrumb({ params }: { params: Record<string, string> }) {
  const { data } = useQuery(platformTenantQueryOptions(params.tenantId ?? ''))
  return data?.name ?? 'Tenant'
}

/**
 * One tenant, in any lifecycle state: its header (name, state, actions) and a
 * section nav over the tabs. Everything here reads `GET /platform/tenants/:id`;
 * only the Members, Invitations, Activity and Flags tabs and the Edit details
 * action reach the tenant's own routes, and only while it is active. A 404 is an
 * unknown tenant; it never signs out. While the tenant loads, the header is a
 * skeleton of its two text lines and the actions button (the heading is
 * 2rem tall and the line under it 1rem, the line's text being 1.25rem; none of
 * it measured), under the real tabs; Overview and Flags draw their own
 * skeletons, the other tabs stay blank until the tenant lands. A tab above the reader's platform role
 * (Flags, for admins) is left out of the nav.
 */
function TenantLayout() {
  const { tenantId } = Route.useParams()
  const tenant = useQuery(platformTenantQueryOptions(tenantId))
  const heading = useRef<HTMLHeadingElement>(null)
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  const tabs = TENANT_DETAIL_TABS.filter(
    (tab) => tab.minRole === undefined || platformRoleAtLeast(platformRole, tab.minRole)
  )

  if (tenant.isError) {
    return statusFrom(tenant.error) === 404 ? (
      <EmptyState
        icon={<IconSearchOff aria-hidden="true" />}
        title={<h1>Tenant not found</h1>}
        description="It doesn’t exist, or your access changed. Reload if your role was just updated."
        action={
          <Link to={ROUTES.tenants} className={buttonVariants({ variant: 'outline' })}>
            Back to tenants
          </Link>
        }
      />
    ) : (
      <LoadError message="We could not load this tenant." onRetry={() => void tenant.refetch()} />
    )
  }
  const loaded = tenant.data
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {loaded === undefined ? (
          <>
            <h1 className="sr-only">Tenant</h1>
            <div className="grid gap-1">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-9 w-28" />
          </>
        ) : (
          <>
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  ref={heading}
                  tabIndex={-1}
                  className="text-2xl font-semibold break-all outline-none"
                >
                  {loaded.name}
                </h1>
                <TenantStateBadge state={loaded.lifecycleState} />
              </div>
              <p className="text-sm text-muted-foreground">
                <code>{loaded.slug}</code> · Created{' '}
                {formatDate(loaded.createdAt, 'medium') ?? 'on an unknown date'}
              </p>
            </div>
            <TenantActionsMenu tenant={loaded} fallbackFocus={heading} />
          </>
        )}
      </div>
      <nav aria-label="Tenant sections" className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ tenantId }}
            activeOptions={{ exact: true, includeSearch: false }}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-[status=active]:border-primary data-[status=active]:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
