import { RANGE_LABELS } from '@/components/features/overview/range'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatShare } from '@/lib/format'
import type { PlatformStats } from '@/types/api.types'

/**
 * The window's undelivered share, over the emails that left our server: sent,
 * delivered, undelivered and complained. Suppressed emails never left, so they
 * are not in it. Each email counts once, by its current status, so the figure
 * means the same with or without a provider webhook.
 * @param days - The daily message counts.
 * @returns The tile's value and its note; "—" and "No emails sent" for an empty window.
 */
function undeliveredRate(days: PlatformStats['emailMessages']): { value: string; note: string } {
  const undelivered = days.reduce((sum, day) => sum + day.undelivered, 0)
  const left = days.reduce(
    (sum, day) => sum + day.sent + day.delivered + day.undelivered + day.complained,
    0
  )
  if (left === 0) return { value: '—', note: 'No emails sent' }
  return {
    value: formatShare(undelivered, left),
    note: `${undelivered.toLocaleString('en-US')} of ${left.toLocaleString('en-US')} emails that left our server`,
  }
}

/** The Overview's headline numbers. Totals are live; the undelivered rate covers the window. */
export function KpiCards({ stats }: { stats: PlatformStats }) {
  const rate = undeliveredRate(stats.emailMessages)
  const cards = [
    {
      label: 'Tenants',
      value: stats.totals.tenants.toLocaleString('en-US'),
      note: 'Live customer tenants',
    },
    { label: 'Users', value: stats.totals.users.toLocaleString('en-US'), note: 'Active accounts' },
    {
      label: 'Staff',
      value: stats.totals.staff.toLocaleString('en-US'),
      note: 'Platform team members',
    },
    { label: `Undelivered rate (${RANGE_LABELS[stats.range]})`, ...rate },
  ]
  return (
    <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
