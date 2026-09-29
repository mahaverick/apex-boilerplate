import { useId } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { shortDate } from '@/lib/format'
import type { PlatformStats } from '@/types/api.types'

// "Failed attempts", never "Failed": the API counts send attempts, and a mail retried then sent lands in both series.
const config = {
  sent: { label: 'Sent', color: 'var(--chart-1)' },
  failed: { label: 'Failed attempts', color: 'var(--chart-4)' },
} satisfies ChartConfig

/**
 * Daily send attempts, sent stacked under failed. The SVG is decorative for
 * assistive tech; the visually hidden table carries the same numbers.
 */
export function EmailsChart({ emails }: { emails: PlatformStats['emails'] }) {
  const titleId = useId()
  return (
    <Card>
      <figure aria-labelledby={titleId} className="m-0">
        <CardHeader>
          <CardTitle>
            <figcaption id={titleId}>Emails per day</figcaption>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="aspect-auto h-56 w-full" aria-hidden>
            <BarChart data={emails} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={shortDate}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="sent" stackId="emails" fill="var(--color-sent)" radius={[0, 0, 4, 4]} />
              <Bar
                dataKey="failed"
                stackId="emails"
                fill="var(--color-failed)"
                radius={[4, 4, 0, 0]}
              />
              <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
            </BarChart>
          </ChartContainer>
          <table className="sr-only">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Sent</th>
                <th scope="col">Failed attempts</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{shortDate(day.date)}</th>
                  <td>{day.sent}</td>
                  <td>{day.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </figure>
    </Card>
  )
}
