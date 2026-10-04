import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ROUTES } from '@/constants/routes'
import { timelineSentence } from '@/constants/timeline-events'
import { TIMELINE_UNVERIFIED_NOTE } from '@/constants/timeline.constants'
import { absoluteTime, relativeTime } from '@/lib/relative-time'
import type { TimelineRow } from '@/types/api.types'

/** Pageviews and page leaves already say their path in the sentence. */
const PATH_IN_SENTENCE = new Set(['$pageview', '$pageleave'])

/**
 * Where the event came from. Only a row express signed earns Server or Email
 * (its audit and product events are both the server's); every other row is
 * the browser's, and its badge says the server did not confirm it. Base UI's
 * Tooltip is not announced, so that note is in the trigger's text too,
 * visually hidden.
 */
function SourceBadge({ row }: { row: TimelineRow }) {
  if (row.verified && row.source !== 'browser') {
    return <Badge variant="outline">{row.source === 'email' ? 'Email' : 'Server'}</Badge>
  }
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default">
        <Badge variant="outline">Browser</Badge>
        <span className="sr-only">, {TIMELINE_UNVERIFIED_NOTE}</span>
      </TooltipTrigger>
      <TooltipContent>{TIMELINE_UNVERIFIED_NOTE}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Who sent a tenant-timeline row, as express resolves it: no actor is a
 * system row ("System"); an actor with no name has no user row left
 * ("Deleted user", unlinked); otherwise their name in `Pii`, linked to
 * their user page.
 */
function TimelineActorName({ row }: { row: TimelineRow }) {
  const actor = row.actor
  if (actor === undefined || actor === null) return <span className="font-medium">System</span>
  if (actor.displayName === null) return <span className="font-medium">Deleted user</span>
  return (
    <Link
      to={ROUTES.user}
      params={{ userId: actor.id }}
      className="font-medium underline-offset-4 hover:underline"
    >
      <Pii>{actor.displayName}</Pii>
    </Link>
  )
}

/**
 * One event's content: the actor (tenant timelines, shown for every row,
 * verified or not), the sentence, its badges (Staff only on a verified row),
 * the page it happened on and when. The sentence is wrapped whole in
 * `Pii`, since it can hold a path or a clicked element's text. Base UI's
 * Tooltip is not announced, so the absolute time is in the trigger's text
 * too, visually hidden.
 */
export function TimelineEvent({
  row,
  showActor,
  children,
}: {
  row: TimelineRow
  /** Tenant timelines name who did each thing; a user's timeline is all theirs or staff's on them. */
  showActor: boolean
  /** Shown after the time: a request's disclosure button. */
  children?: ReactNode
}) {
  const absolute = absoluteTime(row.timestamp)
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {showActor && <TimelineActorName row={row} />}
        <Pii className="wrap-break-word">{timelineSentence(row)}</Pii>
        <SourceBadge row={row} />
        {row.verified && row.access === 'platform' && <Badge variant="outline">Staff</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {row.path !== null && !PATH_IN_SENTENCE.has(row.event) && (
          <Pii className="break-all">{row.path}</Pii>
        )}
        <Tooltip>
          <TooltipTrigger className="cursor-default underline decoration-dotted underline-offset-2">
            <time dateTime={row.timestamp}>{relativeTime(row.timestamp)}</time>
            <span className="sr-only">, {absolute}</span>
          </TooltipTrigger>
          <TooltipContent>{absolute}</TooltipContent>
        </Tooltip>
        {children}
      </div>
    </div>
  )
}

/** One event as a list item. */
export function TimelineEventRow({ row, showActor }: { row: TimelineRow; showActor: boolean }) {
  return (
    <li className="py-2">
      <TimelineEvent row={row} showActor={showActor} />
    </li>
  )
}
