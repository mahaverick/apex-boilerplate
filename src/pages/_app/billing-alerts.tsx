import { createFileRoute } from '@tanstack/react-router'
import { BillingAlertsList } from '@/components/features/billing/billing-alerts-list'
import { PlatformNotFound } from '@/components/features/platform-not-found'
import { pageTitle } from '@/constants/app'
import { platformRoleAtLeast } from '@/constants/roles'
import { billingAlertsList } from '@/queries/billing-reads.queries'
import { useAuthStore } from '@/states/auth.store'

/** The Billing alerts page: every alert express raised about billing, for platform admins. */
export const Route = createFileRoute('/_app/billing-alerts')({
  validateSearch: billingAlertsList.schema,
  head: () => ({ meta: [{ title: pageTitle('Billing alerts') }] }),
  staticData: { crumb: 'Billing alerts' },
  component: BillingAlertsPage,
})

/** Below platform admin the API answers 404, so the page says the same without asking. */
function BillingAlertsPage() {
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  return platformRoleAtLeast(platformRole, 'admin') ? <BillingAlertsList /> : <PlatformNotFound />
}
