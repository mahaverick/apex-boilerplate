/**
 * The e2e fixture harness. Not part of the shipped app — nothing in `src/`
 * imports it, and `index.html` is the only Vite entry that builds.
 *
 * Playwright's `fixtures` project needs the REAL shell, the real router and
 * the real CSS in a real browser, but not a real backend. This boots the
 * actual router with MSW answering the same fixtures `tests/unit/a11y.test.tsx`
 * uses, and the same signed-in store state.
 *
 * The harness user is a platform admin, so every staff page renders, unless
 * `?role=` names another role (see `platformRole`).
 */
import '@/lib/zod-jitless'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { http, passthrough } from 'msw'
import { setupWorker } from 'msw/browser'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { queryClient, router } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import {
  AUDIT_ID_1,
  AUDIT_ID_2,
  EMAIL_ATTEMPT_ID,
  EMAIL_EVENT_ID,
  EMAIL_ID,
  EMAIL_ID_2,
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  PLATFORM_TENANT_ID,
  STAFF_USER_ID,
  SUPPRESSION_ID,
  SUPPRESSION_ID_2,
  TENANT_ID,
  TENANT_ID_2,
  TENANT_ID_3,
  TENANT_ID_4,
  USER_ID,
  USER_ID_2,
  USER_ID_3,
} from '../../tests/fixtures/ids'

/** The one tenant the activity rows and the tenant filter name. */
const ACME = { id: TENANT_ID, name: 'Acme Corp', slug: 'acme' }

/** The platform tenant's staff, for the Staff page and the activity page's actor filter. */
const MEMBERS = [
  {
    membership: {
      id: MEMBERSHIP_ID,
      userId: USER_ID,
      tenantId: PLATFORM_TENANT_ID,
      role: 'admin',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID, email: 'a@b.com', firstName: 'A', lastName: 'B' },
  },
  {
    membership: {
      id: MEMBERSHIP_ID_2,
      userId: USER_ID_2,
      tenantId: PLATFORM_TENANT_ID,
      role: 'viewer',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID_2, email: 'c@d.com', firstName: 'Cleo', lastName: 'D' },
  },
]

/** The one current password the change-password handler below accepts. */
const HARNESS_PASSWORD = 'current-password'

/**
 * `?role=none` is a signed-in user who is not staff, so /no-access renders
 * instead of redirecting to the overview; `?role=viewer` is staff below
 * admin, so the admin-only pages refuse; `?role=owner` is a platform owner,
 * who gets the Maintenance page's controls. Anything else is an admin.
 */
const roleParam = new URLSearchParams(location.search).get('role')
const platformRole =
  roleParam === 'none'
    ? null
    : roleParam === 'viewer'
      ? ('viewer' as const)
      : roleParam === 'owner'
        ? ('owner' as const)
        : ('admin' as const)

/**
 * `?member=owner|admin|manager|editor|viewer` makes the harness user a member
 * of Acme at that role, with Cleo D its owner, so the members tab offers
 * Leave on their own row; otherwise they reach Acme through platform access.
 */
const memberParam = new URLSearchParams(location.search).get('member')
const acmeRole =
  memberParam === 'owner' ||
  memberParam === 'admin' ||
  memberParam === 'manager' ||
  memberParam === 'editor' ||
  memberParam === 'viewer'
    ? memberParam
    : null

const testUser = {
  id: USER_ID,
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole,
  analyticsOptOut: false,
}

/**
 * The Overview's figures: the same seven days as `testStats` in
 * `tests/mocks/handlers.ts`, restated because that file's `@/tests` imports
 * do not resolve under Vite. The emails are a no-webhook install's: every
 * day's sends in `sent`, and one undelivered on the fourth day, so the chart
 * draws eight segments (zero-height ones draw nothing).
 */
const STATS = {
  range: '7d' as const,
  totals: { tenants: 1284, users: 9730, staff: 18, stuckTenants: 6 },
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
  emailMessages: ['23', '24', '25', '26', '27', '28', '29'].map((day, index) => ({
    date: `2026-09-${day}`,
    delivered: 0,
    sent: 500 + index * 10,
    undelivered: index === 3 ? 1 : 0,
    complained: 0,
    suppressed: 0,
  })),
}

function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return Response.json({ success: true, message, statusCode, data })
}

/** A staff actor on the History cards, with the platform tenant the API files `user.*` entries under. */
const SAM = { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' }
const PLATFORM = { id: PLATFORM_TENANT_ID, name: 'Platform', slug: 'platform' }

/**
 * A History card's entries: a user's (`targetId`) or a tenant's staff actions
 * (`tenantId` with `access=platform`), each carrying a long reason so the
 * card's wrapping is measured too.
 */
function historyOf(params: URLSearchParams) {
  const targetId = params.get('targetId')
  if (targetId !== null) {
    return [
      {
        id: AUDIT_ID_2,
        occurredAt: '2026-09-25T10:00:00.000Z',
        action: 'user.deactivated',
        access: 'platform',
        actor: SAM,
        target: { type: 'user', id: targetId },
        metadata: { reason: 'Repeated chargebacks reported by the billing provider this month' },
        tenant: PLATFORM,
      },
      {
        id: AUDIT_ID_1,
        occurredAt: '2026-09-25T09:00:00.000Z',
        action: 'user.created',
        access: 'platform',
        actor: SAM,
        target: { type: 'user', id: targetId },
        metadata: { emailDomain: 'example-company-domain.com' },
        tenant: PLATFORM,
      },
    ]
  }
  return [
    {
      id: AUDIT_ID_2,
      occurredAt: '2026-09-25T10:00:00.000Z',
      action: 'tenant.suspended',
      access: 'platform',
      actor: SAM,
      target: { type: 'tenant', id: params.get('tenantId') },
      metadata: { reason: 'Billing hold while the overdue invoices are reconciled' },
      tenant: ACME,
    },
  ]
}

/** A Users row: Cleo is inactive and unverified; the other is staff, with a long name and email. */
const USER_ROWS = [
  {
    id: USER_ID_2,
    email: 'c@d.com',
    firstName: 'Cleo',
    lastName: 'D',
    active: false,
    emailVerifiedAt: null,
    lastLoggedInAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    platformRole: null,
    membershipCount: 1,
  },
  {
    id: USER_ID_3,
    email: 'a-very-long-address-for-overflow@example-company-domain.com',
    firstName: 'Evangeline',
    lastName: 'Featherstonehaugh',
    active: true,
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    lastLoggedInAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    platformRole: 'viewer',
    membershipCount: 12,
  },
]

/**
 * A user's page. Cleo is live, active and unverified, so her actions menu
 * offers Deactivate; `USER_ID_3` is a deleted account with a long name and
 * email, so the read-only page is measured at its widest.
 */
function userDetail(userId: string) {
  const deleted = userId === USER_ID_3
  return {
    ...(deleted
      ? {
          ...USER_ROWS[1]!,
          active: false,
          deletedAt: '2026-09-20T00:00:00.000Z',
          platformRole: null,
        }
      : { ...USER_ROWS[0]!, active: true }),
    hasPassword: false,
    authProviders: ['email', 'google'],
    memberships: [
      {
        tenantId: TENANT_ID,
        tenantName: 'Acme Corp',
        tenantSlug: 'acme',
        lifecycleState: 'active',
        role: 'editor',
        joinedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        tenantId: TENANT_ID_2,
        tenantName: 'Beta Ltd',
        tenantSlug: 'beta',
        lifecycleState: 'suspended',
        role: 'viewer',
        joinedAt: '2026-02-01T00:00:00.000Z',
      },
    ],
    pendingInvitations: [
      {
        id: '40000000-0000-4000-8000-000000000001',
        tenantId: TENANT_ID_3,
        tenantName: 'Gamma Inc',
        role: 'viewer',
        expiresAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  }
}

/** The fields every tenant page reads beyond the ones that name the tenant. */
const TENANT_DETAIL_BASE = {
  logo: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  deletedAt: null,
  settings: { timezone: 'Europe/London', locale: 'en' },
  pendingOwnerInvitation: null,
}

/**
 * A tenant's page. Acme is active, with a long description and an inactive
 * owner; Beta is suspended, with its own details and one owner, so its tabs
 * render frozen and nothing on its page is Acme's; Delta is active with no
 * owner at all, so its Actions menu offers the owner invitation. Delta is on
 * no list: only its own page is reached.
 */
function tenantDetail(tenantId: string) {
  if (tenantId === TENANT_ID_4) {
    return {
      ...TENANT_DETAIL_BASE,
      id: TENANT_ID_4,
      name: 'Delta LLC',
      slug: 'delta',
      lifecycleState: 'active',
      description: null,
      website: null,
      memberCount: 0,
      owners: [],
      pendingInvitationCount: 0,
    }
  }
  if (tenantId === TENANT_ID_2) {
    return {
      ...TENANT_DETAIL_BASE,
      id: TENANT_ID_2,
      name: 'Beta Ltd',
      slug: 'beta',
      lifecycleState: 'suspended',
      description: 'Beta’s own description, suspended while its billing is reviewed.',
      website: 'https://beta.example-company-domain.com',
      memberCount: 1,
      owners: [
        {
          userId: USER_ID_3,
          email: 'a-very-long-address-for-overflow@example-company-domain.com',
          firstName: 'Evangeline',
          lastName: 'Featherstonehaugh',
          active: true,
        },
      ],
      pendingInvitationCount: 0,
    }
  }
  return {
    ...TENANT_DETAIL_BASE,
    ...ACME,
    lifecycleState: 'active',
    description:
      'A deliberately long description, so the overview card wraps at phone width rather than scrolling sideways.',
    website: 'https://acme.example-company-domain.com',
    memberCount: 2,
    owners: [
      { userId: USER_ID, email: 'a@b.com', firstName: 'A', lastName: 'B', active: true },
      { userId: USER_ID_2, email: 'c@d.com', firstName: 'Cleo', lastName: 'D', active: false },
    ],
    pendingInvitationCount: 1,
  }
}

/**
 * The emails list, a user's Emails card and a tenant's Emails tab, all
 * `GET /platform/emails`: a delivered reset to Cleo, and a bounced invitation
 * to a long address on Acme, so the badges and the widest row are measured.
 */
const EMAIL_ROWS = [
  {
    id: EMAIL_ID,
    recipient: 'c@d.com',
    templateKey: 'password_reset',
    status: 'delivered',
    senderClass: 'transactional',
    createdAt: '2026-09-28T10:00:00.000Z',
    statusUpdatedAt: '2026-09-28T10:00:05.000Z',
    user: { id: USER_ID_2, name: 'Cleo D' },
    tenant: null,
    canResend: true,
  },
  {
    id: EMAIL_ID_2,
    recipient: 'a-very-long-address-for-overflow@example-company-domain.com',
    templateKey: 'tenant_invitation',
    status: 'bounced',
    senderClass: 'transactional',
    createdAt: '2026-09-27T09:00:00.000Z',
    statusUpdatedAt: '2026-09-27T09:00:07.000Z',
    user: null,
    tenant: ACME,
    canResend: false,
  },
]

/**
 * An email's page. Cleo's reset was delivered and can be resent; the long
 * address's invitation hard-bounced, so its address is suppressed, its page
 * shows the banner and offers no Resend.
 */
function emailDetail(emailId: string) {
  const row = EMAIL_ROWS.find((email) => email.id === emailId) ?? EMAIL_ROWS[0]!
  const bounced = row.status === 'bounced'
  return {
    ...row,
    linkApp: 'web',
    failureOrigin: null,
    attempts: [
      {
        id: EMAIL_ATTEMPT_ID,
        status: 'sent',
        errorCode: null,
        createdAt: row.createdAt,
      },
    ],
    events: [
      {
        id: EMAIL_EVENT_ID,
        provider: 'resend',
        type: bounced ? 'bounced' : 'delivered',
        bounceKind: bounced ? 'hard' : null,
        detail: bounced ? 'MESSAGE_REJECTED' : null,
        occurredAt: row.statusUpdatedAt,
      },
    ],
    suppression: bounced
      ? { id: SUPPRESSION_ID, reason: 'hard_bounce', createdAt: row.statusUpdatedAt }
      : null,
    resentFromId: null,
    resentAsIds: [],
  }
}

/** A preview as express renders it: inline styles only, the link masked, one long unbroken line to test the frame's own scroll. */
const EMAIL_PREVIEW = {
  subject: 'Reset your password',
  html: '<div style="font-family:sans-serif;color:#111"><p>Hi Cleo,</p><p>Reset your password: <a href="http://localhost:5173/reset-password?token=••••••">http://localhost:5173/reset-password?token=••••••••••••••••••••••••••••••••••••••••</a></p></div>',
  text: 'Hi Cleo,\n\nReset your password: http://localhost:5173/reset-password?token=••••••',
  partial: false,
}

/**
 * Deliverability: the 7-day window has provider data, so every tile has a
 * value; the 30-day one has none, so the page shows the no-provider banner
 * and "No provider data" tiles over the same chart.
 */
function emailHealth(range: string) {
  const hasProvider = range !== '30d'
  const rate = (numerator: number, denominator: number) => ({
    value: hasProvider ? numerator / denominator : null,
    numerator: hasProvider ? numerator : 0,
    denominator: hasProvider ? denominator : 0,
  })
  return {
    range: range === '30d' ? '30d' : '7d',
    totals: {
      messages: 3711,
      delivered: hasProvider ? 3650 : 0,
      sent: hasProvider ? 50 : 3710,
      undelivered: 1,
      complained: hasProvider ? 10 : 0,
      suppressed: 2,
      providerEvents: hasProvider ? 4200 : 0,
    },
    rates: {
      undeliveredRate: { value: 1 / 3711, numerator: 1, denominator: 3711 },
      deliveredRate: rate(3650, 3711),
      bounceRate: rate(1, 3711),
      complaintRate: rate(10, 3711),
      openRate: rate(40, 200),
      clickRate: rate(8, 200),
    },
    days: STATS.emailMessages,
    byTemplate: [
      { key: 'password_reset', messages: 2100, undelivered: 1, complained: 6 },
      { key: 'tenant_invitation', messages: 1611, undelivered: 0, complained: 4 },
    ],
    byDomain: [
      { key: 'example-company-domain.com', messages: 3000, undelivered: 1, complained: 9 },
      { key: 'd.com', messages: 711, undelivered: 0, complained: 1 },
    ],
  }
}

/** Suppressions: the long address's, still active and so offering Lift, and a lifted one with its reason. */
const SUPPRESSION_ROWS = [
  {
    id: SUPPRESSION_ID,
    address: 'a-very-long-address-for-overflow@example-company-domain.com',
    reason: 'hard_bounce',
    sourceMessageId: EMAIL_ID_2,
    createdAt: '2026-09-27T09:00:08.000Z',
    liftedAt: null,
    liftedBy: null,
    liftReason: null,
  },
  {
    id: SUPPRESSION_ID_2,
    address: 'c@d.com',
    reason: 'complaint',
    sourceMessageId: null,
    createdAt: '2026-09-20T09:00:00.000Z',
    liftedAt: '2026-09-21T09:00:00.000Z',
    liftedBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
    liftReason: 'The customer confirmed the complaint was a mistake and asked to be mailed again',
  },
]

/** The four default steps' names, as express's registry serves them. */
const STEP_TITLES = {
  configure_settings: 'Configure your workspace',
  invite_teammate: 'Invite a teammate',
  teammate_joined: 'A teammate joins',
  read_getting_started: 'Read the getting-started guide',
} as const

/** The onboarding funnel for any window: 40 started, two steps with a staff share, so both fills draw. */
function onboardingFunnel(range: string) {
  return {
    range,
    from: '2026-08-31T00:00:00.000Z',
    totals: { started: 40, inProgress: 18, stuck: 6, complete: 14, dismissed: 2 },
    completionRate: 14 / 40,
    steps: [
      {
        key: 'configure_settings',
        scope: 'tenant',
        required: true,
        completed: 30,
        staffCompleted: 4,
      },
      { key: 'invite_teammate', scope: 'tenant', required: true, completed: 20, staffCompleted: 1 },
      {
        key: 'teammate_joined',
        scope: 'tenant',
        required: false,
        completed: 12,
        staffCompleted: 0,
      },
      {
        key: 'read_getting_started',
        scope: 'member',
        required: false,
        completed: 9,
        staffCompleted: 0,
      },
    ].map((step) => ({ ...step, title: STEP_TITLES[step.key as keyof typeof STEP_TITLES] })),
    trackedTenants: 52,
  }
}

/**
 * One row per tab, the onboarding list filtered the way the API filters it:
 * Acme stuck with two owners, the long-named Beta in progress, Delta waiting
 * for its owner, and the rest finished or dismissed.
 */
const ONBOARDING_ROWS = [
  {
    ...ACME,
    state: 'stuck',
    owners: [
      { id: USER_ID, name: 'A B' },
      { id: USER_ID_2, name: 'Cleo D' },
    ],
    startedAt: '2026-09-10T09:00:00.000Z',
    lastProgressAt: '2026-09-20T09:00:00.000Z',
    completedAt: null,
    daysStuck: 9,
    nextStep: { key: 'invite_teammate', title: STEP_TITLES.invite_teammate },
    requiredDone: 1,
    requiredTotal: 2,
  },
  {
    id: TENANT_ID_2,
    name: 'Beta Ltd',
    slug: 'beta',
    state: 'in_progress',
    owners: [{ id: USER_ID_3, name: 'Evangeline Featherstonehaugh' }],
    startedAt: '2026-09-25T09:00:00.000Z',
    lastProgressAt: '2026-09-27T09:00:00.000Z',
    completedAt: null,
    daysStuck: null,
    nextStep: { key: 'configure_settings', title: STEP_TITLES.configure_settings },
    requiredDone: 0,
    requiredTotal: 2,
  },
  {
    id: TENANT_ID_4,
    name: 'Delta LLC',
    slug: 'delta',
    state: 'awaiting_owner',
    owners: [],
    startedAt: null,
    lastProgressAt: null,
    completedAt: null,
    daysStuck: null,
    nextStep: { key: 'configure_settings', title: STEP_TITLES.configure_settings },
    requiredDone: 0,
    requiredTotal: 2,
  },
  {
    id: TENANT_ID_3,
    name: 'Gamma Inc',
    slug: 'gamma',
    state: 'complete',
    owners: [{ id: USER_ID_2, name: 'Cleo D' }],
    startedAt: '2026-09-01T09:00:00.000Z',
    lastProgressAt: '2026-09-05T09:00:00.000Z',
    completedAt: '2026-09-05T09:00:00.000Z',
    daysStuck: null,
    nextStep: null,
    requiredDone: 2,
    requiredTotal: 2,
  },
]

/**
 * `?onboarding=` picks the state Acme's Onboarding tab renders, so the
 * contrast suite can measure every badge tone on one page; the default is
 * stuck. Beta's tab is suspended and read-only; Delta's awaits its owner.
 */
const acmeOnboardingState = new URLSearchParams(location.search).get('onboarding') ?? 'stuck'

/** A tenant's Onboarding tab: every completion kind, an open member disclosure's worth of members, and two reminders. */
function tenantOnboarding(tenantId: string) {
  const isBeta = tenantId === TENANT_ID_2
  const isDelta = tenantId === TENANT_ID_4
  const state = isBeta ? 'stuck' : isDelta ? 'awaiting_owner' : acmeOnboardingState
  const tenant = isBeta
    ? { id: TENANT_ID_2, name: 'Beta Ltd', slug: 'beta', lifecycleState: 'suspended' }
    : isDelta
      ? { id: TENANT_ID_4, name: 'Delta LLC', slug: 'delta', lifecycleState: 'active' }
      : { ...ACME, lifecycleState: 'active' }
  const canAct = !isBeta && !isDelta && (state === 'stuck' || state === 'in_progress')
  const step = (key: keyof typeof STEP_TITLES, required: boolean) => ({
    key,
    title: STEP_TITLES[key],
    description: 'What this step asks of the customer, long enough to wrap at phone width.',
    scope: 'tenant',
    kind: 'auto',
    required,
    completedAt: null,
    source: null,
    completedBy: null,
    reason: null,
    members: null,
    canMarkComplete: canAct,
  })
  return {
    tenant,
    state,
    startedAt: isDelta || state === 'not_tracked' ? null : '2026-09-10T09:00:00.000Z',
    lastProgressAt: isDelta || state === 'not_tracked' ? null : '2026-09-20T09:00:00.000Z',
    completedAt: state === 'complete' ? '2026-09-20T09:00:00.000Z' : null,
    dismissedAt: state === 'dismissed' ? '2026-09-21T09:00:00.000Z' : null,
    dismissedBy: state === 'dismissed' ? { id: USER_ID_2, name: 'Cleo D' } : null,
    daysStuck: state === 'stuck' ? 9 : null,
    requiredDone: 1,
    requiredTotal: 2,
    nextStep: { key: 'invite_teammate', title: STEP_TITLES.invite_teammate },
    steps: [
      {
        ...step('configure_settings', true),
        completedAt: '2026-09-12T09:00:00.000Z',
        source: 'staff',
        completedBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
        reason:
          'Set up together on the kickoff call, since the owner could not find the settings page',
        canMarkComplete: false,
      },
      step('invite_teammate', true),
      {
        ...step('teammate_joined', false),
        completedAt: '2026-09-20T09:00:00.000Z',
        source: 'auto',
        canMarkComplete: false,
      },
      {
        ...step('read_getting_started', false),
        scope: 'member',
        kind: 'manual',
        completedAt: '2026-09-13T09:00:00.000Z',
        source: 'customer',
        canMarkComplete: false,
        members: {
          completed: 1,
          total: 2,
          entries: [
            {
              user: { id: USER_ID, name: 'A B' },
              role: 'owner',
              completedAt: '2026-09-13T09:00:00.000Z',
              source: 'customer',
            },
            {
              user: { id: USER_ID_3, name: 'Evangeline Featherstonehaugh' },
              role: 'editor',
              completedAt: null,
              source: null,
            },
          ],
        },
      },
    ],
    reminder: {
      canSend: canAct,
      blockedBy: canAct ? null : isBeta ? 'tenant_state_conflict' : 'not_in_progress',
      lastSentAt: '2026-09-28T09:00:00.000Z',
      nextAllowedAt: null,
      recipientCount: 2,
      emailDomains: ['b.com', 'example-company-domain.com'],
    },
    reminders: [
      {
        id: AUDIT_ID_2,
        sentAt: '2026-09-28T09:00:00.000Z',
        sentBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
        reason:
          'Stalled for a week after the kickoff call; nudging both owners towards inviting the team',
        recipientCount: 2,
        emailDomains: ['b.com', 'example-company-domain.com'],
        messageIds: [EMAIL_ID, EMAIL_ID_2],
      },
      {
        id: AUDIT_ID_1,
        sentAt: '2026-09-20T09:00:00.000Z',
        sentBy: null,
        reason: 'First nudge',
        recipientCount: 1,
        emailDomains: ['b.com'],
        messageIds: [EMAIL_ID],
      },
    ],
  }
}

/** posthog-js session ids and a request's trace, shaped as PostHog stores them. */
const SESSION_1 = '0199a000-0000-7000-8000-000000000001'
const SESSION_2 = '0199a000-0000-7000-8000-000000000002'
const TRACE = '0af7651916cd43dd8448eb211c80319c'

/** PostHog's links for the project the harness pretends to read. */
const TIMELINE_LINKS = {
  replay: 'https://us.posthog.com/project/1/replay/{sessionId}',
}

/** A timeline row with every field set, unverified as a browser event is; PostHog timestamps carry microseconds. */
function timelineRow(n: number, seconds: number, fields: Record<string, unknown>) {
  return {
    uuid: `0199a000-0000-7000-9000-${String(n).padStart(12, '0')}`,
    event: '$pageview',
    timestamp: `2026-10-04T10:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.123456Z`,
    distinctId: USER_ID_2,
    verified: false,
    tenant: null,
    source: 'browser',
    access: null,
    app: 'react',
    sessionId: SESSION_1,
    traceId: null,
    path: '/settings',
    elementText: null,
    props: {},
    ...fields,
  }
}

/**
 * A timeline's newest page: a customer-app session holding a click whose text
 * names a person, a two-event sign-in request and a pageview; a staff action
 * outside any session; then an Apex session. A tenant's rows name their actors,
 * one by email and one purged. `view=key` drops PostHog's own `$` events, as
 * express does; `range=24h` keeps the first session only; `before` answers the
 * one older page.
 */
function timelineOf(kind: 'user' | 'tenant', id: string, params: URLSearchParams) {
  const actor = (actorId: string, displayName: string | null) =>
    kind === 'tenant' ? { actor: { id: actorId, displayName } } : {}
  const links = {
    ...TIMELINE_LINKS,
    person: kind === 'user' ? `https://us.posthog.com/project/1/person/${id}` : null,
    group: kind === 'tenant' ? `https://us.posthog.com/project/1/groups/0/${id}` : null,
  }
  if (params.has('before')) {
    const older = [timelineRow(9, 1, { sessionId: SESSION_2, app: 'apex', path: '/users' })]
    return { configured: true, rows: older, nextCursor: null, links }
  }
  const rows = [
    timelineRow(1, 50, {
      event: '$autocapture',
      elementText: kind === 'tenant' ? 'Remove Evangeline Featherstonehaugh' : 'Resend to c@d.com',
      ...actor(USER_ID_2, 'Cleo D'),
    }),
    timelineRow(2, 40, {
      event: 'user_signed_in',
      verified: true,
      source: 'product',
      access: 'member',
      app: 'api',
      traceId: TRACE,
      path: null,
      props: { method: 'google' },
      ...actor(USER_ID_2, 'Cleo D'),
    }),
    timelineRow(3, 39, {
      event: 'auth_reauthenticated',
      verified: true,
      source: 'audit',
      access: 'member',
      app: 'api',
      traceId: TRACE,
      path: null,
      ...actor(USER_ID_2, 'Cleo D'),
    }),
    timelineRow(4, 30, { ...actor(USER_ID_2, 'Cleo D') }),
    timelineRow(5, 20, {
      event: kind === 'tenant' ? 'tenant_suspended' : 'user_deactivated',
      distinctId: STAFF_USER_ID,
      verified: true,
      source: 'audit',
      access: 'platform',
      app: 'api',
      sessionId: null,
      path: null,
      props: { target_type: kind, target_id: id, has_reason: true },
      ...actor(STAFF_USER_ID, 'a-very-long-address-for-overflow@example-company-domain.com'),
    }),
    timelineRow(6, 10, {
      sessionId: SESSION_2,
      app: 'apex',
      path: '/overview',
      ...actor(USER_ID_3, null),
    }),
  ]
  const inView =
    params.get('view') === 'key' ? rows.filter((row) => !row.event.startsWith('$')) : rows
  const inRange =
    params.get('range') === '24h' ? inView.filter((row) => row.sessionId === SESSION_1) : inView
  return { configured: true, rows: inRange, nextCursor: 'older', links }
}

/**
 * `?errors=unconfigured` answers the errors routes as an environment
 * without the PostHog personal key does; anything else is configured.
 */
const errorsParam = new URLSearchParams(location.search).get('errors')

/** An issue in PostHog's Error Tracking for the project the harness pretends to read, with every field set. */
function errorIssue(n: number, fields: Record<string, unknown>) {
  const issueId = `01a107cd-0000-7000-8000-${String(n).padStart(12, '0')}`
  return {
    issueId,
    type: 'TypeError',
    value: "Cannot read properties of undefined (reading 'id')",
    count: 3,
    firstSeen: '2026-10-01T09:00:00.000Z',
    lastSeen: '2026-10-04T09:58:00.000Z',
    source: 'browser',
    app: 'react',
    verified: false,
    link: `https://us.posthog.com/project/1/error_tracking/${issueId}`,
    ...fields,
  }
}

/**
 * A user's or a tenant's issues, newest first: a browser crash whose message
 * names a person (express scrubs addresses, never names), a signed API
 * error with a long unbroken message, and a server row express did not sign.
 */
function errorsOf() {
  if (errorsParam === 'unconfigured') return { configured: false }
  return {
    configured: true,
    nextCursor: null,
    items: [
      errorIssue(1, { value: 'Member Evangeline Featherstonehaugh has no role' }),
      errorIssue(2, {
        type: 'PostgresError',
        value: `duplicate key value violates unique constraint "${'tenants_slug_key_'.repeat(6)}"`,
        count: 1284,
        source: 'server',
        app: 'api',
        verified: true,
        lastSeen: '2026-10-03T09:00:00.000Z',
      }),
      errorIssue(3, {
        type: 'Error',
        value: 'Forged server error',
        count: 1,
        source: 'server',
        app: 'api',
        verified: false,
        lastSeen: '2026-10-02T09:00:00.000Z',
      }),
    ],
  }
}

/**
 * `?flags=unconfigured` answers the flags routes as an environment without
 * the feature flags key does; anything else is configured.
 */
const flagsParam = new URLSearchParams(location.search).get('flags')

/** A flag's PostHog page in the project the harness pretends to read. */
function flagUrl(id: number) {
  return `https://us.posthog.com/project/1/feature_flags/${id}`
}

/**
 * The inspector's list: express's two reference flags (one active beta page,
 * one experiment), a third made unsupported by a cohort condition with a
 * long description, an unregistered PostHog flag and the five traits.
 */
function flagsList() {
  const enabled = flagsParam !== 'unconfigured'
  return {
    items: [
      {
        key: 'example_beta_page',
        description: 'Reference flag: the tenant Beta page and its API route',
        kind: 'boolean',
        variants: null,
        scope: 'tenant',
        client: true,
        apps: ['react'],
        experiment: false,
        fallback: false,
        state: enabled ? 'active' : 'missing',
        conditions: 1,
        maxRollout: 50,
        posthogUrl: enabled ? flagUrl(101) : null,
      },
      {
        key: 'example_cta_experiment',
        description: 'Reference experiment: the getting-started call-to-action style',
        kind: 'multivariate',
        variants: ['control', 'bold'],
        scope: 'user',
        client: true,
        apps: ['react'],
        experiment: true,
        fallback: 'control',
        state: enabled ? 'inactive' : 'missing',
        conditions: 1,
        maxRollout: 0,
        posthogUrl: enabled ? flagUrl(102) : null,
      },
      {
        key: 'server_side_reconciliation_with_an_unusually_long_flag_key_x',
        description: `Reconciles ${'every tenant ledger overnight '.repeat(4)}on the worker.`,
        kind: 'boolean',
        variants: null,
        scope: 'user',
        client: false,
        apps: [],
        experiment: false,
        fallback: false,
        state: enabled ? 'unsupported' : 'missing',
        ...(enabled ? { unsupportedReason: 'cohort' } : {}),
        conditions: 2,
        maxRollout: 100,
        posthogUrl: enabled ? flagUrl(103) : null,
      },
    ],
    unregistered: enabled
      ? [{ key: 'legacy_marketing_banner', active: true, posthogUrl: flagUrl(104) }]
      : [],
    traits: [
      {
        name: 'platform_role',
        where: 'person',
        description: "The user's platform (staff) role; none for a user who is not staff.",
        examples: ['none', 'viewer', 'editor', 'manager', 'admin', 'owner'],
      },
      {
        name: 'tenant_role',
        where: 'person',
        description:
          "The user's membership role in the tenant the flag is evaluated for; none with no tenant or no membership.",
        examples: ['owner', 'admin', 'manager', 'editor', 'viewer', 'none'],
      },
      {
        name: 'app_env',
        where: 'person',
        description: 'The deployment the server runs in (APP_ENV).',
        examples: ['local', 'dev', 'qa', 'prod'],
      },
      {
        name: 'account_created_days',
        where: 'person',
        description: 'Whole days since the user signed up, an integer of at least 0.',
        examples: ['0', '30', '365'],
      },
      {
        name: 'tenant_created_days',
        where: 'group',
        description:
          'Whole days since the tenant was created, an integer of at least 0; absent with no tenant.',
        examples: ['0', '90', '365'],
      },
    ],
    snapshot: {
      enabled,
      fetchedAt: enabled ? '2026-10-05T09:59:30.000Z' : null,
      stale: false,
    },
  }
}

/**
 * One evaluation: in a tenant the beta page matches its first condition;
 * the experiment puts the user in its holdout, so they see `control` and
 * exposure records the holdout; the unsupported flag serves its fallback.
 */
function flagsEvaluation(params: URLSearchParams) {
  const tenantId = params.get('tenantId')
  const enabled = flagsParam !== 'unconfigured'
  return {
    traits: {
      platform_role: 'viewer',
      tenant_role: tenantId === null ? 'none' : 'editor',
      app_env: 'local',
      account_created_days: 277,
      ...(tenantId === null ? {} : { tenant_created_days: 277 }),
    },
    flags: enabled
      ? [
          tenantId === null
            ? { key: 'example_beta_page', value: false, reason: 'fallback:no_tenant' }
            : {
                key: 'example_beta_page',
                value: true,
                reason: 'condition_match',
                conditionIndex: 0,
              },
          {
            key: 'example_cta_experiment',
            value: 'control',
            reason: 'holdout',
            holdoutVariant: 'holdout-3605',
          },
          {
            key: 'server_side_reconciliation_with_an_unusually_long_flag_key_x',
            value: false,
            reason: 'fallback:unsupported',
          },
        ]
      : [
          { key: 'example_beta_page', value: false, reason: 'fallback:unconfigured' },
          { key: 'example_cta_experiment', value: 'control', reason: 'fallback:unconfigured' },
          {
            key: 'server_side_reconciliation_with_an_unusually_long_flag_key_x',
            value: false,
            reason: 'fallback:unconfigured',
          },
        ],
    snapshot: { fetchedAt: enabled ? '2026-10-05T09:59:30.000Z' : null, stale: false },
  }
}

/**
 * The API's release, error tracking's health (a few events throttled) and
 * feature flags' health (one flag unsupported), so the card warns on both.
 */
const SYSTEM_STATUS = {
  release: '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
  errorTracking: {
    enabled: true,
    window: '15m',
    sent: 42,
    dropped: { throttled: 2, buffer_full: 0, rejected: 0, retry_exhausted: 0 },
    lastSendOkAt: '2026-10-04T10:00:00.000Z',
    lastSendError: null,
  },
  flags: {
    enabled: true,
    snapshotAt: '2026-10-05T09:59:30.000Z',
    checkedAt: '2026-10-05T09:59:30.000Z',
    stale: false,
    lastFetchOk: '2026-10-05T09:59:30.000Z',
    lastFetchError: null,
    propertyMatchingVersion: 1,
    counts: {
      registered: 3,
      active: 1,
      inactive: 1,
      missing: 0,
      unsupported: 1,
      unregistered: 1,
      unknownVariant15m: 0,
    },
  },
}

/**
 * `?maintenance=full` answers the platform state as full maintenance, set by
 * Sam Staff, so the banner and the page's facts render; `?maintenance=route`
 * lets `GET /platform/maintenance-mode` through to the network, where the
 * test's own `context.route` answers it. Anything else is off. `PUT` is never
 * answered here: a test that changes the mode routes it itself.
 */
const maintenanceParam = new URLSearchParams(location.search).get('maintenance')

/** Every queue `queue.service.ts` creates, paused or not, with one analytics job finishing. */
function harnessQueues(paused: boolean) {
  return ['email', 'notification', 'maintenance', 'analytics'].map((name) => ({
    name,
    paused,
    active: name === 'analytics' ? 1 : 0,
  }))
}

const MAINTENANCE_VIEW =
  maintenanceParam === 'full'
    ? {
        mode: 'full' as const,
        message:
          'We are upgrading the database so the app stays fast as it grows.\nWe expect to be back by 11:00 UTC.',
        reason: 'Postgres 18 upgrade, ticket OPS-1234, approved in the change review',
        since: '2026-10-06T10:42:00.000Z',
        changedBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
        version: 5,
        queues: harnessQueues(true),
        environment: 'staging',
      }
    : {
        mode: 'off' as const,
        message: null,
        reason: null,
        since: null,
        changedBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
        version: 4,
        queues: harnessQueues(false),
        environment: 'staging',
      }

/** The API's step-up refusal, for the writes the fixtures drive into the stacked dialog. */
function reauthRequired() {
  return Response.json(
    {
      success: false,
      message: 'Recent sign-in required',
      statusCode: 401,
      code: 'REAUTH_REQUIRED',
      requestId: 'harness',
    },
    { status: 401 }
  )
}

const worker = setupWorker(
  // The overview, the harness's default route: its KPI cards and both charts.
  http.get('/api/v1/platform/stats', ({ request }) =>
    ok(
      { ...STATS, range: new URL(request.url).searchParams.get('range') ?? STATS.range },
      'Platform stats retrieved.'
    )
  ),
  // An admin's Overview also reads the API's release, error tracking's, feature flags' and maintenance mode's health.
  http.get('/api/v1/platform/system/status', () =>
    ok(
      {
        ...SYSTEM_STATUS,
        maintenance: {
          mode: MAINTENANCE_VIEW.mode,
          since: MAINTENANCE_VIEW.since,
          known: true,
          queuesPaused: MAINTENANCE_VIEW.mode === 'full',
          queues: MAINTENANCE_VIEW.queues,
          noticesPending: false,
          lastReloadError: null,
        },
      },
      'System status retrieved.'
    )
  ),
  // The staff shell's banner reads this on every page: off unless `?maintenance=` says otherwise.
  http.get('/api/v1/platform/maintenance-mode', () =>
    maintenanceParam === 'route'
      ? passthrough()
      : ok(MAINTENANCE_VIEW, 'Maintenance mode retrieved.')
  ),
  // The staff shell's loader reads Apex's flags on every page; Apex has none yet.
  http.get('/api/v1/platform/me/flags', () =>
    ok({ flags: {}, evaluatedAt: '2026-10-05T10:00:00.000Z' }, 'Flags retrieved.')
  ),
  // The flags inspector and its evaluation, configured unless `?flags=unconfigured`.
  http.get('/api/v1/platform/flags', () => ok(flagsList(), 'Flags retrieved.')),
  http.get('/api/v1/platform/flags/evaluate', ({ request }) =>
    ok(flagsEvaluation(new URL(request.url).searchParams), 'Flags evaluated.')
  ),
  // The activity page (the platform log, its actor filter's staff list and its tenant filter's search), and the History cards: a user's by `targetId`, a tenant's by `tenantId` with `access=platform`.
  http.get('/api/v1/platform/audit-log', ({ request }) => {
    const params = new URL(request.url).searchParams
    if (params.has('targetId') || (params.has('tenantId') && params.get('access') === 'platform')) {
      return ok({ entries: historyOf(params), nextCursor: null }, 'Audit log retrieved.')
    }
    return ok(
      {
        entries: [
          {
            id: AUDIT_ID_2,
            occurredAt: '2026-09-25T10:00:00.000Z',
            action: 'tenant.settings_updated',
            access: 'platform',
            actor: { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' },
            target: { type: 'settings', id: TENANT_ID },
            metadata: { changed: ['timezone'] },
            tenant: ACME,
          },
          {
            id: AUDIT_ID_1,
            occurredAt: '2026-09-25T09:00:00.000Z',
            action: 'tenant.created',
            access: 'member',
            actor: { id: USER_ID, name: 'A B', email: 'a@b.com' },
            target: { type: 'tenant', id: TENANT_ID },
            metadata: { name: 'Acme Corp', slug: 'acme' },
            tenant: ACME,
          },
        ],
        nextCursor: 'c2',
      },
      'Audit log retrieved.'
    )
  }),
  // The Staff page: the harness admin's platform role, the staff list (shared with the activity page's actor filter) and no pending invitations.
  http.get('/api/v1/tenants/platform', () =>
    ok(
      {
        id: PLATFORM_TENANT_ID,
        name: 'Platform',
        slug: 'platform',
        description: null,
        logo: null,
        website: null,
        lifecycleState: 'active',
        deletedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isPlatform: true,
        role: 'admin',
        access: 'member',
      },
      'Tenant retrieved.'
    )
  ),
  http.get('/api/v1/tenants/platform/members', () => ok(MEMBERS, 'Members retrieved.')),
  http.get('/api/v1/tenants/platform/invitations', () => ok([], 'Invitations retrieved.')),
  // The Tenants table, the palette and the activity tenant filter: one tenant in each status, so every badge renders.
  http.get('/api/v1/platform/tenants', () =>
    ok(
      {
        tenants: [
          { ...ACME, lifecycleState: 'active' },
          { id: TENANT_ID_2, name: 'Beta Ltd', slug: 'beta', lifecycleState: 'suspended' },
          { id: TENANT_ID_3, name: 'Gamma Inc', slug: 'gamma', lifecycleState: 'archived' },
        ].map((tenant) => ({ ...tenant, memberCount: 2, createdAt: '2026-01-01T00:00:00.000Z' })),
        nextCursor: null,
        prevCursor: null,
      },
      'Tenants retrieved.'
    )
  ),
  // The Users table and the palette's user search; `prevCursor` is null, as on a real first page.
  http.get('/api/v1/platform/users', () =>
    ok({ users: USER_ROWS, nextCursor: 'n', prevCursor: null }, 'Users retrieved.')
  ),
  http.get('/api/v1/platform/users/:userId', ({ params }) =>
    ok(userDetail(String(params.userId)), 'User retrieved.')
  ),
  // The user and tenant timelines, filtered by `view` and `range` and paged by `before` as express answers them.
  http.get('/api/v1/platform/users/:userId/timeline', ({ params, request }) =>
    ok(
      timelineOf('user', String(params.userId), new URL(request.url).searchParams),
      'Timeline retrieved.'
    )
  ),
  http.get('/api/v1/platform/tenants/:tenantId/timeline', ({ params, request }) =>
    ok(
      timelineOf('tenant', String(params.tenantId), new URL(request.url).searchParams),
      'Timeline retrieved.'
    )
  ),
  // The user and tenant Errors tabs, configured unless `?errors=unconfigured`.
  http.get('/api/v1/platform/users/:userId/errors', () => ok(errorsOf(), 'Errors retrieved.')),
  http.get('/api/v1/platform/tenants/:tenantId/errors', () => ok(errorsOf(), 'Errors retrieved.')),
  http.get('/api/v1/platform/tenants/:tenantId', ({ params }) =>
    ok(tenantDetail(String(params.tenantId)), 'Tenant retrieved.')
  ),
  // The onboarding page (funnel, and the list by state) and a tenant's Onboarding tab.
  http.get('/api/v1/platform/onboarding/funnel', ({ request }) =>
    ok(
      onboardingFunnel(new URL(request.url).searchParams.get('range') ?? '30d'),
      'Onboarding funnel retrieved.'
    )
  ),
  http.get('/api/v1/platform/onboarding/tenants', ({ request }) => {
    const state = new URL(request.url).searchParams.get('state') ?? 'stuck'
    const tenants = ONBOARDING_ROWS.filter((row) => row.state === state)
    return ok({ tenants, nextCursor: null, prevCursor: null }, 'Onboarding tenants retrieved.')
  }),
  http.get('/api/v1/platform/tenants/:tenantId/onboarding', ({ params }) =>
    ok(tenantOnboarding(String(params.tenantId)), 'Tenant onboarding retrieved.')
  ),
  // Acme's own routes, which its Members, Invitations and Activity tabs read. Beta's are never called: a frozen tenant's tabs make no tenant-route request.
  http.get('/api/v1/tenants/acme', () =>
    ok(
      {
        ...ACME,
        description: null,
        logo: null,
        website: null,
        lifecycleState: 'active',
        deletedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isPlatform: false,
        role: acmeRole ?? 'admin',
        access: acmeRole ? 'member' : 'platform',
      },
      'Tenant retrieved.'
    )
  ),
  http.get('/api/v1/tenants/acme/members', () =>
    ok(
      MEMBERS.map((member, index) => ({
        ...member,
        membership: {
          ...member.membership,
          tenantId: TENANT_ID,
          ...(acmeRole ? { role: index === 0 ? acmeRole : 'owner' } : {}),
        },
      })),
      'Members retrieved.'
    )
  ),
  http.delete('/api/v1/tenants/:slug/membership', () => ok(null, 'You left the tenant.')),
  http.get('/api/v1/tenants/acme/invitations', () => ok([], 'Invitations retrieved.')),
  http.get('/api/v1/tenants/acme/audit-log', () =>
    ok(
      {
        entries: [
          {
            id: AUDIT_ID_1,
            occurredAt: '2026-09-25T09:00:00.000Z',
            action: 'tenant.created',
            access: 'member',
            actor: { id: USER_ID, name: 'A B', email: 'a@b.com' },
            target: { type: 'tenant', id: TENANT_ID },
            metadata: { name: 'Acme Corp', slug: 'acme' },
          },
        ],
        nextCursor: null,
      },
      'Audit log retrieved.'
    )
  ),
  // Before `/platform/emails/:emailId`, as express registers it, so `health` is never read as an id.
  http.get('/api/v1/platform/emails/health', ({ request }) =>
    ok(
      emailHealth(new URL(request.url).searchParams.get('range') ?? '7d'),
      'Email health retrieved.'
    )
  ),
  http.get('/api/v1/platform/emails/:emailId/preview', () =>
    ok(EMAIL_PREVIEW, 'Email preview rendered.')
  ),
  http.get('/api/v1/platform/emails/:emailId', ({ params }) =>
    ok(emailDetail(String(params.emailId)), 'Email retrieved.')
  ),
  http.get('/api/v1/platform/email-suppressions', ({ request }) => {
    const state = new URL(request.url).searchParams.get('state') ?? 'active'
    const suppressions = SUPPRESSION_ROWS.filter(
      (row) => state === 'all' || (state === 'lifted') === (row.liftedAt !== null)
    )
    return ok({ suppressions, nextCursor: null, prevCursor: null }, 'Suppressions retrieved.')
  }),
  // Filtered the way the API filters: a user's card sees their emails, a tenant's tab its own.
  http.get('/api/v1/platform/emails', ({ request }) => {
    const params = new URL(request.url).searchParams
    const userId = params.get('userId')
    const tenantId = params.get('tenantId')
    const emails = EMAIL_ROWS.filter(
      (row) =>
        (userId === null || row.user?.id === userId) &&
        (tenantId === null || row.tenant?.id === tenantId)
    )
    return ok({ messages: emails, nextCursor: null, prevCursor: null }, 'Emails retrieved.')
  }),
  // Suspending a tenant, sending an owner invitation and deactivating a user always ask for a recent sign-in, so the fixtures can open the stacked step-up dialog.
  http.post('/api/v1/platform/tenants/:tenantId/suspend', reauthRequired),
  http.post('/api/v1/platform/tenants/:tenantId/owner-invitation', reauthRequired),
  http.post('/api/v1/platform/users/:userId/deactivate', reauthRequired),
  http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.')),
  // /profile's Security section. Unmocked, it would reach the real API, 401, and sign the harness user out.
  http.get('/api/v1/auth/providers', () =>
    ok(
      {
        providers: [
          { provider: 'email', linkedAt: '2026-01-01T00:00:00.000Z' },
          { provider: 'google', linkedAt: '2026-01-02T00:00:00.000Z' },
        ],
        hasPassword: true,
      },
      'Auth providers retrieved.'
    )
  ),
  http.post('/api/v1/auth/sessions/revoke-others', () =>
    ok({ revoked: 2 }, 'Other sessions signed out.')
  ),
  // Any other current password gets the API's own 400.
  http.post('/api/v1/auth/change-password', async ({ request }) => {
    const body = (await request.json()) as { currentPassword?: unknown }
    if (body.currentPassword === HARNESS_PASSWORD) return ok(null, 'Password has been changed.')
    return Response.json(
      {
        success: false,
        message: 'Current password is incorrect.',
        statusCode: 400,
        requestId: 'harness',
      },
      { status: 400 }
    )
  }),
  // Belt and braces: nothing in the fixtures suite should ever reach the real backend, and a silent fall-through is how it would.
  http.post('/api/v1/auth/refresh', () =>
    ok({ accessToken: 'harness-token', user: testUser }, 'Session refreshed.')
  )
)

await worker.start({ onUnhandledRequest: 'bypass', quiet: true })

// The real store state a signed-in user has. `isBootstrapped` skips the refresh round trip the root route would otherwise wait on.
useAuthStore.setState({
  accessToken: 'harness-token',
  user: testUser,
  isAuthenticated: true,
  isBootstrapped: true,
})

/**
 * Which in-app route to mount. Defaults to the overview. `?path=` exists for
 * the contrast suite and `fixtures/security.test.ts`, which need the other
 * authenticated surfaces: the handlers above answer /profile,
 * /auth/providers, the tenants page's search, the activity page's three
 * requests, the Staff page's three, the users list and a user's page (its Emails
 * card, timeline and errors included), a tenant's page with its tabs, the Emails list and an email's page with its
 * preview, Deliverability, Suppressions, Onboarding, Feature flags and Maintenance, so those pages render without a backend.
 *
 * Only a same-origin absolute path is accepted. This harness is not
 * shipped (nothing in `src/` imports it, and `index.html` is the only Vite
 * entry that builds), but it does run against a real browser with a
 * signed-in store, and a query parameter that reached `replaceState`
 * unchecked would be an open-redirect shape worth never writing down in
 * the first place.
 */
const requestedPath = new URLSearchParams(location.search).get('path')
const targetPath = requestedPath && /^\/[^/\\]/.test(requestedPath) ? requestedPath : '/overview'

/**
 * replaceState, NOT router.navigate: navigate before the router mounts
 * does a real navigation, and the dev server then answers
 * the path with the SPA fallback (index.html -> main.tsx), so
 * the harness never runs. The router reads location on mount, so setting
 * it first is enough. A path may carry its own query
 * (`?path=/deliverability?range=30d`); the harness's parameters follow it
 * after an `&`, so the page reads that query as written.
 */
const harnessQuery = location.search.slice(1)
history.replaceState(
  null,
  '',
  harnessQuery === ''
    ? targetPath
    : `${targetPath}${targetPath.includes('?') ? '&' : '?'}${harnessQuery}`
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
