import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import { ChartCard } from '@/components/features/overview/chart-card'
import { RANGE_LABELS } from '@/components/features/overview/range'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { shortDate } from '@/lib/format'
import type { PlatformStats, StatsRange } from '@/types/api.types'

const config = {
  users: { label: 'Users', color: 'var(--chart-1)' },
  tenants: { label: 'Tenants', color: 'var(--chart-2)' },
} satisfies ChartConfig

/**
 * Daily user and tenant sign-ups. The SVG is decorative for assistive tech;
 * the visually hidden table carries the same numbers.
 */
export function SignupsChart({
  signups,
  range,
}: {
  signups: PlatformStats['signups']
  range: StatsRange
}) {
  const empty = signups.every((day) => day.users === 0 && day.tenants === 0)
  return (
    <ChartCard
      title="Sign-ups per day"
      empty={empty ? `No sign-ups in the last ${RANGE_LABELS[range]}` : null}
    >
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
    </ChartCard>
  )
}
