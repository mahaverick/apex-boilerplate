import { createFileRoute } from '@tanstack/react-router'
import { BillingAlertsTable } from '@/components/features/billing/billing-alerts-table'
import { PlatformNotFound } from '@/components/features/platform-not-found'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { billingAlertsListOptions } from '@/queries/billing-admin.queries'
import { billingAlertsList } from '@/queries/billing-reads.queries'
import { useAuthStore } from '@/states/auth.store'

/** The Billing alerts page: every alert express raised about billing, for platform admins. */
export const Route = createFileRoute('/_app/billing-alerts')({
  validateSearch: billingAlertsList.schema,
  head: () => ({ meta: [{ title: pageTitle('Billing alerts') }] }),
  staticData: { crumb: 'Billing alerts' },
  component: BillingAlertsPage,
})

/**
 * Every billing alert, searched, sorted and paged in the URL. The table
 * shows a 404 (the reader was demoted since the profile loaded) as the
 * role-denied state.
 */
function BillingAlerts() {
  const list = useListSearch(billingAlertsList)
  const query = useListQuery(list, billingAlertsListOptions)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Billing alerts</h1>
        </CardTitle>
        <CardDescription>
          What the billing jobs and the payment provider reported, across all tenants, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BillingAlertsTable
          query={query}
          empty={<EmptyState size="compact" title="No billing alerts." />}
        />
      </CardContent>
    </Card>
  )
}

/** Below platform admin the API answers 404, so the page says the same without asking. */
function BillingAlertsPage() {
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  return platformRoleAtLeast(platformRole, 'admin') ? <BillingAlerts /> : <PlatformNotFound />
}
