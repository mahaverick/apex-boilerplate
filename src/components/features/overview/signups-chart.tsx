import { useId } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
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

const config = {
  users: { label: 'Users', color: 'var(--chart-1)' },
  tenants: { label: 'Tenants', color: 'var(--chart-2)' },
} satisfies ChartConfig

/**
 * Daily user and tenant sign-ups. The SVG is decorative for assistive tech;
 * the visually hidden table carries the same numbers.
 */
export function SignupsChart({ signups }: { signups: PlatformStats['signups'] }) {
  const titleId = useId()
  return (
    <Card>
      <figure aria-labelledby={titleId} className="m-0">
        <CardHeader>
          <CardTitle>
            <figcaption id={titleId}>Sign-ups per day</figcaption>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="aspect-auto h-56 w-full" aria-hidden>
            <AreaChart data={signups} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={shortDate}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="users"
                type="monotone"
                stroke="var(--color-users)"
                fill="var(--color-users)"
                fillOpacity={0.2}
              />
              <Area
                dataKey="tenants"
                type="monotone"
                stroke="var(--color-tenants)"
                fill="var(--color-tenants)"
                fillOpacity={0.2}
              />
              <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
            </AreaChart>
          </ChartContainer>
          <table className="sr-only">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Users</th>
                <th scope="col">Tenants</th>
              </tr>
            </thead>
            <tbody>
              {signups.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{shortDate(day.date)}</th>
                  <td>{day.users}</td>
                  <td>{day.tenants}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </figure>
    </Card>
  )
}
