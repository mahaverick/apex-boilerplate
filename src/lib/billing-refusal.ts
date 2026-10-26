import type { ServerErrors } from '@/hooks/use-server-errors'
import { codeFrom, retryAfterSecondsFrom, statusFrom } from '@/lib/api-error'
import { providerName } from '@/lib/billing-actions'
import { nounFor } from '@/lib/plural'
import { ROLE_DENIED_ACTION, staffMessageFrom } from '@/lib/staff-message'
import { isReauthRequired, stepUpRefusal } from '@/lib/step-up'
import { REASON_REQUIRED, ROUTE_NOT_FOUND } from '@/types/api.types'
import type { StaffTenantBilling } from '@/types/billing.types'

/** Express's code on a 503 for a billing row that kept moving under a write. */
const BILLING_BUSY = 'BILLING_BUSY'

/** Express's code on a 503 (no answer) or a 502 (refused, or payments off) from the payment provider. */
const PAYMENT_PROVIDER_UNAVAILABLE = 'PAYMENT_PROVIDER_UNAVAILABLE'

/** The tenant a billing write is for, so an outage's sentence can name it and its provider. */
export interface BillingWriteContext {
  tenantName: string
  provider: StaffTenantBilling['provider']
}

/**
 * How long to wait, from `Retry-After`: "30 seconds", "1 second", or "a
 * minute" when the header is missing; minutes from 120 seconds up.
 * @param error - The refusal.
 */
function waitFrom(error: unknown): string {
  const seconds = retryAfterSecondsFrom(error)
  if (seconds === null) return 'a minute'
  if (seconds >= 120) return `${String(Math.ceil(seconds / 60))} minutes`
  return `${String(seconds)} ${nounFor(seconds, 'seconds')}`
}

/**
 * A billing outage in staff words. Express masks every 5xx body ("Our server
 * hit an error … contact support"), so only the code and `Retry-After`
 * reach the page; this words the two codes a billing write meets:
 * - 503 `BILLING_BUSY`: the row kept moving (a resync, a cancel), so wait;
 * - 503 `PAYMENT_PROVIDER_UNAVAILABLE`: the provider didn't answer, so wait;
 * - 502 `PAYMENT_PROVIDER_UNAVAILABLE`: the provider refused, or payments
 *   are off while a subscription is held, so look in its dashboard.
 * @param error - The refusal.
 * @param context - The tenant, when the write is for one.
 * @returns The sentence, or undefined for any other refusal.
 */
export function billingOutageMessage(
  error: unknown,
  context?: BillingWriteContext
): string | undefined {
  const code = codeFrom(error)
  const status = statusFrom(error)
  if (code === BILLING_BUSY && status === 503) {
    const whose = context === undefined ? 'Billing' : `Billing for ${context.tenantName}`
    return `${whose} is updating. Try again in ${waitFrom(error)}.`
  }
  if (code !== PAYMENT_PROVIDER_UNAVAILABLE) return undefined
  const provider = providerName(context?.provider ?? null, { sentenceStart: true })
  const owned = provider === 'Razorpay' ? 'Razorpay’s' : 'the payment provider’s'
  if (status === 503) {
    return `${provider} didn’t answer. Try again in ${waitFrom(error)}. If it keeps failing, check ${owned} status page.`
  }
  if (status === 502) {
    const tenant = context === undefined ? 'the tenant' : context.tenantName
    return `${provider} didn’t accept this request. Check ${tenant} in ${owned} dashboard.`
  }
  return undefined
}

/**
 * Shows a refused billing write inside its own dialog, as `ReasonDialog`
 * shows one: a declined step-up as the step-up's sentence, a reason refusal
 * on the Reason field, a role gate's 404 (the route code, or none) as the
 * role sentence and any other 404 (`grant_not_found`) as the API's, a 403
 * or 409 as the API's sentence (`staffMessageFrom`), a busy row or a
 * provider outage in staff words (`billingOutageMessage`, since express masks
 * the 5xx body), and anything else through `capture`, which shows field
 * errors on their fields.
 * @param serverErrors - The dialog form's server errors.
 * @param error - The write's rejection.
 * @param context - The tenant, for a write on one.
 */
export function refuseInForm(
  serverErrors: ServerErrors,
  error: unknown,
  context?: BillingWriteContext
): void {
  if (isReauthRequired(error)) {
    serverErrors.setFormErrors([stepUpRefusal(error)])
    return
  }
  const code = codeFrom(error)
  if (code === REASON_REQUIRED) {
    serverErrors.setFieldError('reason', [staffMessageFrom(error)])
    return
  }
  const status = statusFrom(error)
  if (status === 404) {
    serverErrors.setFormErrors([
      code === undefined || code === ROUTE_NOT_FOUND ? ROLE_DENIED_ACTION : staffMessageFrom(error),
    ])
    return
  }
  if (status === 403 || status === 409) {
    serverErrors.setFormErrors([staffMessageFrom(error)])
    return
  }
  const outage = billingOutageMessage(error, context)
  if (outage !== undefined) {
    serverErrors.setFormErrors([outage])
    return
  }
  serverErrors.capture(error)
}
