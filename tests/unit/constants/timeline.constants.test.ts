import { describe, expect, it } from 'vitest'
import {
  TIMELINE_ERROR,
  TIMELINE_LAG_NOTE,
  TIMELINE_MORE_ERROR,
  TIMELINE_NOT_CONFIGURED,
  TIMELINE_RANGE_LABELS,
  TIMELINE_RANGES,
  TIMELINE_REFETCH_ERROR,
  TIMELINE_UNVERIFIED_NOTE,
  TIMELINE_VIEW_LABELS,
  TIMELINE_VIEWS,
  timelineEmptyMessage,
} from '@/constants/timeline.constants'

describe('timeline windows and views', () => {
  it('offers the four windows and two views express accepts, in order', () => {
    expect(TIMELINE_RANGES).toEqual(['24h', '7d', '30d', '90d'])
    expect(TIMELINE_VIEWS).toEqual(['all', 'key'])
    expect(TIMELINE_RANGES.map((range) => TIMELINE_RANGE_LABELS[range])).toEqual([
      '24 hours',
      '7 days',
      '30 days',
      '90 days',
    ])
    expect(TIMELINE_VIEWS.map((view) => TIMELINE_VIEW_LABELS[view])).toEqual([
      'Everything',
      'Key events',
    ])
  })
})

describe('timeline copy', () => {
  it('says each state as the spec words it', () => {
    expect(TIMELINE_NOT_CONFIGURED).toBe('PostHog timelines are not set up for this environment.')
    expect(TIMELINE_ERROR).toBe(
      'We could not reach PostHog, so nothing is listed. This is not a sign of no activity.'
    )
    expect(TIMELINE_MORE_ERROR).toBe(
      'We could not load more events. What is listed above is correct, but it may not be all of it.'
    )
    expect(TIMELINE_REFETCH_ERROR).toBe(
      'We could not refresh the timeline. What is listed above may be out of date.'
    )
    expect(TIMELINE_LAG_NOTE).toBe('Events can take a few minutes to appear.')
    expect(TIMELINE_UNVERIFIED_NOTE).toBe('Reported by the browser, not confirmed by the server.')
  })

  it.each([
    ['24h', 'all', 'No events in the last 24 hours.'],
    ['7d', 'all', 'No events in the last 7 days.'],
    [
      '90d',
      'key',
      'No key events in the last 90 days. Switch to Everything to see pageviews and clicks.',
    ],
  ] as const)('says an empty %s %s window is empty, and nothing more', (range, view, text) => {
    expect(timelineEmptyMessage(range, view)).toBe(text)
  })
})
