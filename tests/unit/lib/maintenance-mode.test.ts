import { describe, expect, it } from 'vite-plus/test'
import {
  bannerSentence,
  conflictSentence,
  isSwitchOn,
  queueLine,
  sinceLabel,
} from '@/lib/maintenance-mode'
import { absoluteTime } from '@/lib/relative-time'
import { fullMaintenanceView, maintenanceModeView } from '@/tests/fixtures/maintenance-mode'

/** What `sinceLabel` prints for the full fixture's start: the date, the time and the zone. */
const START = absoluteTime('2026-10-06T10:42:00.000Z')

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
  it('names the date, the time and the zone, whatever the day', () => {
    expect(sinceLabel('2026-10-06T10:42:00.000Z')).toBe(START)
    expect(START).toContain('6 October 2026')
    expect(START).toMatch(/(?:GMT|UTC)/)
  })

  it('names an unreadable instant rather than printing Invalid Date', () => {
    expect(sinceLabel('not a date')).toBe('an unknown time')
  })
})

describe('bannerSentence', () => {
  it('names the mode in capitals, when it began and who set it', () => {
    expect(bannerSentence(fullMaintenanceView())).toBe(
      `Customers are in FULL maintenance since ${START}, set by Sam Staff.`
    )
    expect(bannerSentence(fullMaintenanceView({ mode: 'read_only' }))).toBe(
      `Customers are in READ-ONLY maintenance since ${START}, set by Sam Staff.`
    )
  })

  it('leaves out what it does not know', () => {
    expect(bannerSentence(fullMaintenanceView({ since: null, changedBy: null }))).toBe(
      'Customers are in FULL maintenance.'
    )
  })
})

describe('conflictSentence', () => {
  it('says what the state is now, who set it and when', () => {
    expect(conflictSentence(fullMaintenanceView())).toBe(
      `Someone changed maintenance mode while you were editing: it is now full, set by Sam Staff at ${START}. Check the page and try again.`
    )
    expect(conflictSentence(maintenanceModeView({ changedBy: null, since: null }))).toBe(
      'Someone changed maintenance mode while you were editing: it is now off. Check the page and try again.'
    )
  })
})

describe('queueLine', () => {
  it('says whether the queue is paused and how many jobs run on it', () => {
    expect(queueLine({ name: 'email', paused: true, active: 0 })).toBe(
      'email: paused, 0 jobs running'
    )
    expect(queueLine({ name: 'analytics', paused: false, active: 1200 })).toBe(
      'analytics: not paused, 1,200 jobs running'
    )
  })

  it('says the auth-email queue is never paused, and why', () => {
    const line =
      'auth-email: never paused, 0 jobs running. We still send sign-in, invitation and Confirm it’s you emails during maintenance.'
    expect(queueLine({ name: 'auth-email', paused: false, active: 0 })).toBe(line)
    // Maintenance never pauses it, so an unanswered pause state is still "never paused".
    expect(queueLine({ name: 'auth-email', paused: null, active: 0 })).toBe(line)
    expect(queueLine({ name: 'auth-email', paused: true, active: 0 })).toBe(
      'auth-email: paused, 0 jobs running'
    )
  })

  it('says unknown for what Redis did not answer', () => {
    expect(queueLine({ name: 'email', paused: null, active: null })).toBe(
      'email: pause state unknown, running job count unknown'
    )
    expect(queueLine({ name: 'email', paused: true, active: null })).toBe(
      'email: paused, running job count unknown'
    )
  })
})
