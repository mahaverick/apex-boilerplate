import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ActivityList } from '@/components/features/activity/activity-list'
import { LoadError, ROLE_ERROR } from '@/components/features/load-error'
import { FrozenTenant } from '@/components/features/tenants/frozen-tenant'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { canViewActivity } from '@/constants/roles'
import { flattenAuditPages, useTenantAuditLog } from '@/queries/audit.queries'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { useMyRole } from '@/queries/tenant.queries'

export const Route = createFileRoute('/_app/tenants/$tenantId/activity')({
  head: () => ({ meta: [{ title: pageTitle('Tenant activity') }] }),
  staticData: { crumb: 'Activity' },
  component: TenantActivityTab,
})

function TenantActivityTab() {
  const { tenantId } = Route.useParams()
  const { data } = useQuery(platformTenantQueryOptions(tenantId))
  if (!data) return null
  if (data.lifecycleState !== 'active') return <FrozenTenant state={data.lifecycleState} />
  return <TenantActivity slug={data.slug} tenantId={data.id} />
}

/** The tenant's audit log: effective owner or admin, as its route requires. */
function TenantActivity({ slug, tenantId }: { slug: string; tenantId: string }) {
  const { role, isPending, isError, retry } = useMyRole(slug, tenantId)
  const allowed = role !== undefined && canViewActivity(role)
  const log = useTenantAuditLog(slug, {}, { enabled: allowed }, tenantId)
  if (isPending) return <Skeleton className="h-40 w-full" />
  if (isError || !role) return <LoadError message={ROLE_ERROR} onRetry={retry} />
  if (!allowed) {
    return (
      <p className="text-sm text-muted-foreground">
        A tenant’s activity is for owners and admins. Your role here can’t see it.
      </p>
    )
  }
  return (
    <ActivityList
      entries={flattenAuditPages(log.data)}
      isPending={log.isPending}
      isError={log.isError}
      onRetry={() => void log.refetch()}
      hasNextPage={log.hasNextPage}
      isFetchingNextPage={log.isFetchingNextPage}
      isFetchNextPageError={log.isFetchNextPageError}
      onLoadMore={() => void log.fetchNextPage()}
      emptyMessage="Nothing has happened in this tenant yet."
    />
  )
}
