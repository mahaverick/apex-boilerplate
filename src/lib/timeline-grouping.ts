/**
 * @file A timeline's rows as sessions, requests and events. Pure, and run
 * over every loaded page at once, so a session or request cut by a page
 * boundary joins up when the next page arrives.
 */
import type { TimelineRow } from '@/types/api.types'

/** One event alone, or the server events of one request (two or more, newest first). */
export type TimelineEntry =
  { kind: 'event'; row: TimelineRow } | { kind: 'request'; traceId: string; rows: TimelineRow[] }

/** A run of rows from one browser session, or an entry outside any session. */
export type TimelineItem =
  | {
      kind: 'session'
      sessionId: string
      /** The browser app the session ran in, from its browser rows; `null` when it has none. */
      app: 'react' | 'apex' | null
      /** The oldest row's timestamp. */
      startedAt: string
      /** The newest row's timestamp. */
      endedAt: string
      items: TimelineEntry[]
    }
  | TimelineEntry

/**
 * A verified server row's trace, else `null`: browser rows, and any row
 * express did not sign, are never grouped by trace, since a forged event
 * could claim a real request's trace.
 */
function serverTrace(row: TimelineRow): string | null {
  return row.verified && row.source !== 'browser' ? row.traceId : null
}

/**
 * Consecutive verified server rows sharing a trace become one request; any other row
 * stays an event. A trace seen once is an event, not a request of one.
 * @param rows - Rows in timeline order (newest first).
 * @returns The entries, in the same order.
 */
function groupRequests(rows: TimelineRow[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const row of rows) {
    const trace = serverTrace(row)
    const last = entries.at(-1)
    if (trace !== null && last !== undefined) {
      if (last.kind === 'request' && last.traceId === trace) {
        last.rows.push(row)
        continue
      }
      if (last.kind === 'event' && serverTrace(last.row) === trace) {
        entries[entries.length - 1] = { kind: 'request', traceId: trace, rows: [last.row, row] }
        continue
      }
    }
    entries.push({ kind: 'event', row })
  }
  return entries
}

/**
 * The session block for one run of rows sharing a session id.
 * @param sessionId - The shared id.
 * @param rows - The run, newest first; never empty.
 * @returns The block.
 */
function sessionBlock(sessionId: string, rows: TimelineRow[]): TimelineItem {
  let app: 'react' | 'apex' | null = null
  for (const row of rows) {
    if (row.source === 'browser' && (row.app === 'react' || row.app === 'apex')) {
      app = row.app
      break
    }
  }
  return {
    kind: 'session',
    sessionId,
    app,
    startedAt: rows.at(-1)!.timestamp,
    endedAt: rows[0]!.timestamp,
    items: groupRequests(rows),
  }
}

/**
 * How many events an entry list holds, counting each row of a request.
 * @param items - A session's entries.
 * @returns The event count.
 */
export function countEvents(items: TimelineEntry[]): number {
  return items.reduce(
    (count, entry) => count + (entry.kind === 'request' ? entry.rows.length : 1),
    0
  )
}

/**
 * Rows (newest first) as the timeline shows them: consecutive rows sharing a
 * non-null session id form a session block; rows without one stand alone
 * between blocks; and, inside a block or among standalone rows, consecutive
 * verified server rows sharing a trace collapse into one request.
 * @param rows - Every loaded page's rows, in order.
 * @returns The items, in the same order.
 */
export function groupTimeline(rows: TimelineRow[]): TimelineItem[] {
  const items: TimelineItem[] = []
  let index = 0
  while (index < rows.length) {
    const sessionId = rows[index]!.sessionId
    let end = index + 1
    while (end < rows.length && rows[end]!.sessionId === sessionId) end += 1
    const run = rows.slice(index, end)
    if (sessionId === null) items.push(...groupRequests(run))
    else items.push(sessionBlock(sessionId, run))
    index = end
  }
  return items
}

/**
 * A session's replay link: the API's template with the session id filled in.
 * @param template - `links.replay`, holding `{sessionId}`.
 * @param sessionId - The session.
 * @returns The PostHog replay URL.
 */
export function replayHref(template: string, sessionId: string): string {
  return template.replace('{sessionId}', encodeURIComponent(sessionId))
}

/**
 * How long a session ran, from its oldest to its newest row: "45 s",
 * "12 min", "1 h 5 min".
 * @param startedAt - The oldest row's timestamp.
 * @param endedAt - The newest row's timestamp.
 * @returns The length, or "unknown length" when a timestamp does not parse.
 */
export function sessionDuration(startedAt: string, endedAt: string): string {
  const milliseconds = Date.parse(endedAt) - Date.parse(startedAt)
  if (Number.isNaN(milliseconds)) return 'unknown length'
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`
}
