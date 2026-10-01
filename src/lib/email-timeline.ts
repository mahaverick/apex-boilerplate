/**
 * @file One email's history as a single ordered list: when it was queued,
 * each send attempt, each provider event, and the resends on either side.
 */
import type { EmailAttempt, EmailMessageDetail, EmailProviderEvent } from '@/types/api.types'

/** One line of the timeline. `at` is an ISO timestamp, absent only on `resent-as`. */
export type TimelineEntry =
  | { kind: 'queued'; key: string; at: string }
  | { kind: 'resent-from'; key: string; at: string; messageId: string }
  | { kind: 'attempt'; key: string; at: string; attempt: EmailAttempt }
  | { kind: 'event'; key: string; at: string; event: EmailProviderEvent }
  | { kind: 'resent-as'; key: string; messageId: string }

/** Milliseconds since the epoch, or +Infinity for a timestamp that does not parse, so it sorts last. */
function time(iso: string): number {
  const value = Date.parse(iso)
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value
}

/**
 * The detail's attempts and provider events merged by time, oldest first,
 * between two fixed ends. "Queued" (and, for a resend, the message it
 * resent) always leads: that is when the row was created, and a provider
 * clock running behind ours must not place an event before it. The
 * messages that resent this one carry no time in the API's answer and come
 * after it, so they close the list. Equal times keep attempts before events.
 * @param detail - `GET /platform/emails/:id`.
 * @returns The entries in display order.
 */
export function buildEmailTimeline(
  detail: Pick<
    EmailMessageDetail,
    'createdAt' | 'attempts' | 'events' | 'resentFromId' | 'resentAsIds'
  >
): TimelineEntry[] {
  const opening: TimelineEntry[] = [{ kind: 'queued', key: 'queued', at: detail.createdAt }]
  if (detail.resentFromId !== null) {
    opening.push({
      kind: 'resent-from',
      key: `resent-from-${detail.resentFromId}`,
      at: detail.createdAt,
      messageId: detail.resentFromId,
    })
  }
  const middle: Extract<TimelineEntry, { kind: 'attempt' | 'event' }>[] = [
    ...detail.attempts.map((attempt) => ({
      kind: 'attempt' as const,
      key: `attempt-${attempt.id}`,
      at: attempt.createdAt,
      attempt,
    })),
    ...detail.events.map((event) => ({
      kind: 'event' as const,
      key: `event-${event.id}`,
      at: event.occurredAt,
      event,
    })),
  ]
  // Array.prototype.sort is stable, so equal times keep attempts ahead of events.
  middle.sort((a, b) => time(a.at) - time(b.at))
  const closing: TimelineEntry[] = detail.resentAsIds.map((messageId) => ({
    kind: 'resent-as',
    key: `resent-as-${messageId}`,
    messageId,
  }))
  return [...opening, ...middle, ...closing]
}
