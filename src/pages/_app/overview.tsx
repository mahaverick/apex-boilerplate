import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { EmailsChart } from '@/components/features/overview/emails-chart'
import { KpiCards } from '@/components/features/overview/kpi-cards'
import { RANGE_LABELS } from '@/components/features/overview/range'
import { SignupsChart } from '@/components/features/overview/signups-chart'
import { RoleDenied } from '@/components/features/role-denied'
import { WidgetBoundary } from '@/components/features/widget-boundary'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pageTitle } from '@/constants/app'
import { isRoleDenied, platformStatsQueryOptions, STATS_RANGES } from '@/queries/platform.queries'

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
})

/** The loaded layout's shape: five KPI cards, then two chart cards, so nothing jumps when the data lands. */
function OverviewSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((card) => (
          <Skeleton key={card} className="h-30 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-74 rounded-xl" />
        <Skeleton className="h-74 rounded-xl" />
      </div>
    </>
  )
}

/**
 * The staff Overview. The window lives in the URL, so a view can be shared.
 * One request feeds every widget, so there is one skeleton shaped like the
 * loaded layout and one page-level error or role-denied state; `WidgetBoundary`
 * isolates only a render error, per widget.
 */
function OverviewPage() {
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const stats = useQuery(platformStatsQueryOptions(range))

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
      {stats.isError ? (
        isRoleDenied(stats.error) ? (
          <RoleDenied />
        ) : (
          <LoadError
            message="We could not load the platform figures."
            onRetry={() => void stats.refetch()}
          />
        )
      ) : stats.data === undefined ? (
        <OverviewSkeleton />
      ) : (
        <div className="grid gap-6" aria-busy={stats.isPlaceholderData}>
          <WidgetBoundary name="Key figures">
            <KpiCards stats={stats.data} />
          </WidgetBoundary>
          <div className="grid gap-4 xl:grid-cols-2">
            <WidgetBoundary name="Sign-ups">
              <SignupsChart signups={stats.data.signups} range={stats.data.range} />
            </WidgetBoundary>
            <WidgetBoundary name="Emails">
              <EmailsChart days={stats.data.emailMessages} range={stats.data.range} />
            </WidgetBoundary>
          </div>
        </div>
      )}
    </div>
  )
}
