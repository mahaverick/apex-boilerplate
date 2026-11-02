/** @file The system status card's error-tracking labels and refresh interval. */
import type { ErrorDropReason } from '@/types/api.types'

/**
 * Each drop reason as the status card names it, in display order. A batch is
 * dropped as `retry_exhausted` after express's `ERROR_RETRY_LIMIT` (5) sends.
 */
export const ERROR_DROP_LABELS: Record<ErrorDropReason, string> = {
  throttled: 'Throttled',
  buffer_full: 'Queue full',
  rejected: 'Refused by PostHog',
  retry_exhausted: 'Dropped after 5 sends',
}

/** How often the status card asks again while the tab is visible. */
export const SYSTEM_STATUS_REFETCH_MS = 60_000
