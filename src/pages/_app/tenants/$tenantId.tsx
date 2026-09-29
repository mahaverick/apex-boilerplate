import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { LoadError } from '@/components/features/load-error'
import { TenantActionsMenu } from '@/components/features/tenants/tenant-actions-menu'
import { TenantStateBadge } from '@/components/features/tenants/tenant-state-badge'
import { buttonVariants } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { TENANT_DETAIL_TABS } from '@/constants/tenant-tabs'
import { statusFrom } from '@/lib/api-error'
import { formatDate } from '@/lib/format'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'

export const Route = createFileRoute('/_app/tenants/$tenantId')({
  // Started, not awaited: the header renders its skeleton while this runs.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(platformTenantQueryOptions(params.tenantId))
  },
  head: () => ({ meta: [{ title: pageTitle('Tenant') }] }),
  staticData: { crumb: 'Tenant' },
  component: TenantLayout,
})

/**
 * One tenant, in any lifecycle state: its header (name, state, actions) and a
 * section nav over the tabs. Everything here reads `GET /platform/tenants/:id`;
 * only the Members, Invitations and Activity tabs and the Edit details action
 * reach the tenant's own routes, and only while it is active. A 404 is an
 * unknown tenant; it never signs out.
 */
function TenantLayout() {
  const { tenantId } = Route.useParams()
  const tenant = useQuery(platformTenantQueryOptions(tenantId))

  if (tenant.isError) {
    return statusFrom(tenant.error) === 404 ? (
      <Empty>
        <EmptyHeader>
          <h1 className="text-lg font-semibold">Tenant not found</h1>
          <EmptyDescription>
            It doesn’t exist, or your access changed. Reload if your role was just updated.
          </EmptyDescription>
        </EmptyHeader>
        <Link to={ROUTES.tenants} className={buttonVariants({ variant: 'outline' })}>
          Back to tenants
        </Link>
      </Empty>
    ) : (
      <LoadError message="We could not load this tenant." onRetry={() => void tenant.refetch()} />
    )
  }
  if (tenant.data === undefined) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const { name, slug, lifecycleState, createdAt } = tenant.data
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold break-all">{name}</h1>
            <TenantStateBadge state={lifecycleState} />
          </div>
          <p className="text-sm text-muted-foreground">
            <code>{slug}</code> · Created {formatDate(createdAt, 'medium') ?? 'on an unknown date'}
          </p>
        </div>
        <TenantActionsMenu tenant={tenant.data} />
      </div>
      <nav aria-label="Tenant sections" className="flex gap-1 overflow-x-auto border-b">
        {TENANT_DETAIL_TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ tenantId }}
            activeOptions={{ exact: true }}
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
