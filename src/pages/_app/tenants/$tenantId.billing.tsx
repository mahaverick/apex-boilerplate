import { IconReceiptOff } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { BillingActionsMenu } from '@/components/features/billing/billing-actions-menu'
import { BillingEventsCard } from '@/components/features/billing/billing-events-card'
import { BillingHistoryCard } from '@/components/features/billing/billing-history-card'
import { BillingSubscriptionsCard } from '@/components/features/billing/billing-subscriptions-card'
import { GrantsCard } from '@/components/features/billing/grants-card'
import { HeldChargesCard } from '@/components/features/billing/held-charges-card'
import { InvoicesCard } from '@/components/features/billing/invoices-card'
import { RevokeGrantAction } from '@/components/features/billing/revoke-grant-dialog'
import { TaxDetailsCard } from '@/components/features/billing/tax-details-card'
import { TaxDocumentsCard } from '@/components/features/billing/tax-documents-card'
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
import { useNow } from '@/hooks/use-now'
import { codeFrom } from '@/lib/api-error'
import { billingActionsFor } from '@/lib/billing-actions'
import {
  billingHistoryList,
  staffPlansQueryOptions,
  staffTenantBillingQueryOptions,
} from '@/queries/billing-reads.queries'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformTenantDetail } from '@/types/api.types'
import { TENANT_BILLING_NOT_FOUND, type StaffTenantBilling } from '@/types/billing.types'

/** A tenant's Billing tab: its plan and state, usage, grants, and its billing lists. */
export const Route = createFileRoute('/_app/tenants/$tenantId/billing')({
  // One schema for the tab's three URL lists, each under its own prefix.
  validateSearch: billingHistoryList.schema,
  // Started, not awaited: the tab renders its skeleton while these run.
  loader: ({ context, params, preload }) => {
    void context.queryClient.prefetchQuery(staffPlansQueryOptions())
    // Express audits every billing read as `billing.viewed`, so a hover preload must not read it.
    if (preload) return
    void context.queryClient.prefetchQuery(staffTenantBillingQueryOptions(params.tenantId))
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
 * succeeded, since they answer the same 404s. The skeleton stays until the
 * tenant's detail has loaded as well: every date reads in its time zone, so
 * a date shown before it could name a different day.
 */
function TenantBillingTab() {
  const { tenantId } = Route.useParams()
  const billing = useQuery(staffTenantBillingQueryOptions(tenantId))
  // The layout reads the detail too; its time zone dates every row, so no date shows before it.
  const tenant = useQuery(platformTenantQueryOptions(tenantId)).data
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
      {(data) =>
        tenant === undefined ? (
          <BillingSkeleton />
        ) : (
          <TenantBilling tenantId={tenantId} tenant={tenant} billing={data} />
        )
      }
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
 * The billing actions sit in the summary's header and on each active grant,
 * for the roles and states express accepts (`billingActionsFor`); they need
 * the tenant's name, slug and lifecycle state from its detail, which the
 * layout has already read. A viewer gets no actions and no actions column.
 * Every date reads in the tenant's `settings.timezone`, as react's billing
 * page and express's billing emails write it, so staff and the customer
 * name the same day.
 */
function TenantBilling({
  tenantId,
  tenant,
  billing,
}: {
  tenantId: string
  tenant: PlatformTenantDetail
  billing: StaffTenantBilling
}) {
  const plans = useQuery(staffPlansQueryOptions())
  const role = useAuthStore((s) => s.user?.platformRole)
  const heading = useRef<HTMLHeadingElement>(null)
  const now = useNow()
  const catalog = plans.data?.catalog ?? []
  const {
    revoke: canRevoke,
    taxDetails: canEditTax,
    creditNote: canCredit,
    resolveHeld: canResolve,
  } = billingActionsFor(role, tenant, billing, catalog, now)
  const labels = new Map(catalog.map((entry) => [entry.key, entry.label]))
  // Express and react date a tenant's billing in its zone.
  const timeZone = tenant.settings.timezone
  // No tax card, column or request while registration is off and the workspace has no documents.
  const showTax = billing.taxDocumentsEnabled || billing.hasTaxDocuments
  return (
    <div className="grid gap-6">
      <TenantBillingSummary
        billing={billing}
        plans={plans.data}
        timeZone={timeZone}
        headingRef={heading}
        actions={
          <BillingActionsMenu
            tenant={tenant}
            billing={billing}
            catalog={catalog}
            fallbackFocus={heading}
          />
        }
      />
      <TenantEntitlementsCard billing={billing} catalog={catalog} />
      <GrantsCard
        grants={billing.grants}
        catalog={catalog}
        timeZone={timeZone}
        actions={
          canRevoke
            ? (grant) => (
                <RevokeGrantAction
                  tenant={tenant}
                  grant={grant}
                  label={labels.get(grant.key) ?? grant.key}
                  fallbackFocus={heading}
                />
              )
            : undefined
        }
      />
      <BillingHistoryCard tenantId={tenantId} timeZone={timeZone} />
      <BillingEventsCard tenantId={tenantId} timeZone={timeZone} />
      <BillingSubscriptionsCard tenantId={tenantId} timeZone={timeZone} />
      <InvoicesCard
        tenantId={tenantId}
        paymentsEnabled={billing.paymentsEnabled}
        provider={billing.provider}
        timeZone={timeZone}
        taxColumn={showTax}
      />
      {showTax && <TaxDetailsCard tenant={tenant} billing={billing} canEdit={canEditTax} />}
      {showTax && (
        <TaxDocumentsCard
          tenant={tenant}
          provider={billing.provider}
          canCredit={canCredit}
          timeZone={timeZone}
        />
      )}
      {(billing.hasHeldCharges || billing.taxDocumentsEnabled) && (
        <HeldChargesCard tenant={tenant} canResolve={canResolve} />
      )}
    </div>
  )
}
