/**
 * @file The timeline pages' URL search params, mirroring express's query
 * validator. A value the API would refuse falls back to its default instead,
 * so a stale or hand-edited link still opens a timeline.
 */
import { z } from 'zod'
import {
  TIMELINE_DEFAULT_RANGE,
  TIMELINE_DEFAULT_VIEW,
  TIMELINE_RANGES,
  TIMELINE_VIEWS,
} from '@/constants/timeline.constants'

/** `?range=7d&view=all`, each defaulted and each falling back on an invalid value. */
export const timelineSearchSchema = z.object({
  range: z.enum(TIMELINE_RANGES).default(TIMELINE_DEFAULT_RANGE).catch(TIMELINE_DEFAULT_RANGE),
  view: z.enum(TIMELINE_VIEWS).default(TIMELINE_DEFAULT_VIEW).catch(TIMELINE_DEFAULT_VIEW),
})

/** The validated search params. */
export type TimelineSearch = z.infer<typeof timelineSearchSchema>
