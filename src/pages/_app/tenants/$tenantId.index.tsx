import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { TenantHistoryCard } from '@/components/features/history-card'
import { TenantOwners } from '@/components/features/tenants/tenant-owners'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { formatDate } from '@/lib/format'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'

export const Route = createFileRoute('/_app/tenants/$tenantId/')({
  head: () => ({ meta: [{ title: pageTitle('Tenant overview') }] }),
  component: TenantOverviewTab,
})

/** One label/value row of a definition list. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all sm:col-span-2">{value}</dd>
    </div>
  )
}

/**
 * The tenant's details from the platform read alone, so it works in every
 * lifecycle state and records no staff visit; below them, for admins, what
 * staff have done to it. The layout owns the loading
 * and error states; this renders once the detail is cached.
 */
function TenantOverviewTab() {
  const { tenantId } = Route.useParams()
  const { data } = useQuery(platformTenantQueryOptions(tenantId))
  if (!data) return null
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Details</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3">
              <Row label="Description" value={data.description ?? '—'} />
              <Row label="Website" value={data.website ?? '—'} />
              <Row label="Timezone" value={data.settings.timezone} />
              <Row label="Locale" value={data.settings.locale} />
              <Row label="Members" value={String(data.memberCount)} />
              <Row label="Pending invitations" value={String(data.pendingInvitationCount)} />
              <Row label="Last updated" value={formatDate(data.updatedAt, 'medium') ?? '—'} />
              {data.deletedAt && (
                <Row label="Archived" value={formatDate(data.deletedAt, 'medium') ?? '—'} />
              )}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Owners</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <TenantOwners tenant={data} />
          </CardContent>
        </Card>
      </div>
      <TenantHistoryCard tenantId={data.id} />
    </div>
  )
}
