import { RANGE_LABELS } from '@/components/features/overview/range'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PlatformStats } from '@/types/api.types'

/**
 * Failed send attempts as a share of all attempts in the window, to two
 * decimals. Attempts, not emails: a mail retried and then sent is logged
 * once as failed and once as sent.
 * @param emails - The daily series.
 * @returns e.g. "0.03% of send attempts failed" ("<0.01%" when a failure rounds to zero), or
 *   "No send attempts" when there were none.
 */
function failureShare(emails: PlatformStats['emails']): string {
  const sent = emails.reduce((sum, day) => sum + day.sent, 0)
  const failed = emails.reduce((sum, day) => sum + day.failed, 0)
  const total = sent + failed
  if (total === 0) return 'No send attempts'
  const share = ((failed / total) * 100).toFixed(2)
  // A real failure never rounds away to "0.00%".
  const shown = failed > 0 && share === '0.00' ? '<0.01' : share
  return `${shown}% of send attempts failed`
}

/** The Overview's headline numbers. Totals are live; send attempts cover the window. */
export function KpiCards({ stats }: { stats: PlatformStats }) {
  const attempts = stats.emails.reduce((sum, day) => sum + day.sent + day.failed, 0)
  const cards = [
    { label: 'Tenants', value: stats.totals.tenants, note: 'Live customer tenants' },
    { label: 'Users', value: stats.totals.users, note: 'Active accounts' },
    { label: 'Staff', value: stats.totals.staff, note: 'Platform team members' },
    {
      label: `Send attempts (${RANGE_LABELS[stats.range]})`,
      value: attempts,
      note: failureShare(stats.emails),
    },
  ]
  return (
    <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {card.value.toLocaleString('en-US')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{card.note}</CardContent>
        </Card>
      ))}
    </section>
  )
}
