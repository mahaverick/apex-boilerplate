import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ServerErrors } from '@/hooks/use-server-errors'
import { refuseInForm } from '@/lib/billing-refusal'
import { ROLE_DENIED_ACTION } from '@/lib/staff-message'

/**
 * An Axios error answering `status` with express's envelope.
 * @param status - The HTTP status.
 * @param message - The envelope's message.
 * @param code - The envelope's code.
 * @param headers - The response's headers, such as `retry-after`.
 */
function refused(
  status: number,
  message: string,
  code?: string,
  headers: Record<string, string> = {}
): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const data = { success: false, message, statusCode: status, code, requestId: 'test-request-id' }
  return new AxiosError(message, String(status), config, null, {
    data,
    status,
    statusText: 'Error',
    headers,
    config,
  })
}

/** Express masks every 5xx body: only the code and `Retry-After` reach the page. */
const MASKED =
  'Our server hit an error. Try again, and contact support with the error ID if it happens again.'

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

/** The tenant a billing write is for, as the dialogs pass it. */
const ACME = { tenantName: 'Acme Corp', provider: 'razorpay' } as const

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
      refuseInForm(
        errors,
        refused(
          status,
          'Express’s TRIAL_NOT_EXTENDABLE sentence, shown as sent.',
          'TRIAL_NOT_EXTENDABLE'
        )
      )
      expect(errors.setFormErrors).toHaveBeenCalledWith([
        'Express’s TRIAL_NOT_EXTENDABLE sentence, shown as sent.',
      ])
    }
  })

  it('leaves anything else to capture', () => {
    for (const [status, code] of [
      [400, 'VALIDATION_ERROR'],
      [500, 'INTERNAL_ERROR'],
      [503, 'MAINTENANCE'],
    ] as const) {
      const errors = spyErrors()
      const error = refused(status, MASKED, code)
      refuseInForm(errors, error, ACME)
      expect(errors.capture).toHaveBeenCalledWith(error)
      expect(errors.setFormErrors).not.toHaveBeenCalled()
    }
  })

  it.each([
    [{ 'retry-after': '30' }, 'Billing for Acme Corp is updating. Try again in 30 seconds.'],
    [{ 'retry-after': '1' }, 'Billing for Acme Corp is updating. Try again in 1 second.'],
    [{}, 'Billing for Acme Corp is updating. Try again in a minute.'],
  ])('words a busy billing row (Retry-After %o) as a wait, not a server error', (headers, text) => {
    const errors = spyErrors()
    refuseInForm(errors, refused(503, MASKED, 'BILLING_BUSY', headers), ACME)
    expect(errors.setFormErrors).toHaveBeenCalledWith([text])
    expect(errors.capture).not.toHaveBeenCalled()
  })

  it.each([
    [
      { 'retry-after': '30' },
      'Razorpay didn’t answer. Try again in 30 seconds. If it keeps failing, check Razorpay’s status page.',
    ],
    [
      {},
      'Razorpay didn’t answer. Try again in a minute. If it keeps failing, check Razorpay’s status page.',
    ],
  ])('words a provider that didn’t answer (Retry-After %o) with the wait', (headers, text) => {
    const errors = spyErrors()
    refuseInForm(errors, refused(503, MASKED, 'PAYMENT_PROVIDER_UNAVAILABLE', headers), ACME)
    expect(errors.setFormErrors).toHaveBeenCalledWith([text])
  })

  it('words a provider that refused the request, naming the dashboard', () => {
    const errors = spyErrors()
    refuseInForm(errors, refused(502, MASKED, 'PAYMENT_PROVIDER_UNAVAILABLE'), {
      tenantName: 'Acme Corp',
      provider: 'fake',
    })
    expect(errors.setFormErrors).toHaveBeenCalledWith([
      'The payment provider didn’t accept this request. Check Acme Corp in the payment provider’s dashboard.',
    ])
  })

  it('names no tenant when the write has none', () => {
    const errors = spyErrors()
    refuseInForm(errors, refused(503, MASKED, 'BILLING_BUSY', { 'retry-after': '30' }))
    expect(errors.setFormErrors).toHaveBeenCalledWith([
      'Billing is updating. Try again in 30 seconds.',
    ])
  })
})
