import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ServerErrors } from '@/hooks/use-server-errors'
import { refuseInForm } from '@/lib/billing-refusal'
import { ROLE_DENIED_ACTION } from '@/lib/staff-message'

/** An Axios error answering `status` with express's envelope, carrying `message` and `code`. */
function refused(status: number, message: string, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const data = { success: false, message, statusCode: status, code, requestId: 'test-request-id' }
  return new AxiosError(message, String(status), config, null, {
    data,
    status,
    statusText: 'Error',
    headers: {},
    config,
  })
}

/** A form's server errors with every write spied on. */
function spyErrors(): ServerErrors {
  return {
    fieldErrors: {},
    formErrors: [],
    capture: vi.fn(),
    clearField: vi.fn(),
    setFieldError: vi.fn(),
    setFormErrors: vi.fn(),
    reset: vi.fn(),
  }
}

describe('refuseInForm', () => {
  it('shows a declined step-up as the step-up’s sentence', () => {
    const errors = spyErrors()
    refuseInForm(errors, refused(401, 'Recent sign-in required', 'REAUTH_REQUIRED'))
    expect(errors.setFormErrors).toHaveBeenCalledWith(['Confirm it’s you to continue.'])
    expect(errors.capture).not.toHaveBeenCalled()
  })

  it('puts a reason refusal on the Reason field', () => {
    const errors = spyErrors()
    refuseInForm(
      errors,
      refused(400, 'Give a reason of 1 to 500 characters for this change.', 'REASON_REQUIRED')
    )
    expect(errors.setFieldError).toHaveBeenCalledWith('reason', [
      'Give a reason of 1 to 500 characters for this change.',
    ])
  })

  it('words a role gate’s 404 as the role sentence, with the route code or none', () => {
    for (const code of ['not_found', undefined]) {
      const errors = spyErrors()
      refuseInForm(errors, refused(404, 'Route not found', code))
      expect(errors.setFormErrors).toHaveBeenCalledWith([ROLE_DENIED_ACTION])
    }
  })

  it('shows any other 404 as the API’s sentence', () => {
    const errors = spyErrors()
    refuseInForm(
      errors,
      refused(404, 'We couldn’t find this grant on this tenant.', 'grant_not_found')
    )
    expect(errors.setFormErrors).toHaveBeenCalledWith([
      'We couldn’t find this grant on this tenant.',
    ])
  })

  it('shows a 403 or 409 as the API’s sentence', () => {
    for (const status of [403, 409]) {
      const errors = spyErrors()
      refuseInForm(errors, refused(status, 'This tenant pays for Paid.', 'TRIAL_NOT_EXTENDABLE'))
      expect(errors.setFormErrors).toHaveBeenCalledWith(['This tenant pays for Paid.'])
    }
  })

  it('leaves anything else, a provider outage included, to capture', () => {
    for (const status of [400, 502, 503]) {
      const errors = spyErrors()
      const error = refused(status, 'Razorpay didn’t answer.', 'PAYMENT_PROVIDER_UNAVAILABLE')
      refuseInForm(errors, error)
      expect(errors.capture).toHaveBeenCalledWith(error)
      expect(errors.setFormErrors).not.toHaveBeenCalled()
    }
  })
})
