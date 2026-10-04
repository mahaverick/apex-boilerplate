import { useId, useState } from 'react'
import { TimelineEvent, TimelineEventRow } from '@/components/features/timeline/timeline-event-row'
import { Button } from '@/components/ui/button'
import type { TimelineRow } from '@/types/api.types'

/**
 * One request's server events (two or more, sharing a trace), collapsed to
 * its newest event plus "+N related". The disclosure expands the rest in
 * place, oldest last.
 */
export function TimelineRequest({ rows, showActor }: { rows: TimelineRow[]; showActor: boolean }) {
  const [isOpen, setOpen] = useState(false)
  const listId = useId()
  const [first, ...related] = rows
  if (first === undefined) return null
  return (
    <li className="py-2">
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
      <ul id={listId} hidden={!isOpen} aria-label="Related events" className="ml-4 border-l pl-3">
        {related.map((row) => (
          <TimelineEventRow key={row.uuid} row={row} showActor={showActor} />
        ))}
      </ul>
    </li>
  )
}
