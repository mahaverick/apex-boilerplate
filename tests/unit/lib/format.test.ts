import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatShare, fullName, shortDate } from '@/lib/format'

// Noon UTC: the same calendar day in every timezone a runner is likely to use.
const NOON_UTC = '2026-03-05T12:00:00.000Z'
const date = new Date(NOON_UTC)

describe('formatDate', () => {
  it('formats in the reader locale, at the style the caller asks for', () => {
    // The expected strings come from the same options the pages use, so this pins the options without hard-coding one locale's output.
    expect(formatDate(NOON_UTC, 'long')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date)
    )
    expect(formatDate(NOON_UTC, 'medium')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
    )
    expect(formatDate(NOON_UTC, 'long')).not.toBe(formatDate(NOON_UTC, 'medium'))
  })

  it('returns null for a value that is not a date, so each caller picks its own fallback', () => {
    expect(formatDate('not a date', 'long')).toBeNull()
  })
})

describe('formatDateTime', () => {
  it('formats a medium date with a short time, in the reader locale', () => {
    expect(formatDateTime(NOON_UTC)).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    )
  })

  it('returns null for a value that is not a date', () => {
    expect(formatDateTime('')).toBeNull()
  })
})

describe('fullName', () => {
  it('joins the parts that have text', () => {
    expect(fullName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace')
    expect(fullName({ firstName: 'Ada', lastName: null })).toBe('Ada')
    expect(fullName({ firstName: null, lastName: 'Lovelace' })).toBe('Lovelace')
  })

  it('trims each part before joining', () => {
    expect(fullName({ firstName: ' Ada ', lastName: ' Lovelace ' })).toBe('Ada Lovelace')
  })

  it('returns null when neither part has text', () => {
    expect(fullName({ firstName: '  ', lastName: '' })).toBeNull()
    expect(fullName({ firstName: null, lastName: null })).toBeNull()
    expect(fullName(null)).toBeNull()
    expect(fullName(undefined)).toBeNull()
  })
})

describe('shortDate', () => {
  it('names the UTC day the API bucketed, not the reader-local one', () => {
    expect(shortDate('2026-09-29')).toBe('Sep 29')
    expect(shortDate('2026-01-01')).toBe('Jan 1')
  })
})

describe('formatShare', () => {
  it('is a percentage to two decimals', () => {
    expect(formatShare(1, 3)).toBe('33.33%')
    expect(formatShare(0, 5)).toBe('0.00%')
    expect(formatShare(5, 5)).toBe('100.00%')
  })

  it('never rounds a real part away to 0.00%', () => {
    expect(formatShare(1, 100_000)).toBe('<0.01%')
  })
})
