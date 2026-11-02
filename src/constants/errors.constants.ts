/** @file The system status card's error-tracking labels and refresh interval. */
import type { ErrorDropReason } from '@/types/api.types'

/**
 * Each drop reason as the status card names it, in display order.
 * `retry_exhausted` here states no number: the card puts in the API's
 * `retryLimit` when it sends one.
 */
export const ERROR_DROP_LABELS: Record<ErrorDropReason, string> = {
  throttled: 'Throttled',
  buffer_full: 'Queue full',
  rejected: 'Refused by PostHog',
  retry_exhausted: 'Dropped after the last retry',
}

/** How often the status card asks again while the tab is visible. */
export const SYSTEM_STATUS_REFETCH_MS = 60_000
