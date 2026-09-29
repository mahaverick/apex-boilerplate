import type { StatsRange } from '@/types/api.types'

/** How each window reads in the toggle, the KPI label and the empty states. */
export const RANGE_LABELS = {
  '7d': '7 days',
  '30d': '30 days',
} as const satisfies Record<StatsRange, string>
