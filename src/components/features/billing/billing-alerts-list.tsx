import { BillingAlertsTable } from '@/components/features/billing/billing-alerts-table'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { billingAlertsListOptions } from '@/queries/billing-admin.queries'
import { billingAlertsList } from '@/queries/billing-reads.queries'

/**
 * Every billing alert, searched, sorted and paged in the URL, as the
 * Billing alerts page shows it. The table shows a 404 (the reader was
 * demoted since the profile loaded) as the role-denied state. It lives
 * outside the route file so the route imports only `billing-reads`, as
 * the other billing routes do.
 */
export function BillingAlertsList() {
  const list = useListSearch(billingAlertsList)
  const query = useListQuery(list, billingAlertsListOptions)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Billing alerts</h1>
        </CardTitle>
        <CardDescription>
          What the billing jobs and the payment provider reported, across all tenants.
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
