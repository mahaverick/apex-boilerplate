import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { switchIdentity } from '@/http/session'
import { statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { track } from '@/observability/telemetry'
import { refreshProfile } from '@/queries/profile.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import type {
  AcceptedInvitation,
  ApiSuccess,
  InvitationPreview,
  InvitationSignIn,
  InvitationVerifyResult,
} from '@/types/api.types'

/** Query keys for invitation previews, one per token. */
export const invitationKeys = {
  preview: (token: string) => ['invitations', 'preview', token] as const,
}

/**
 * What an invite link opens onto. Public, and asked as a stranger even when
 * someone is signed in: no bearer token is sent (a `false` header makes the
 * request interceptor skip it, and axios drops it from the wire), and
 * `skipAuthRetry` keeps a 401 here from being read as a verdict on the
 * session. A POST with the token in the body, so it stays out of URLs and
 * access logs.
 *
 * A 404 is the answer ("invalid or expired"), so it is not retried; anything
 * else is retried once, as the app's query client does.
 */
export function useInvitationPreview(token: string | undefined) {
  return useQuery({
    queryKey: invitationKeys.preview(token ?? ''),
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.post<ApiSuccess<InvitationPreview>>(
          '/invitations/preview',
          { token },
          {
            headers: { Authorization: false },
            skipAuthRetry: true,
            signal,
          }
        )
      ),
    enabled: Boolean(token),
    retry: (failureCount, error) => statusFrom(error) !== 404 && failureCount < 1,
  })
}

/**
 * Accepts as the signed-in user. Expected refusals are 403 (wrong or
 * unverified email) and 404 (invalid, expired or used); a 401 here is a real
 * session verdict, handled by the interceptor like any other.
 *
 * On success the tenant's member list is invalidated, since the caller is now
 * on it: an observed list refetches at once, an unobserved one on its next
 * mount. The profile refreshes, since accepting into the platform tenant
 * changes the stored user's platformRole.
 */
export function useAcceptInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<AcceptedInvitation>>('/invitations/accept', { token })
      ),
    onSuccess: async ({ tenant }) => {
      await queryClient.invalidateQueries({ queryKey: tenantKeys.members(tenant.slug) })
      await refreshProfile(queryClient)
    },
  })
}

/**
 * Stores a session an invitation link signed in: a different signed-in user is
 * switched out first (`switchIdentity`), and the store is signed in before
 * `sign_in_completed` is tracked, so the event carries the new identity. The
 * response's user already carries the role the join gave, so the profile needs
 * no refresh. The tenant's member list is invalidated, since the caller is now
 * on it.
 */
async function signInJoined(queryClient: QueryClient, joined: InvitationSignIn): Promise<void> {
  switchIdentity(queryClient, joined.user.id)
  useAuthStore.getState().login(joined.accessToken, joined.user)
  track('sign_in_completed', { method: 'link' })
  await queryClient.invalidateQueries({ queryKey: tenantKeys.members(joined.tenant.slug) })
}

/** True for the `202` "Check your inbox" answer of a verify, which carries no session. */
export function isConfirmationSent(
  result: InvitationVerifyResult
): result is Extract<InvitationVerifyResult, { confirmationSent: true }> {
  return 'confirmationSent' in result
}

/**
 * Opens an invitation signed out. Every staff invitation answers `202` "Check
 * your inbox": the server mails a confirmation link, and the answer sets no
 * session and switches no one out. The one-click `200`, which signs a new
 * address in and joins it, stays handled because the API keeps it. Posting
 * again with the same token is the resend. Public like the preview, so a stale
 * bearer token is never sent. A 404 is the dead invitation.
 */
export function useVerifyInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<InvitationVerifyResult>>(
          '/invitations/verify',
          { token },
          { skipAuthRetry: true, headers: { Authorization: false } }
        )
      ),
    onSuccess: async (result) => {
      if (isConfirmationSent(result)) return
      await signInJoined(queryClient, result)
    },
  })
}

/** What a confirm posts: the mailed link's token, and the address the link names. */
interface ConfirmInvitationInput {
  token: string
  email?: string | undefined
}

/**
 * Finishes joining from the emailed confirmation link: the server signs in the
 * invited address, replacing any session this browser had, and joins it. The
 * link's address goes with the token, so the server refuses a link whose
 * address was swapped; a blank one is left out. Public like the verify. A 404
 * is the dead link, whatever its cause.
 */
export function useConfirmInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ token, email }: ConfirmInvitationInput) => {
      // The API counts a blank address as a mismatch, so a link without one sends none.
      const address = email?.trim()
      return unwrap(
        await apiClient.post<ApiSuccess<InvitationSignIn>>(
          '/invitations/confirm',
          address ? { token, email: address } : { token },
          { skipAuthRetry: true, headers: { Authorization: false } }
        )
      )
    },
    onSuccess: (joined) => signInJoined(queryClient, joined),
  })
}

/** "Ada Lovelace", or "A teammate" when there is no name on file or no inviter. */
export function inviterName(
  inviter: { firstName: string | null; lastName: string | null } | null
): string {
  return fullName(inviter) ?? 'A teammate'
}
