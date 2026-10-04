import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { TimelineEntryItem, TimelineSession } from '@/components/features/timeline/timeline-session'
import {
  TimelineEmpty,
  TimelineNotConfigured,
  TimelineSkeleton,
} from '@/components/features/timeline/timeline-states'
import { TimelineToolbar } from '@/components/features/timeline/timeline-toolbar'
import { Button } from '@/components/ui/button'
import {
  TIMELINE_ERROR,
  TIMELINE_MORE_ERROR,
  TIMELINE_REFETCH_ERROR,
} from '@/constants/timeline.constants'
import { groupTimeline, type TimelineItem } from '@/lib/timeline-grouping'
import { isRoleDenied } from '@/queries/platform.queries'
import {
  flattenTimelinePages,
  refreshTimeline,
  timelineInfiniteOptions,
  type TimelineKind,
} from '@/queries/timeline.queries'
import type { TimelineRange, TimelineView } from '@/types/api.types'

interface TimelinePanelProps {
  kind: TimelineKind
  id: string
  range: TimelineRange
  view: TimelineView
  /** Puts a new window or view in the URL. */
  onSearchChange: (search: { range: TimelineRange; view: TimelineView }) => void
}

/** A stable key: a session id can recur after a gap, so its block is keyed by its newest row too. */
function itemKey(item: TimelineItem): string {
  if (item.kind === 'session') {
    const first = item.items[0]!
    return `${item.sessionId}:${first.kind === 'request' ? first.rows[0]!.uuid : first.row.uuid}`
  }
  return item.kind === 'request' ? item.rows[0]!.uuid : item.row.uuid
}

/**
 * A user's or a tenant's PostHog timeline: the toolbar, then sessions,
 * requests and events, newest first, regrouped over every loaded page. The
 * states say what is true: not set up, loading, empty for this window, and
 * three different failures (nothing loaded, Load more, a refresh). Every
 * failure but a 404 gets the same copy (a 502 `TIMELINE_UNAVAILABLE`'s
 * message is masked); a 404 is a role refusal, and the page around it
 * handles an unknown subject. Express drops forged and duplicate rows after
 * fetching, so a page can be short, or empty, and still have a next one:
 * "empty" is said only when there is no next page.
 */
export function TimelinePanel({ kind, id, range, view, onSearchChange }: TimelinePanelProps) {
  const client = useQueryClient()
  const options = timelineInfiniteOptions(kind, id, range, view)
  const timeline = useInfiniteQuery(options)

  if (timeline.isError && isRoleDenied(timeline.error)) return <RoleDenied />

  const first = timeline.data?.pages[0]
  if (first?.configured === false) return <TimelineNotConfigured />

  const rows = flattenTimelinePages(timeline.data)
  const links = first?.configured ? first.links : null
  const showActor = kind === 'tenant'

  return (
    <div className="grid gap-4">
      <TimelineToolbar
        range={range}
        view={view}
        onRangeChange={(next) => onSearchChange({ range: next, view })}
        onViewChange={(next) => onSearchChange({ range, view: next })}
        onRefresh={() => void refreshTimeline(client, options.queryKey)}
        isRefreshing={timeline.isRefetching}
        posthogHref={links === null ? null : kind === 'user' ? links.person : links.group}
      />
      {timeline.isPending ? (
        <TimelineSkeleton />
      ) : rows.length === 0 && !timeline.hasNextPage ? (
        timeline.isError ? (
          <LoadError message={TIMELINE_ERROR} onRetry={() => void timeline.refetch()} />
        ) : (
          <TimelineEmpty range={range} view={view} />
        )
      ) : (
        <div className="grid gap-3">
          {rows.length > 0 && (
            <ul aria-label="Timeline" className="grid gap-3">
              {groupTimeline(rows).map((item) =>
                item.kind === 'session' ? (
                  <TimelineSession
                    key={itemKey(item)}
                    session={item}
                    replayTemplate={links?.replay ?? ''}
                    showActor={showActor}
                  />
                ) : (
                  <TimelineEntryItem key={itemKey(item)} entry={item} showActor={showActor} />
                )
              )}
            </ul>
          )}
          {timeline.isFetchNextPageError ? (
            <LoadError
              message={rows.length === 0 ? TIMELINE_ERROR : TIMELINE_MORE_ERROR}
              onRetry={() => void timeline.fetchNextPage()}
            />
          ) : (
            timeline.isError && (
              <LoadError
                message={rows.length === 0 ? TIMELINE_ERROR : TIMELINE_REFETCH_ERROR}
                onRetry={() => void refreshTimeline(client, options.queryKey)}
              />
            )
          )}
          {timeline.hasNextPage && (
            <Button
              variant="outline"
              className="justify-self-start"
              disabled={timeline.isFetching}
              onClick={() => void timeline.fetchNextPage()}
            >
              {timeline.isFetchingNextPage ? 'Loading…' : 'Load more events'}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
