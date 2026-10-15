import { useId, useState } from 'react'
import { TimelineEvent, TimelineEventRow } from '@/components/features/timeline/timeline-event-row'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemGroup } from '@/components/ui/item'
import { cn } from '@/lib/utils'
import type { TimelineRow } from '@/types/api.types'

/**
 * One request's server events (two or more consecutive verified rows sharing
 * a trace), collapsed to its newest event plus "+N related". The disclosure expands the rest in
 * place, oldest last.
 */
export function TimelineRequest({ rows, showActor }: { rows: TimelineRow[]; showActor: boolean }) {
  const [isOpen, setOpen] = useState(false)
  const listId = useId()
  const [first, ...related] = rows
  if (first === undefined) return null
  return (
    <Item size="xs" role="listitem" className="rounded-none border-0 px-0 py-2">
      <ItemContent>
        <TimelineEvent row={first} showActor={showActor}>
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={isOpen}
            aria-controls={listId}
            onClick={() => setOpen((open) => !open)}
          >
            +{related.length} related
          </Button>
        </TimelineEvent>
        <ItemGroup
          id={listId}
          hidden={!isOpen}
          aria-label="Related events"
          className={cn('ml-4 gap-0 border-l pl-3 has-data-[size=xs]:gap-0', !isOpen && 'hidden')}
        >
          {related.map((row) => (
            <TimelineEventRow key={row.uuid} row={row} showActor={showActor} />
          ))}
        </ItemGroup>
      </ItemContent>
    </Item>
  )
}
