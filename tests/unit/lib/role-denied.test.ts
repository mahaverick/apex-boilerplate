import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { isRoleDenied } from '@/lib/role-denied'

/** An axios failure that answered `status`, with an optional error `code`. */
function answered(status: number, code?: string) {
  return new AxiosError('failed', undefined, undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: code ? { success: false, message: 'm', code } : {},
  })
}

describe('isRoleDenied', () => {
  it('reads a 404 as the role being refused', () => {
    expect(isRoleDenied(answered(404))).toBe(true)
  })

  it.each([401, 403, 500])('reads a %i as something else', (status) => {
    expect(isRoleDenied(answered(status))).toBe(false)
  })

  it('reads a request that got no answer as something else', () => {
    expect(isRoleDenied(new Error('offline'))).toBe(false)
  })

  it('a 403 PASSKEY_SETUP_REQUIRED on /platform/* is not a role refusal', () => {
    expect(isRoleDenied(answered(403, 'PASSKEY_SETUP_REQUIRED'))).toBe(false)
  })
})
