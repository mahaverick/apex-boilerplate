import { http, HttpResponse } from 'msw'
import type { MembershipRole } from '@/constants/roles'
import type { ClientFlagValues } from '@/observability/flags/flag-types'
import { testBillingSettings, testPlans, testTenantBilling } from '@/tests/fixtures/billing'
import { flagRows, flagsMeta, unregisteredRows } from '@/tests/fixtures/flags'
import {
  AUDIT_ID_4,
  EMAIL_ATTEMPT_ID,
  EMAIL_EVENT_ID,
  EMAIL_ID,
  INVITATION_ID,
  STAFF_USER_ID,
  SUPPRESSION_ID,
  TENANT_ID,
  USER_ID,
  USER_ID_2,
  USER_ID_3,
} from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { maintenanceModeView } from '@/tests/fixtures/maintenance-mode'
import { USER_HANDLE } from '@/tests/fixtures/user-handle'
import type {
  EmailHealth,
  EmailMessageDay,
  EmailMessageDetail,
  EmailMessageSummary,
  EmailPreview,
  EmailSuppression,
  InvitationPreview,
  OnboardingFunnel,
  OnboardingReminderView,
  OnboardingStepDetail,
  OnboardingTenantRow,
  PlatformStats,
  PlatformUserDetail,
  SystemStatus,
  TenantAccess,
  TenantInvitation,
  TenantOnboardingDetail,
  User,
} from '@/types/api.types'

/** A platform admin. Every in-app surface is staff-only, so a test about a non-staff user sets `platformRole: null`. */
export const testUser: User = {
  id: USER_ID,
  email: 'a.b@example.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: 'admin',
  analyticsOptOut: false,
}

/** `testUser` as `GET /platform/users/:userId` answers it: an active platform admin in no customer tenant. */
export const testUserDetail: PlatformUserDetail = {
  id: testUser.id,
  email: testUser.email,
  firstName: testUser.firstName,
  lastName: testUser.lastName,
  active: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lastLoggedInAt: '2026-01-02T00:00:00.000Z',
  createdAt: testUser.createdAt,
  deletedAt: null,
  platformRole: 'admin',
  membershipCount: 0,
  authProviders: ['email'],
  memberships: [],
  pendingInvitations: [],
}

/** 43 characters of base64url, the shape the server mints and validates. */
export const TEST_INVITATION_TOKEN = 'inv-token-'.padEnd(43, 'x')

/** express's one answer to an invite and to a resend, whether or not the address has an account. */
export const INVITATION_SENT_MESSAGE = 'If we can invite that address, we sent it an invitation.'

/** One pending row, as `GET /tenants/:slug/invitations` lists it. */
export const testInvitation: TenantInvitation = {
  id: INVITATION_ID,
  email: 'invited@example.com',
  role: 'editor',
  invitedBy: { id: USER_ID, firstName: 'A', lastName: 'B' },
  expiresAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-09-24T00:00:00.000Z',
  lastSentAt: null,
  resendAvailableAt: null,
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

/** Seven days ending 2026-09-29, so every widget has something to draw. */
export const testStats: PlatformStats = {
  range: '7d',
  totals: { tenants: 1284, users: 9730, staff: 18, stuckTenants: 6 },
  signups: ['23', '24', '25', '26', '27', '28', '29'].map((day, index) => ({
    date: `2026-09-${day}`,
    users: 20 + index * 3,
    tenants: 2 + (index % 3),
  })),
  emailMessages: EMAIL_MESSAGE_DAYS,
}

/** A healthy API: error tracking on, events sent, nothing dropped or refused. */
export const testSystemStatus: SystemStatus = {
  release: '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
  errorTracking: {
    enabled: true,
    window: '15m',
    sent: 42,
    dropped: { throttled: 0, buffer_full: 0, rejected: 0, retry_exhausted: 0 },
    lastSendOkAt: '2026-10-04T10:00:00.000Z',
    lastSendError: null,
  },
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

/** The invitation email re-rendered for staff, its accept token masked as bullets. */
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

/**
 * Thirty days of onboarding: 40 tenants started, split by current state,
 * and the four default steps, two with staff completions so both bar fills
 * draw. 52 tenants are tracked in all, so the page is not the empty state.
 */
export const testOnboardingFunnel: OnboardingFunnel = {
  range: '30d',
  from: '2026-08-31T00:00:00.000Z',
  totals: { started: 40, inProgress: 18, stuck: 6, complete: 14, dismissed: 2 },
  completionRate: 14 / 40,
  steps: [
    {
      key: 'configure_settings',
      title: 'Configure your workspace',
      scope: 'tenant',
      required: true,
      completed: 30,
      staffCompleted: 4,
    },
    {
      key: 'invite_teammate',
      title: 'Invite a teammate',
      scope: 'tenant',
      required: true,
      completed: 20,
      staffCompleted: 1,
    },
    {
      key: 'teammate_joined',
      title: 'A teammate joins',
      scope: 'tenant',
      required: false,
      completed: 12,
      staffCompleted: 0,
    },
    {
      key: 'read_getting_started',
      title: 'Read the getting-started guide',
      scope: 'member',
      required: false,
      completed: 9,
      staffCompleted: 0,
    },
  ],
  trackedTenants: 52,
}

/**
 * One row of `GET /platform/onboarding/tenants`: Acme, stuck for nine days
 * with one of its two required steps done.
 * @param overrides - Fields to replace.
 * @returns The row.
 */
export function onboardingTenantRow(
  overrides: Partial<OnboardingTenantRow> = {}
): OnboardingTenantRow {
  return {
    id: TENANT_ID,
    name: 'Acme Corp',
    slug: 'acme',
    state: 'stuck',
    owners: [{ id: USER_ID_2, name: 'Cleo Doe' }],
    startedAt: '2026-09-10T09:00:00.000Z',
    lastProgressAt: '2026-09-20T09:00:00.000Z',
    completedAt: null,
    daysStuck: 9,
    nextStep: { key: 'invite_teammate', title: 'Invite a teammate' },
    requiredDone: 1,
    requiredTotal: 2,
    ...overrides,
  }
}

/**
 * One staff reminder on Acme: Sam's, to its one owner at example.com,
 * filed as `emailSummary`'s message.
 * @param overrides - Fields to replace.
 * @returns The reminder.
 */
export function onboardingReminder(
  overrides: Partial<OnboardingReminderView> = {}
): OnboardingReminderView {
  return {
    id: AUDIT_ID_4,
    sentAt: '2026-09-28T09:00:00.000Z',
    sentBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
    reason: 'Nudge after the kickoff call',
    recipientCount: 1,
    emailDomains: ['example.com'],
    messageIds: [EMAIL_ID],
    ...overrides,
  }
}

/** Acme's four steps in progress: settings done automatically, nothing else yet but the owner's own guide. */
const ACME_STEPS: OnboardingStepDetail[] = [
  {
    key: 'configure_settings',
    title: 'Configure your workspace',
    description: 'Set the time zone and language your team works in.',
    scope: 'tenant',
    kind: 'auto',
    required: true,
    completedAt: '2026-09-12T09:00:00.000Z',
    source: 'auto',
    completedBy: null,
    reason: null,
    members: null,
    canMarkComplete: false,
  },
  {
    key: 'invite_teammate',
    title: 'Invite a teammate',
    description: 'Invite the first person to work with you.',
    scope: 'tenant',
    kind: 'auto',
    required: true,
    completedAt: null,
    source: null,
    completedBy: null,
    reason: null,
    members: null,
    canMarkComplete: true,
  },
  {
    key: 'teammate_joined',
    title: 'A teammate joins',
    description: 'Someone you invited accepts.',
    scope: 'tenant',
    kind: 'auto',
    required: false,
    completedAt: null,
    source: null,
    completedBy: null,
    reason: null,
    members: null,
    canMarkComplete: true,
  },
  {
    key: 'read_getting_started',
    title: 'Read the getting-started guide',
    description: 'Each person ticks this once they have read it.',
    scope: 'member',
    kind: 'manual',
    required: false,
    completedAt: '2026-09-13T09:00:00.000Z',
    source: 'customer',
    completedBy: null,
    reason: null,
    members: {
      completed: 1,
      total: 2,
      entries: [
        {
          user: { id: USER_ID_2, name: 'Cleo Doe' },
          role: 'owner',
          completedAt: '2026-09-13T09:00:00.000Z',
          source: 'customer',
        },
        {
          user: { id: USER_ID_3, name: 'Evan Editor' },
          role: 'editor',
          completedAt: null,
          source: null,
        },
      ],
    },
    canMarkComplete: false,
  },
]

/**
 * `GET /platform/tenants/:id/onboarding` for Acme, in progress: settings
 * configured automatically, no teammate invited yet, and the member step
 * done by its owner, Cleo, but not by its editor. No reminder yet, and one
 * could go to Cleo at example.com.
 * @param overrides - Fields to replace.
 * @returns The detail.
 */
export function tenantOnboardingDetail(
  overrides: Partial<TenantOnboardingDetail> = {}
): TenantOnboardingDetail {
  return {
    tenant: { id: TENANT_ID, name: 'Acme Corp', slug: 'acme', lifecycleState: 'active' },
    state: 'in_progress',
    startedAt: '2026-09-10T09:00:00.000Z',
    lastProgressAt: '2026-09-13T09:00:00.000Z',
    completedAt: null,
    dismissedAt: null,
    dismissedBy: null,
    daysStuck: null,
    requiredDone: 1,
    requiredTotal: 2,
    nextStep: { key: 'invite_teammate', title: 'Invite a teammate' },
    steps: ACME_STEPS,
    reminder: {
      canSend: true,
      blockedBy: null,
      lastSentAt: null,
      nextAllowedAt: null,
      recipientCount: 1,
      emailDomains: ['example.com'],
    },
    reminders: [],
    ...overrides,
  }
}

/**
 * Acme's detail once staff marked `stepKey` complete, as the mark-complete
 * endpoint answers it.
 * @param stepKey - The step staff completed.
 * @returns The detail.
 */
export function tenantOnboardingAfterStaffCompletion(stepKey: string): TenantOnboardingDetail {
  return tenantOnboardingDetail({
    steps: ACME_STEPS.map((step) =>
      step.key === stepKey
        ? {
            ...step,
            completedAt: '2026-09-30T09:00:00.000Z',
            source: 'staff',
            completedBy: { id: USER_ID, name: 'A B' },
            reason: 'Done on the call',
            canMarkComplete: false,
          }
        : step
    ),
  })
}

/**
 * Every Apex flag at its fallback, of which there are none. Written out rather
 * than read from the flags module, because the setup file loads this file
 * before a test's `vi.mock('@/observability/flags/flag-keys', …)` could apply.
 */
const TEST_FLAG_FALLBACKS = {} satisfies ClientFlagValues

/**
 * A flags read as express answers it: every flag at its fallback unless
 * `overrides` says otherwise.
 * @param overrides - Values that differ from the fallbacks.
 * @returns The response data.
 */
export function testFlags(overrides: Readonly<Record<string, boolean | string>> = {}) {
  return {
    flags: { ...TEST_FLAG_FALLBACKS, ...overrides },
    evaluatedAt: '2026-10-05T10:00:00.000Z',
  }
}

/**
 * A success envelope as express sends it; `statusCode` is also the HTTP status.
 * @returns The response.
 */
export function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return HttpResponse.json({ success: true, message, statusCode, data }, { status: statusCode })
}

/** Express's 404 sentence for a tax read while registration is off and the workspace has no documents (GC§3.1). */
const TAX_DOCUMENTS_DISABLED_READ =
  'Tax documents are off, and this workspace has none to download.'

/**
 * An error envelope as express sends it, with a fixed `requestId`; `statusCode` is also the HTTP status
 * and `code` the machine-readable error code, when the case has one.
 * @returns The response.
 */
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

/** The default answer to every API call a page makes, so a test overrides only the endpoint it is about. */
export const handlers = [
  http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Session refreshed.')),
  http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.')),
  // Express answers every link request 202 with no data, whether or not the address has an account.
  http.post('/api/v1/auth/link/request', () =>
    ok(null, 'Check your inbox for a sign-in link.', 202)
  ),
  // The token signs in the test user; like the API, a different address in the body is refused and spends nothing.
  http.post('/api/v1/auth/link/verify', async ({ request }) => {
    const { email } = (await request.json()) as { email?: string }
    if (email !== undefined && email.toLowerCase() !== testUser.email) {
      return fail('This link expired or was already used. Ask for a new link.', 400, 'LINK_INVALID')
    }
    return ok(
      { user: testUser, accessToken: 'link-token', isNewUser: false, redirect: null },
      'Signed in.'
    )
  }),
  // A "Confirm it's you" link confirmed for the calling session: a new access token with a fresh `auth_time`.
  http.post('/api/v1/auth/step-up/link/verify', () =>
    ok({ accessToken: 'stepped-up' }, 'Identity confirmed.')
  ),
  // A link mailed, the next one a minute out; express's strict body is `{ app: 'apex' }` and nothing else, or 400.
  http.post('/api/v1/auth/step-up/link/request', async ({ request }) => {
    const body = await request.json().catch(() => null)
    if (JSON.stringify(body) !== JSON.stringify({ app: 'apex' })) {
      return fail('Invalid request body.', 400, 'VALIDATION_ERROR')
    }
    return ok(
      { resendAvailableAt: new Date(Date.now() + 60_000).toISOString() },
      'Check your inbox for a confirmation link.',
      202
    )
  }),
  // Passkeys default to optional with none created; a test for another mode or a list overrides these.
  http.get('/api/v1/auth/passkeys/config', () =>
    ok({ mode: 'optional', rpId: 'localhost' }, 'Passkey settings retrieved.')
  ),
  // Step-up by passkey: the account has none, so the "Confirm it's you" dialog opens on the email link. A passkey test overrides this.
  http.post('/api/v1/auth/passkeys/step-up/options', () =>
    fail('You have no passkey.', 409, 'NO_PASSKEY')
  ),
  http.get('/api/v1/auth/passkeys', () =>
    ok({ passkeys: [], userHandle: USER_HANDLE }, 'Passkeys retrieved.')
  ),
  // The sign-in methods the profile's Security section lists: email only; a test that needs Google serves its own.
  http.get('/api/v1/auth/providers', () =>
    ok(
      { providers: [{ provider: 'email', linkedAt: '2026-01-01T00:00:00.000Z' }] },
      'Auth providers retrieved.'
    )
  ),
  http.post('/api/v1/invitations/preview', () =>
    ok(testInvitationPreview, 'Invitation retrieved.')
  ),
  // Signed out, one click: the invitee is signed in and joined, as express's `verifyInvitation` answers.
  http.post('/api/v1/invitations/verify', () =>
    ok(
      {
        user: testUser,
        accessToken: 'invitation-token',
        isNewUser: false,
        tenant: testInvitationPreview.tenant,
        role: testInvitationPreview.role,
      },
      'Invitation accepted.'
    )
  ),
  http.post('/api/v1/invitations/accept', () =>
    ok(
      {
        tenant: testInvitationPreview.tenant,
        role: testInvitationPreview.role,
        alreadyMember: false,
      },
      'Invitation accepted.'
    )
  ),
  // The mailed confirmation link: the staff invitee is signed in and joined, as express's confirm answers.
  http.post('/api/v1/invitations/confirm', () =>
    ok(
      {
        user: testUser,
        accessToken: 'confirm-token',
        isNewUser: false,
        tenant: testInvitationPreview.tenant,
        role: testInvitationPreview.role,
      },
      'Invitation accepted.'
    )
  ),
  // The staff shell's maintenance banner reads this on every page: off, so no banner shows.
  http.get('/api/v1/platform/maintenance-mode', () =>
    ok(maintenanceModeView(), 'Maintenance mode retrieved.')
  ),
  // The staff shell's loader reads Apex's flags on every page, and there are none.
  http.get('/api/v1/platform/me/flags', () => ok(testFlags(), 'Flags retrieved.')),
  http.post('/api/v1/platform/me/flags/exposures', () => new HttpResponse(null, { status: 204 })),
  // Overview, where sign-in lands, reads the stats.
  http.get('/api/v1/platform/stats', () => ok(testStats, 'Platform stats retrieved.')),
  // An admin's Overview also reads the system status.
  http.get('/api/v1/platform/system/status', () =>
    ok(testSystemStatus, 'System status retrieved.')
  ),
  // The platform audit log, empty.
  http.get('/api/v1/platform/audit-log', () => ok(listPage([]), 'Audit log retrieved.')),
  // The users directory defaults to an empty page, and any one user reads as the test user; a page test serves its own.
  http.get('/api/v1/platform/users', () => ok(listPage([]), 'Users retrieved.')),
  http.get('/api/v1/platform/users/:userId', () => ok(testUserDetail, 'User retrieved.')),
  // A staff-sent sign-in link goes; a test that needs a refusal or a failed mail serves its own.
  http.post('/api/v1/platform/users/:userId/sign-in-link', () =>
    ok({ emailSent: true }, 'Sign-in link sent.')
  ),
  // A tenant's members and pending invitations default to empty pages; a page test serves its own rows.
  http.get('/api/v1/tenants/:slug/members', () => ok(listPage([]), 'Members retrieved.')),
  http.get('/api/v1/tenants/:slug/invitations', () => ok(listPage([]), 'Invitations retrieved.')),
  // The flags inspector's registry, unregistered flags and meta read answer the reference fixtures.
  http.get('/api/v1/platform/flags', () => ok(listPage(flagRows()), 'Flags retrieved.')),
  http.get('/api/v1/platform/flags/unregistered', () =>
    ok(listPage(unregisteredRows()), 'Unregistered flags retrieved.')
  ),
  http.get('/api/v1/platform/flags/meta', () => ok(flagsMeta(), 'Flags meta retrieved.')),
  // The email list defaults to empty, so a page that only embeds one renders unchanged; `/emails/health` is registered before `:emailId`, which would otherwise match it.
  http.get('/api/v1/platform/emails', () => ok(listPage([]), 'Emails retrieved.')),
  http.get('/api/v1/platform/emails/health', () => ok(testEmailHealth, 'Email health retrieved.')),
  http.get('/api/v1/platform/emails/:emailId', ({ params }) =>
    ok(emailDetail({ id: String(params.emailId) }), 'Email retrieved.')
  ),
  http.get('/api/v1/platform/emails/:emailId/preview', () =>
    ok(testEmailPreview, 'Email preview rendered.')
  ),
  http.post('/api/v1/platform/emails/:emailId/resend', () => ok({}, 'Resend requested.', 202)),
  http.get('/api/v1/platform/email-suppressions', () =>
    ok(listPage([]), 'Suppressions retrieved.')
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
  // Both plans, the default trial rules, no billing alerts, and any tenant reads as a monthly Paid customer with empty billing lists.
  http.get('/api/v1/platform/plans', () => ok(testPlans, 'Plans retrieved.')),
  http.get('/api/v1/platform/billing-settings', () =>
    ok(testBillingSettings, 'Billing settings retrieved.')
  ),
  http.get('/api/v1/platform/billing/alerts', () => ok(listPage([]), 'Billing alerts retrieved.')),
  http.get('/api/v1/platform/tenants/:tenantId/billing', () =>
    ok(testTenantBilling, 'Billing retrieved.')
  ),
  http.get('/api/v1/platform/tenants/:tenantId/billing/history', () =>
    ok(listPage([]), 'Billing history retrieved.')
  ),
  http.get('/api/v1/platform/tenants/:tenantId/billing/events', () =>
    ok(listPage([]), 'Billing events retrieved.')
  ),
  http.get('/api/v1/platform/tenants/:tenantId/billing/subscriptions', () =>
    ok(listPage([]), 'Billing subscriptions retrieved.')
  ),
  http.get('/api/v1/platform/tenants/:tenantId/billing/invoices', () =>
    ok(listPage([]), 'Invoices retrieved.')
  ),
  // Registration off and no documents: every tax read answers 404 tax_documents_disabled, so a default tenant shows no tax UI.
  http.get('/api/v1/platform/tenants/:tenantId/billing/tax-details', () =>
    fail(TAX_DOCUMENTS_DISABLED_READ, 404, 'tax_documents_disabled')
  ),
  http.get('/api/v1/platform/tenants/:tenantId/billing/tax-documents', () =>
    fail(TAX_DOCUMENTS_DISABLED_READ, 404, 'tax_documents_disabled')
  ),
  http.get('/api/v1/platform/tenants/:tenantId/billing/tax-held-charges', () =>
    fail(TAX_DOCUMENTS_DISABLED_READ, 404, 'tax_documents_disabled')
  ),

  // Tracked tenants exist but no list has a row, and any tenant reads as Acme's in-progress detail.
  http.get('/api/v1/platform/onboarding/funnel', ({ request }) =>
    ok(
      { ...testOnboardingFunnel, range: new URL(request.url).searchParams.get('range') ?? '30d' },
      'Onboarding funnel retrieved.'
    )
  ),
  http.get('/api/v1/platform/onboarding/tenants', () =>
    ok(listPage([]), 'Onboarding tenants retrieved.')
  ),
  http.get('/api/v1/platform/tenants/:tenantId/onboarding', () =>
    ok(tenantOnboardingDetail(), 'Tenant onboarding retrieved.')
  ),
  http.post('/api/v1/platform/tenants/:tenantId/onboarding/steps/:stepKey/complete', ({ params }) =>
    ok(tenantOnboardingAfterStaffCompletion(String(params.stepKey)), 'Onboarding step completed.')
  ),
  http.post('/api/v1/platform/tenants/:tenantId/onboarding/remind', () =>
    ok({ emailSent: true, recipientCount: 1, queuedCount: 1 }, 'Reminder sent to 1 owner.')
  ),
]
