import { ToneBadge } from '@/components/features/tone-badge'
import { ONBOARDING_STATE_BADGE } from '@/constants/onboarding.constants'
import type { OnboardingState } from '@/types/api.types'

/** A tenant's onboarding state as a badge in its shared tone. */
export function OnboardingStateBadge({ state }: { state: OnboardingState }) {
  const { label, tone } = ONBOARDING_STATE_BADGE[state]
  return <ToneBadge tone={tone}>{label}</ToneBadge>
}
