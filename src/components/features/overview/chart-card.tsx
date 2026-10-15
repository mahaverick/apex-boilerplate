import { useId, type ReactNode } from 'react'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** A chart card's heading, its empty-window message, and the chart with its hidden table. */
interface ChartCardProps {
  /** The figure's name, shown as its heading: "Sign-ups per day". */
  title: string
  /** Shown instead of the chart when the window has nothing to draw; `null` draws it. */
  empty: string | null
  /** The chart and its visually hidden table. */
  children: ReactNode
}

/**
 * A card holding one named figure. The heading names the figure through
 * `aria-labelledby`, not a `<figcaption>`, which would have to be the
 * figure's first or last child rather than sit inside the card header.
 */
export function ChartCard({ title, empty, children }: ChartCardProps) {
  const titleId = useId()
  return (
    <Card>
      <figure aria-labelledby={titleId} className="m-0 flex flex-col gap-(--card-spacing)">
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>{title}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {empty === null ? (
            children
          ) : (
            <EmptyState size="compact" className="h-56 justify-center" title={empty} />
          )}
        </CardContent>
      </figure>
    </Card>
  )
}
