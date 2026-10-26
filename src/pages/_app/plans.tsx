import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { BillingSettingsCard } from '@/components/features/billing/billing-settings-card'
import { PlanEditorCard } from '@/components/features/billing/plan-editor-card'
import { PricesCard } from '@/components/features/billing/prices-card'
import { DashboardPending } from '@/components/shared/pending-templates'
import { QueryState } from '@/components/shared/query-state'
import { SectionBoundary } from '@/components/shared/section-boundary'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import {
  billingSettingsQueryOptions,
  staffPlansQueryOptions,
} from '@/queries/billing-reads.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlanKey, StaffPlans } from '@/types/billing.types'

/** The Plans page: Free and Paid with their entitlements, Paid's prices, and the trial and grace rules. */
export const Route = createFileRoute('/_app/plans')({
  // Started, not awaited: the page renders its skeleton while this runs.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(staffPlansQueryOptions())
    void context.queryClient.prefetchQuery(billingSettingsQueryOptions())
  },
  head: () => ({ meta: [{ title: pageTitle('Plans') }] }),
  staticData: { crumb: 'Plans' },
  component: PlansPage,
  pendingComponent: DashboardPending,
})

/** Two plan cards side by side over the prices card, at about their loaded heights. */
function PlansSkeleton() {
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
      <Skeleton className="h-56 rounded-xl" />
    </>
  )
}

/**
 * Every staff role reads the plans (express's `GET /platform/plans` is a
 * viewer route); only an admin and up edits them, since every plan and
 * price write is admin. Below admin the edit controls are not rendered at
 * all. A 404 is a role refusal, which `QueryState` shows as `RoleDenied`.
 * The trial and grace card has its own read, so a plans failure leaves it up.
 */
function PlansPage() {
  const plans = useQuery(staffPlansQueryOptions())
  const canEdit = platformRoleAtLeast(
    useAuthStore((state) => state.user?.platformRole),
    'admin'
  )
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Plans</h1>
      <QueryState
        query={plans}
        name="Plans"
        errorMessage="We couldn’t load the plans. Select Try again."
        skeleton={<PlansSkeleton />}
        className="gap-6"
      >
        {(data) => <PlansContent plans={data} canEdit={canEdit} />}
      </QueryState>
      <SectionBoundary name="Trials and grace">
        <BillingSettingsCard canEdit={canEdit} />
      </SectionBoundary>
    </div>
  )
}

/** The cards' order: Free, then Paid, by name rather than by the alphabet. */
const PLAN_ORDER: readonly PlanKey[] = ['free', 'paid']

/**
 * Free's card, then Paid's, then Paid's prices. Express refuses a price on
 * Free, so only Paid has a prices card.
 */
function PlansContent({ plans, canEdit }: { plans: StaffPlans; canEdit: boolean }) {
  const ordered = [...plans.plans].sort(
    (a, b) => PLAN_ORDER.indexOf(a.key) - PLAN_ORDER.indexOf(b.key)
  )
  const paid = ordered.find((plan) => plan.key === 'paid')
  return (
    <>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {ordered.map((plan) => (
          <SectionBoundary key={plan.id} name={plan.name}>
            <PlanEditorCard plan={plan} catalog={plans.catalog} canEdit={canEdit} />
          </SectionBoundary>
        ))}
      </div>
      {paid !== undefined && (
        <SectionBoundary name="Prices">
          <PricesCard plan={paid} warnAboveMinor={plans.priceWarningAboveMinor} canEdit={canEdit} />
        </SectionBoundary>
      )}
    </>
  )
}
