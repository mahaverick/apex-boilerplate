import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { isReauthRequired, sentWithCurrentToken } from '@/lib/step-up'
import { useAuthStore } from '@/states/auth.store'
import { REAUTH_REQUIRED } from '@/types/api.types'

function axiosFailure(status: number, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, message: 'x', statusCode: status, code, requestId: 'r' },
  })
}

describe('isReauthRequired', () => {
  it('is true only for a 401 carrying REAUTH_REQUIRED', () => {
    expect(isReauthRequired(axiosFailure(401, REAUTH_REQUIRED))).toBe(true)
    expect(isReauthRequired(axiosFailure(401))).toBe(false)
    expect(isReauthRequired(axiosFailure(403, REAUTH_REQUIRED))).toBe(false)
    expect(isReauthRequired(new Error('boom'))).toBe(false)
  })
})

describe('sentWithCurrentToken', () => {
  function refusedWith(token: string): AxiosError {
    const error = axiosFailure(401, REAUTH_REQUIRED)
    error.config?.headers.set('Authorization', `Bearer ${token}`)
    return error
  }

  it('is true when the refused request carried the token the store holds', () => {
    useAuthStore.setState({ accessToken: 'tok' })
    expect(sentWithCurrentToken(refusedWith('tok'))).toBe(true)
  })

  it('is false once another confirmation has swapped a newer token in', () => {
    useAuthStore.setState({ accessToken: 'newer' })
    expect(sentWithCurrentToken(refusedWith('tok'))).toBe(false)
  })

  it('is true for anything it cannot compare', () => {
    expect(sentWithCurrentToken(new Error('boom'))).toBe(true)
  })
})
