import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { FlagEvaluation } from '@/components/features/flags/flag-evaluation'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { FrozenTenant } from '@/components/features/tenants/frozen-tenant'
import { DetailTabPending } from '@/components/shared/pending-templates'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { FLAGS_LIST_ERROR } from '@/constants/flags.constants'
import { platformRoleAtLeast, ROLE_LABELS } from '@/constants/roles'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { fullName } from '@/lib/format'
import { isRoleDenied } from '@/lib/role-denied'
import { useFlagRegistry } from '@/queries/flag-inspector.queries'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { memberName, membersListOptions } from '@/queries/tenant.queries'
import { platformUserQueryOptions } from '@/queries/user-admin.queries'
import { tenantFlagsSearchSchema } from '@/schemas/flags.schemas'
import { cleanSearch } from '@/schemas/list-request.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformTenantDetail } from '@/types/api.types'
import { LIST_SEARCH_DEBOUNCE_MS, MAX_SEARCH_LENGTH } from '@/types/list.types'

/** How many members the picker lists, with or without a search. */
const PICKER_LIMIT = 20

/** A tenant's Flags tab: any member's flag evaluation in this tenant, kept in `?userId`. */
export const Route = createFileRoute('/_app/tenants/$tenantId/flags')({
  validateSearch: tenantFlagsSearchSchema,
  head: () => ({ meta: [{ title: pageTitle('Tenant flags') }] }),
  staticData: { crumb: 'Flags' },
  component: TenantFlagsTab,
  pendingComponent: DetailTabPending,
})

/**
 * The member picker's search box, buttons and hint line while the members and
 * the registry load: the box (an input is 2.25rem tall), three member buttons
 * (a small button is 2rem tall) and the hint's one line. The count of members
 * is a guess, not measured.
 */
function MemberPickerSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-9 w-72 max-w-full" />
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2].map((member) => (
          <Skeleton key={member} className="h-8 w-36" />
        ))}
      </div>
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  )
}

/**
 * The member picker and the picked member's evaluation in this tenant, as
 * the customer app sees it. The picker lists twenty members, and its search
 * box asks the server for the rest. Members are read through the tenant's
 * own routes, so only an active tenant lists them. A `?userId=` outside the
 * listed members still evaluates, named from the user's record.
 */
function TenantFlagsPanel({ tenant }: { tenant: PlatformTenantDetail }) {
  const { userId } = Route.useSearch()
  const navigate = Route.useNavigate()
  /** What the reader typed in the search box. */
  const [term, setTerm] = useState('')
  /** The search term the request waits for, so a keystroke is not a request. */
  const search = useDebouncedValue(cleanSearch(term), LIST_SEARCH_DEBOUNCE_MS)
  const members = useQuery(
    membersListOptions(
      tenant.slug,
      tenant.id,
      { search: search || undefined, limit: PICKER_LIMIT },
      { total: false }
    )
  )
  const flags = useFlagRegistry()
  const picked = members.data?.items.find((member) => member.user.id === userId)
  /** The picked user's record, read only when the listed members do not name them. */
  const pickedUser = useQuery({
    ...platformUserQueryOptions(userId ?? ''),
    enabled: userId !== undefined && members.data !== undefined && picked === undefined,
  })

  if (isRoleDenied(members.error) || isRoleDenied(flags.error)) return <RoleDenied />
  // A failed search keeps the box, so the reader can change the term or retry under it.
  const searchFailed = members.isError && search !== ''
  if (flags.isError || (members.isError && !searchFailed)) {
    return (
      <LoadError
        message={flags.isError ? FLAGS_LIST_ERROR : 'We could not load this tenant’s members.'}
        onRetry={() => void (flags.isError ? flags.refetch() : members.refetch())}
      />
    )
  }
  if ((members.data === undefined && !searchFailed) || flags.data === undefined) {
    return <MemberPickerSkeleton />
  }
  const listed = members.data?.items ?? []
  const pickedName = picked
    ? memberName(picked)
    : pickedUser.data
      ? (fullName(pickedUser.data) ?? pickedUser.data.email)
      : pickedUser.isError
        ? 'Unknown user'
        : 'Loading…'
  return (
    <div className="grid gap-4">
      <Input
        type="search"
        aria-label="Find a member"
        placeholder="Search by name or email"
        className="w-72 max-w-full"
        maxLength={MAX_SEARCH_LENGTH}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      {searchFailed && (
        <LoadError
          message="We couldn’t search this tenant’s members. Select Try again to search again."
          onRetry={() => void members.refetch()}
        />
      )}
      {search !== '' && members.isSuccess && !members.isPlaceholderData && listed.length === 0 && (
        <p className="text-sm text-muted-foreground">No members match.</p>
      )}
      <ul aria-label="Members" className="flex flex-wrap gap-2">
        {listed.map((member) => (
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
      {userId === undefined ? (
        <p className="text-sm text-muted-foreground">
          Pick a member to see every flag as the customer app evaluates it for them here.
        </p>
      ) : (
        <>
          <p className="text-sm">
            Showing flags for <Pii>{pickedName}</Pii>.
          </p>
          <FlagEvaluation
            params={{ userId, tenantId: tenant.id, app: 'react' }}
            registry={flags.data}
          />
        </>
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
  return (
    <section aria-labelledby="tenant-flags" className="grid gap-4">
      <h2 id="tenant-flags" className="text-lg font-semibold">
        Flags
      </h2>
      {!platformRoleAtLeast(platformRole, 'admin') ? (
        <RoleDenied />
      ) : !data ? (
        <MemberPickerSkeleton />
      ) : data.lifecycleState !== 'active' ? (
        <FrozenTenant state={data.lifecycleState} canReactivate />
      ) : (
        <TenantFlagsPanel tenant={data} />
      )}
    </section>
  )
}
