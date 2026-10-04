/**
 * @file The user and tenant timelines' windows, views and copy. The windows
 * and views mirror express's `timeline.constants.ts`; the copy says what is
 * true of the request, never that nothing happened when the read failed.
 */
import type { TimelineRange, TimelineView } from '@/types/api.types'

/** The windows the toolbar offers, in select order. */
export const TIMELINE_RANGES = [
  '24h',
  '7d',
  '30d',
  '90d',
] as const satisfies readonly TimelineRange[]

/** The two views, in toggle order. */
export const TIMELINE_VIEWS = ['all', 'key'] as const satisfies readonly TimelineView[]

/** What the API assumes when the URL names no window. */
export const TIMELINE_DEFAULT_RANGE: TimelineRange = '7d'

/** The debugging view is the default; key events is the account-understanding view. */
export const TIMELINE_DEFAULT_VIEW: TimelineView = 'all'

/** Each window as the select and the empty state name it. */
export const TIMELINE_RANGE_LABELS: Record<TimelineRange, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
}

/** Each view as the toggle names it. */
export const TIMELINE_VIEW_LABELS: Record<TimelineView, string> = {
  all: 'Everything',
  key: 'Key events',
}

/** No personal key in this environment: express answered `configured: false`. */
export const TIMELINE_NOT_CONFIGURED = 'PostHog timelines are not set up for this environment.'

/** The first page failed: said of the request, not of the user's activity. */
export const TIMELINE_ERROR =
  'We could not reach PostHog, so nothing is listed. This is not a sign of no activity.'

/** A "Load more" failed: what is on screen is still right. */
export const TIMELINE_MORE_ERROR =
  'We could not load more events. What is listed above is correct, but it may not be all of it.'

/** A refresh of pages already shown failed: what is on screen may be stale. */
export const TIMELINE_REFETCH_ERROR =
  'We could not refresh the timeline. What is listed above may be out of date.'

/** An unverified row's Browser badge: anyone holding the public project key can send one. */
export const TIMELINE_UNVERIFIED_NOTE = 'Reported by the browser, not confirmed by the server.'

/** PostHog ingests with a lag, and express caches a page for 30 seconds. */
export const TIMELINE_LAG_NOTE = 'Events can take a few minutes to appear.'

/**
 * The empty state for a window and view. Key events leave out pageviews and
 * clicks, so that view says where they went.
 * @param range - The window shown.
 * @param view - The view shown.
 * @returns The sentence.
 */
export function timelineEmptyMessage(range: TimelineRange, view: TimelineView): string {
  const label = TIMELINE_RANGE_LABELS[range]
  return view === 'key'
    ? `No key events in the last ${label}. Switch to Everything to see pageviews and clicks.`
    : `No events in the last ${label}.`
}
