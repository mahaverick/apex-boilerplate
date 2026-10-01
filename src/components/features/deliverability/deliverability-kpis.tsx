import { RANGE_LABELS } from '@/components/features/overview/range'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatShare } from '@/lib/format'
import type { EmailHealth, EmailRate } from '@/types/api.types'

/** One rate tile: which rate, how it reads, and what its denominator counts. */
interface RateTile {
  key: keyof EmailHealth['rates']
  label: string
  /** Whether only provider webhook events can move it: `value` is null until one arrives. */
  providerDependent: boolean
  /** What the denominator counts, as the note names it. */
  of: string
  /** A sentence after the counts, for a rate that needs one. */
  caveat?: string
}

const APPROXIMATE =
  'Approximate: image blocking hides some opens, and mail privacy features open some emails on their own.'

const RATE_TILES: readonly RateTile[] = [
  {
    key: 'undeliveredRate',
    label: 'Undelivered rate',
    providerDependent: false,
    of: 'emails sent',
  },
  { key: 'deliveredRate', label: 'Delivered rate', providerDependent: true, of: 'emails sent' },
  { key: 'bounceRate', label: 'Hard bounce rate', providerDependent: true, of: 'emails sent' },
  { key: 'complaintRate', label: 'Complaint rate', providerDependent: true, of: 'emails sent' },
  {
    key: 'openRate',
    label: 'Open rate (approximate)',
    providerDependent: true,
    of: 'general-sender emails',
    caveat: APPROXIMATE,
  },
  {
    key: 'clickRate',
    label: 'Click rate (approximate)',
    providerDependent: true,
    of: 'general-sender emails',
    caveat:
      'Approximate, and general-sender emails only: tracking is off on the sender that carries sign-in links.',
  },
]

/**
 * A rate's value and note. The share is worked out from the numerator and
 * denominator the API sends, so it reads the same whatever unit `value` is
 * in; `value` itself only says whether the rate is known.
 * @param rate - The API's rate.
 * @param tile - How the tile reads.
 * @param providerEvents - Provider events received in the window.
 * @returns "—" with the reason when the rate is unknown, else the share and its counts.
 */
function rateText(
  rate: EmailRate,
  tile: RateTile,
  providerEvents: number
): { value: string; note: string } {
  if (rate.value === null || rate.denominator === 0) {
    return {
      value: '—',
      note:
        tile.providerDependent && providerEvents === 0
          ? 'No provider data'
          : 'No emails to measure in this window',
    }
  }
  const counts = `${rate.numerator.toLocaleString('en-US')} of ${rate.denominator.toLocaleString('en-US')} ${tile.of}`
  return {
    value: formatShare(rate.numerator, rate.denominator),
    note: tile.caveat === undefined ? counts : `${counts}. ${tile.caveat}`,
  }
}

/**
 * The Deliverability page's headline figures: how many emails left our
 * server in the window, and each rate over them with its denominator shown.
 * The undelivered rate needs no provider (failed sends alone count); the rest
 * read "No provider data" until a provider webhook has sent an event.
 */
export function DeliverabilityKpis({ health }: { health: EmailHealth }) {
  const { totals } = health
  const cards = [
    {
      label: `Emails sent (${RANGE_LABELS[health.range]})`,
      value: totals.messages.toLocaleString('en-US'),
      note: `${totals.suppressed.toLocaleString('en-US')} more suppressed, never sent`,
    },
    ...RATE_TILES.map((tile) => ({
      label: tile.label,
      ...rateText(health.rates[tile.key], tile, totals.providerEvents),
    })),
  ]
  return (
    <section
      aria-label="Deliverability figures"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{card.value}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{card.note}</CardContent>
        </Card>
      ))}
    </section>
  )
}
