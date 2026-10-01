import { Link } from '@tanstack/react-router'
import { EMAIL_EVENT_LABELS, providerLabel } from '@/constants/email.constants'
import { ROUTES } from '@/constants/routes'
import { buildEmailTimeline, type TimelineEntry } from '@/lib/email-timeline'
import { formatDateTime } from '@/lib/format'
import type { EmailMessageDetail } from '@/types/api.types'

/** What one entry says happened. */
function Description({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case 'queued': {
      return <span className="font-medium">Queued</span>
    }
    case 'suppressed': {
      return <span className="font-medium">Not sent: the address was suppressed</span>
    }
    case 'resent-from': {
      return (
        <span>
          A resend of{' '}
          <Link
            to={ROUTES.email}
            params={{ emailId: entry.messageId }}
            className="underline underline-offset-4"
          >
            an earlier email
          </Link>
        </span>
      )
    }
    case 'attempt': {
      return entry.attempt.status === 'sent' ? (
        <span className="font-medium">Handed to the mail server</span>
      ) : (
        <span>
          <span className="font-medium">Send attempt failed</span>
          {entry.attempt.errorCode !== null && (
            <>
              {' '}
              <code className="text-xs">{entry.attempt.errorCode}</code>
            </>
          )}
        </span>
      )
    }
    case 'event': {
      const { event } = entry
      return (
        <span>
          <span className="font-medium">{EMAIL_EVENT_LABELS[event.type] ?? event.type}</span>
          {event.bounceKind !== null && (
            <span>{event.bounceKind === 'hard' ? ' · hard bounce' : ' · soft bounce'}</span>
          )}
          {event.detail !== null && (
            <>
              {' '}
              <code className="text-xs">{event.detail}</code>
            </>
          )}
          <span className="text-muted-foreground"> · {providerLabel(event.provider)}</span>
        </span>
      )
    }
    case 'resent-as': {
      return (
        <span>
          Resent as{' '}
          <Link
            to={ROUTES.email}
            params={{ emailId: entry.messageId }}
            className="underline underline-offset-4"
          >
            a new email
          </Link>
        </span>
      )
    }
  }
}

/**
 * The message's delivery history, oldest first (`buildEmailTimeline`). A
 * resend that happened after this message has no time of its own here; its
 * own page has it.
 */
export function EmailTimeline({ detail }: { detail: EmailMessageDetail }) {
  const entries = buildEmailTimeline(detail)
  return (
    <ol aria-label="Delivery timeline" className="grid gap-3 border-l pl-4">
      {entries.map((entry) => (
        <li key={entry.key} className="grid gap-0.5 text-sm">
          <Description entry={entry} />
          {entry.kind !== 'resent-as' && (
            <time dateTime={entry.at} className="text-xs text-muted-foreground">
              {formatDateTime(entry.at) ?? 'Unknown time'}
            </time>
          )}
        </li>
      ))}
    </ol>
  )
}
