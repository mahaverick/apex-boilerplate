import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { EmailsChart } from '@/components/features/overview/emails-chart'
import { KpiCards } from '@/components/features/overview/kpi-cards'
import { RANGE_LABELS } from '@/components/features/overview/range'
import { SignupsChart } from '@/components/features/overview/signups-chart'
import { SystemStatusCard } from '@/components/features/overview/system-status-card'
import { DashboardPending } from '@/components/shared/pending-templates'
import { QueryState } from '@/components/shared/query-state'
import { SectionBoundary } from '@/components/shared/section-boundary'
import { KpiCardSkeleton } from '@/components/shared/section-skeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { platformStatsQueryOptions, STATS_RANGES } from '@/queries/platform.queries'
import { useAuthStore } from '@/states/auth.store'

/** The Overview page: platform figures for a time window kept in `?range`. */
export const Route = createFileRoute('/_app/overview')({
  validateSearch: z.object({ range: z.enum(STATS_RANGES).default('7d').catch('7d') }),
  loaderDeps: ({ search }) => ({ range: search.range }),
  // Started, not awaited: the page renders its skeletons while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(platformStatsQueryOptions(deps.range))
  },
  head: () => ({ meta: [{ title: pageTitle('Overview') }] }),
  staticData: { crumb: 'Overview' },
  component: OverviewPage,
  pendingComponent: DashboardPending,
})

/** The loaded layout's shape: five KPI cards at their loaded height, then two chart blocks at about the loaded charts' height. */
function OverviewSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((card) => (
          <KpiCardSkeleton key={card} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </>
  )
}

/**
 * The staff Overview. The window lives in the URL, so a view can be shared.
 * One request feeds every figure and chart, through `QueryState`: one
 * skeleton shaped like the loaded layout and one page-level error or
 * role-denied state; `SectionBoundary` isolates each widget's render error.
 * Admins also get the system status card, which has its own request and its
 * own states.
 */
function OverviewPage() {
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const stats = useQuery(platformStatsQueryOptions(range))
  const isAdmin = platformRoleAtLeast(
    useAuthStore((state) => state.user?.platformRole),
    'admin'
  )

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <ToggleGroup
          aria-label="Time range"
          value={[range]}
          onValueChange={(value: string[]) => {
            const next = STATS_RANGES.find((option) => value.includes(option))
            if (next) void navigate({ search: { range: next }, replace: true })
          }}
        >
          {STATS_RANGES.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {RANGE_LABELS[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <QueryState
        query={stats}
        name="Platform figures"
        errorMessage="We could not load the platform figures."
        skeleton={<OverviewSkeleton />}
        className="gap-6"
      >
        {(data) => (
          <>
            <SectionBoundary name="Key figures">
              <KpiCards stats={data} />
            </SectionBoundary>
            <div className="grid gap-4 xl:grid-cols-2">
              <SectionBoundary name="Sign-ups">
                <SignupsChart signups={data.signups} range={data.range} />
              </SectionBoundary>
              <SectionBoundary name="Emails">
                <EmailsChart days={data.emailMessages} range={data.range} />
              </SectionBoundary>
            </div>
          </>
        )}
      </QueryState>
      {isAdmin && (
        <SectionBoundary name="System status">
          <SystemStatusCard />
        </SectionBoundary>
      )}
    </div>
  )
}
