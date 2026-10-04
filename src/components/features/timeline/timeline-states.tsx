import { Skeleton } from '@/components/ui/skeleton'
import { TIMELINE_NOT_CONFIGURED, timelineEmptyMessage } from '@/constants/timeline.constants'
import type { TimelineRange, TimelineView } from '@/types/api.types'

/** Express has no PostHog personal key here: nothing was asked of PostHog, nothing was audited. */
export function TimelineNotConfigured() {
  return (
    <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
      {TIMELINE_NOT_CONFIGURED}
    </p>
  )
}

/** The first page in flight: rows shaped like the loaded list, so nothing jumps when it lands. */
export function TimelineSkeleton() {
  return (
    <div className="grid gap-2" aria-busy="true">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

/** A loaded first page with no rows, said of this window and view only. */
export function TimelineEmpty({ range, view }: { range: TimelineRange; view: TimelineView }) {
  return <p className="text-sm text-muted-foreground">{timelineEmptyMessage(range, view)}</p>
}
