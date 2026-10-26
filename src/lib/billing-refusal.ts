import type { ServerErrors } from '@/hooks/use-server-errors'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { ROLE_DENIED_ACTION, staffMessageFrom } from '@/lib/staff-message'
import { isReauthRequired, stepUpRefusal } from '@/lib/step-up'
import { REASON_REQUIRED, ROUTE_NOT_FOUND } from '@/types/api.types'

/** The statuses whose sentence is the API's verdict on the write, shown as is. */
const VERDICT_STATUSES = new Set([403, 409, 502, 503])

/**
 * Shows a refused billing write inside its own dialog, as `ReasonDialog`
 * shows one: a declined step-up as the step-up's sentence, a reason refusal
 * on the Reason field, a role gate's 404 (the route code, or none) as the
 * role sentence and any other 404 (`grant_not_found`) as the API's, a 403,
 * 409, 502 or 503 as the API's sentence (`staffMessageFrom`), and anything
 * else, field errors included, through `capture`.
 * @param serverErrors - The dialog form's server errors.
 * @param error - The write's rejection.
 */
export function refuseInForm(serverErrors: ServerErrors, error: unknown): void {
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
  if (status !== undefined && VERDICT_STATUSES.has(status)) {
    serverErrors.setFormErrors([staffMessageFrom(error)])
    return
  }
  serverErrors.capture(error)
}
