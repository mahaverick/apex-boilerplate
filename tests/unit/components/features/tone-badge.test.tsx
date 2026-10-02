import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OnboardingStateBadge } from '@/components/features/onboarding/onboarding-state-badge'
import { ToneBadge } from '@/components/features/tone-badge'
import { BADGE_TONES } from '@/constants/badge-tones'

describe('ToneBadge', () => {
  it.each([
    ['success', /bg-success/],
    ['neutral', /bg-secondary/],
    ['neutral-outline', /bg-secondary.*border-border|border-border.*bg-secondary/],
    ['warning', /bg-warning/],
    ['destructive', /text-destructive/],
    ['outline', /text-foreground/],
    ['muted', /text-muted-foreground/],
  ] as const)('draws %s with its own classes', (tone, className) => {
    render(<ToneBadge tone={tone}>{tone}</ToneBadge>)
    const badge = screen.getByText(tone)
    expect(badge).toHaveAttribute('data-tone', tone)
    expect(badge.className).toMatch(className)
  })

  it('gives every tone a distinct look', () => {
    const classNames = BADGE_TONES.map((tone) => {
      const { unmount } = render(<ToneBadge tone={tone}>{tone}</ToneBadge>)
      const className = screen.getByText(tone).className
      unmount()
      return className
    })
    expect(new Set(classNames).size).toBe(BADGE_TONES.length)
  })
})

describe('OnboardingStateBadge', () => {
  it.each([
    ['complete', 'Complete', 'success'],
    ['in_progress', 'In progress', 'neutral'],
    ['stuck', 'Stuck', 'warning'],
    ['awaiting_owner', 'Awaiting owner', 'neutral-outline'],
    ['dismissed', 'Dismissed', 'outline'],
    ['not_tracked', 'Not tracked', 'muted'],
  ] as const)('renders %s as “%s”', (state, label, tone) => {
    render(<OnboardingStateBadge state={state} />)
    expect(screen.getByText(label)).toHaveAttribute('data-tone', tone)
  })
})
