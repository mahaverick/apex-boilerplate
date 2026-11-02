import { absoluteTime } from '@/lib/relative-time'
import type { StatsRange } from '@/types/api.types'

/** How each window reads in the toggle, the KPI label and the empty states. */
export const RANGE_LABELS = {
  '7d': '7 days',
  '30d': '30 days',
} as const satisfies Record<StatsRange, string>

/**
 * A chart's description: its buckets and when its data was read.
 * @param asOf - When the query's data arrived (`dataUpdatedAt`), in epoch milliseconds.
 * @returns "Per UTC day. As of 2 November 2026 at 10:42 GMT+5:30."
 */
export function chartDescription(asOf: number): string {
  return `Per UTC day. As of ${absoluteTime(new Date(asOf).toISOString())}.`
}
