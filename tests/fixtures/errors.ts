/**
 * @file Error issues shaped as express serves them: UUIDv7-shaped issue ids,
 * as PostHog mints them, and PostHog's Error Tracking links.
 */
import type { ErrorIssue, ErrorIssuesPage } from '@/types/api.types'

/**
 * An issue id by ordinal, UUIDv7-shaped like PostHog's.
 * @param n - The ordinal, 1 to 999.
 * @returns The id.
 */
export function issueId(n: number): string {
  return `01a107cd-0000-7000-8000-${String(n).padStart(12, '0')}`
}

/**
 * A browser `TypeError` seen three times; override what a test is about.
 * @param overrides - The fields that differ.
 * @returns The issue.
 */
export function errorIssue(overrides: Partial<ErrorIssue> = {}): ErrorIssue {
  const id = overrides.issueId ?? issueId(1)
  return {
    issueId: id,
    type: 'TypeError',
    value: "Cannot read properties of undefined (reading 'id')",
    count: 3,
    firstSeen: '2026-10-01T09:00:00.000Z',
    lastSeen: '2026-10-04T09:58:00.000Z',
    source: 'browser',
    app: 'react',
    verified: false,
    link: `https://us.posthog.com/project/1/error_tracking/${id}`,
    ...overrides,
  }
}

/**
 * A configured answer holding `items`.
 * @param items - The issues, newest first.
 * @returns The page.
 */
export function errorsPage(items: ErrorIssue[]): ErrorIssuesPage {
  return { configured: true, items, nextCursor: null }
}
