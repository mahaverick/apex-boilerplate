/**
 * @file Step-up support outside React: recognising the API's `REAUTH_REQUIRED`
 * 401, and telling whether a refusal is already out of date because a fresher
 * token has landed since the request went out.
 */
import axios from 'axios'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { useAuthStore } from '@/states/auth.store'
import { REAUTH_REQUIRED } from '@/types/api.types'

/** Whether a failed request was refused for a sign-in that is too old for it. */
export function isReauthRequired(error: unknown): boolean {
  return statusFrom(error) === 401 && codeFrom(error) === REAUTH_REQUIRED
}

/**
 * Whether a refused request carried the token the store holds now. False
 * means another action's confirmation swapped a fresher token in while this
 * request was in flight, so its refusal is already out of date and a plain
 * retry will do. Anything that can't be compared counts as current.
 * @param error - The rejection `isReauthRequired` recognised.
 * @returns False only when the request provably used an older token.
 */
export function sentWithCurrentToken(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return true
  const sent = error.config?.headers.get('Authorization')
  const current = useAuthStore.getState().accessToken
  return typeof sent !== 'string' || current === null || sent === `Bearer ${current}`
}
