import { http, HttpResponse } from 'msw'
import type { MembershipRole } from '@/constants/roles'
import {
  EMAIL_ATTEMPT_ID,
  EMAIL_EVENT_ID,
  EMAIL_ID,
  INVITATION_ID,
  SUPPRESSION_ID,
  TENANT_ID,
  USER_ID,
  USER_ID_2,
} from '@/tests/fixtures/ids'
import type {
  EmailHealth,
  EmailMessageDay,
  EmailMessageDetail,
  EmailMessageSummary,
  EmailPreview,
  EmailSuppression,
  InvitationPreview,
  PlatformStats,
  TenantAccess,
  TenantInvitation,
  User,
} from '@/types/api.types'

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

/** The seven UTC days the stats and health fixtures cover, ending 2026-09-29. */
const FIXTURE_DAYS = ['23', '24', '25', '26', '27', '28', '29'].map((day) => `2026-09-${day}`)

/** Every group non-zero on some day, three undelivered, one complained and one suppressed mail, so each series draws. */
const EMAIL_MESSAGE_DAYS: EmailMessageDay[] = FIXTURE_DAYS.map((date, index) => ({
  date,
  delivered: 400 + index * 10,
  sent: 90 + index,
  undelivered: index === 3 ? 2 : index === 4 ? 1 : 0,
  complained: index === 5 ? 1 : 0,
  suppressed: index === 6 ? 1 : 0,
}))

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
  emailMessages: EMAIL_MESSAGE_DAYS,
}

/** Sums one group over the fixture days. */
function total(group: keyof Omit<EmailMessageDay, 'date'>): number {
  return EMAIL_MESSAGE_DAYS.reduce((sum, day) => sum + day[group], 0)
}

/** A rate from its parts, as the API reports it. */
function rate(numerator: number, denominator: number) {
  return { value: denominator === 0 ? null : numerator / denominator, numerator, denominator }
}

const LEFT_SERVER = total('delivered') + total('sent') + total('undelivered') + total('complained')

/** Undelivered emails that were hard bounces: fewer than all of them, so the two rates differ. */
const HARD_BOUNCED = 1

/** Two-way splits of `LEFT_SERVER` for the breakdown rows: the first part, and what is left. */
const TEMPLATE_SPLIT = Math.floor(LEFT_SERVER * 0.6)
const DOMAIN_SPLIT = Math.floor(LEFT_SERVER * 0.5)

/** The same seven days as a health report from an install whose provider webhook is live. */
export const testEmailHealth: EmailHealth = {
  range: '7d',
  totals: {
    messages: LEFT_SERVER,
    delivered: total('delivered'),
    sent: total('sent'),
    undelivered: total('undelivered'),
    complained: total('complained'),
    suppressed: total('suppressed'),
    providerEvents: total('delivered') + 120,
  },
  rates: {
    undeliveredRate: rate(total('undelivered'), LEFT_SERVER),
    deliveredRate: rate(total('delivered'), LEFT_SERVER),
    bounceRate: rate(HARD_BOUNCED, LEFT_SERVER),
    complaintRate: rate(total('complained'), LEFT_SERVER),
    openRate: rate(40, 100),
    clickRate: rate(5, 100),
  },
  days: EMAIL_MESSAGE_DAYS,
  byTemplate: [
    {
      key: 'email_verification',
      messages: TEMPLATE_SPLIT,
      undelivered: total('undelivered'),
      complained: 0,
    },
    {
      key: 'tenant_invitation',
      messages: LEFT_SERVER - TEMPLATE_SPLIT,
      undelivered: 0,
      complained: total('complained'),
    },
  ],
  byDomain: [
    {
      key: 'example.com',
      messages: DOMAIN_SPLIT,
      undelivered: total('undelivered'),
      complained: total('complained'),
    },
    { key: 'acme.test', messages: LEFT_SERVER - DOMAIN_SPLIT, undelivered: 0, complained: 0 },
  ],
}

/**
 * One row of `GET /platform/emails`: Cleo's delivered invitation to Acme,
 * resendable by the signed-in admin.
 * @param overrides - Fields to replace.
 * @returns The row.
 */
export function emailSummary(overrides: Partial<EmailMessageSummary> = {}): EmailMessageSummary {
  return {
    id: EMAIL_ID,
    recipient: 'cleo@example.com',
    templateKey: 'tenant_invitation',
    status: 'delivered',
    senderClass: 'transactional',
    createdAt: '2026-09-29T10:00:00.000Z',
    statusUpdatedAt: '2026-09-29T10:00:05.000Z',
    user: { id: USER_ID_2, name: 'Cleo Doe' },
    tenant: { id: TENANT_ID, name: 'Acme Corp', slug: 'acme' },
    canResend: true,
    ...overrides,
  }
}

/**
 * `GET /platform/emails/:id` for `emailSummary`: one attempt, one provider
 * event, no suppression, never resent.
 * @param overrides - Fields to replace.
 * @returns The detail.
 */
export function emailDetail(overrides: Partial<EmailMessageDetail> = {}): EmailMessageDetail {
  return {
    ...emailSummary(),
    linkApp: 'web',
    failureOrigin: null,
    attempts: [
      {
        id: EMAIL_ATTEMPT_ID,
        status: 'sent',
        errorCode: null,
        createdAt: '2026-09-29T10:00:01.000Z',
      },
    ],
    events: [
      {
        id: EMAIL_EVENT_ID,
        provider: 'resend',
        type: 'delivered',
        bounceKind: null,
        detail: null,
        occurredAt: '2026-09-29T10:00:05.000Z',
      },
    ],
    suppression: null,
    resentFromId: null,
    resentAsIds: [],
    ...overrides,
  }
}

/** The invitation re-rendered, its accept link masked, every value on file. */
export const testEmailPreview: EmailPreview = {
  subject: 'You have been invited to Acme Corp',
  html: '<p style="color:#111">A teammate invited you to join Acme Corp as Editor.</p><p><a href="http://localhost:5173/invitations/accept?token=••••••">Accept</a></p>',
  text: 'A teammate invited you to join Acme Corp as Editor.\n\nAccept: http://localhost:5173/invitations/accept?token=••••••',
  partial: false,
}

/**
 * One row of `GET /platform/email-suppressions`: an active hard-bounce
 * suppression on Cleo's address, from `emailSummary`'s message.
 * @param overrides - Fields to replace.
 * @returns The row.
 */
export function emailSuppression(overrides: Partial<EmailSuppression> = {}): EmailSuppression {
  return {
    id: SUPPRESSION_ID,
    address: 'cleo@example.com',
    reason: 'hard_bounce',
    sourceMessageId: EMAIL_ID,
    createdAt: '2026-09-29T11:00:00.000Z',
    liftedAt: null,
    liftedBy: null,
    liftReason: null,
    ...overrides,
  }
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
  // The shell lands on Overview after every sign-in, and Overview reads these. A test about the stats overrides it.
  http.get('/api/v1/platform/stats', () => ok(testStats, 'Platform stats retrieved.')),
  // The platform audit log, empty. A test about activity overrides it.
  http.get('/api/v1/platform/audit-log', () =>
    ok({ entries: [], nextCursor: null }, 'Audit log retrieved.')
  ),
  // The email pages, a user's Emails card and a tenant's Emails tab read these; empty lists, so a page that only embeds one renders unchanged. Health is registered before `:emailId`, which would otherwise match it.
  http.get('/api/v1/platform/emails', () =>
    ok({ messages: [], nextCursor: null, prevCursor: null }, 'Emails retrieved.')
  ),
  http.get('/api/v1/platform/emails/health', () => ok(testEmailHealth, 'Email health retrieved.')),
  http.get('/api/v1/platform/emails/:emailId', ({ params }) =>
    ok(emailDetail({ id: String(params.emailId) }), 'Email retrieved.')
  ),
  http.get('/api/v1/platform/emails/:emailId/preview', () =>
    ok(testEmailPreview, 'Email preview rendered.')
  ),
  http.post('/api/v1/platform/emails/:emailId/resend', () => ok({}, 'Resend requested.', 202)),
  http.get('/api/v1/platform/email-suppressions', () =>
    ok({ suppressions: [], nextCursor: null, prevCursor: null }, 'Suppressions retrieved.')
  ),
  http.post('/api/v1/platform/email-suppressions/:suppressionId/lift', () =>
    ok(
      emailSuppression({
        liftedAt: '2026-09-30T09:00:00.000Z',
        liftedBy: { id: USER_ID, name: 'A B' },
        liftReason: 'Mailbox fixed',
      }),
      'Suppression lifted.'
    )
  ),
]
