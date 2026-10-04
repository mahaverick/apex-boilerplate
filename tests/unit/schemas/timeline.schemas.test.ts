import { describe, expect, it } from 'vitest'
import { timelineSearchSchema } from '@/schemas/timeline.schemas'

describe('timelineSearchSchema', () => {
  it('defaults to the debugging view over seven days', () => {
    expect(timelineSearchSchema.parse({})).toEqual({ range: '7d', view: 'all' })
  })

  it('keeps every window and view express accepts', () => {
    for (const range of ['24h', '7d', '30d', '90d'] as const) {
      for (const view of ['all', 'key'] as const) {
        expect(timelineSearchSchema.parse({ range, view })).toEqual({ range, view })
      }
    }
  })

  it.each([
    [
      { range: '1y', view: 'all' },
      { range: '7d', view: 'all' },
    ],
    [
      { range: '30d', view: 'raw' },
      { range: '30d', view: 'all' },
    ],
    [
      { range: 7, view: ['key'] },
      { range: '7d', view: 'all' },
    ],
    [
      { range: null, view: null },
      { range: '7d', view: 'all' },
    ],
  ])('falls back to the default for an invalid value: %o', (input, output) => {
    expect(timelineSearchSchema.parse(input)).toEqual(output)
  })

  it('drops keys it does not know', () => {
    expect(timelineSearchSchema.parse({ range: '24h', before: 'cursor' })).toEqual({
      range: '24h',
      view: 'all',
    })
  })
})
