import { useQuery } from '@tanstack/react-query'
import { createFileRoute, stripSearchParams, useNavigate, useSearch } from '@tanstack/react-router'
import type { ComponentProps, ReactNode } from 'react'
import { FlagEvaluatePanel } from '@/components/features/flags/flag-evaluate-panel'
import { FlagRegistryTable } from '@/components/features/flags/flag-registry-table'
import { TraitsPanel } from '@/components/features/flags/traits-panel'
import { UnregisteredFlagsTable } from '@/components/features/flags/unregistered-flags-table'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { SettingsRouteError } from '@/components/features/route-error'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { Note } from '@/components/shared/note'
import { SettingsPagePending } from '@/components/shared/pending-templates'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import {
  FLAGS_LIST_ERROR,
  FLAGS_NOT_CONFIGURED,
  FLAGS_STALE_NOTE,
} from '@/constants/flags.constants'
import { platformRoleAtLeast } from '@/constants/roles'
import { useNow } from '@/hooks/use-now'
import { relativeTime } from '@/lib/relative-time'
import { isRoleDenied } from '@/lib/role-denied'
import {
  FLAG_REGISTRY_READ,
  flagsList,
  flagsListOptions,
  flagsMetaQueryOptions,
  unregisteredFlagsList,
  unregisteredFlagsListOptions,
} from '@/queries/flag-inspector.queries'
import { listRequest, listValues } from '@/schemas/list-request.schemas'
import { useAuthStore } from '@/states/auth.store'
import type { FlagsMetaResponse } from '@/types/api.types'

/** The Feature flags page: the read-only flags inspector. */
export const Route = createFileRoute('/_app/settings/platform/flags')({
  validateSearch: flagsList.schema,
  // The evaluate form's default app is no part of a list's view, so a list write never puts it in the URL.
  search: { middlewares: [stripSearchParams({ app: 'react' })] },
  loaderDeps: ({ search }) => ({
    registry: listRequest(flagsList, listValues(flagsList, search)),
    unregistered: listRequest(unregisteredFlagsList, listValues(unregisteredFlagsList, search)),
  }),
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(flagsMetaQueryOptions())
    void context.queryClient.prefetchQuery(flagsListOptions(deps.registry))
    void context.queryClient.prefetchQuery(flagsListOptions(FLAG_REGISTRY_READ, { total: false }))
    void context.queryClient.prefetchQuery(unregisteredFlagsListOptions(deps.unregistered))
  },
  head: () => ({ meta: [{ title: pageTitle('Feature flags') }] }),
  staticData: { crumb: 'Feature flags' },
  component: FlagsPage,
  pendingComponent: SettingsPagePending,
  /**
   * Kept out of a lazy chunk, as the router's default error screen is: a failed
   * fetch could not load it. Splitting it would also pull the error listener
   * out of the entry chunk (pnpm check:bundle).
   */
  codeSplitGroupings: [['component']],
  errorComponent: SettingsRouteError,
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

/** The evaluate panel; only its evaluation table waits for the registry read. */
function EvaluateSection({
  search,
  onSearchChange,
}: {
  search: ComponentProps<typeof FlagEvaluatePanel>['search']
  onSearchChange: ComponentProps<typeof FlagEvaluatePanel>['onSearchChange']
}) {
  const registry = useQuery(flagsListOptions(FLAG_REGISTRY_READ, { total: false }))
  return (
    <FlagEvaluatePanel
      search={search}
      onSearchChange={onSearchChange}
      registry={{
        rows: registry.data?.items,
        truncated: registry.data?.page.hasNext === true,
        isError: registry.isError,
        retry: () => void registry.refetch(),
      }}
    />
  )
}

/** The loaded page: notes on the snapshot, then each section. */
function FlagsContent({ meta, isAdmin }: { meta: FlagsMetaResponse; isAdmin: boolean }) {
  const now = useNow()
  // Not `Route.useSearch()` or `Route.useNavigate()`: this route module imports the error screen (route-error, then observability/errors), and a page chunk importing `Route` back from it makes Rolldown split the error listener out of the entry chunk (pnpm check:bundle).
  const search = useSearch({ from: '/_app/settings/platform/flags' })
  const navigate = useNavigate({ from: '/settings/platform/flags' })
  const registry = useListQuery(useListSearch(flagsList), flagsListOptions)
  const unregistered = useListQuery(
    useListSearch(unregisteredFlagsList),
    unregisteredFlagsListOptions
  )
  const { snapshot } = meta
  // A list refused after the page loaded (the role changed): one refusal for the page, as the meta read gives.
  if (isRoleDenied(registry.query.error) || isRoleDenied(unregistered.query.error)) {
    return <RoleDenied />
  }
  return (
    <>
      {!snapshot.enabled && <Note tone="passive">{FLAGS_NOT_CONFIGURED}</Note>}
      {snapshot.enabled && snapshot.stale && <Note tone="warning">{FLAGS_STALE_NOTE}</Note>}
      <FlagsSection id="flags-registered" title="Registered flags">
        <FlagRegistryTable query={registry} />
        {snapshot.fetchedAt !== null && (
          <p className="text-xs text-muted-foreground">
            Flag definitions last changed{' '}
            <time dateTime={snapshot.fetchedAt}>{relativeTime(snapshot.fetchedAt, now)}</time>.
            Rollouts are edited in PostHog.
          </p>
        )}
      </FlagsSection>
      <FlagsSection id="flags-evaluate" title="Evaluate">
        {isAdmin ? (
          <EvaluateSection
            search={search}
            // The panel leaves a choice out to clear it, so the user and tenant go before `next` is spread; both lists' params stay.
            onSearchChange={(next) =>
              void navigate({
                search: (prev) => ({ ...prev, userId: undefined, tenantId: undefined, ...next }),
                replace: true,
              })
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">Admins can evaluate flags for a user.</p>
        )}
      </FlagsSection>
      <FlagsSection id="flags-unregistered" title="In PostHog, not registered">
        <UnregisteredFlagsTable query={unregistered} />
      </FlagsSection>
      <FlagsSection id="flags-traits" title="Traits reference">
        <TraitsPanel traits={meta.traits} />
      </FlagsSection>
    </>
  )
}

/**
 * The flags inspector, read-only: every registered flag with its live
 * PostHog state, PostHog's unregistered flags, the traits a release
 * condition may use. For admins, any user's evaluation; other staff see
 * that it exists. Rollouts are edited in PostHog, never here. The meta read
 * gates the page: a refusal shows once for the whole page, and each list
 * shows its own states after that.
 */
function FlagsPage() {
  const meta = useQuery(flagsMetaQueryOptions())
  const isAdmin = platformRoleAtLeast(
    useAuthStore((state) => state.user?.platformRole),
    'admin'
  )
  return (
    <div className="grid gap-6">
      {meta.isError ? (
        isRoleDenied(meta.error) ? (
          <RoleDenied />
        ) : (
          <LoadError message={FLAGS_LIST_ERROR} onRetry={() => void meta.refetch()} />
        )
      ) : meta.data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <FlagsContent meta={meta.data} isAdmin={isAdmin} />
      )}
    </div>
  )
}
