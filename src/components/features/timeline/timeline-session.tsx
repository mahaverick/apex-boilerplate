import { TimelineEventRow } from '@/components/features/timeline/timeline-event-row'
import { TimelineRequest } from '@/components/features/timeline/timeline-request'
import { absoluteTime } from '@/lib/relative-time'
import {
  countEvents,
  replayHref,
  sessionDuration,
  type TimelineEntry,
  type TimelineItem,
} from '@/lib/timeline-grouping'

/** The browser apps a session can run in, as the header names them. */
const APP_LABELS = { react: 'Customer app', apex: 'Apex' } as const

/** A request or a lone event, as a list item. */
export function TimelineEntryItem({
  entry,
  showActor,
}: {
  entry: TimelineEntry
  showActor: boolean
}) {
  return entry.kind === 'request' ? (
    <TimelineRequest rows={entry.rows} showActor={showActor} />
  ) : (
    <TimelineEventRow row={entry.row} showActor={showActor} />
  )
}

/**
 * One browser session: when it started and ended, how long it ran, which
 * app, how many events, and its replay in PostHog. Staff need a PostHog seat
 * to watch it; the link only opens PostHog.
 */
export function TimelineSession({
  session,
  replayTemplate,
  showActor,
}: {
  session: Extract<TimelineItem, { kind: 'session' }>
  /** `links.replay`, holding `{sessionId}`. */
  replayTemplate: string
  showActor: boolean
}) {
  const count = countEvents(session.items)
  const facts = [
    `${absoluteTime(session.startedAt)} – ${absoluteTime(session.endedAt)}`,
    sessionDuration(session.startedAt, session.endedAt),
    ...(session.app === null ? [] : [APP_LABELS[session.app]]),
    `${count} ${count === 1 ? 'event' : 'events'}`,
  ]
  return (
    <li className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
        <p>
          <span className="font-medium">Session</span>{' '}
          <span className="text-muted-foreground">{facts.join(' · ')}</span>
        </p>
        <a
          href={replayHref(replayTemplate, session.sessionId)}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline underline-offset-4"
        >
          Watch replay <span aria-hidden="true">↗</span>
          <span className="sr-only"> (opens PostHog in a new tab)</span>
        </a>
      </div>
      <ul aria-label="Session events" className="divide-y px-3">
        {session.items.map((entry) => (
          <TimelineEntryItem
            key={entry.kind === 'request' ? entry.rows[0]!.uuid : entry.row.uuid}
            entry={entry}
            showActor={showActor}
          />
        ))}
      </ul>
    </li>
  )
}
