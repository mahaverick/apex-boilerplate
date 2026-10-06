import { describe, expect, it } from 'vitest'
import {
  maintenanceMessageSchema,
  maintenanceModeFormSchema,
} from '@/schemas/maintenance-mode.schemas'

/** The messages a parse failed with, by field. */
function issuesOf(result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) {
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [String(issue.path[0]), issue.message])
  )
}

const VALID = {
  mode: 'full' as const,
  message: '  Back soon.\nThanks for waiting.  ',
  reason: ' DB upgrade ',
  confirmation: 'staging',
}

describe('maintenanceMessageSchema', () => {
  it('trims and keeps line breaks, as the API does', () => {
    expect(maintenanceMessageSchema.parse('  Back soon.\nThanks. ')).toBe('Back soon.\nThanks.')
  })

  it.each([
    ['', 'Enter the message customers will see.'],
    ['   ', 'Enter the message customers will see.'],
    ['x'.repeat(501), 'Message must be at most 500 characters.'],
    [
      `Back ${String.fromCodePoint(0x202e)}soon`,
      'Message contains characters that are not allowed',
    ],
    ['Back\u0007soon', 'Message contains characters that are not allowed'],
  ])('refuses %j', (value, message) => {
    const result = maintenanceMessageSchema.safeParse(value)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(message)
  })

  it('accepts exactly 500 characters', () => {
    expect(maintenanceMessageSchema.safeParse('x'.repeat(500)).success).toBe(true)
  })
})

describe('maintenanceModeFormSchema', () => {
  it('switching on needs a reason and the environment typed exactly', () => {
    const schema = maintenanceModeFormSchema('off', 'staging')
    expect(schema.parse(VALID)).toEqual({
      mode: 'full',
      message: 'Back soon.\nThanks for waiting.',
      reason: 'DB upgrade',
      confirmation: 'staging',
    })
    expect(issuesOf(schema.safeParse({ ...VALID, reason: '  ', confirmation: 'Staging' }))).toEqual(
      {
        reason: 'Enter a reason.',
        confirmation: 'Type staging exactly to confirm.',
      }
    )
  })

  it('escalating from read-only to full is a switch-on too', () => {
    const schema = maintenanceModeFormSchema('read_only', 'production')
    expect(issuesOf(schema.safeParse({ ...VALID, reason: '', confirmation: '' }))).toEqual({
      reason: 'Enter a reason.',
      confirmation: 'Type production exactly to confirm.',
    })
  })

  it('easing to read-only or editing the message needs neither', () => {
    for (const [from, mode] of [
      ['full', 'read_only'],
      ['full', 'full'],
      ['read_only', 'read_only'],
    ] as const) {
      const result = maintenanceModeFormSchema(from, 'staging').safeParse({
        ...VALID,
        mode,
        reason: '',
        confirmation: '',
      })
      expect(result.success).toBe(true)
    }
  })

  it('still checks an optional reason it is given, and always the message', () => {
    const schema = maintenanceModeFormSchema('full', 'staging')
    expect(
      issuesOf(
        schema.safeParse({ ...VALID, mode: 'read_only', reason: 'x'.repeat(501), message: '' })
      )
    ).toEqual({
      reason: 'Reason must be at most 500 characters.',
      message: 'Enter the message customers will see.',
    })
  })
})
