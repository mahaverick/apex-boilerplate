/**
 * @file The Errors tab's and the system status card's copy. Like the
 * timeline's, it says what is true of the request, never that nothing went
 * wrong when the read failed.
 */
import type { ErrorDropReason } from '@/types/api.types'

/** No personal key in this environment: express answered `configured: false`. */
export const ERRORS_NOT_CONFIGURED = 'PostHog error tracking is not set up for this environment.'

/** A loaded list with no issues: express looks back a fixed 30 days. */
export const ERRORS_EMPTY = 'No errors in the last 30 days.'

/** The list failed: said of the request, not of the user's or tenant's errors. */
export const ERRORS_ERROR =
  'We could not reach PostHog, so nothing is listed. This is not a sign of no errors.'

/** A server row whose signature did not verify: anyone holding the public project key can send one. */
export const ERRORS_UNVERIFIED_NOTE = 'Claims to come from the server, but express did not sign it.'

/** PostHog groups an exception into an issue after ingesting it, which takes a few seconds. */
export const ERRORS_LAG_NOTE = 'Errors can take a minute to appear.'

/** Each app name express or a browser sends, as the badge names it; any other is shown as sent. */
export const ERROR_APP_LABELS: Record<string, string> = {
  api: 'API',
  react: 'Customer app',
  apex: 'Apex',
}

/** Each drop reason as the status card names it, in display order. */
export const ERROR_DROP_LABELS: Record<ErrorDropReason, string> = {
  throttled: 'Throttled',
  buffer_full: 'Queue full',
  rejected: 'Refused by PostHog',
  retry_exhausted: 'Gave up retrying',
}

/** How often the status card asks again while the tab is visible. */
export const SYSTEM_STATUS_REFETCH_MS = 60_000
