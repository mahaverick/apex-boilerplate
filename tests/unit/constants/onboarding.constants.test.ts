import { describe, expect, it } from 'vitest'
import { BADGE_TONES } from '@/constants/badge-tones'
import {
  ONBOARDING_RANGE_LABELS,
  ONBOARDING_SOURCE_LABELS,
  ONBOARDING_STATE_BADGE,
  ONBOARDING_TAB_LABELS,
} from '@/constants/onboarding.constants'
import { ONBOARDING_LIST_STATES, ONBOARDING_RANGES, ONBOARDING_STATES } from '@/types/api.types'

describe('ONBOARDING_STATE_BADGE', () => {
  it('gives each state the tone the spec assigns', () => {
    expect(Object.keys(ONBOARDING_STATE_BADGE).sort()).toEqual([...ONBOARDING_STATES].sort())
    expect(
      Object.fromEntries(ONBOARDING_STATES.map((s) => [s, ONBOARDING_STATE_BADGE[s].tone]))
    ).toEqual({
      complete: 'success',
      in_progress: 'neutral',
      stuck: 'warning',
      awaiting_owner: 'neutral-outline',
      dismissed: 'outline',
      not_tracked: 'muted',
    })
  })

  it('never draws two states alike, and uses only shared tones', () => {
    const tones = ONBOARDING_STATES.map((state) => ONBOARDING_STATE_BADGE[state].tone)
    expect(new Set(tones).size).toBe(tones.length)
    for (const tone of tones) expect(BADGE_TONES).toContain(tone)
    for (const state of ONBOARDING_STATES) expect(ONBOARDING_STATE_BADGE[state].label).not.toBe('')
  })
})

describe('labels', () => {
  it('names every list tab, window and completion source', () => {
    expect(ONBOARDING_LIST_STATES.map((state) => ONBOARDING_TAB_LABELS[state])).toEqual([
      'Stuck',
      'In progress',
      'Awaiting owner',
      'Complete',
      'Dismissed',
    ])
    expect(ONBOARDING_RANGES.map((range) => ONBOARDING_RANGE_LABELS[range])).toEqual([
      '7 days',
      '30 days',
      '90 days',
    ])
    expect(Object.keys(ONBOARDING_SOURCE_LABELS).sort()).toEqual(['auto', 'customer', 'staff'])
  })
})
