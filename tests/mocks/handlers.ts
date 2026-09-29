import { http, HttpResponse } from 'msw'
import { USER_ID } from '@/tests/fixtures/ids'
import type { InvitationPreview, PlatformStats, User } from '@/types/api.types'

/** A platform admin: every in-app surface is staff-only, so a test about non-staff says `platformRole: null`. */
export const testUser: User = {
  id: USER_ID,
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: 'admin',
}

/** 43 characters of base64url, the shape the server mints and validates. */
export const TEST_INVITATION_TOKEN = 'inv-token-'.padEnd(43, 'x')

/** Sent to `testUser`'s own address, so a signed-in test user is the invitee. */
export const testInvitationPreview: InvitationPreview = {
  tenant: { name: 'Acme Corp', slug: 'acme' },
  role: 'editor',
  invitedBy: { firstName: 'Ada', lastName: 'Lovelace' },
  email: testUser.email,
}

/** Seven days ending 2026-09-29, with one failed send attempt, so every widget has something to draw. */
export const testStats: PlatformStats = {
  range: '7d',
  totals: { tenants: 1284, users: 9730, staff: 18 },
  signups: ['23', '24', '25', '26', '27', '28', '29'].map((day, index) => ({
    date: `2026-09-${day}`,
    users: 20 + index * 3,
    tenants: 2 + (index % 3),
  })),
  emails: ['23', '24', '25', '26', '27', '28', '29'].map((day, index) => ({
    date: `2026-09-${day}`,
    sent: 500 + index * 10,
    failed: index === 3 ? 1 : 0,
  })),
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
  // The shell lands on Overview after every sign-in, and Overview reads these. A test about the stats overrides it.
  http.get('/api/v1/platform/stats', () => ok(testStats, 'Platform stats retrieved.')),
  // The platform audit log, empty. A test about activity overrides it.
  http.get('/api/v1/platform/audit-log', () =>
    ok({ entries: [], nextCursor: null }, 'Audit log retrieved.')
  ),
]
