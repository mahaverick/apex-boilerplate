/**
 * @file A time as staff pages show it: absolute, with its zone named, since a
 * page is read long after it loads. The relative time sits in a tooltip and,
 * since Base UI's tooltip is not announced, in visually hidden text beside it.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { absoluteTime, relativeTime } from '@/lib/relative-time'

/** The instant to show, and the zone it reads in. */
interface TimestampProps {
  /** An ISO timestamp. */
  iso: string
  /** A tenant's `settings.timezone`, or `undefined` for the reader's zone. */
  timeZone?: string
}

/**
 * "2 November 2026 at 10:42 GMT+5:30", with "3 minutes ago" in a tooltip and
 * in hidden text. The shared clock (`useNow`) keeps the relative time current.
 * @param props - The instant and its zone.
 */
export function Timestamp({ iso, timeZone }: TimestampProps) {
  const now = useNow()
  const relative = relativeTime(iso, now)
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default text-left underline decoration-dotted underline-offset-2">
        <time dateTime={iso}>{absoluteTime(iso, timeZone)}</time>
        <span className="sr-only">, {relative}</span>
      </TooltipTrigger>
      <TooltipContent>{relative}</TooltipContent>
    </Tooltip>
  )
}
