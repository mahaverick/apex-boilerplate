import { IconChecklist } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { FunnelCard } from '@/components/features/onboarding/funnel-card'
import { OnboardingKpis } from '@/components/features/onboarding/onboarding-kpis'
import { OnboardingTenantsTable } from '@/components/features/onboarding/onboarding-tenants-table'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { DashboardPending } from '@/components/shared/pending-templates'
import { QueryState } from '@/components/shared/query-state'
import { SectionBoundary } from '@/components/shared/section-boundary'
import { KpiCardSkeleton } from '@/components/shared/section-skeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pageTitle } from '@/constants/app'
import {
  ONBOARDING_NOT_STARTED,
  ONBOARDING_RANGE_LABELS,
  ONBOARDING_TAB_LABELS,
} from '@/constants/onboarding.constants'
import { isRoleDenied } from '@/lib/role-denied'
import { analyticsKey, track } from '@/observability/telemetry'
import {
  onboardingFunnelQueryOptions,
  onboardingTenantsList,
  onboardingTenantsListOptions,
} from '@/queries/onboarding.queries'
import { listRequest, listValues } from '@/schemas/list-request.schemas'
import {
  ONBOARDING_LIST_STATES,
  ONBOARDING_RANGES,
  type OnboardingListState,
} from '@/types/api.types'

/** This list, as `table_filtered` names it. */
const TABLE = analyticsKey('onboarding_tenants')

/** The Onboarding page: the activation funnel and the tracked tenants by state. */
export const Route = createFileRoute('/_app/onboarding')({
  validateSearch: onboardingTenantsList.schema,
  // The default range and tab stay out of the URL, so a list write that spreads the search does not write them back.
  search: { middlewares: [stripSearchParams({ range: '30d', state: 'stuck' })] },
  loaderDeps: ({ search }) => ({
    range: search.range,
    state: search.state,
    request: listRequest(onboardingTenantsList, listValues(onboardingTenantsList, search)),
  }),
  // Started, not awaited: the page renders its skeletons while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(onboardingFunnelQueryOptions(deps.range))
    void context.queryClient.prefetchQuery(onboardingTenantsListOptions(deps.state, deps.request))
  },
  head: () => ({ meta: [{ title: pageTitle('Onboarding') }] }),
  staticData: { crumb: 'Onboarding' },
  component: OnboardingPage,
  pendingComponent: DashboardPending,
})

/** What each tab says when no tenant is in its state. */
const EMPTY_TAB: Record<OnboardingListState, { title: string; description: string }> = {
  stuck: {
    title: 'No tenant is stuck.',
    description: 'A tenant appears here once it goes a while without progress.',
  },
  in_progress: {
    title: 'No tenant is in progress.',
    description: 'Tenants appear here while they work through their steps.',
  },
  awaiting_owner: {
    title: 'No tenant is waiting for its owner.',
    description: 'A tenant staff created appears here until its owner accepts.',
  },
  complete: {
    title: 'No tenant has finished yet.',
    description: 'A tenant appears here once every required step is done.',
  },
  dismissed: {
    title: 'No tenant has dismissed its checklist.',
    description: 'An owner can hide the checklist before finishing it.',
  },
}

/** Whether a tab value names one of the list states. */
function isListState(value: unknown): value is OnboardingListState {
  return (ONBOARDING_LIST_STATES as readonly unknown[]).includes(value)
}

/** The funnel's loaded shape: five figures at their loaded height, then a block at about the funnel card's height. */
function FunnelSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((card) => (
          <KpiCardSkeleton key={card} height="11rem" />
        ))}
      </div>
      <Skeleton className="h-78 rounded-xl" />
    </>
  )
}

/**
 * Onboarding across every active tenant: the funnel for a window kept in the
 * URL, and the tracked tenants by state, as tabs in `?state` (stuck first),
 * sorted, searched and paged through the shared list table. The tenants list is not windowed, so the
 * range never resets it. The funnel loads through `QueryState` and the
 * tenants start their own read with the page; a role refusal of the funnel
 * shows once, and until any tenant is tracked the page says only that.
 */
function OnboardingPage() {
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const funnel = useQuery(onboardingFunnelQueryOptions(range))

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Onboarding</h1>
        <ToggleGroup
          aria-label="Time range"
          value={[range]}
          onValueChange={(value: string[]) => {
            const next = ONBOARDING_RANGES.find((option) => value.includes(option))
            if (next) void navigate({ search: (prev) => ({ ...prev, range: next }), replace: true })
          }}
        >
          {ONBOARDING_RANGES.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {ONBOARDING_RANGE_LABELS[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <QueryState
        query={funnel}
        name="Onboarding"
        errorMessage="We could not load the onboarding figures."
        skeleton={<FunnelSkeleton />}
        isEmpty={(data) => data.trackedTenants === 0}
        empty={
          <EmptyState
            icon={<IconChecklist aria-hidden="true" />}
            title="No tenant is tracked yet."
            description={ONBOARDING_NOT_STARTED}
          />
        }
        className="gap-6"
      >
        {(data) => (
          <>
            <SectionBoundary name="Onboarding figures">
              <OnboardingKpis funnel={data} />
            </SectionBoundary>
            <SectionBoundary name="Onboarding funnel">
              <FunnelCard funnel={data} />
            </SectionBoundary>
          </>
        )}
      </QueryState>
      {!(funnel.isError && isRoleDenied(funnel.error)) && funnel.data?.trackedTenants !== 0 && (
        <TenantsByState />
      )}
    </div>
  )
}

/**
 * The tracked tenants, one tab per state. Changing tab drops the cursor: it
 * belongs to the list it was cut from. The tab list scrolls in a box of its
 * own: the list centres its tabs, and an overflowing centred row clips its
 * first tab where no scroll reaches.
 */
function TenantsByState() {
  const { state } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <section aria-labelledby="onboarding-tenants" className="grid gap-3">
      <h2 id="onboarding-tenants" className="text-lg font-semibold">
        Tenants
      </h2>
      <Tabs
        className="min-w-0"
        value={state}
        onValueChange={(next: unknown) => {
          if (!isListState(next)) return
          track('table_filtered', { table: TABLE })
          // A cursor belongs to its tab; the search and the sort carry over.
          void navigate({
            search: (prev) => ({ ...prev, state: next, cursor: undefined, direction: undefined }),
          })
        }}
      >
        <div className="max-w-full overflow-x-auto">
          <TabsList aria-label="Onboarding states">
            {ONBOARDING_LIST_STATES.map((value) => (
              <TabsTrigger key={value} value={value}>
                {ONBOARDING_TAB_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {ONBOARDING_LIST_STATES.map((value) => (
          <TabsContent key={value} value={value} className="pt-2">
            {value === state && <TenantsPanel state={value} />}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  )
}

/** One state's tenants, through the shared list table. */
function TenantsPanel({ state }: { state: OnboardingListState }) {
  const list = useListSearch(onboardingTenantsList)
  const query = useListQuery(list, (request) => onboardingTenantsListOptions(state, request))
  return (
    <OnboardingTenantsTable
      state={state}
      query={query}
      empty={
        <EmptyState
          icon={<IconChecklist aria-hidden="true" />}
          title={EMPTY_TAB[state].title}
          description={EMPTY_TAB[state].description}
        />
      }
    />
  )
}
