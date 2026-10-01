import { parseISO } from 'date-fns'
import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { rangeLabel, toDay, type DayRange } from '@/lib/date-range'

/**
 * A creation-date filter: the calendar in a popover, in range mode. The
 * first click picks one day and a second extends it; each pick applies at
 * once, and the popover stays open until dismissed.
 */
export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DayRange
  onChange: (range: DayRange) => void
}) {
  const [open, setOpen] = useState(false)
  const label = rangeLabel(value)
  const selected: DateRange | undefined =
    value.from === undefined
      ? undefined
      : { from: parseISO(value.from), to: value.to === undefined ? undefined : parseISO(value.to) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="w-56 justify-start font-normal"
            aria-label={`Filter by date. Current: ${label}`}
          />
        }
      >
        <CalendarDays aria-hidden />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto" aria-label="Filter by date">
        <Calendar
          mode="range"
          selected={selected}
          defaultMonth={selected?.from}
          onSelect={(range) => onChange({ from: toDay(range?.from), to: toDay(range?.to) })}
        />
        {(value.from !== undefined || value.to !== undefined) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange({})
              setOpen(false)
            }}
          >
            Clear dates
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
