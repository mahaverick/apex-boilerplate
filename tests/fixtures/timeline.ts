/**
 * @file Timeline rows and pages shaped as express serves them. Event uuids
 * and session ids are UUIDv7-shaped, as PostHog and posthog-js mint them;
 * timestamps carry PostHog's six fractional digits.
 */
import { USER_ID_2 } from '@/tests/fixtures/ids'
import type { TimelinePage, TimelineRow } from '@/types/api.types'

/** posthog-js session ids. */
export const SESSION_ID = '0199a000-0000-7000-8000-000000000001'
export const SESSION_ID_2 = '0199a000-0000-7000-8000-000000000002'

/** W3C trace ids, as express copies them from the active span. */
export const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
export const TRACE_ID_2 = '4bf92f3577b34da6a3ce929d0e0e4736'

/** The links express builds for a user timeline. */
export const USER_LINKS = {
  person: `https://us.posthog.com/project/1/person/${USER_ID_2}`,
  group: null,
  replay: 'https://us.posthog.com/project/1/replay/{sessionId}',
}

/**
 * An event uuid by ordinal, UUIDv7-shaped like PostHog's.
 * @param n - The ordinal, 1 to 999.
 * @returns The uuid.
 */
export function eventId(n: number): string {
  return `0199a000-0000-7000-9000-${String(n).padStart(12, '0')}`
}

/**
 * A timestamp `seconds` after 10:00 on 2026-10-04, with microseconds.
 * @param seconds - Seconds past 10:00, under 3600.
 * @param micros - The fractional part, six digits.
 * @returns PostHog's string.
 */
export function at(seconds: number, micros = '000000'): string {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0')
  const rest = String(seconds % 60).padStart(2, '0')
  return `2026-10-04T10:${minutes}:${rest}.${micros}Z`
}

/**
 * A browser pageview (unverified, as every browser event is) with every
 * field set; override what a test is about. A server row sets `verified`.
 * @param overrides - The fields that differ.
 * @returns The row.
 */
export function timelineRow(overrides: Partial<TimelineRow> = {}): TimelineRow {
  return {
    uuid: eventId(1),
    event: '$pageview',
    timestamp: at(0),
    distinctId: USER_ID_2,
    verified: false,
    tenant: null,
    source: 'browser',
    access: null,
    app: 'react',
    sessionId: SESSION_ID,
    traceId: null,
    path: '/settings',
    elementText: null,
    props: {},
    ...overrides,
  }
}

/**
 * A configured page of `rows`.
 * @param rows - The rows, newest first.
 * @param nextCursor - The next page's cursor, or `null` on the last page.
 * @returns The page.
 */
export function timelinePage(rows: TimelineRow[], nextCursor: string | null = null): TimelinePage {
  return { configured: true, rows, nextCursor, links: USER_LINKS }
}
