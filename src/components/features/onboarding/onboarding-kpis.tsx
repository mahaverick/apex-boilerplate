import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ONBOARDING_RANGE_LABELS } from '@/constants/onboarding.constants'
import { formatShare } from '@/lib/format'
import type { OnboardingFunnel } from '@/types/api.types'

/**
 * The funnel's headline figures, over the tenants that started onboarding in
 * the window: how many, and how they stand now. The four states add up to
 * the started count. The rate is worked out from the two counts shown beside
 * it, so it can never disagree with them; `completionRate` only says whether
 * there is one.
 */
export function OnboardingKpis({ funnel }: { funnel: OnboardingFunnel }) {
  const { totals } = funnel
  const { started } = totals
  const count = (value: number) => value.toLocaleString('en-US')
  const cards = [
    {
      label: `Started (${ONBOARDING_RANGE_LABELS[funnel.range]})`,
      value: count(started),
      note: 'Tenants whose onboarding began in the window',
    },
    { label: 'Completed', value: count(totals.complete), note: 'Every required step done' },
    {
      label: 'Completion rate',
      value:
        funnel.completionRate === null || started === 0
          ? '—'
          : formatShare(totals.complete, started),
      note:
        funnel.completionRate === null || started === 0
          ? 'No tenant started in the window'
          : `${count(totals.complete)} of ${count(started)} started tenants`,
    },
    { label: 'Stuck now', value: count(totals.stuck), note: 'No progress for a while' },
    { label: 'Dismissed', value: count(totals.dismissed), note: 'Hid the checklist unfinished' },
  ]
  return (
    <section
      aria-label="Onboarding figures"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
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
