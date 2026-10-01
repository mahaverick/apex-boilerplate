import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmailStatusBadge } from '@/components/features/emails/email-status-badge'

describe('EmailStatusBadge', () => {
  it.each([
    ['delivered', 'Delivered', 'success', /bg-success/],
    ['queued', 'Queued', 'neutral', /bg-secondary/],
    ['sent', 'Sent', 'neutral', /bg-secondary/],
    ['deferred', 'Deferred', 'warning', /bg-warning/],
    ['bounced', 'Bounced', 'destructive', /text-destructive/],
    ['failed', 'Failed', 'destructive', /text-destructive/],
    ['complained', 'Complained', 'destructive', /text-destructive/],
    ['suppressed', 'Suppressed', 'muted', /text-muted-foreground/],
  ] as const)('renders %s as a %s badge', (status, label, tone, className) => {
    render(<EmailStatusBadge status={status} />)
    const badge = screen.getByText(label)
    expect(badge).toHaveAttribute('data-tone', tone)
    expect(badge.className).toMatch(className)
  })
})
