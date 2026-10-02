import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { LoadError } from '@/components/features/load-error'
import { FunnelCard } from '@/components/features/onboarding/funnel-card'
import { OnboardingKpis } from '@/components/features/onboarding/onboarding-kpis'
import { OnboardingTenantsTable } from '@/components/features/onboarding/onboarding-tenants-table'
import { RoleDenied } from '@/components/features/role-denied'
import { WidgetBoundary } from '@/components/features/widget-boundary'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pageTitle } from '@/constants/app'
import {
  ONBOARDING_NOT_STARTED,
  ONBOARDING_RANGE_LABELS,
  ONBOARDING_TAB_LABELS,
} from '@/constants/onboarding.constants'
import { statusFrom } from '@/lib/api-error'
import {
  onboardingFunnelQueryOptions,
  onboardingTenantsQueryOptions,
} from '@/queries/onboarding.queries'
import { onboardingSearchSchema } from '@/schemas/onboarding.schemas'
import {
  ONBOARDING_LIST_STATES,
  ONBOARDING_RANGES,
  type OnboardingListState,
  type PageDirection,
} from '@/types/api.types'

export const Route = createFileRoute('/_app/onboarding')({
  validateSearch: onboardingSearchSchema,
  loaderDeps: ({ search }) => search,
  // Started, not awaited: the page renders its skeletons while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(onboardingFunnelQueryOptions(deps.range))
    void context.queryClient.prefetchQuery(
      onboardingTenantsQueryOptions({
        state: deps.state,
        cursor: deps.cursor,
        direction: deps.dir,
      })
    )
  },
  head: () => ({ meta: [{ title: pageTitle('Onboarding') }] }),
  staticData: { crumb: 'Onboarding' },
  component: OnboardingPage,
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

function isListState(value: unknown): value is OnboardingListState {
  return (ONBOARDING_LIST_STATES as readonly unknown[]).includes(value)
}

/** The funnel's loaded shape: five figures, then the funnel card. */
function FunnelSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((card) => (
          <Skeleton key={card} className="h-30 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-74 rounded-xl" />
    </>
  )
}

/**
 * Onboarding across every active tenant: the funnel for a window kept in the
 * URL, and the tracked tenants by state, as tabs in `?state` (stuck first),
 * paged by `?cursor` and `?dir`. The tenants list is not windowed, so the
 * range never resets it. Until any tenant is tracked the page says only that.
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
      {funnel.isError ? (
        statusFrom(funnel.error) === 404 ? (
          <RoleDenied />
        ) : (
          <LoadError
            message="We could not load the onboarding figures."
            onRetry={() => void funnel.refetch()}
          />
        )
      ) : funnel.data === undefined ? (
        <FunnelSkeleton />
      ) : funnel.data.trackedTenants === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No tenant is tracked yet.</EmptyTitle>
            <EmptyDescription>{ONBOARDING_NOT_STARTED}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="grid gap-6" aria-busy={funnel.isPlaceholderData}>
            <WidgetBoundary name="Onboarding figures">
              <OnboardingKpis funnel={funnel.data} />
            </WidgetBoundary>
            <WidgetBoundary name="Onboarding funnel">
              <FunnelCard funnel={funnel.data} />
            </WidgetBoundary>
          </div>
          <TenantsByState />
        </>
      )}
    </div>
  )
}

/** The tracked tenants, one tab per state. Changing tab drops the cursor: it belongs to the list it was cut from. */
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
          void navigate({ search: (prev) => ({ range: prev.range, state: next }) })
        }}
      >
        {/* The list centres its tabs, so it scrolls inside a box of its own: an overflowing centred row would clip its first tab out of reach. */}
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

function TenantsPanel({ state }: { state: OnboardingListState }) {
  const { cursor, dir } = Route.useSearch()
  const navigate = Route.useNavigate()
  const page = useQuery(onboardingTenantsQueryOptions({ state, cursor, direction: dir }))

  function goTo(target: string | null, direction: PageDirection) {
    if (target) {
      void navigate({ search: (prev) => ({ ...prev, cursor: target, dir: direction }) })
    }
  }
  const firstPage = () =>
    void navigate({ search: (prev) => ({ range: prev.range, state: prev.state }) })

  // The previous page's rows stay up while the next loads; its "nothing here" would describe the wrong view.
  const settled =
    page.data !== undefined && !(page.isPlaceholderData && page.data.tenants.length === 0)

  if (page.isError) {
    return statusFrom(page.error) === 404 ? (
      <RoleDenied />
    ) : (
      <div className="grid justify-items-start gap-2">
        <LoadError message="We could not load these tenants." onRetry={() => void page.refetch()} />
        {cursor !== undefined && (
          <Button variant="ghost" size="sm" onClick={firstPage}>
            <ChevronLeft aria-hidden />
            First page
          </Button>
        )}
      </div>
    )
  }
  if (!settled || page.data === undefined) return <Skeleton className="h-64 w-full" />
  if (page.data.tenants.length === 0) {
    return cursor !== undefined ? (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing on this page.</EmptyTitle>
          <EmptyDescription>The list changed since this page was opened.</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={firstPage}>
          <ChevronLeft aria-hidden />
          First page
        </Button>
      </Empty>
    ) : (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{EMPTY_TAB[state].title}</EmptyTitle>
          <EmptyDescription>{EMPTY_TAB[state].description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="grid gap-2">
      <div aria-busy={page.isPlaceholderData} className="min-w-0">
        <OnboardingTenantsTable rows={page.data.tenants} state={state} />
      </div>
      <nav aria-label="Pagination" className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous page"
          disabled={page.data.prevCursor === null || page.isPlaceholderData}
          onClick={() => goTo(page.data?.prevCursor ?? null, 'prev')}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next page"
          disabled={page.data.nextCursor === null || page.isPlaceholderData}
          onClick={() => goTo(page.data?.nextCursor ?? null, 'next')}
        >
          <ChevronRight aria-hidden />
        </Button>
      </nav>
    </div>
  )
}
