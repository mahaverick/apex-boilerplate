import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { RoleDenied } from '@/components/features/role-denied'
import { TimelinePanel } from '@/components/features/timeline/timeline-panel'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { timelineSearchSchema } from '@/schemas/timeline.schemas'
import { useAuthStore } from '@/states/auth.store'

export const Route = createFileRoute('/_app/tenants/$tenantId/timeline')({
  validateSearch: timelineSearchSchema,
  head: () => ({ meta: [{ title: pageTitle('Tenant timeline') }] }),
  staticData: { crumb: 'Timeline' },
  component: TenantTimelineTab,
})

/**
 * What a tenant's people did, across browser and server, from PostHog, and
 * staff actions on it, each row with who did it. Admins and up; below that
 * the tab says so without asking the API. Read from the platform API, so it
 * shows in every lifecycle state. The layout handles an unknown tenant.
 */
function TenantTimelineTab() {
  const { tenantId } = Route.useParams()
  const { range, view } = Route.useSearch()
  const navigate = Route.useNavigate()
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  const { data } = useQuery(platformTenantQueryOptions(tenantId))
  if (!data) return null
  return (
    <section aria-labelledby="tenant-timeline" className="grid gap-4">
      <h2 id="tenant-timeline" className="text-lg font-semibold">
        Timeline
      </h2>
      {platformRoleAtLeast(platformRole, 'admin') ? (
        <TimelinePanel
          kind="tenant"
          id={data.id}
          range={range}
          view={view}
          onSearchChange={(search) => void navigate({ search, replace: true })}
        />
      ) : (
        <RoleDenied />
      )}
    </section>
  )
}
