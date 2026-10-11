/**
 * @file The onboarding page's URL search params. A malformed one falls back
 * to its default rather than failing the page.
 */
import { z } from 'zod'
import { ONBOARDING_LIST_STATES, ONBOARDING_RANGES, PAGE_DIRECTIONS } from '@/types/api.types'

/** `/onboarding`: the funnel's window (30 days by default), the list's tab (stuck first) and its page. */
export const onboardingSearchSchema = z.object({
  range: z.enum(ONBOARDING_RANGES).default('30d').catch('30d'),
  state: z.enum(ONBOARDING_LIST_STATES).default('stuck').catch('stuck'),
  cursor: z.string().optional().catch(undefined),
  dir: z.enum(PAGE_DIRECTIONS).optional().catch(undefined),
})
