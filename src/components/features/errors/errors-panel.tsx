import { useQuery } from '@tanstack/react-query'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { TimelineSkeleton } from '@/components/features/timeline/timeline-states'
import { ToneBadge } from '@/components/features/tone-badge'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ERROR_APP_LABELS,
  ERRORS_EMPTY,
  ERRORS_ERROR,
  ERRORS_LAG_NOTE,
  ERRORS_NOT_CONFIGURED,
  ERRORS_UNVERIFIED_NOTE,
} from '@/constants/errors.constants'
import { absoluteTime, relativeTime } from '@/lib/relative-time'
import { errorIssuesQueryOptions } from '@/queries/errors.queries'
import { isRoleDenied } from '@/queries/platform.queries'
import type { TimelineKind } from '@/queries/timeline.queries'
import type { ErrorIssue } from '@/types/api.types'

/**
 * Where the issue's newest event came from: Server or Browser, the app it
 * names, and Unverified on a server row express did not sign. Base UI's
 * Tooltip is not announced, so that note is in the trigger's text too,
 * visually hidden.
 */
function SourceBadges({ issue }: { issue: ErrorIssue }) {
  const app = issue.app === null ? null : (ERROR_APP_LABELS[issue.app] ?? issue.app)
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="outline">{issue.source === 'server' ? 'Server' : 'Browser'}</Badge>
      {app !== null && <Badge variant="secondary">{app}</Badge>}
      {issue.source === 'server' && !issue.verified && (
        <Tooltip>
          <TooltipTrigger className="cursor-default">
            <ToneBadge tone="warning">Unverified</ToneBadge>
            <span className="sr-only">, {ERRORS_UNVERIFIED_NOTE}</span>
          </TooltipTrigger>
          <TooltipContent>{ERRORS_UNVERIFIED_NOTE}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/** One issue as a table row. `type` and `value` render as text, never as markup. */
function ErrorIssueRow({ issue }: { issue: ErrorIssue }) {
  const absolute = absoluteTime(issue.lastSeen)
  return (
    <TableRow>
      <TableCell className="max-w-md align-top whitespace-normal">
        <code className="text-sm font-medium break-all">{issue.type}</code>
        <Pii as="p" className="text-sm break-all text-muted-foreground">
          {issue.value}
        </Pii>
      </TableCell>
      <TableCell className="align-top">
        <SourceBadges issue={issue} />
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">
        {issue.count.toLocaleString('en-US')}
      </TableCell>
      <TableCell className="align-top">
        <Tooltip>
          <TooltipTrigger className="cursor-default text-sm underline decoration-dotted underline-offset-2">
            <time dateTime={issue.lastSeen}>{relativeTime(issue.lastSeen)}</time>
            <span className="sr-only">, {absolute}</span>
          </TooltipTrigger>
          <TooltipContent>{absolute}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="align-top">
        <a
          href={issue.link}
          target="_blank"
          rel="noreferrer"
          className="text-sm whitespace-nowrap underline-offset-4 hover:underline"
        >
          Open in PostHog <span aria-hidden="true">↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </TableCell>
    </TableRow>
  )
}

/**
 * A user's or a tenant's PostHog error issues over the last 30 days, newest
 * first. The states say what is true: not set up, loading, empty, and a
 * failure, which gets one copy whatever its status (a 502
 * `TIMELINE_UNAVAILABLE`'s message is masked). A 404 is a role refusal; the
 * page around it handles an unknown subject.
 */
export function ErrorsPanel({ kind, id }: { kind: TimelineKind; id: string }) {
  const errors = useQuery(errorIssuesQueryOptions(kind, id))

  if (errors.isError) {
    return isRoleDenied(errors.error) ? (
      <RoleDenied />
    ) : (
      <LoadError message={ERRORS_ERROR} onRetry={() => void errors.refetch()} />
    )
  }
  if (errors.data === undefined) return <TimelineSkeleton />
  if (!errors.data.configured) {
    return (
      <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
        {ERRORS_NOT_CONFIGURED}
      </p>
    )
  }
  if (errors.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{ERRORS_EMPTY}</p>
  }
  return (
    <div className="grid gap-2">
      <Table aria-label="Errors">
        <TableHeader>
          <TableRow>
            <TableHead>Error</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead>
              <span className="sr-only">PostHog</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {errors.data.items.map((issue) => (
            <ErrorIssueRow key={issue.issueId} issue={issue} />
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{ERRORS_LAG_NOTE}</p>
    </div>
  )
}
