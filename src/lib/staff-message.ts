import { codeFrom, messageFrom } from '@/lib/api-error'
import { ROUTE_NOT_FOUND } from '@/types/api.types'

/** A 404 from a staff route answers the caller's role: it changed after the page loaded. */
export const ROLE_DENIED_ACTION =
  'Your role no longer allows this action. Ask a platform owner to check your role.'

/**
 * The sentence a failed staff request shows: `ROLE_DENIED_ACTION` for
 * express's route code `not_found`, which every role-gate refusal answers
 * with and whose own sentence is for developers; the shared `messageFrom`
 * otherwise. Use it wherever apex shows a refusal's text.
 * @param error - A query or mutation error.
 */
export function staffMessageFrom(error: unknown): string {
  return codeFrom(error) === ROUTE_NOT_FOUND ? ROLE_DENIED_ACTION : messageFrom(error)
}
