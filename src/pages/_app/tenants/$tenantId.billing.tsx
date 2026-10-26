import { IconReceiptOff } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { BillingEventsCard } from '@/components/features/billing/billing-events-card'
import { BillingHistoryCard } from '@/components/features/billing/billing-history-card'
import { BillingSubscriptionsCard } from '@/components/features/billing/billing-subscriptions-card'
import { GrantsCard } from '@/components/features/billing/grants-card'
import { InvoicesCard } from '@/components/features/billing/invoices-card'
import { TenantBillingSummary } from '@/components/features/billing/tenant-billing-summary'
import { TenantEntitlementsCard } from '@/components/features/billing/tenant-entitlements-card'
import { EmptyState } from '@/components/shared/empty-state'
import { DetailTabPending } from '@/components/shared/pending-templates'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { codeFrom } from '@/lib/api-error'
import {
  billingHistoryList,
  staffPlansQueryOptions,
  staffTenantBillingQueryOptions,
} from '@/queries/billing-admin.queries'
import { TENANT_BILLING_NOT_FOUND, type StaffTenantBilling } from '@/types/billing.types'

/** A tenant's Billing tab: its plan and state, usage, grants, and its billing lists. */
export const Route = createFileRoute('/_app/tenants/$tenantId/billing')({
  // One schema for the tab's three URL lists, each under its own prefix.
  validateSearch: billingHistoryList.schema,
  // Started, not awaited: the tab renders its skeleton while these run.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(staffTenantBillingQueryOptions(params.tenantId))
    void context.queryClient.prefetchQuery(staffPlansQueryOptions())
  },
  head: () => ({ meta: [{ title: pageTitle('Tenant billing') }] }),
  staticData: { crumb: 'Billing' },
  component: TenantBillingTab,
  pendingComponent: DetailTabPending,
})

/**
 * One tenant's billing, from the platform reads, so it shows in every
 * lifecycle state. The platform tenant has no billing: express answers 404
 * `tenant_billing_not_found`, read here before `QueryState`, which would take
 * any 404 for a role refusal. The layout hides this tab for it, so only a
 * typed URL lands here. Any other 404 is a refusal (`RoleDenied`); the layout
 * handles an unknown tenant. The lists mount only once the billing read
 * succeeded, since they answer the same 404s.
 */
function TenantBillingTab() {
  const { tenantId } = Route.useParams()
  const billing = useQuery(staffTenantBillingQueryOptions(tenantId))
  if (billing.isError && codeFrom(billing.error) === TENANT_BILLING_NOT_FOUND) {
    return (
      <EmptyState
        icon={<IconReceiptOff aria-hidden="true" />}
        title={<h2>This tenant has no billing.</h2>}
        description="Only customer tenants have a plan. Open a customer tenant from Tenants."
        action={
          <Link to={ROUTES.tenants} className={buttonVariants({ variant: 'outline' })}>
            Back to tenants
          </Link>
        }
      />
    )
  }
  return (
    <QueryState
      query={billing}
      name="Billing"
      errorMessage="We couldn’t load this tenant’s billing. Select Try again."
      skeleton={<BillingSkeleton />}
    >
      {(data) => <TenantBilling tenantId={tenantId} billing={data} />}
    </QueryState>
  )
}

/** The Billing card while the read runs: a title bar over eight rows of 1.75rem, the height of a summary row. */
function BillingSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <CardRowsSkeleton rows={8} rowHeight="1.75rem" />
      </CardContent>
    </Card>
  )
}

/**
 * The tab's sections. The staff plans give the catalog's labels and the
 * retired-price mark; if they fail, rows show registry keys and no mark.
 * Read only: the billing actions are their own controls, in the summary's
 * header and on each active grant, for the roles that may use them.
 */
function TenantBilling({ tenantId, billing }: { tenantId: string; billing: StaffTenantBilling }) {
  const plans = useQuery(staffPlansQueryOptions())
  const catalog = plans.data?.catalog ?? []
  return (
    <div className="grid gap-6">
      <TenantBillingSummary billing={billing} plans={plans.data} />
      <TenantEntitlementsCard billing={billing} catalog={catalog} />
      <GrantsCard grants={billing.grants} catalog={catalog} />
      <BillingHistoryCard tenantId={tenantId} />
      <BillingEventsCard tenantId={tenantId} />
      <BillingSubscriptionsCard tenantId={tenantId} />
      <InvoicesCard tenantId={tenantId} paymentsEnabled={billing.paymentsEnabled} />
    </div>
  )
}
