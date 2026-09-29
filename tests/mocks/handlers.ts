import { http, HttpResponse } from 'msw'
import type { MembershipRole } from '@/constants/roles'
import { INVITATION_ID, USER_ID } from '@/tests/fixtures/ids'
import type { InvitationPreview, TenantAccess, TenantInvitation, User } from '@/types/api.types'

export const testUser: User = {
  id: USER_ID,
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: null,
}

/** 43 characters of base64url, the shape the server mints and validates. */
export const TEST_INVITATION_TOKEN = 'inv-token-'.padEnd(43, 'x')

/** express's one answer to an invite and to a resend, whether or not the address has an account. */
export const INVITATION_SENT_MESSAGE =
  'If that address can be invited, an invitation has been sent.'

/** One pending row, as `GET /tenants/:slug/invitations` lists it. */
export const testInvitation: TenantInvitation = {
  id: INVITATION_ID,
  email: 'invitee@b.com',
  role: 'editor',
  invitedBy: { id: USER_ID, firstName: 'A', lastName: 'B' },
  expiresAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-09-24T00:00:00.000Z',
}

/** Sent to `testUser`'s own address, so a signed-in test user is the invitee. */
export const testInvitationPreview: InvitationPreview = {
  tenant: { name: 'Acme Corp', slug: 'acme' },
  role: 'editor',
  invitedBy: { firstName: 'Ada', lastName: 'Lovelace' },
  email: testUser.email,
}

export function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return HttpResponse.json({ success: true, message, statusCode, data }, { status: statusCode })
}

export function fail(message: string, statusCode: number, code?: string) {
  return HttpResponse.json(
    { success: false, message, statusCode, code, requestId: 'test-request-id' },
    { status: statusCode }
  )
}

/**
 * `GET /tenants/:slug` as the API answers it: the tenant row plus the
 * caller's EFFECTIVE role there and how they reached it. `useMyRole` reads
 * the role from here, so a detail mock without it renders the role error.
 */
export function tenantDetail<T extends object>(
  tenant: T,
  role: MembershipRole,
  access: TenantAccess = 'member'
) {
  return { ...tenant, isPlatform: false, role, access }
}

export const handlers = [
  http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Token refreshed.')),
  http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.')),
  // Express answers every registration this way, free address or taken: no user, ever.
  http.post('/api/v1/auth/register', () =>
    ok(null, 'If that address can be registered, a verification email has been sent.', 202)
  ),
  // The profile page's Security section fetches this whenever /profile mounts. A password account; a test about Google or a failed load overrides it.
  http.get('/api/v1/auth/providers', () =>
    ok(
      {
        providers: [{ provider: 'email', linkedAt: '2026-01-01T00:00:00.000Z' }],
        hasPassword: true,
      },
      'Auth providers retrieved.'
    )
  ),
  http.post('/api/v1/invitations/preview', () =>
    ok(testInvitationPreview, 'Invitation retrieved.')
  ),
  http.post('/api/v1/invitations/accept', () =>
    ok(
      { tenant: testInvitationPreview.tenant, role: testInvitationPreview.role },
      'Invitation accepted.'
    )
  ),
  // Both audit logs, empty. A test about activity overrides them.
  http.get('/api/v1/tenants/:slug/audit-log', () =>
    ok({ entries: [], nextCursor: null }, 'Audit log retrieved.')
  ),
  http.get('/api/v1/platform/audit-log', () =>
    ok({ entries: [], nextCursor: null }, 'Audit log retrieved.')
  ),
]
