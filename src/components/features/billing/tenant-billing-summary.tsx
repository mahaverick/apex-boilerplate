import { IconCopy } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { BillingStateBadge } from '@/components/features/billing/billing-state-badge'
import { ToneBadge } from '@/components/features/tone-badge'
import { copyId } from '@/components/shared/command-palette/copy-id'
import { Note } from '@/components/shared/note'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { providerLabel } from '@/constants/billing-labels'
import { useNow } from '@/hooks/use-now'
import { formatDate } from '@/lib/format'
import { formatInr } from '@/lib/money'
import { absoluteTime, relativeTime } from '@/lib/relative-time'
import type { StaffPlans, StaffTenantBilling } from '@/types/billing.types'

/** What staff read when payments are off on the server. */
const PAYMENTS_OFF_NOTE =
  'Payments are off on this server. The plan and dates show what is stored; nothing can be charged or synced.'

/**
 * A date in the reader's locale, or a fallback for a value that is not a date.
 * @param iso - An ISO timestamp.
 */
function day(iso: string): string {
  return formatDate(iso, 'medium') ?? 'an unknown date'
}

/**
 * The price line: "₹999 per month", marked when the plans list that price as
 * retired. Without the plans the mark is left off rather than guessed.
 * @param billing - The tenant's billing.
 * @param plans - The staff plans, if they loaded.
 */
function priceText(billing: StaffTenantBilling, plans: StaffPlans | undefined): string {
  const { price } = billing
  if (price === null) return 'None'
  const per = price.interval === 'year' ? 'per year' : 'per month'
  const listed = plans?.plans.flatMap((plan) => plan.prices).find((p) => p.id === price.id)
  const retired = listed !== undefined && !listed.active
  return `${formatInr(price.amountMinor)} ${per}${retired ? ' (retired price)' : ''}`
}

/**
 * The failed payment line: when it failed, and when Paid ends, or that the
 * provider is still retrying while there is no end yet.
 * @param pastDue - The tenant's failed payment.
 */
function pastDueText(pastDue: NonNullable<StaffTenantBilling['pastDue']>): string {
  const ends =
    pastDue.graceEndsAt === null
      ? 'The payment provider is still retrying.'
      : `Paid ends on ${day(pastDue.graceEndsAt)}.`
  return `Payment failed on ${day(pastDue.since)}. ${ends}${pastDue.paused ? ' Subscription paused.' : ''}`
}

/** One subscription id row: the id in monospace and a button that copies it. */
function SubscriptionIdRow({ label, id }: { label: string; id: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="break-all">{id}</code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
          onClick={() => copyId(id, `${label} copied.`)}
        >
          <IconCopy aria-hidden="true" />
        </Button>
      </dd>
    </>
  )
}

/**
 * A tenant's billing at a glance: plan and state, price, dates, a failed
 * payment, the payer, the provider and its subscription ids, and the last
 * sync. With payments off it says so and shows no provider ids, since none
 * can be acted on. The billing email is owner-only, so staff never see one.
 * `actions` is the header's slot for the billing actions a role may take.
 */
export function TenantBillingSummary({
  billing,
  plans,
  actions,
}: {
  billing: StaffTenantBilling
  /** The staff plans, for the retired-price mark; absent while they load or if they failed. */
  plans: StaffPlans | undefined
  actions?: ReactNode
}) {
  const now = useNow()
  const showIds = billing.paymentsEnabled
  const ids = [
    ['Subscription ID', billing.providerSubscriptionId],
    ['Pending subscription ID', billing.pendingSubscriptionId],
    ['Next subscription ID', billing.nextSubscriptionId],
  ] as const
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Billing</h2>
        </CardTitle>
        {actions !== undefined && <CardAction>{actions}</CardAction>}
      </CardHeader>
      <CardContent className="grid gap-4">
        {!billing.paymentsEnabled && <Note tone="info">{PAYMENTS_OFF_NOTE}</Note>}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {billing.plan.name}
            <BillingStateBadge state={billing.state} />
            {billing.disputeOpen && <ToneBadge tone="destructive">Dispute open</ToneBadge>}
          </dd>
          <dt className="text-muted-foreground">Price</dt>
          <dd>{priceText(billing, plans)}</dd>
          {billing.trialEndsAt !== null && (
            <>
              <dt className="text-muted-foreground">Trial ends</dt>
              <dd>{day(billing.trialEndsAt)}</dd>
            </>
          )}
          {billing.currentPeriodEnd !== null && (
            <>
              <dt className="text-muted-foreground">
                {billing.cancelAtPeriodEnd ? 'Cancels on' : 'Paid until'}
              </dt>
              <dd>{day(billing.currentPeriodEnd)}</dd>
            </>
          )}
          {billing.nextSwitch !== null && (
            <>
              <dt className="text-muted-foreground">Next switch</dt>
              <dd>
                Switches to {billing.nextSwitch.interval === 'year' ? 'yearly' : 'monthly'} billing
                on {day(billing.nextSwitch.startsAt)}
              </dd>
            </>
          )}
          {billing.pastDue !== null && (
            <>
              <dt className="text-muted-foreground">Failed payment</dt>
              <dd>{pastDueText(billing.pastDue)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Payer</dt>
          <dd>
            {billing.payer === null ? (
              'None'
            ) : (
              <>
                <Pii>{billing.payer.name}</Pii>
                {!billing.payer.isMember && ' (left the workspace)'}
              </>
            )}
          </dd>
          <dt className="text-muted-foreground">Payment provider</dt>
          <dd>
            {billing.provider === null
              ? 'None'
              : providerLabel(billing.provider, billing.providerMode)}
          </dd>
          {showIds &&
            ids.map(([label, id]) =>
              id === null ? null : <SubscriptionIdRow key={label} label={label} id={id} />
            )}
          <dt className="text-muted-foreground">Last synced</dt>
          <dd>
            {billing.syncedAt === null ? (
              'Never'
            ) : (
              <time dateTime={billing.syncedAt} title={absoluteTime(billing.syncedAt)}>
                {relativeTime(billing.syncedAt, now)}
              </time>
            )}
          </dd>
        </dl>
      </CardContent>
    </Card>
  )
}
