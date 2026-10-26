import { useState } from 'react'
import { NewPriceDialog } from '@/components/features/billing/new-price-dialog'
import { ToneBadge } from '@/components/features/tone-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { billingDate } from '@/constants/billing-labels'
import { formatInr } from '@/lib/money'
import { INTERVAL_LABELS } from '@/lib/plan-editor'
import type { StaffPlan } from '@/types/billing.types'

/**
 * Paid's prices, active and retired, with how many tenants pay each. An
 * admin adds a price here; a new price retires the active one of its
 * interval, and subscribers keep the price they pay.
 */
export function PricesCard({
  plan,
  warnAboveMinor,
  canEdit,
}: {
  plan: StaffPlan
  /** The API's `priceWarningAboveMinor`: above it, each charge needs the customer's approval. */
  warnAboveMinor: number
  canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Prices</h2>
        </CardTitle>
        <CardDescription>
          Subscribers keep the price they pay. New subscribers pay the active price for their
          interval.
        </CardDescription>
        {canEdit && (
          <CardAction>
            <Button variant="outline" onClick={() => setOpen(true)}>
              New price
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {plan.prices.length === 0 ? (
          <EmptyState
            size="compact"
            title="No prices yet."
            description={`Tenants can’t subscribe to ${plan.name} until it has a price.`}
          />
        ) : (
          <Table aria-label="Prices">
            <TableCaption className="sr-only">Prices</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Interval</TableHead>
                <TableHead scope="col">Amount</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Subscribers</TableHead>
                <TableHead scope="col">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.prices.map((price) => (
                <TableRow key={price.id}>
                  <TableCell className="font-medium">{INTERVAL_LABELS[price.interval]}</TableCell>
                  <TableCell>{formatInr(price.amountMinor)}</TableCell>
                  <TableCell>
                    <ToneBadge tone={price.active ? 'success' : 'muted'}>
                      {price.active ? 'Active' : 'Retired'}
                    </ToneBadge>
                  </TableCell>
                  <TableCell>{price.subscribers.toLocaleString('en-IN')}</TableCell>
                  <TableCell>{billingDate(price.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {canEdit && (
        <NewPriceDialog
          plan={plan}
          warnAboveMinor={warnAboveMinor}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </Card>
  )
}
