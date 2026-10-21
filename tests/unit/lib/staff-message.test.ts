import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { ROLE_DENIED_ACTION, staffMessageFrom } from '@/lib/staff-message'

/** An axios failure carrying express's error envelope. */
function failure(status: number, message: string, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('failed', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, message, requestId: 'r', ...(code ? { code } : {}) },
  })
}

const ROUTE_SENTENCE = 'No route matches this method and path. Check both, then try again.'

describe('staffMessageFrom', () => {
  it('words express’s route and role-gate 404 as staff copy, never its developer sentence', () => {
    expect(staffMessageFrom(failure(404, ROUTE_SENTENCE, 'not_found'))).toBe(ROLE_DENIED_ACTION)
  })

  it('keeps required mode’s setup refusal out of the role-denied copy', () => {
    const message = 'Create a passkey to continue. Every account here needs one.'
    const result = staffMessageFrom(failure(403, message, 'PASSKEY_SETUP_REQUIRED'))
    expect(result).not.toBe(ROLE_DENIED_ACTION)
    expect(result).toBe(message)
  })

  it('keeps the server’s sentence for any other code', () => {
    const message = 'We couldn’t find this user. They may have been purged.'
    expect(staffMessageFrom(failure(404, message, 'user_not_found'))).toBe(message)
    expect(staffMessageFrom(failure(409, 'Too soon', 'reminded_recently'))).toBe('Too soon')
  })

  it('falls back as the shared helper does when no response arrived', () => {
    expect(staffMessageFrom(new AxiosError('down'))).toBe(
      'We couldn’t reach the server. Check your connection, then try again.'
    )
  })
})
