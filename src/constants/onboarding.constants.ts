/**
 * @file Labels and tones for the onboarding pages. The steps themselves are
 * express's registry, served with every read; nothing here lists them.
 */
import type { BadgeTone } from '@/constants/badge-tones'
import type {
  OnboardingListState,
  OnboardingRange,
  OnboardingSource,
  OnboardingState,
} from '@/types/api.types'

/** Each state's label and badge tone; no two states share a tone. */
export const ONBOARDING_STATE_BADGE: Record<OnboardingState, { label: string; tone: BadgeTone }> = {
  complete: { label: 'Complete', tone: 'success' },
  in_progress: { label: 'In progress', tone: 'neutral' },
  stuck: { label: 'Stuck', tone: 'warning' },
  awaiting_owner: { label: 'Awaiting owner', tone: 'neutral-outline' },
  dismissed: { label: 'Dismissed', tone: 'outline' },
  not_tracked: { label: 'Not tracked', tone: 'muted' },
}

/** The tenants list's tabs, as `/onboarding?state=` names them. */
export const ONBOARDING_TAB_LABELS: Record<OnboardingListState, string> = {
  stuck: 'Stuck',
  in_progress: 'In progress',
  awaiting_owner: 'Awaiting owner',
  complete: 'Complete',
  dismissed: 'Dismissed',
}

/** How each funnel window reads in its toggle and the figures' labels. */
export const ONBOARDING_RANGE_LABELS: Record<OnboardingRange, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
}

/** Who completed a step, as the step list says it. */
export const ONBOARDING_SOURCE_LABELS: Record<OnboardingSource, string> = {
  auto: 'Detected automatically',
  customer: 'Ticked by the customer',
  staff: 'Marked complete by staff',
}

/** The funnel bars' two fills: every completion, and the staff-completed part drawn over it. */
export const FUNNEL_COLORS = { completed: 'var(--chart-1)', staff: 'var(--chart-3)' } as const

/** What the onboarding page says while no tenant is tracked at all. */
export const ONBOARDING_NOT_STARTED =
  'Onboarding tracking starts with tenants created after this release.'

/** A tenant created before tracking began. */
export const NOT_TRACKED_NOTE = 'Not tracked — created before onboarding tracking.'

/** A staff-created tenant whose clock has not started. */
export const AWAITING_OWNER_NOTE = 'Waiting for the owner to accept their invitation.'
