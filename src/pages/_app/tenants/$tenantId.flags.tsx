import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { FlagEvaluation } from '@/components/features/flags/flag-evaluation'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { FrozenTenant } from '@/components/features/tenants/frozen-tenant'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { FLAGS_LIST_ERROR } from '@/constants/flags.constants'
import { platformRoleAtLeast, ROLE_LABELS } from '@/constants/roles'
import { flagsListQueryOptions } from '@/queries/flag-inspector.queries'
import { isRoleDenied } from '@/queries/platform.queries'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { memberName, useMembers } from '@/queries/tenant.queries'
import { tenantFlagsSearchSchema } from '@/schemas/flags.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformTenantDetail } from '@/types/api.types'

export const Route = createFileRoute('/_app/tenants/$tenantId/flags')({
  validateSearch: tenantFlagsSearchSchema,
  head: () => ({ meta: [{ title: pageTitle('Tenant flags') }] }),
  staticData: { crumb: 'Flags' },
  component: TenantFlagsTab,
})

/**
 * The member picker and the picked member's evaluation in this tenant, as
 * the customer app sees it. Members are read through the tenant's own
 * routes, so only an active tenant lists them.
 */
function TenantFlagsPanel({ tenant }: { tenant: PlatformTenantDetail }) {
  const { userId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const members = useMembers(tenant.slug, tenant.id)
  const flags = useQuery(flagsListQueryOptions())

  if (members.isError || flags.isError) {
    if (isRoleDenied(members.error) || isRoleDenied(flags.error)) return <RoleDenied />
    return (
      <LoadError
        message={flags.isError ? FLAGS_LIST_ERROR : 'We could not load this tenant’s members.'}
        onRetry={() => void (flags.isError ? flags.refetch() : members.refetch())}
      />
    )
  }
  if (members.data === undefined || flags.data === undefined) {
    return <Skeleton className="h-48 w-full" />
  }
  const picked = members.data.find((member) => member.user.id === userId)
  return (
    <div className="grid gap-4">
      <ul aria-label="Members" className="flex flex-wrap gap-2">
        {members.data.map((member) => (
          <li key={member.user.id}>
            <Button
              variant={member.user.id === userId ? 'default' : 'outline'}
              size="sm"
              aria-pressed={member.user.id === userId}
              onClick={() => void navigate({ search: { userId: member.user.id }, replace: true })}
            >
              <Pii>{memberName(member)}</Pii>
              <span className="text-xs">· {ROLE_LABELS[member.membership.role]}</span>
            </Button>
          </li>
        ))}
      </ul>
      {picked === undefined ? (
        <p className="text-sm text-muted-foreground">
          Pick a member to see every flag as the customer app evaluates it for them here.
        </p>
      ) : (
        <FlagEvaluation
          params={{ userId: picked.user.id, tenantId: tenant.id, app: 'react' }}
          registry={flags.data.items}
        />
      )}
    </div>
  )
}

/**
 * Every registered flag as one member of this tenant gets it in the
 * customer app. Admins and up; below that the tab says so without asking
 * the API. The layout handles an unknown tenant.
 */
function TenantFlagsTab() {
  const { tenantId } = Route.useParams()
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  const { data } = useQuery(platformTenantQueryOptions(tenantId))
  if (!data) return null
  return (
    <section aria-labelledby="tenant-flags" className="grid gap-4">
      <h2 id="tenant-flags" className="text-lg font-semibold">
        Flags
      </h2>
      {!platformRoleAtLeast(platformRole, 'admin') ? (
        <RoleDenied />
      ) : data.lifecycleState !== 'active' ? (
        <FrozenTenant state={data.lifecycleState} />
      ) : (
        <TenantFlagsPanel tenant={data} />
      )}
    </section>
  )
}
