import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ACCESS_FILTER, ACTION_FILTER } from '@/components/features/activity/activity-filters'
import { ActivityTable } from '@/components/features/activity/activity-table'
import { TenantFilterChip, UserFilterChip } from '@/components/features/emails/email-filter-chips'
import { RoleDenied } from '@/components/features/role-denied'
import type { DataTableFilter } from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { fullName } from '@/lib/format'
import { isRoleDenied } from '@/lib/role-denied'
import { platformActivityList, platformAuditListOptions } from '@/queries/audit.queries'
import { tenantsListOptions } from '@/queries/tenant-admin.queries'
import { usersListOptions } from '@/queries/user-admin.queries'
import { cleanSearch } from '@/schemas/list-request.schemas'
import { useAuthStore } from '@/states/auth.store'
import { LIST_SEARCH_DEBOUNCE_MS } from '@/types/list.types'

/** The Activity page: the platform audit log across all tenants, for platform admins. */
export const Route = createFileRoute('/_app/activity')({
  validateSearch: platformActivityList.schema,
  head: () => ({ meta: [{ title: pageTitle('Activity') }] }),
  staticData: { crumb: 'Activity' },
  component: PlatformActivityPage,
})

/**
 * The panel for staff below admin, matching the API: the page never confirms it
 * exists to someone it refuses.
 */
function PlatformNotFound() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Page not available</h1>
        </CardTitle>
        <CardDescription>
          This page does not exist, or it is not available to your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link to={ROUTES.overview} className="text-sm underline underline-offset-4">
          Back to the overview
        </Link>
      </CardContent>
    </Card>
  )
}

/**
 * Every tenant's activity, filtered by tenant, action, actor and access path,
 * all in the URL. The Actor and Tenant facets search the server as the reader
 * types; a URL naming an actor outside the results still filters, and its chip
 * resolves the name from the user's record. A 404 from the log (the viewer was
 * demoted since the profile loaded) gets the role-denied state.
 */
function PlatformActivity() {
  const list = useListSearch(platformActivityList)
  const log = useListQuery(list, platformAuditListOptions)
  /** What the reader typed in the Actor facet's search box. */
  const [actorTerm, setActorTerm] = useState('')
  /** The actor search term the request waits for, so a keystroke is not a request. */
  const actorSearch = useDebouncedValue(cleanSearch(actorTerm), LIST_SEARCH_DEBOUNCE_MS)
  /** The Actor facet's options: the users the search names, twenty at a time, with no total. */
  const actors = useQuery(
    usersListOptions({ search: actorSearch || undefined, limit: 20 }, { total: false })
  )
  /** What the reader typed in the Tenant facet's search box. */
  const [tenantTerm, setTenantTerm] = useState('')
  /** The tenant search term the request waits for, so a keystroke is not a request. */
  const tenantSearch = useDebouncedValue(cleanSearch(tenantTerm), LIST_SEARCH_DEBOUNCE_MS)
  /** The Tenant facet's options: the tenants the search names, twenty at a time, with no total. */
  const tenants = useQuery(
    tenantsListOptions({ search: tenantSearch || undefined, limit: 20 }, { total: false })
  )
  /** The facets, in the toolbar's order. */
  const filters: DataTableFilter[] = [
    {
      name: 'tenant',
      label: 'Tenant',
      single: true,
      options: (tenants.data?.items ?? []).map((tenant) => ({
        value: tenant.id,
        label: tenant.name,
      })),
      optionsState: {
        isPending: tenants.isPending,
        isError: tenants.isError,
        retry: () => void tenants.refetch(),
      },
      onSearch: setTenantTerm,
      renderChip: (value, onRemove) => (
        <TenantFilterChip
          tenantId={value}
          knownName={tenants.data?.items.find((tenant) => tenant.id === value)?.name}
          onRemove={onRemove}
        />
      ),
    },
    ACTION_FILTER,
    {
      name: 'actor',
      label: 'Actor',
      single: true,
      isPersonal: true,
      options: (actors.data?.items ?? []).map((actor) => ({
        value: actor.id,
        label: fullName(actor) ?? actor.email,
      })),
      // The users read's own failure shows in the facet, with a retry.
      optionsState: {
        isPending: actors.isPending,
        isError: actors.isError,
        retry: () => void actors.refetch(),
      },
      onSearch: setActorTerm,
      renderChip: (value, onRemove) => {
        const actor = actors.data?.items.find((entry) => entry.id === value)
        return (
          <UserFilterChip
            userId={value}
            knownName={actor ? (fullName(actor) ?? actor.email) : undefined}
            prefix="Actor: "
            onRemove={onRemove}
          />
        )
      },
    },
    ACCESS_FILTER,
  ]

  if (log.query.isError && isRoleDenied(log.query.error)) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <RoleDenied />
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Activity</h1>
          </CardTitle>
          <CardDescription>
            Every change and every staff visit, across all tenants, newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityTable
            query={log}
            showTenant
            filters={filters}
            empty={<EmptyState size="compact" title="Nothing has happened yet." />}
          />
        </CardContent>
      </Card>
    </div>
  )
}

/** Below platform admin the API answers 404, so the page says the same without asking. */
function PlatformActivityPage() {
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  return platformRoleAtLeast(platformRole, 'admin') ? <PlatformActivity /> : <PlatformNotFound />
}
