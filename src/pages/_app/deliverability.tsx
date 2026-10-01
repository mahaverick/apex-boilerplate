import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { BreakdownCard } from '@/components/features/deliverability/breakdown-card'
import { DeliverabilityKpis } from '@/components/features/deliverability/deliverability-kpis'
import { NoProviderEvents } from '@/components/features/deliverability/no-provider-events'
import { LoadError } from '@/components/features/load-error'
import { EmailsChart } from '@/components/features/overview/emails-chart'
import { RANGE_LABELS } from '@/components/features/overview/range'
import { RoleDenied } from '@/components/features/role-denied'
import { WidgetBoundary } from '@/components/features/widget-boundary'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pageTitle } from '@/constants/app'
import { templateLabel } from '@/constants/email.constants'
import { emailHealthQueryOptions } from '@/queries/email.queries'
import { isRoleDenied, STATS_RANGES } from '@/queries/platform.queries'

export const Route = createFileRoute('/_app/deliverability')({
  validateSearch: z.object({ range: z.enum(STATS_RANGES).default('7d').catch('7d') }),
  loaderDeps: ({ search }) => ({ range: search.range }),
  // Started, not awaited: the page renders its skeletons while this runs.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(emailHealthQueryOptions(deps.range))
  },
  head: () => ({ meta: [{ title: pageTitle('Deliverability') }] }),
  staticData: { crumb: 'Deliverability' },
  component: DeliverabilityPage,
})

/** The loaded layout's shape: seven figures, the chart, then the two tables. */
function DeliverabilitySkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6].map((card) => (
          <Skeleton key={card} className="h-30 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-74 rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </>
  )
}

/**
 * Email health for a window kept in the URL, as on the Overview. One request
 * feeds every widget: one skeleton, one page-level error or role-denied
 * state, and `WidgetBoundary` around each widget for a render error.
 */
function DeliverabilityPage() {
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const health = useQuery(emailHealthQueryOptions(range))

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Deliverability</h1>
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
      {health.isError ? (
        isRoleDenied(health.error) ? (
          <RoleDenied />
        ) : (
          <LoadError
            message="We could not load the deliverability figures."
            onRetry={() => void health.refetch()}
          />
        )
      ) : health.data === undefined ? (
        <DeliverabilitySkeleton />
      ) : (
        <div className="grid gap-6" aria-busy={health.isPlaceholderData}>
          {health.data.totals.providerEvents === 0 && <NoProviderEvents />}
          <WidgetBoundary name="Deliverability figures">
            <DeliverabilityKpis health={health.data} />
          </WidgetBoundary>
          <WidgetBoundary name="Emails per day">
            <EmailsChart days={health.data.days} range={health.data.range} />
          </WidgetBoundary>
          <div className="grid gap-4 xl:grid-cols-2">
            <WidgetBoundary name="By template">
              <BreakdownCard
                title="By template"
                keyHeader="Template"
                rows={health.data.byTemplate}
                labelOf={templateLabel}
              />
            </WidgetBoundary>
            <WidgetBoundary name="By recipient domain">
              <BreakdownCard
                title="Top recipient domains"
                keyHeader="Domain"
                rows={health.data.byDomain}
                labelOf={(key) => key}
              />
            </WidgetBoundary>
          </div>
        </div>
      )}
    </div>
  )
}
