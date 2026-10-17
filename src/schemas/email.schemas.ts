/**
 * @file The email detail page's URL search params. The Emails list's own are
 * the list contract's, in `email.queries.ts`.
 */
import { z } from 'zod'

/** The email detail page's tabs; the first is the default, which the URL leaves out. */
export const EMAIL_DETAIL_TABS = ['timeline', 'preview'] as const
/** A tab the email detail page can show, as `?tab=` names it. */
export type EmailDetailTab = (typeof EMAIL_DETAIL_TABS)[number]

/** `/emails/$emailId` search: `?tab=preview`, or nothing for the timeline. */
export const emailDetailSearchSchema = z.object({
  tab: z.enum(EMAIL_DETAIL_TABS).optional().catch(undefined),
})
