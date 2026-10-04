import { useQuery } from '@tanstack/react-query'
import { LoadError } from '@/components/features/load-error'
import { ToneBadge } from '@/components/features/tone-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ERROR_DROP_LABELS } from '@/constants/errors.constants'
import { relativeTime } from '@/lib/relative-time'
import { isRoleDenied, systemStatusQueryOptions } from '@/queries/platform.queries'
import type { ErrorDropReason, ErrorTrackingStatus, SystemStatus } from '@/types/api.types'

/** The drop reasons in display order. */
const DROP_REASONS = Object.keys(ERROR_DROP_LABELS) as ErrorDropReason[]

/**
 * Whether error tracking lost events or is failing to send: any drop in the
 * window, or a send PostHog has not accepted since the last one it did.
 * @param tracking - The status's error-tracking section.
 * @returns True when the card should warn.
 */
function needsAttention(tracking: ErrorTrackingStatus): boolean {
  return (
    tracking.lastSendError !== null || DROP_REASONS.some((reason) => tracking.dropped[reason] > 0)
  )
}

function StatusFacts({ status }: { status: SystemStatus }) {
  const tracking = status.errorTracking
  const dropped = DROP_REASONS.filter((reason) => tracking.dropped[reason] > 0)
  const droppedTotal = dropped.reduce((sum, reason) => sum + tracking.dropped[reason], 0)
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Release</dt>
      <dd>
        <code className="break-all">{status.release}</code>
      </dd>
      <dt className="text-muted-foreground">Error tracking</dt>
      <dd className="flex flex-wrap items-center gap-2">
        {tracking.enabled ? (
          <ToneBadge tone="success">Enabled</ToneBadge>
        ) : (
          <ToneBadge tone="muted">Disabled</ToneBadge>
        )}
        {needsAttention(tracking) && <ToneBadge tone="warning">Needs attention</ToneBadge>}
      </dd>
      <dt className="text-muted-foreground">Sent</dt>
      <dd className="tabular-nums">{tracking.sent.toLocaleString('en-US')}</dd>
      <dt className="text-muted-foreground">Dropped</dt>
      <dd className="tabular-nums">
        {droppedTotal.toLocaleString('en-US')}
        {dropped.length > 0 && (
          <span className="text-muted-foreground">
            {' '}
            (
            {dropped
              .map(
                (reason) =>
                  `${ERROR_DROP_LABELS[reason]} ${tracking.dropped[reason].toLocaleString('en-US')}`
              )
              .join(', ')}
            )
          </span>
        )}
      </dd>
      <dt className="text-muted-foreground">Last sent</dt>
      <dd>
        {tracking.lastSendOkAt === null ? (
          'None in the last 24 hours'
        ) : (
          <time dateTime={tracking.lastSendOkAt}>{relativeTime(tracking.lastSendOkAt)}</time>
        )}
      </dd>
      {tracking.lastSendError !== null && (
        <>
          <dt className="text-muted-foreground">Last failed send</dt>
          <dd>PostHog answered HTTP {tracking.lastSendError}</dd>
        </>
      )}
    </dl>
  )
}

/**
 * The API's release and error tracking's health over the last 15 minutes,
 * summed across every API and worker process. It warns when any event was
 * dropped or the last send failed. Browser errors go straight to PostHog,
 * so they are not counted here. Admins and up; a 404 (a role that changed,
 * or an API older than 1.7.0) hides the card rather than the Overview.
 */
export function SystemStatusCard() {
  const status = useQuery(systemStatusQueryOptions())
  if (status.isError && isRoleDenied(status.error)) return null
  return (
    <section aria-labelledby="system-status">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="system-status">System status</h2>
          </CardTitle>
          <CardDescription>The API over the last 15 minutes</CardDescription>
        </CardHeader>
        <CardContent>
          {status.isError ? (
            <LoadError
              message="We could not load the system status."
              onRetry={() => void status.refetch()}
            />
          ) : status.data === undefined ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <StatusFacts status={status.data} />
          )}
        </CardContent>
      </Card>
    </section>
  )
}
