import { Button, buttonVariants } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  TIMELINE_LAG_NOTE,
  TIMELINE_RANGE_LABELS,
  TIMELINE_RANGES,
  TIMELINE_VIEW_LABELS,
  TIMELINE_VIEWS,
} from '@/constants/timeline.constants'
import type { TimelineRange, TimelineView } from '@/types/api.types'

interface TimelineToolbarProps {
  range: TimelineRange
  view: TimelineView
  onRangeChange: (range: TimelineRange) => void
  onViewChange: (view: TimelineView) => void
  /** Refetches the first page only. */
  onRefresh: () => void
  isRefreshing: boolean
  /** `links.person` or `links.group`; the button is left out when there is none. */
  posthogHref: string | null
}

/**
 * The window, the view, Refresh and the PostHog link, with the lag note. The
 * window and view live in the URL; the page passes them in and navigates on
 * change.
 */
export function TimelineToolbar({
  range,
  view,
  onRangeChange,
  onViewChange,
  onRefresh,
  isRefreshing,
  posthogHref,
}: TimelineToolbarProps) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={range}
          onValueChange={(next: string | null) => {
            const match = TIMELINE_RANGES.find((option) => option === next)
            if (match) onRangeChange(match)
          }}
        >
          <SelectTrigger aria-label="Time range" className="w-36">
            <SelectValue>
              {(current: string) =>
                TIMELINE_RANGES.find((option) => option === current) === undefined
                  ? current
                  : `Last ${TIMELINE_RANGE_LABELS[current as TimelineRange]}`
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TIMELINE_RANGES.map((option) => (
              <SelectItem key={option} value={option}>
                Last {TIMELINE_RANGE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          aria-label="Events shown"
          value={[view]}
          onValueChange={(value: string[]) => {
            const next = TIMELINE_VIEWS.find((option) => value.includes(option))
            if (next) onViewChange(next)
          }}
        >
          {TIMELINE_VIEWS.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {TIMELINE_VIEW_LABELS[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button variant="outline" size="sm" disabled={isRefreshing} onClick={onRefresh}>
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
        {posthogHref !== null && (
          <a
            href={posthogHref}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Open in PostHog <span aria-hidden="true">↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{TIMELINE_LAG_NOTE}</p>
    </div>
  )
}
