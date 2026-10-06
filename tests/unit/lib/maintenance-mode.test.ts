import { describe, expect, it } from 'vitest'
import {
  bannerSentence,
  conflictSentence,
  isSwitchOn,
  queueLine,
  sinceLabel,
} from '@/lib/maintenance-mode'
import { fullMaintenanceView, maintenanceModeView } from '@/tests/fixtures/maintenance-mode'

/** The same local day as the fixtures' `since`, so the label is the time alone. */
const SAME_DAY = new Date('2026-10-06T12:00:00.000Z')

/** What `sinceLabel` prints for the full fixture's start on that day, in this runner's locale. */
const START = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(
  new Date('2026-10-06T10:42:00.000Z')
)

describe('isSwitchOn', () => {
  it.each([
    ['off', 'read_only', true],
    ['off', 'full', true],
    ['read_only', 'full', true],
    ['full', 'read_only', false],
    ['read_only', 'read_only', false],
    ['full', 'full', false],
    ['full', 'off', false],
    ['read_only', 'off', false],
    ['off', 'off', false],
  ] as const)('%s to %s is a switch-on: %s', (from, to, expected) => {
    expect(isSwitchOn(from, to)).toBe(expected)
  })
})

describe('sinceLabel', () => {
  it('says the time alone on the same day, and the date too on another', () => {
    expect(sinceLabel('2026-10-06T10:42:00.000Z', SAME_DAY)).toBe(START)
    expect(sinceLabel('2026-10-01T10:42:00.000Z', SAME_DAY)).toContain('2026')
  })

  it('names an unreadable instant rather than printing Invalid Date', () => {
    expect(sinceLabel('not a date', SAME_DAY)).toBe('an unknown time')
  })
})

describe('bannerSentence', () => {
  it('names the mode in capitals, when it began and who set it', () => {
    expect(bannerSentence(fullMaintenanceView(), SAME_DAY)).toBe(
      `Customers are in FULL maintenance since ${START}, set by Sam Staff.`
    )
    expect(bannerSentence(fullMaintenanceView({ mode: 'read_only' }), SAME_DAY)).toBe(
      `Customers are in READ-ONLY maintenance since ${START}, set by Sam Staff.`
    )
  })

  it('leaves out what it does not know', () => {
    expect(bannerSentence(fullMaintenanceView({ since: null, changedBy: null }), SAME_DAY)).toBe(
      'Customers are in FULL maintenance.'
    )
  })
})

describe('conflictSentence', () => {
  it('says what the state is now, who set it and when', () => {
    expect(conflictSentence(fullMaintenanceView(), SAME_DAY)).toBe(
      `Someone changed maintenance mode while you were editing: it is now full, set by Sam Staff at ${START}. Check the page and try again.`
    )
    expect(conflictSentence(maintenanceModeView({ changedBy: null, since: null }))).toBe(
      'Someone changed maintenance mode while you were editing: it is now off. Check the page and try again.'
    )
  })
})

describe('queueLine', () => {
  it('says whether the queue is paused and how many jobs run on it', () => {
    expect(queueLine({ name: 'email', paused: true, active: 0 })).toBe('email: paused, 0 running')
    expect(queueLine({ name: 'analytics', paused: false, active: 1200 })).toBe(
      'analytics: not paused, 1,200 running'
    )
  })

  it('says unknown for what Redis did not answer', () => {
    expect(queueLine({ name: 'email', paused: null, active: null })).toBe(
      'email: pause state unknown, running count unknown'
    )
    expect(queueLine({ name: 'email', paused: true, active: null })).toBe(
      'email: paused, running count unknown'
    )
  })
})
