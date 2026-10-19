import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MembershipRole } from '@/constants/roles'
import { apiClient, unwrap } from '@/http/client'
import { switchIdentity } from '@/http/session'
import { statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { track } from '@/observability/telemetry'
import { refreshProfile } from '@/queries/profile.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import type { AcceptedInvitation, ApiSuccess, InvitationPreview, User } from '@/types/api.types'

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
    queryFn: async () =>
      unwrap(
        await apiClient.post<ApiSuccess<InvitationPreview>>(
          '/invitations/preview',
          { token },
          {
            headers: { Authorization: false },
            skipAuthRetry: true,
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

/** What `POST /invitations/verify` answers: the session, whether this click created the account, and the tenant joined. */
interface InvitationSignIn {
  accessToken: string
  user: User
  isNewUser: boolean
  tenant: { name: string; slug: string }
  role: MembershipRole
}

/**
 * Accepts an invitation in one click, signed out: the API signs the invitee in
 * and joins them. Public like the preview, so a stale bearer token is never
 * sent. The response's user already carries the role the join gave, so the
 * profile needs no refresh. A different signed-in user is switched out first
 * (`switchIdentity`). A 404 is the dead invitation.
 *
 * On success the tenant's member list is invalidated, since the caller is now
 * on it.
 */
export function useVerifyInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<InvitationSignIn>>(
          '/invitations/verify',
          { token },
          { skipAuthRetry: true, headers: { Authorization: false } }
        )
      ),
    onSuccess: async ({ accessToken, user, tenant }) => {
      switchIdentity(queryClient, user.id)
      useAuthStore.getState().login(accessToken, user)
      track('sign_in_completed', { method: 'link' })
      await queryClient.invalidateQueries({ queryKey: tenantKeys.members(tenant.slug) })
    },
  })
}

/** "Ada Lovelace", or "A teammate" when there is no name on file or no inviter. */
export function inviterName(
  inviter: { firstName: string | null; lastName: string | null } | null
): string {
  return fullName(inviter) ?? 'A teammate'
}
