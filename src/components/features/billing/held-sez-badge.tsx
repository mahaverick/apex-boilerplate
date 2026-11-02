import { ToneBadge } from '@/components/features/tone-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TAX_HELD_STATUS_BADGE } from '@/constants/billing-labels'

/** What "Held: SEZ" means, in the tooltip and in hidden text, since Base UI's tooltip is not announced. */
const HELD_SEZ_EXPLAINED =
  'The buyer is a Special Economic Zone (SEZ) unit, so staff issue its tax invoice by hand.'

/**
 * The "Held: SEZ" badge of a charge held for a Special Economic Zone unit,
 * with the acronym spelled out in a tooltip and in visually hidden text.
 */
export function HeldSezBadge() {
  const { label, tone } = TAX_HELD_STATUS_BADGE.open
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default">
        <ToneBadge tone={tone}>{label}</ToneBadge>
        <span className="sr-only"> {HELD_SEZ_EXPLAINED}</span>
      </TooltipTrigger>
      <TooltipContent>{HELD_SEZ_EXPLAINED}</TooltipContent>
    </Tooltip>
  )
}
