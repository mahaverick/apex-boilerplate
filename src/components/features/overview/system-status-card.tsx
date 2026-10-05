import { useQuery } from '@tanstack/react-query'
import { LoadError } from '@/components/features/load-error'
import { ToneBadge } from '@/components/features/tone-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ERROR_DROP_LABELS } from '@/constants/errors.constants'
import { relativeTime } from '@/lib/relative-time'
import { isRoleDenied, systemStatusQueryOptions } from '@/queries/platform.queries'
import type {
  ErrorDropReason,
  ErrorTrackingStatus,
  FlagsStatus,
  SystemStatus,
} from '@/types/api.types'

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

/** The only `property_matching_version` express's number matching was validated against. */
const VALIDATED_MATCHING_VERSION = 1

/**
 * Whether feature flags need a look: no snapshot or a stale one, a failed
 * last fetch, a matching version express was not validated against, or any
 * flag missing, unsupported or answering an unknown variant. Flags left
 * unconfigured are a valid steady state, not a warning.
 * @param flags - The status's flags section.
 * @returns True when the card should warn.
 */
function flagsNeedAttention(flags: FlagsStatus): boolean {
  if (!flags.enabled) return false
  return (
    flags.snapshotAt === null ||
    flags.stale ||
    flags.lastFetchError !== null ||
    flags.propertyMatchingVersion !== VALIDATED_MATCHING_VERSION ||
    flags.counts.missing > 0 ||
    flags.counts.unsupported > 0 ||
    flags.counts.unknownVariant15m > 0
  )
}

/** "4 registered: 3 active, 1 inactive, …" as one line, so each count reads in context. */
function flagCounts(counts: FlagsStatus['counts']): string {
  return [
    `${counts.registered} registered: ${counts.active} active`,
    `${counts.inactive} inactive`,
    `${counts.missing} missing`,
    `${counts.unsupported} unsupported`,
    `${counts.unregistered} unregistered in PostHog`,
  ].join(', ')
}

/** The feature flags section: state, snapshot age, counts and the last failed fetch. */
function FlagsFacts({ flags }: { flags: FlagsStatus }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Feature flags</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">State</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {flags.enabled ? (
            <ToneBadge tone="success">Enabled</ToneBadge>
          ) : (
            <ToneBadge tone="muted">Not set up</ToneBadge>
          )}
          {flagsNeedAttention(flags) && <ToneBadge tone="warning">Needs attention</ToneBadge>}
        </dd>
        {flags.enabled && (
          <>
            <dt className="text-muted-foreground">Snapshot</dt>
            <dd>
              {flags.snapshotAt === null ? (
                'None yet'
              ) : (
                <>
                  Fetched <time dateTime={flags.snapshotAt}>{relativeTime(flags.snapshotAt)}</time>
                </>
              )}
              {flags.stale && <span className="text-muted-foreground"> (stale)</span>}
            </dd>
            <dt className="text-muted-foreground">Flags</dt>
            <dd className="tabular-nums">
              {flagCounts(flags.counts)}
              {flags.counts.unknownVariant15m > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({flags.counts.unknownVariant15m.toLocaleString('en-US')} unknown variants in 15
                  minutes)
                </span>
              )}
            </dd>
            {flags.propertyMatchingVersion !== null &&
              flags.propertyMatchingVersion !== VALIDATED_MATCHING_VERSION && (
                <>
                  <dt className="text-muted-foreground">Matching</dt>
                  <dd>
                    PostHog property matching version {flags.propertyMatchingVersion}; express is
                    validated for version {VALIDATED_MATCHING_VERSION}
                  </dd>
                </>
              )}
            {flags.lastFetchError !== null && (
              <>
                <dt className="text-muted-foreground">Last failed fetch</dt>
                <dd>
                  <code>{flags.lastFetchError}</code>
                </dd>
              </>
            )}
          </>
        )}
      </dl>
    </div>
  )
}

function StatusFacts({ status }: { status: SystemStatus }) {
  const tracking = status.errorTracking
  const dropped = DROP_REASONS.filter((reason) => tracking.dropped[reason] > 0)
  const droppedTotal = dropped.reduce((sum, reason) => sum + tracking.dropped[reason], 0)
  return (
    <div className="grid gap-4">
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
      {status.flags !== undefined && <FlagsFacts flags={status.flags} />}
    </div>
  )
}

/**
 * The API's release, error tracking's health over the last 15 minutes,
 * summed across every API and worker process, and feature flags' health.
 * Error tracking warns when any event was dropped or the last send failed;
 * feature flags warn as `flagsNeedAttention` says. An API older than 1.8.0
 * sends no flags section, and the card shows none. Browser errors go
 * straight to PostHog, so they are not counted here. Admins and up; a 404 (a role that changed,
 * or an API older than 1.7.0) hides the card rather than the Overview. A
 * failed first load shows a retryable error; a failed refresh keeps the last
 * status up, with a note saying when it was loaded.
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
          {status.isError && status.data !== undefined ? (
            <>
              <StatusFacts status={status.data} />
              <p className="mt-3 text-xs text-muted-foreground">
                Could not refresh; showing the status loaded{' '}
                {relativeTime(new Date(status.dataUpdatedAt).toISOString())}.
              </p>
            </>
          ) : status.isError ? (
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
