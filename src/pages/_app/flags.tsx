import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { FlagEvaluatePanel } from '@/components/features/flags/flag-evaluate-panel'
import { FlagRegistryTable } from '@/components/features/flags/flag-registry-table'
import { TraitsPanel } from '@/components/features/flags/traits-panel'
import { UnregisteredFlagsTable } from '@/components/features/flags/unregistered-flags-table'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import {
  FLAGS_LIST_ERROR,
  FLAGS_NOT_CONFIGURED,
  FLAGS_STALE_NOTE,
} from '@/constants/flags.constants'
import { platformRoleAtLeast } from '@/constants/roles'
import { relativeTime } from '@/lib/relative-time'
import { flagsListQueryOptions } from '@/queries/flag-inspector.queries'
import { isRoleDenied } from '@/queries/platform.queries'
import { flagsSearchSchema } from '@/schemas/flags.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { FlagsListResponse } from '@/types/api.types'

export const Route = createFileRoute('/_app/flags')({
  validateSearch: flagsSearchSchema,
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(flagsListQueryOptions())
  },
  head: () => ({ meta: [{ title: pageTitle('Feature flags') }] }),
  staticData: { crumb: 'Feature flags' },
  component: FlagsPage,
})

/** One titled block of the page. */
function FlagsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** The loaded page: notes on the snapshot, then each section. */
function FlagsContent({ data, isAdmin }: { data: FlagsListResponse; isAdmin: boolean }) {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <>
      {!data.snapshot.enabled && (
        <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
          {FLAGS_NOT_CONFIGURED}
        </p>
      )}
      {data.snapshot.enabled && data.snapshot.stale && (
        <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
          {FLAGS_STALE_NOTE}
        </p>
      )}
      <FlagsSection id="flags-registered" title="Registered flags">
        <FlagRegistryTable items={data.items} />
        {data.snapshot.fetchedAt !== null && (
          <p className="text-xs text-muted-foreground">
            PostHog snapshot from{' '}
            <time dateTime={data.snapshot.fetchedAt}>{relativeTime(data.snapshot.fetchedAt)}</time>.
            Rollouts are edited in PostHog.
          </p>
        )}
      </FlagsSection>
      {isAdmin && (
        <FlagsSection id="flags-evaluate" title="Evaluate">
          <FlagEvaluatePanel
            search={search}
            onSearchChange={(next) => void navigate({ search: next, replace: true })}
            registry={data.items}
          />
        </FlagsSection>
      )}
      <FlagsSection id="flags-unregistered" title="In PostHog, not registered">
        <UnregisteredFlagsTable rows={data.unregistered} />
      </FlagsSection>
      <FlagsSection id="flags-traits" title="Traits reference">
        <TraitsPanel traits={data.traits} />
      </FlagsSection>
    </>
  )
}

/**
 * The flags inspector, read-only: every registered flag with its live
 * PostHog state, PostHog's unregistered flags, the traits a release
 * condition may use and, for admins, any user's evaluation. Rollouts are
 * edited in PostHog, never here.
 */
function FlagsPage() {
  const flags = useQuery(flagsListQueryOptions())
  const isAdmin = platformRoleAtLeast(
    useAuthStore((state) => state.user?.platformRole),
    'admin'
  )
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Feature flags</h1>
      {flags.isError ? (
        isRoleDenied(flags.error) ? (
          <RoleDenied />
        ) : (
          <LoadError message={FLAGS_LIST_ERROR} onRetry={() => void flags.refetch()} />
        )
      ) : flags.data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <FlagsContent data={flags.data} isAdmin={isAdmin} />
      )}
    </div>
  )
}
