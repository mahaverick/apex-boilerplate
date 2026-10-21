import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { actionMessageFrom } from '@/lib/action-message'
import { ROLE_DENIED_ACTION } from '@/lib/staff-message'

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

describe('actionMessageFrom', () => {
  it('words a not_found 404 as ROLE_DENIED_ACTION and passes other messages through', () => {
    expect(
      actionMessageFrom(failure(404, 'No route matches this method and path.', 'not_found'))
    ).toBe(ROLE_DENIED_ACTION)
    expect(actionMessageFrom(failure(409, 'Too soon', 'reminded_recently'))).toBe('Too soon')
  })
})
