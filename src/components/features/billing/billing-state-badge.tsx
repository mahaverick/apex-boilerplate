import { ToneBadge } from '@/components/features/tone-badge'
import { BILLING_STATE_BADGE } from '@/constants/billing-labels'
import type { BillingState } from '@/types/billing.types'

/**
 * A tenant's stored billing state as a badge in its shared tone. A tenant with
 * no billing record shows a dash, which a screen reader reads as "No billing".
 */
export function BillingStateBadge({ state }: { state: BillingState | null }) {
  if (state === null) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No billing</span>
      </span>
    )
  }
  const { label, tone } = BILLING_STATE_BADGE[state]
  return <ToneBadge tone={tone}>{label}</ToneBadge>
}
