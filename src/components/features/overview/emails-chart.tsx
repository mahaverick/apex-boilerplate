import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import { ChartCard } from '@/components/features/overview/chart-card'
import { RANGE_LABELS } from '@/components/features/overview/range'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { EMAIL_GROUPS } from '@/constants/email.constants'
import { shortDate } from '@/lib/format'
import { EMAIL_GROUP_KEYS, type EmailMessageDay, type StatsRange } from '@/types/api.types'

/**
 * Daily emails in five disjoint groups by current status, stacked: each email
 * is in exactly one bar segment, so a day's stack is that day's emails. The
 * SVG is decorative for assistive tech; the visually hidden table carries the
 * same numbers.
 */
export function EmailsChart({ days, range }: { days: EmailMessageDay[]; range: StatsRange }) {
  const empty = days.every((day) => EMAIL_GROUP_KEYS.every((group) => day[group] === 0))
  return (
    <ChartCard
      title="Emails per day"
      empty={empty ? `No emails in the last ${RANGE_LABELS[range]}` : null}
    >
      <ChartContainer config={EMAIL_GROUPS} className="aspect-auto h-56 w-full" aria-hidden>
        <BarChart data={days} margin={{ left: 12, right: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={shortDate}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {EMAIL_GROUP_KEYS.map((group) => (
            <Bar key={group} dataKey={group} stackId="emails" fill={`var(--color-${group})`} />
          ))}
          <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">Day</th>
            {EMAIL_GROUP_KEYS.map((group) => (
              <th key={group} scope="col">
                {EMAIL_GROUPS[group].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{shortDate(day.date)}</th>
              {EMAIL_GROUP_KEYS.map((group) => (
                <td key={group}>{day[group]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
