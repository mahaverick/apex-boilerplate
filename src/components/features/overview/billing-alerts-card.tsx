import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTenant } from '@/components/features/billing/billing-alert-tenant'
import { LoadError } from '@/components/features/load-error'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { BILLING_ALERT_KIND_LABELS } from '@/constants/billing-labels'
import { ROUTES } from '@/constants/routes'
import { useNow } from '@/hooks/use-now'
import { relativeTime } from '@/lib/relative-time'
import { isRoleDenied } from '@/lib/role-denied'
import { billingAlertsListOptions } from '@/queries/billing-admin.queries'
import type { BillingAlert } from '@/types/billing.types'

/** How many alerts the card shows: the newest, with the rest on the full list. */
const CARD_ALERTS = 5

/**
 * The newest billing alerts, for platform admins (express's alerts route is
 * admin). Its own request and its own states: a 404 (the role changed since
 * the page loaded) hides the card, as the system status card does, and a
 * failure stays in the card with a retry.
 */
export function BillingAlertsCard() {
  const now = useNow()
  const alerts = useQuery(billingAlertsListOptions({ limit: CARD_ALERTS }, { total: false }))
  if (alerts.isError && isRoleDenied(alerts.error)) return null
  return (
    <section aria-labelledby="billing-alerts">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="billing-alerts">Billing alerts</h2>
          </CardTitle>
          <CardDescription>The newest {CARD_ALERTS}, newest first</CardDescription>
          <CardAction>
            <Link to={ROUTES.billingAlerts} className="text-sm underline underline-offset-4">
              Show all alerts
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          {alerts.isError ? (
            <LoadError
              message="We couldn’t load the billing alerts. Select Try again."
              onRetry={() => void alerts.refetch()}
            />
          ) : alerts.data === undefined ? (
            <CardRowsSkeleton rows={CARD_ALERTS} />
          ) : alerts.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No billing alerts.</p>
          ) : (
            <ul className="grid gap-3">
              {alerts.data.items.map((alert) => (
                <AlertRow key={alert.id} alert={alert} now={now} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

/** One alert: its kind, its tenant (a link to the tenant's Billing tab), when, then the message. */
function AlertRow({ alert, now }: { alert: BillingAlert; now: number }) {
  return (
    <li className="grid gap-1 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-medium">{BILLING_ALERT_KIND_LABELS[alert.kind]}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <AlertTenant tenant={alert.tenant} />
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <time dateTime={alert.at} className="text-muted-foreground">
          {relativeTime(alert.at, now)}
        </time>
      </div>
      <p className="wrap-break-word text-muted-foreground">{alert.message}</p>
    </li>
  )
}
