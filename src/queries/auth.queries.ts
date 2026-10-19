import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ROUTES } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import {
  broadcastAuthMessage,
  broadcastLogout,
  ensureSession,
  isAuthVerdict,
  switchIdentity,
} from '@/http/session'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { toast } from '@/lib/toast'
import { track } from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'
import {
  ACCESS_TOKEN_EXPIRED,
  type ApiSuccess,
  type AuthProviders,
  type User,
} from '@/types/api.types'

/** Which frontend the API should link back to: this one. The API accepts only 'web' or 'apex'. */
const APP = 'apex' as const

/** What `POST /auth/link/verify` answers: the session, whether this click created the account, and the path stored with the link. */
interface LinkSignIn {
  accessToken: string
  user: User
  isNewUser: boolean
  redirect: string | null
}

/**
 * What a sign-in link verify posts: the token, and the address the link names
 * when it names one; a blank one is left out. The server refuses an address
 * that is not the token's own, so a page can show it while verifying without
 * trusting the URL.
 */
interface SignInLinkVerifyInput {
  token: string
  email?: string | undefined
}

/** The key of the caller's linked sign-in methods, `['auth', 'providers']`. */
export const authKeys = { providers: ['auth', 'providers'] as const }

/**
 * Requests a sign-in link that opens this app. The API answers 202 whether or
 * not the address has an account, so success says nothing about the address.
 * `redirect` is the same-origin path to land on after signing in; it is left
 * out when absent. No bearer token and no refresh retry: the request is public.
 */
export function useRequestSignInLink() {
  return useMutation({
    mutationFn: async (input: { email: string; redirect?: string }) => {
      await apiClient.post<ApiSuccess<null>>(
        '/auth/link/request',
        { email: input.email, app: APP, redirect: input.redirect },
        { skipAuthRetry: true, headers: { Authorization: false } }
      )
    },
    onSuccess: () => track('sign_in_link_requested'),
  })
}

/**
 * Signs in with the token from an emailed link. Public like the request, so a
 * stale bearer token is never sent. The link's address goes with the token,
 * so the server refuses a link whose address was swapped for someone else's.
 * A different signed-in user is switched out first (`switchIdentity`). The
 * store is signed in before `sign_in_completed` is tracked, so the event
 * carries the new identity.
 */
export function useVerifySignInLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ token, email }: SignInLinkVerifyInput) => {
      // The API counts an empty or blank address as a mismatch, so a link without one sends none.
      const address = email?.trim()
      return unwrap(
        await apiClient.post<ApiSuccess<LinkSignIn>>(
          '/auth/link/verify',
          address ? { token, email: address } : { token },
          { skipAuthRetry: true, headers: { Authorization: false } }
        )
      )
    },
    onSuccess: ({ accessToken, user }) => {
      switchIdentity(queryClient, user.id)
      useAuthStore.getState().login(accessToken, user)
      track('sign_in_completed', { method: 'link' })
    },
  })
}

/** Posts a step-up link's token with the current bearer, refusing the interceptor's refresh-and-retry. */
async function postStepUpLink(token: string) {
  return unwrap(
    await apiClient.post<ApiSuccess<{ accessToken: string }>>(
      '/auth/step-up/link/verify',
      { token },
      { skipAuthRetry: true }
    )
  )
}

/**
 * Confirms it's the signed-in person with the token from an emailed "Confirm
 * it's you" link (express `POST /auth/step-up/link/verify`). It carries this
 * session's bearer, because the API binds the link to the session that asked
 * for it.
 *
 * An expired access token (401 `ACCESS_TOKEN_EXPIRED`) is refreshed once
 * through `ensureSession()` and the token posted again; the refresh keeps the
 * session id, so the binding still holds. The interceptor's own retry is
 * skipped because its verdict path calls `redirectToLogin()`, which would
 * carry the token into `/login?redirect=`. A refresh verdict rejects with the
 * original 401, which the page reads as the session's end; any other refresh
 * failure rejects with that failure, which leaves the link usable.
 *
 * On success it swaps in the new access token, whose `auth_time` is now, and
 * tells the waiting tab, which refreshes and retries its action.
 */
export function useConfirmStepUpLink() {
  return useMutation({
    mutationFn: async (token: string) => {
      try {
        return await postStepUpLink(token)
      } catch (error) {
        if (statusFrom(error) !== 401 || codeFrom(error) !== ACCESS_TOKEN_EXPIRED) throw error
        try {
          await ensureSession()
        } catch (refreshError) {
          throw isAuthVerdict(refreshError) ? error : refreshError
        }
        return postStepUpLink(token)
      }
    },
    onSuccess: ({ accessToken }) => {
      useAuthStore.getState().setToken(accessToken)
      broadcastAuthMessage('step_up_confirmed')
    },
  })
}

/** The sign-in methods linked to the caller's account, and whether it has a password. */
export function useAuthProviders() {
  return useQuery({
    queryKey: authKeys.providers,
    queryFn: async () => unwrap(await apiClient.get<ApiSuccess<AuthProviders>>('/auth/providers')),
  })
}

/** What `POST /auth/sessions/revoke-others` answers: how many other sessions it ended. */
export interface RevokedSessions {
  revoked: number
}

/**
 * Signs the caller out everywhere but here: the API revokes every other
 * session of this user and keeps the current one. It sends an empty JSON
 * object, the body the API documents for the route.
 */
export function useRevokeOtherSessions() {
  return useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.post<ApiSuccess<RevokedSessions>>('/auth/sessions/revoke-others', {})),
  })
}

const LOGOUT_FAILED_MESSAGE = "Couldn't sign out. Check your connection and try again."

/** Names the sign-out mutation, so every sign-out control sees one in flight. */
const LOGOUT_KEY = ['auth', 'logout'] as const

/**
 * Whether a sign-out is in flight anywhere, from any control that started it.
 * @returns True while a `useLogout` mutation is pending.
 */
export function useLogoutPending(): boolean {
  return useIsMutating({ mutationKey: LOGOUT_KEY }) > 0
}

/**
 * Signs out server-side first; the local session ends only once the server's has.
 * `returnTo` is the same-origin path to land on afterwards, `/login` by default.
 */
export function useLogout({ returnTo = ROUTES.login }: { returnTo?: string } = {}) {
  const logout = useAuthStore((s) => s.logout)
  /** Ends this tab's session, tells the other tabs, and leaves for `returnTo`. */
  const endSession = () => {
    logout()
    broadcastLogout()
    window.location.assign(returnTo)
  }
  return useMutation({
    mutationKey: LOGOUT_KEY,
    // skipAuthRetry: onError below alone decides what a failed logout means.
    mutationFn: async () =>
      apiClient.post<ApiSuccess<unknown>>('/auth/logout', undefined, { skipAuthRetry: true }),
    onSuccess: endSession,
    onError: (error) => {
      // A 401 is taken as the session already over; no response, 5xx or 429 leave it alive.
      if (statusFrom(error) === 401) {
        endSession()
        return
      }
      toast.error(LOGOUT_FAILED_MESSAGE)
    },
  })
}

/**
 * Confirms the signed-in user's password for a step-up (express
 * `POST /auth/reauthenticate`) and swaps in the fresh access token it
 * returns, which carries a fresh `auth_time`. A wrong password is a 400, never
 * a 401, so the interceptor never reads it as a verdict on the session.
 */
export function useReauthenticate() {
  const setToken = useAuthStore((s) => s.setToken)
  return useMutation({
    mutationFn: async (password: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<{ accessToken: string }>>('/auth/reauthenticate', {
          password,
        })
      ),
    onSuccess: (data) => setToken(data.accessToken),
  })
}
