/**
 * @file The Emails page's URL search params. The router JSON-parses search
 * values; a `YYYY-MM-DD` date is not JSON, so it arrives as the string it is.
 */
import { z } from 'zod'
import { searchText } from '@/schemas/search.schemas'
import { EMAIL_MESSAGE_STATUSES, EMAIL_TEMPLATE_KEYS, PAGE_DIRECTIONS } from '@/types/api.types'

/** A UTC calendar day, as `from` and `to` take it; anything else is no bound. */
const day = z.iso.date().optional().catch(undefined)

/** A record id; express validates these as UUIDs, so anything else is no filter. */
const id = z.uuid().optional().catch(undefined)

/** `/emails` search: every param optional, and a malformed one is dropped rather than failing the page. */
export const emailsSearchSchema = z.object({
  q: searchText,
  status: z.enum(EMAIL_MESSAGE_STATUSES).optional().catch(undefined),
  template: z.enum(EMAIL_TEMPLATE_KEYS).optional().catch(undefined),
  userId: id,
  tenantId: id,
  from: day,
  to: day,
  cursor: z.string().optional().catch(undefined),
  dir: z.enum(PAGE_DIRECTIONS).optional().catch(undefined),
})

export type EmailsSearch = z.infer<typeof emailsSearchSchema>

/** The email detail page's tabs; the first is the default, which the URL leaves out. */
export const EMAIL_DETAIL_TABS = ['timeline', 'preview'] as const
export type EmailDetailTab = (typeof EMAIL_DETAIL_TABS)[number]

/** `/emails/$emailId` search: `?tab=preview`, or nothing for the timeline. */
export const emailDetailSearchSchema = z.object({
  tab: z.enum(EMAIL_DETAIL_TABS).optional().catch(undefined),
})
