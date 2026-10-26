/**
 * @file The e2e fixture harness: the real shell, router and CSS in a real
 * browser, with MSW answering the same fixtures `tests/unit/a11y.test.tsx` uses
 * and the same signed-in store state, so Playwright's `fixtures` project needs
 * no backend. Nothing in `src/` imports it, and `index.html` is the only Vite
 * entry that builds. The harness user is a platform admin unless `?role=` names
 * another role (see `platformRole`).
 */
import '@/lib/zod-jitless'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { http, passthrough } from 'msw'
import { setupWorker } from 'msw/browser'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { authTimeOf } from '@/lib/step-up'
import { profileKeys } from '@/queries/profile.queries'
import { queryClient, router } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import type { StaffTenantBilling } from '@/types/billing.types'
import {
  testBillingEvents,
  testBillingHistory,
  testBillingSubscriptions,
  testInvoices,
  testPlans,
  testTenantBilling,
} from '../../tests/fixtures/billing'
import {
  AUDIT_ID_1,
  AUDIT_ID_2,
  EMAIL_ATTEMPT_ID,
  EMAIL_EVENT_ID,
  EMAIL_ID,
  EMAIL_ID_2,
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  PASSKEY_ID,
  PASSKEY_ID_2,
  PASSKEY_ID_3,
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
import { listPage } from '../../tests/fixtures/list-page'
import { USER_HANDLE } from '../../tests/fixtures/user-handle'

/** The one tenant the activity rows and the tenant filter name. */
/** The Activity page's third entry: a suspension whose reason names a person. */
const SUSPENDED_AUDIT_ID = '60000000-0000-4000-8000-000000000101'
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
    user: { id: USER_ID, email: 'a.b@example.com', firstName: 'A', lastName: 'B' },
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
    user: { id: USER_ID_2, email: 'cleo.d@example.com', firstName: 'Cleo', lastName: 'D' },
  },
]

/**
 * The staff invitation the accept page previews: Sam Staff asks a new
 * address to join the platform as a viewer.
 */
const STAFF_INVITATION = {
  tenant: { name: 'Platform', slug: 'platform' },
  role: 'viewer' as const,
  invitedBy: { firstName: 'Sam', lastName: 'Staff' },
  email: 'new.staff@example.com',
}

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
 * Once they leave, Acme answers through platform access, without their row.
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

/** Whether the harness user has left Acme in this page load. */
let hasLeftAcme = false

/** The harness user's role in Acme, while they are still a member there. */
function acmeMembership() {
  return hasLeftAcme ? null : acmeRole
}

const testUser = {
  id: USER_ID,
  email: 'a.b@example.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole,
  analyticsOptOut: false,
}

/**
 * The Overview's figures: the same seven days as `testStats` in
 * `tests/mocks/handlers.ts`, restated because `@` is aliased to `src/`, so that
 * file's `@/tests` imports do not resolve under Vite. All sends are in `sent`
 * and one email is undelivered on the fourth day, so the chart draws eight
 * segments (a zero-height segment draws nothing).
 */
const STATS = {
  range: '7d' as const,
  totals: { tenants: 1284, users: 9730, staff: 18, stuckTenants: 6 },
  signups: ['23', '24', '25', '26', '27', '28', '29'].map((day, index) => ({
    date: `2026-09-${day}`,
    users: 20 + index * 3,
    tenants: 2 + (index % 3),
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

/** The API's success envelope around `data`, with `statusCode` as its HTTP status too. */
function ok<T>(data: T, message = 'OK', statusCode = 200) {
  return Response.json({ success: true, message, statusCode, data }, { status: statusCode })
}

/** An express error envelope as a `Response`; `headers` carries a `Maintenance-Mode` answer. */
function fail(
  message: string,
  statusCode: number,
  code?: string,
  headers?: HeadersInit,
  extra: Record<string, unknown> = {}
) {
  return Response.json(
    { success: false, message, statusCode, code, ...extra, requestId: 'harness-request-id' },
    { status: statusCode, headers }
  )
}

/** express's `LINK_INVALID_MESSAGE`: its one answer for a sign-in or step-up link that cannot be used. */
const LINK_INVALID = 'This link expired or was already used. Ask for a new link.'

/** express's `INVITATION_INVALID_MESSAGE`, its one answer for every dead invitation. */
const INVITATION_INVALID =
  'This invitation link has expired or was already used. Ask the person who invited you for a new one.'

/** express's `INVITATION_CONFIRM_INVALID_MESSAGE`, for a confirmation link that cannot join anyone. */
const INVITATION_CONFIRM_INVALID =
  "We couldn't use this link. Open your invitation email and select Join again, or ask the person who invited you for a new invite."

/** express's 503 while maintenance is read-only: its `mode` and `since`, `Retry-After`, and the `Maintenance-Mode` header. */
function readOnly() {
  return fail(
    'The service is read-only for maintenance.',
    503,
    'READ_ONLY_MODE',
    { 'Maintenance-Mode': 'read_only', 'Retry-After': '30' },
    { mode: 'read_only', since: null }
  )
}

const params = new URLSearchParams(location.search)

/**
 * `?session=none` starts signed out: the store is settled with no user, so no
 * bootstrap refresh runs, and a refresh answers 401 as express does without a
 * cookie. Only the public routes (`/login`, `/auth/link`, `/auth/confirm` and
 * the invitation pages) render under it; a staff route sends it to `/login`.
 */
const signedOut = params.get('session') === 'none'
/** Whether the browser holds a refresh cookie: from the start when signed in, else once a link or an invitation signed it in. */
let hasRefreshCookie = !signedOut

/**
 * `?link=` picks what `POST /auth/link/verify` answers: `ok` (the default)
 * signs the harness user in, `dead` is the 400 `LINK_INVALID`, and `readonly`
 * the 503 `READ_ONLY_MODE`.
 */
const linkMode = params.get('link') ?? 'ok'

/**
 * `?invite=` picks the staff invitation answers. With none, the preview is
 * for another address, so a signed-in user is asked before switching. `ok`
 * makes the preview the harness user's, so signed in, the page accepts.
 * Signed out, the verify answers the `202` "Check your inbox" for the
 * preview's address, as express does for every staff invitation. `dead` 404s
 * the preview, the verify and the accept. `joined` 404s the preview, as for a
 * used link, and the accept answers `alreadyMember`.
 */
const inviteMode = params.get('invite')

/**
 * `?inviteconfirm=` picks what `POST /invitations/confirm` answers: `ok` (the
 * default) signs the harness user in and joins the platform, `dead` is the
 * 404 `invitation_invalid`, and `readonly` the 503 `READ_ONLY_MODE`.
 */
const inviteConfirmMode = params.get('inviteconfirm') ?? 'ok'

/**
 * `?confirm=` picks what `POST /auth/step-up/link/verify` answers: `ok` (the
 * default) and `gone` confirm the session, and `dead` is the 400
 * `LINK_INVALID`. `gone` names the run with no tab waiting; the server answers
 * it as `ok`, and the confirm page finds no wait lock held.
 */
const confirmMode = params.get('confirm') ?? 'ok'

/**
 * Where the harness keeps when this browser's session last confirmed it was
 * the user: shared by every harness page in the context, as the server's
 * session is, so a confirm in one tab elevates the next refresh in another.
 */
const STEPPED_UP_AT_KEY = 'e2e-harness:stepped-up-at'

/** The session's sign-in, in epoch seconds: long enough ago that every step-up route refuses it, except under `?setup=1`, whose session just signed in. */
const SIGNED_IN_AUTH_TIME =
  params.get('setup') === '1'
    ? Math.floor(Date.now() / 1000)
    : Math.floor(Date.parse('2026-01-01T00:00:00.000Z') / 1000)

/** The session's current `auth_time`: its last confirmation in any tab, or the sign-in. */
function sessionAuthTime(): number {
  const steppedUp = Number(localStorage.getItem(STEPPED_UP_AT_KEY))
  return Number.isFinite(steppedUp) && steppedUp > 0 ? steppedUp : SIGNED_IN_AUTH_TIME
}

/**
 * An access token shaped as express's: a JWT whose payload carries
 * `auth_time`, which the step-up dialog reads after a refresh to tell a real
 * confirmation from a stray message. Unsigned, as nothing here checks it.
 */
function harnessToken(authTime = sessionAuthTime()): string {
  return [btoa('{"alg":"none"}'), btoa(JSON.stringify({ auth_time: authTime })), 'harness'].join(
    '.'
  )
}

/**
 * `?stepup=once` refuses a suspend whose bearer has not confirmed in the last
 * 10 minutes, as express's `requireRecentAuth` does, and answers any other
 * with the suspended tenant, which the tenant's page then reads. So only a
 * retry that carries the confirmed token lands. Without it, every suspend is
 * refused.
 */
const stepUpOnce = params.get('stepup') === 'once'
/** Whether Acme is suspended now, in this page load. */
const suspension = { suspended: false }

/** The grants staff added in this page load, newest first, ahead of the fixture's. */
const addedGrants: StaffTenantBilling['grants'] = []

/** A customer tenant's billing view as it stands in this page load. */
function tenantBilling(): StaffTenantBilling {
  return { ...testTenantBilling, grants: [...addedGrants, ...testTenantBilling.grants] }
}

/** express's `STEP_UP_MAX_AGE_MS`: how recent a confirmation the step-up routes accept. */
const STEP_UP_MAX_AGE_MS = 10 * 60 * 1000

/**
 * express's `requireRecentAuth`: whether the request's bearer carries an
 * `auth_time` within `STEP_UP_MAX_AGE_MS` of now.
 */
function hasRecentAuth(request: Request): boolean {
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? null
  const authTime = authTimeOf(bearer)
  return authTime !== null && Date.now() - authTime * 1000 <= STEP_UP_MAX_AGE_MS
}

/** How a list handler reads a request: the params that narrow the rows, then the page. */
interface ServeOptions<T> {
  /** The row text `search` matches, lower-cased by the caller or not. */
  searchIn?: (row: T) => string[]
  /** One predicate per filter param the handler understands, given the comma list's values. */
  filters?: Record<string, (row: T, values: string[]) => boolean>
  /** The sort keys the handler orders by; a key not listed, or none, keeps the array order. */
  sorts?: Record<string, (a: T, b: T) => number>
}

/**
 * Answers a list request the way express does: the search, the filters and
 * the sort applied, then one page of `limit` rows from a cursor, with a total
 * on the first page when it was asked for. A cursor is the offset of a page
 * boundary, so `direction=prev` reads the rows before it.
 * @param rows - Every row the list holds.
 * @param params - The request's query.
 * @param options - How to match, filter and sort.
 * @returns The list envelope's data.
 */
function serveList<T>(rows: T[], params: URLSearchParams, options: ServeOptions<T> = {}) {
  const search = (params.get('search') ?? '').trim().toLowerCase()
  let matched = rows.filter((row) => {
    if (
      search !== '' &&
      !(options.searchIn?.(row) ?? []).some((text) => text.toLowerCase().includes(search))
    ) {
      return false
    }
    return Object.entries(options.filters ?? {}).every(([name, test]) => {
      const raw = params.get(name)
      return raw === null || raw === '' || test(row, raw.split(','))
    })
  })
  const sort = params.get('sort')
  const descending = sort?.startsWith('-') ?? false
  const compare = options.sorts?.[sort?.replace(/^-/, '') ?? '']
  if (compare) matched = [...matched].sort((a, b) => (descending ? compare(b, a) : compare(a, b)))
  const limit = Number(params.get('limit') ?? 20)
  const cursor = Number(params.get('cursor') ?? 0)
  const backwards = params.get('direction') === 'prev'
  const end = backwards ? cursor : cursor + limit
  const start = backwards ? Math.max(0, cursor - limit) : cursor
  return listPage(
    matched.slice(start, Math.min(end, matched.length)),
    {
      nextCursor: end < matched.length ? String(Math.min(end, matched.length)) : null,
      prevCursor: start > 0 ? String(start) : null,
      hasNext: end < matched.length,
      hasPrev: start > 0,
      limit,
    },
    params.has('total') ? { count: matched.length, capped: false } : undefined
  )
}

/** A staff actor on the History cards, and the platform tenant their `user.*` entries are filed under. */
const SAM = { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' }
const PLATFORM = { id: PLATFORM_TENANT_ID, name: 'Platform', slug: 'platform' }

/**
 * A History card's entries: a user's (`target`) or a tenant's staff actions
 * (`tenant` with `access=platform`), each carrying a long reason so the
 * card's wrapping is measured too.
 */
function historyOf(params: URLSearchParams) {
  const targetId = params.get('target')
  if (targetId !== null) {
    return [
      {
        id: AUDIT_ID_2,
        occurredAt: '2026-09-25T10:00:00.000Z',
        action: 'user.deactivated',
        access: 'platform',
        actor: SAM,
        target: { type: 'user', id: targetId },
        metadata: {
          reason: 'Repeated chargebacks reported by Cleo D at the billing provider this month',
        },
        tenant: PLATFORM,
      },
      {
        id: AUDIT_ID_1,
        occurredAt: '2026-09-25T09:00:00.000Z',
        action: 'user.created',
        access: 'platform',
        actor: SAM,
        target: { type: 'user', id: targetId },
        metadata: { emailDomain: 'example-corp.co.uk' },
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
      target: { type: 'tenant', id: params.get('tenant') ?? TENANT_ID },
      metadata: { reason: 'Billing hold while the overdue invoices are reconciled' },
      tenant: ACME,
    },
  ]
}

/** A Users row: Cleo is inactive and unverified; the other is staff, with a long name and email. */
const USER_ROWS = [
  {
    id: USER_ID_2,
    email: 'cleo.d@example.com',
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
    email: 'a-very-long-address-for-the-overflow-check@example-corp.co.uk',
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
        lastSentAt: null,
        resendAvailableAt: null,
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
 * render frozen; Delta is active with no owner at all, so its Actions menu
 * offers the owner invitation. Delta is on no list: only its own page is reached.
 * The platform tenant (the staff team) has a page too, with no Billing tab.
 */
function tenantDetail(tenantId: string) {
  if (tenantId === PLATFORM_TENANT_ID) {
    return {
      ...TENANT_DETAIL_BASE,
      ...PLATFORM,
      lifecycleState: 'active',
      description: null,
      website: null,
      memberCount: MEMBERS.length,
      owners: [],
      pendingInvitationCount: 0,
    }
  }
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
      website: 'https://beta.example-corp.co.uk',
      memberCount: 1,
      owners: [
        {
          userId: USER_ID_3,
          email: 'a-very-long-address-for-the-overflow-check@example-corp.co.uk',
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
    lifecycleState: suspension.suspended ? 'suspended' : 'active',
    description:
      'A deliberately long description, so the overview card wraps at phone width rather than scrolling sideways.',
    website: 'https://acme.example-corp.co.uk',
    memberCount: 2,
    owners: [
      { userId: USER_ID, email: 'a.b@example.com', firstName: 'A', lastName: 'B', active: true },
      {
        userId: USER_ID_2,
        email: 'cleo.d@example.com',
        firstName: 'Cleo',
        lastName: 'D',
        active: false,
      },
    ],
    pendingInvitationCount: 1,
  }
}

/**
 * The emails list, a user's Emails card and a tenant's Emails tab, all
 * `GET /platform/emails`: a delivered sign-in link to Cleo, and a bounced invitation
 * to a long address on Acme, so the badges and the widest row are measured.
 */
const EMAIL_ROWS = [
  {
    id: EMAIL_ID,
    recipient: 'cleo.d@example.com',
    templateKey: 'sign_in_link',
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
    recipient: 'a-very-long-address-for-the-overflow-check@example-corp.co.uk',
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
 * An email's page. Cleo's sign-in link was delivered and can be resent; the long
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

/** `?emails=none` answers every email list as empty; anything else is the fixture rows. */
const emailsParam = new URLSearchParams(location.search).get('emails')

/**
 * `?preview=partial` answers a preview whose stored details were incomplete,
 * and `?preview=unavailable` one whose template no longer exists; anything
 * else is a whole preview.
 */
const previewParam = new URLSearchParams(location.search).get('preview')

/** A preview as express renders it: inline styles only, the link masked, one long unbroken line to test the frame's own scroll. */
const EMAIL_PREVIEW = {
  subject: 'Sign in to Boilerplate',
  html: '<div style="font-family:sans-serif;color:#111"><p>Hi Cleo,</p><p>Sign in to Boilerplate: <a href="http://localhost:5173/auth/link?token=••••••">http://localhost:5173/auth/link?token=••••••••••••••••••••••••••••••••••••••••</a></p></div>',
  text: 'Hi Cleo,\n\nSign in to Boilerplate: http://localhost:5173/auth/link?token=••••••',
  partial: false,
}

/**
 * Deliverability: the 7-day window has provider data, so every tile has a
 * value; the 30-day one has none, so the page shows the no-provider banner
 * and "No provider data" tiles over the same chart.
 */
function emailHealth(range: string) {
  const hasProvider = range !== '30d'
  /** A rate tile's figures; with no provider data the tile has no value. */
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
      { key: 'sign_in_link', messages: 2100, undelivered: 1, complained: 6 },
      { key: 'tenant_invitation', messages: 1611, undelivered: 0, complained: 4 },
    ],
    byDomain: [
      { key: 'example-corp.co.uk', messages: 3000, undelivered: 1, complained: 9 },
      { key: 'example.com', messages: 711, undelivered: 0, complained: 1 },
    ],
  }
}

/** Suppressions: the long address's, still active and so offering Lift, and a lifted one with its reason. */
const SUPPRESSION_ROWS = [
  {
    id: SUPPRESSION_ID,
    address: 'a-very-long-address-for-the-overflow-check@example-corp.co.uk',
    reason: 'hard_bounce',
    sourceMessageId: EMAIL_ID_2,
    createdAt: '2026-09-27T09:00:08.000Z',
    liftedAt: null,
    liftedBy: null,
    liftReason: null,
  },
  {
    id: SUPPRESSION_ID_2,
    address: 'cleo.d@example.com',
    reason: 'complaint',
    sourceMessageId: null,
    createdAt: '2026-09-20T09:00:00.000Z',
    liftedAt: '2026-09-21T09:00:00.000Z',
    liftedBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
    liftReason: 'The customer confirmed the complaint was a mistake and asked to be mailed again',
  },
]

/** The title of each onboarding step, by key. */
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
 * The onboarding list: Acme stuck with two owners, the long-named Beta in
 * progress, Delta waiting for its owner and Gamma complete. No row is dismissed.
 * The handler returns the rows whose state matches `?state=` (default `stuck`).
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

/** A tenant's Onboarding tab: a step completed by staff, by the system and by the customer (with its members), and two reminders. */
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
  /** An open step of the tab, with a description long enough to wrap at phone width. */
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
      emailDomains: ['example.com', 'example-corp.co.uk'],
    },
    reminders: [
      {
        id: AUDIT_ID_2,
        sentAt: '2026-09-28T09:00:00.000Z',
        sentBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
        reason:
          'Stalled for a week after the kickoff call; nudging both owners towards inviting the team',
        recipientCount: 2,
        emailDomains: ['example.com', 'example-corp.co.uk'],
        messageIds: [EMAIL_ID, EMAIL_ID_2],
      },
      {
        id: AUDIT_ID_1,
        sentAt: '2026-09-20T09:00:00.000Z',
        sentBy: null,
        reason: 'First nudge',
        recipientCount: 1,
        emailDomains: ['example.com'],
        messageIds: [EMAIL_ID],
      },
    ],
  }
}

/**
 * `?flags=unconfigured` answers the flags routes as an environment without
 * the feature flags key does, and `?flags=stale` answers an evaluation whose
 * snapshot is stale; anything else is configured and fresh.
 */
const flagsParam = new URLSearchParams(location.search).get('flags')

/** A flag's PostHog page in the project the harness pretends to read. */
function flagUrl(id: number) {
  return `https://us.posthog.com/project/1/feature_flags/${id}`
}

/**
 * The registry: two reference flags (an active beta page and an inactive
 * experiment) and a third made unsupported by a cohort condition with a long
 * description.
 */
function flagRegistryRows() {
  const enabled = flagsParam !== 'unconfigured'
  return [
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
  ]
}

/** PostHog's flags the registry lacks: one, unless PostHog is not configured. */
function unregisteredFlagRows() {
  return flagsParam === 'unconfigured'
    ? []
    : [{ key: 'legacy_marketing_banner', active: true, posthogUrl: flagUrl(104) }]
}

/** The inspector's meta read: the five traits and the snapshot. */
function flagsMeta() {
  const enabled = flagsParam !== 'unconfigured'
  return {
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
 * One evaluation: in a tenant the beta page matches its first condition; the
 * experiment puts the user in its holdout, so they see `control`; the
 * unsupported flag serves its fallback.
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
    snapshot: {
      fetchedAt: enabled ? '2026-10-05T09:59:30.000Z' : null,
      stale: flagsParam === 'stale',
    },
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

/** The four queues, all paused or none, with one analytics job active. */
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

/** express's step-up refusal (`requireRecentAuth`), for the writes the fixtures drive into the stacked dialog. */
function reauthRequired() {
  return fail("Confirm it's you to continue.", 401, 'REAUTH_REQUIRED')
}

/**
 * `?hold=` and `?fail=` each take comma-separated API paths
 * (`/api/v1/platform/stats`), matched exactly as MSW path patterns (a `:param`
 * segment matches any value; there is no prefix match), for every method, so
 * a held POST such as `/api/v1/auth/link/verify` or
 * `/api/v1/invitations/verify` stays pending too. A held path never answers
 * and a failed one answers 500, so a fixture can show that one section's
 * request changes only that section. Only `/api/v1/` paths are taken. These
 * handlers come first, so they win over the defaults below.
 */
const sectionParams = new URLSearchParams(location.search)
/** The `/api/v1/` paths listed under `key`. */
const pathsOf = (key: string) =>
  (sectionParams.get(key) ?? '').split(',').filter((path) => path.startsWith('/api/v1/'))
const sectionHandlers = [
  ...pathsOf('hold').map((path) => http.all(path, () => new Promise<Response>(() => {}))),
  ...pathsOf('fail').map((path) =>
    http.all(
      path,
      () =>
        new Response(
          JSON.stringify({ success: false, message: 'Harness failure', statusCode: 500 }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
    )
  ),
]

/**
 * The Tenants table's rows: one in each status, then enough more to fill a
 * second page. Between them they hold every plan state, each one express can
 * produce: every customer tenant has a billing record, so none is null. The
 * first filler is on Free, so the first page shows every plan badge.
 */
const PLATFORM_TENANT_ROWS = [
  { ...ACME, lifecycleState: 'active', billingState: 'active' },
  {
    id: TENANT_ID_2,
    name: 'Beta Ltd',
    slug: 'beta',
    lifecycleState: 'suspended',
    billingState: 'past_due',
  },
  {
    id: TENANT_ID_3,
    name: 'Gamma Inc',
    slug: 'gamma',
    lifecycleState: 'archived',
    billingState: 'free',
  },
  ...Array.from({ length: 21 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
    name: `Filler ${String(index + 1).padStart(2, '0')} Co`,
    slug: `filler-${index + 1}`,
    lifecycleState: 'active',
    billingState: index === 0 ? 'free' : 'trialing',
  })),
].map((tenant, index) => ({
  ...tenant,
  planKey: tenant.billingState === 'free' ? 'free' : 'paid',
  memberCount: 2,
  createdAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
}))

/**
 * `?passkeys=off|optional|required` sets the passkey config mode (default `optional`).
 * In `off` every passkey route but the config answers express's unknown-route 404.
 */
const passkeyMode = (params.get('passkeys') ?? 'optional') as 'off' | 'optional' | 'required'

/**
 * `?setup=1` is required mode for an account with no passkey yet: every
 * `/platform/*` call and `POST /auth/passkeys/step-up/options` answer 403
 * `PASSKEY_SETUP_REQUIRED` until a registration verify succeeds, as express's
 * allowlist does. The session it starts is a fresh sign-in, so the first
 * registration needs no "Confirm it's you".
 */
const setupMode = params.get('setup') === '1'
let setupDone = !setupMode

/** `?passkeylist=none|one|two` (default `none`, which keeps every step-up fixture on the email-link view). */
const passkeyListMode = params.get('passkeylist') ?? 'none'

/** The probe's passkey name, for `?pii=probe`: the first row carries it. */
const PROBE_PASSKEY_NAME = 'Pii Probe’s phone'

/** The harness user's passkeys, oldest first; a registration appends, a delete removes. */
const passkeys = [
  {
    id: PASSKEY_ID,
    name: params.get('pii') === 'probe' ? PROBE_PASSKEY_NAME : 'MacBook Touch ID',
    provider: { name: 'iCloud Keychain', iconLight: null, iconDark: null },
    synced: true,
    createdAt: '2026-09-01T10:00:00.000Z',
    lastUsedAt: '2026-10-01T10:00:00.000Z',
    credentialId: 'Y3JlZGVudGlhbC0x',
  },
  {
    id: PASSKEY_ID_2,
    name: 'Work security key',
    provider: { name: 'YubiKey 5', iconLight: null, iconDark: null },
    synced: false,
    createdAt: '2026-09-15T10:00:00.000Z',
    lastUsedAt: null,
    credentialId: 'Y3JlZGVudGlhbC0y',
  },
].slice(0, passkeyListMode === 'none' ? 0 : passkeyListMode === 'one' ? 1 : 2)

/** express's unknown-route 404, which every passkey route but the config answers in `off` mode. */
function unknownRoute() {
  return fail('Route not found', 404, 'not_found')
}

/** The 403 that required mode answers while the account has no passkey, or null once it has one. */
function setupRefusal() {
  return setupDone
    ? null
    : fail(
        'Create a passkey to continue. Every account here needs one.',
        403,
        'PASSKEY_SETUP_REQUIRED'
      )
}

/** The 401 a stale session gets for a write that needs a recent confirmation, or null when it is recent. */
function reauthRefusal(request: Request) {
  return hasRecentAuth(request) ? null : reauthRequired()
}

/** A request challenge for `rpId` `localhost`, the harness's origin. */
function passkeyRequestOptions() {
  return {
    challenge: 'aGFybmVzcy1jaGFsbGVuZ2U',
    rpId: 'localhost',
    timeout: 60000,
    userVerification: 'required',
  }
}

/**
 * A 400 when the request body is not exactly `expected` (the contract's strict
 * bodies), else `null`, so a wrong wire shape cannot pass through the harness unseen.
 */
async function wrongBody(request: Request, expected: Record<string, unknown>) {
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as unknown
  return JSON.stringify(body) === JSON.stringify(expected)
    ? null
    : fail('Request body does not match the contract.', 400, 'VALIDATION_ERROR')
}

/** The list answer: the passkeys and the user handle. */
function passkeyList() {
  return { passkeys, userHandle: USER_HANDLE }
}

/**
 * Handlers for the passkey and step-up calls of the contract. The harness does
 * not check a signature. `?passkeyuser=customer` makes the sign-in verify answer
 * express's 403 `PASSKEY_NO_ACCESS` for a non-staff account.
 */
const passkeyHandlers = [
  http.get('/api/v1/auth/passkeys/config', () =>
    ok({ mode: passkeyMode, rpId: 'localhost' }, 'Passkey config retrieved.')
  ),
  http.post('/api/v1/auth/passkeys/sign-in/options', async ({ request }) =>
    passkeyMode === 'off'
      ? unknownRoute()
      : ((await wrongBody(request, {})) ??
        ok({ challengeId: 'harness-sign-in', options: passkeyRequestOptions() }, 'Options.'))
  ),
  http.post('/api/v1/auth/passkeys/sign-in/verify', () => {
    if (passkeyMode === 'off') return unknownRoute()
    if (params.get('passkeyuser') === 'customer') {
      return fail(
        "This account doesn't have staff access. Ask a staff owner to invite you.",
        403,
        'PASSKEY_NO_ACCESS'
      )
    }
    hasRefreshCookie = true
    return ok(
      { user: testUser, accessToken: harnessToken(), isNewUser: false, redirect: null },
      'Signed in.'
    )
  }),
  http.post('/api/v1/auth/passkeys/step-up/options', async ({ request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    const malformed = await wrongBody(request, {})
    if (malformed) return malformed
    const refusal = setupRefusal()
    if (refusal) return refusal
    if (passkeys.length === 0)
      return fail('You have no passkey to confirm with.', 409, 'NO_PASSKEY')
    return ok({ challengeId: 'harness-step-up', options: passkeyRequestOptions() }, 'Options.')
  }),
  http.post('/api/v1/auth/passkeys/step-up/verify', async ({ request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    // Strict body: `app` is not accepted here.
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as object
    if ('app' in body)
      return fail('Request body does not match the contract.', 400, 'VALIDATION_ERROR')
    const now = Math.floor(Date.now() / 1000)
    localStorage.setItem(STEPPED_UP_AT_KEY, String(now))
    return ok({ accessToken: harnessToken(now) }, 'Identity confirmed.')
  }),
  http.get('/api/v1/auth/passkeys', () =>
    passkeyMode === 'off' ? unknownRoute() : ok(passkeyList(), 'Passkeys retrieved.')
  ),
  http.post('/api/v1/auth/passkeys/registration/options', async ({ request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    const malformed = await wrongBody(request, { app: 'apex' })
    if (malformed) return malformed
    const stale = reauthRefusal(request)
    if (stale) return stale
    return ok(
      {
        challengeId: 'harness-registration',
        options: {
          challenge: 'aGFybmVzcy1jaGFsbGVuZ2U',
          rp: { id: 'localhost', name: 'Harness' },
          user: { id: USER_HANDLE, name: testUser.email, displayName: 'A B' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          timeout: 60000,
          attestation: 'none',
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        },
      },
      'Options.'
    )
  }),
  http.post('/api/v1/auth/passkeys/registration/verify', ({ request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    const stale = reauthRefusal(request)
    if (stale) return stale
    const passkey = {
      id: PASSKEY_ID_3,
      name: 'Passkey 3',
      provider: { name: 'Chrome on Mac', iconLight: null, iconDark: null },
      synced: false,
      createdAt: '2026-10-21T10:00:00.000Z',
      lastUsedAt: null,
      credentialId: 'Y3JlZGVudGlhbC0z',
    }
    passkeys.push(passkey)
    setupDone = true
    return ok({ passkey }, 'Passkey created.', 201)
  }),
  http.patch('/api/v1/auth/passkeys/:id', async ({ params: route, request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    const passkey = passkeys.find((row) => row.id === route.id)
    if (!passkey) return fail('Passkey not found', 404, 'passkey_not_found')
    passkey.name = ((await request.json()) as { name: string }).name
    return ok({ passkey }, 'Passkey renamed.')
  }),
  http.delete('/api/v1/auth/passkeys/:id', ({ params: route, request }) => {
    if (passkeyMode === 'off') return unknownRoute()
    if (new URL(request.url).searchParams.get('app') !== 'apex') {
      return fail('Query does not match the contract.', 400, 'VALIDATION_ERROR')
    }
    const stale = reauthRefusal(request)
    if (stale) return stale
    const index = passkeys.findIndex((row) => row.id === route.id)
    if (index === -1) return fail('Passkey not found', 404, 'passkey_not_found')
    if (passkeys.length === 1 && passkeyMode === 'required') {
      return fail(
        'Your account needs at least one passkey. Create another before you delete this one.',
        409,
        'LAST_PASSKEY'
      )
    }
    passkeys.splice(index, 1)
    return ok(passkeyList(), 'Passkey deleted.')
  }),
]

const worker = setupWorker(
  // Under `?setup=1` every platform call is refused until the first passkey exists, `?hold=` and `?fail=` included; it falls through once it does.
  http.all('/api/v1/platform/*', () => setupRefusal() ?? undefined),
  ...sectionHandlers,
  ...passkeyHandlers,
  // The Overview, the default route: its KPI cards and both charts.
  http.get('/api/v1/platform/stats', ({ request }) =>
    ok(
      { ...STATS, range: new URL(request.url).searchParams.get('range') ?? STATS.range },
      'Platform stats retrieved.'
    )
  ),
  // An admin's Overview also reads the release and the error tracking, flags and maintenance health.
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
  // The staff shell's banner reads this on every page; it is off unless `?maintenance=` says otherwise.
  http.get('/api/v1/platform/maintenance-mode', () =>
    maintenanceParam === 'route'
      ? passthrough()
      : ok(MAINTENANCE_VIEW, 'Maintenance mode retrieved.')
  ),
  // The staff shell's loader reads Apex's flags on every page; there are none.
  http.get('/api/v1/platform/me/flags', () =>
    ok({ flags: {}, evaluatedAt: '2026-10-05T10:00:00.000Z' }, 'Flags retrieved.')
  ),
  // The flags inspector and its evaluation, configured unless `?flags=unconfigured`.
  http.get('/api/v1/platform/flags', ({ request }) =>
    ok(
      serveList(flagRegistryRows(), new URL(request.url).searchParams, {
        searchIn: (row) => [row.key, row.description],
        filters: {
          kind: (row, values) => values.includes(row.kind),
          state: (row, values) => values.includes(row.state),
        },
      }),
      'Flags retrieved.'
    )
  ),
  http.get('/api/v1/platform/flags/unregistered', ({ request }) =>
    ok(
      serveList(unregisteredFlagRows(), new URL(request.url).searchParams, {
        searchIn: (row) => [row.key],
      }),
      'Unregistered flags retrieved.'
    )
  ),
  http.get('/api/v1/platform/flags/meta', () => ok(flagsMeta(), 'Flags meta retrieved.')),
  http.get('/api/v1/platform/flags/evaluate', ({ request }) =>
    ok(flagsEvaluation(new URL(request.url).searchParams), 'Flags evaluated.')
  ),
  // The activity page's log and the History cards: a user's by `target`, a tenant's by `tenant` with `access=platform`.
  http.get('/api/v1/platform/audit-log', ({ request }) => {
    const params = new URL(request.url).searchParams
    if (params.has('target') || (params.has('tenant') && params.get('access') === 'platform')) {
      return ok(listPage(historyOf(params)), 'Audit log retrieved.')
    }
    return ok(
      listPage(
        [
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
            actor: { id: USER_ID, name: 'A B', email: 'a.b@example.com' },
            target: { type: 'tenant', id: TENANT_ID },
            metadata: { name: 'Acme Corp', slug: 'acme' },
            tenant: ACME,
          },
          {
            id: SUSPENDED_AUDIT_ID,
            occurredAt: '2026-09-24T09:00:00.000Z',
            action: 'tenant.suspended',
            access: 'platform',
            actor: { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' },
            target: { type: 'tenant', id: TENANT_ID },
            metadata: { reason: 'Escalated by Cleo D after the overdue invoices' },
            tenant: ACME,
          },
        ],
        { hasNext: true, nextCursor: 'c2' }
      ),
      'Audit log retrieved.'
    )
  }),
  // The Staff page: the harness admin's platform role, the staff list (also the activity page's actor filter) and no pending invitations.
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
  http.get('/api/v1/tenants/platform/members', () => ok(listPage(MEMBERS), 'Members retrieved.')),
  http.get('/api/v1/tenants/platform/invitations', () =>
    ok(listPage([]), 'Invitations retrieved.')
  ),
  // The Tenants table, the palette and the activity tenant filter. The rows hold every status and plan state; the default view shows active and suspended, and ?state=archived adds the archived one.
  http.get('/api/v1/platform/tenants', ({ request }) => {
    const params = new URL(request.url).searchParams
    // express's `state` defaults to active and suspended, so archived tenants show only when asked for.
    if (!params.get('state')) params.set('state', 'active,suspended')
    return ok(
      serveList(PLATFORM_TENANT_ROWS, params, {
        searchIn: (row) => [row.name, row.slug],
        filters: {
          state: (row, values) => values.includes(row.lifecycleState),
          billingState: (row, values) => values.includes(row.billingState),
        },
        sorts: {
          name: (a, b) => a.name.localeCompare(b.name),
          created: (a, b) => a.createdAt.localeCompare(b.createdAt),
        },
      }),
      'Tenants retrieved.'
    )
  }),
  // The Users table and the palette's user search; `prevCursor` is null, as on a real first page.
  http.get('/api/v1/platform/users', ({ request }) => {
    const params = new URL(request.url).searchParams
    const page = serveList(USER_ROWS, params, {
      searchIn: (row) => [row.email, row.firstName, row.lastName],
      filters: {
        status: (row, values) => values.includes(row.active ? 'active' : 'inactive'),
        signedIn: (row, values) => values.includes(String(row.lastLoggedInAt !== null)),
        staff: (row, values) => values.includes(String(row.platformRole !== null)),
      },
    })
    return ok(
      params.has('cursor')
        ? page
        : { ...page, page: { ...page.page, hasNext: true, nextCursor: 'n' } },
      'Users retrieved.'
    )
  }),
  http.get('/api/v1/platform/users/:userId', ({ params }) =>
    ok(userDetail(String(params.userId)), 'User retrieved.')
  ),
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
    const params = new URL(request.url).searchParams
    const state = params.get('state') ?? 'stuck'
    const tenants = ONBOARDING_ROWS.filter((row) => row.state === state)
    return ok(
      serveList(tenants, params, { searchIn: (row) => [row.name, row.slug] }),
      'Onboarding tenants retrieved.'
    )
  }),
  http.get('/api/v1/platform/tenants/:tenantId/onboarding', ({ params }) =>
    ok(tenantOnboarding(String(params.tenantId)), 'Tenant onboarding retrieved.')
  ),
  // The plans, and a tenant's Billing tab: every customer tenant reads as a monthly Paid customer, and the platform tenant has no billing, as express answers.
  http.get('/api/v1/platform/plans', () => ok(testPlans, 'Plans retrieved.')),
  http.get('/api/v1/platform/tenants/:tenantId/billing', ({ params }) =>
    params.tenantId === PLATFORM_TENANT_ID
      ? fail('This tenant has no billing.', 404, 'tenant_billing_not_found')
      : ok(tenantBilling(), 'Billing retrieved.')
  ),
  // Adding a grant answers the view with it on top, as express does; staff routes past the step-up are not refused here.
  http.post('/api/v1/platform/tenants/:tenantId/billing/grants', async ({ request }) => {
    const body = (await request.json()) as {
      key: string
      value: number | boolean | null
      expiresAt: string | null
      reason: string
    }
    addedGrants.unshift({
      id: `92000000-0000-4000-8000-${String(addedGrants.length + 2).padStart(12, '0')}`,
      key: body.key,
      value: body.value,
      reason: body.reason,
      grantedBy: { userId: STAFF_USER_ID, name: 'Staff Admin' },
      createdAt: new Date().toISOString(),
      expiresAt: body.expiresAt,
      revokedAt: null,
      status: 'active',
    })
    return ok(tenantBilling(), 'Grant added.')
  }),
  http.get('/api/v1/platform/tenants/:tenantId/billing/history', ({ request }) =>
    ok(
      serveList(testBillingHistory, new URL(request.url).searchParams, {
        searchIn: (row) => [row.from ?? '', row.to, row.cause],
        filters: { source: (row, values) => values.includes(row.source) },
        sorts: { at: (a, b) => a.at.localeCompare(b.at) },
      }),
      'Billing history retrieved.'
    )
  ),
  http.get('/api/v1/platform/tenants/:tenantId/billing/events', ({ request }) =>
    ok(
      serveList(testBillingEvents, new URL(request.url).searchParams, {
        searchIn: (row) => [row.type, row.error ?? ''],
        filters: { status: (row, values) => values.includes(row.status) },
        sorts: { at: (a, b) => a.receivedAt.localeCompare(b.receivedAt) },
      }),
      'Billing events retrieved.'
    )
  ),
  http.get('/api/v1/platform/tenants/:tenantId/billing/subscriptions', ({ request }) =>
    ok(
      serveList(testBillingSubscriptions, new URL(request.url).searchParams, {
        searchIn: (row) => [row.subscriptionId],
        filters: {
          provider: (row, values) => values.includes(row.provider),
          mode: (row, values) => values.includes(row.mode),
        },
        sorts: { firstSeen: (a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) },
      }),
      'Billing subscriptions retrieved.'
    )
  ),
  // Forward only, as express pages the provider: the first page is empty with more to come, and the cursor's page holds the invoice; search and sort are ignored.
  http.get('/api/v1/platform/tenants/:tenantId/billing/invoices', ({ request }) => {
    const params = new URL(request.url).searchParams
    const status = params.get('status')?.split(',')
    const items = testInvoices.filter((row) => status === undefined || status.includes(row.status))
    return ok(
      params.has('cursor')
        ? listPage(items, { hasPrev: true })
        : listPage([], { nextCursor: 'i2', hasNext: true }),
      'Invoices retrieved.'
    )
  }),
  // Acme's own routes, which its Members, Invitations and Activity tabs read. Beta's are never called: a suspended tenant's tabs make no tenant-route request.
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
        role: acmeMembership() ?? 'admin',
        access: acmeMembership() ? 'member' : 'platform',
      },
      'Tenant retrieved.'
    )
  ),
  http.get('/api/v1/tenants/acme/members', () =>
    ok(
      listPage(
        MEMBERS.map((member, index) => ({
          ...member,
          membership: {
            ...member.membership,
            tenantId: TENANT_ID,
            ...(acmeRole ? { role: index === 0 ? acmeRole : 'owner' } : {}),
          },
        })).filter((_, index) => !(acmeRole && hasLeftAcme && index === 0))
      ),
      'Members retrieved.'
    )
  ),
  http.delete('/api/v1/tenants/:slug/membership', ({ params }) => {
    if (params.slug === 'acme') hasLeftAcme = true
    return ok(null, 'You left the tenant.')
  }),
  http.get('/api/v1/tenants/acme/invitations', () => ok(listPage([]), 'Invitations retrieved.')),
  http.get('/api/v1/tenants/acme/audit-log', () =>
    ok(
      listPage([
        {
          id: AUDIT_ID_1,
          occurredAt: '2026-09-25T09:00:00.000Z',
          action: 'tenant.created',
          access: 'member',
          actor: { id: USER_ID, name: 'A B', email: 'a.b@example.com' },
          target: { type: 'tenant', id: TENANT_ID },
          metadata: { name: 'Acme Corp', slug: 'acme' },
        },
      ]),
      'Audit log retrieved.'
    )
  ),
  // Registered before `/platform/emails/:emailId`, or `health` would match as an id.
  http.get('/api/v1/platform/emails/health', ({ request }) =>
    ok(
      emailHealth(new URL(request.url).searchParams.get('range') ?? '7d'),
      'Email health retrieved.'
    )
  ),
  http.get('/api/v1/platform/emails/:emailId/preview', () => {
    if (previewParam === 'unavailable') {
      return Response.json(
        {
          success: false,
          message: 'The template is no longer part of the app.',
          code: 'template_unavailable',
          statusCode: 409,
          requestId: 'harness',
        },
        { status: 409 }
      )
    }
    return ok({ ...EMAIL_PREVIEW, partial: previewParam === 'partial' }, 'Email preview rendered.')
  }),
  http.get('/api/v1/platform/emails/:emailId', ({ params }) =>
    ok(emailDetail(String(params.emailId)), 'Email retrieved.')
  ),
  http.get('/api/v1/platform/email-suppressions', ({ request }) => {
    const params = new URL(request.url).searchParams
    const states = (params.get('state') ?? 'active').split(',')
    const suppressions = SUPPRESSION_ROWS.filter((row) =>
      states.includes(row.liftedAt === null ? 'active' : 'lifted')
    )
    return ok(
      serveList(suppressions, params, { searchIn: (row) => [row.address] }),
      'Suppressions retrieved.'
    )
  }),
  // Filtered the way the API filters: a user's card sees their emails, a tenant's tab its own.
  http.get('/api/v1/platform/emails', ({ request }) => {
    const params = new URL(request.url).searchParams
    const userId = params.get('user')
    const tenantId = params.get('tenant')
    const emails =
      emailsParam === 'none'
        ? []
        : EMAIL_ROWS.filter(
            (row) =>
              (userId === null || row.user?.id === userId) &&
              (tenantId === null || row.tenant?.id === tenantId)
          )
    return ok(
      serveList(emails, params, {
        searchIn: (row) => [row.recipient, row.templateKey],
        filters: {
          status: (row, values) => values.includes(row.status),
          template: (row, values) => values.includes(row.templateKey),
        },
      }),
      'Emails retrieved.'
    )
  }),
  // Suspending a tenant, inviting an owner and deactivating a user answer with the step-up refusal, so the fixtures can open the stacked step-up dialog; `?stepup=once` lets through a suspend whose bearer confirmed in the last 10 minutes.
  http.post('/api/v1/platform/tenants/:tenantId/suspend', ({ request, params: { tenantId } }) => {
    if (!stepUpOnce || !hasRecentAuth(request)) return reauthRequired()
    suspension.suspended = true
    return ok(tenantDetail(String(tenantId)), 'Tenant suspended.')
  }),
  http.post('/api/v1/platform/tenants/:tenantId/owner-invitation', reauthRequired),
  http.post('/api/v1/platform/users/:userId/deactivate', reauthRequired),
  http.post('/api/v1/platform/users/:userId/sign-in-link', () =>
    ok({ emailSent: true }, 'Sign-in link sent.')
  ),
  http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.')),
  // /profile's Security section. Unmocked, it would reach the real API, 401, and sign the harness user out.
  http.get('/api/v1/auth/providers', () =>
    ok(
      {
        providers: [
          { provider: 'email', linkedAt: '2026-01-01T00:00:00.000Z' },
          { provider: 'google', linkedAt: '2026-01-02T00:00:00.000Z' },
        ],
      },
      'Auth providers retrieved.'
    )
  ),
  // "Confirm it's you": a link mailed, the API mailing again in a minute, and the mailed link confirmed in any tab.
  http.post('/api/v1/auth/step-up/link/request', async ({ request }) => {
    // express's strict body schema: `{ app: 'apex' }` and nothing else, or 400.
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
  http.post('/api/v1/auth/step-up/link/verify', () => {
    if (confirmMode === 'dead') return fail(LINK_INVALID, 400, 'LINK_INVALID')
    const now = Math.floor(Date.now() / 1000)
    localStorage.setItem(STEPPED_UP_AT_KEY, String(now))
    return ok({ accessToken: harnessToken(now) }, 'Identity confirmed.')
  }),
  // Sign-in by emailed link: the request always answers 202, and the verify as `?link=` says.
  http.post('/api/v1/auth/link/request', () =>
    ok(null, 'Check your inbox for a sign-in link.', 202)
  ),
  http.post('/api/v1/auth/link/verify', () => {
    if (linkMode === 'dead') return fail(LINK_INVALID, 400, 'LINK_INVALID')
    if (linkMode === 'readonly') return readOnly()
    hasRefreshCookie = true
    return ok(
      { user: testUser, accessToken: harnessToken(), isNewUser: false, redirect: null },
      'Signed in.'
    )
  }),
  // A staff invitation, as `?invite=` picks: the preview, the signed-out verify's 202 and the signed-in accept.
  http.post('/api/v1/invitations/preview', () =>
    inviteMode === 'dead' || inviteMode === 'joined'
      ? fail(INVITATION_INVALID, 404, 'invitation_invalid')
      : ok(
          inviteMode === 'ok' ? { ...STAFF_INVITATION, email: testUser.email } : STAFF_INVITATION,
          'Invitation retrieved.'
        )
  ),
  http.post('/api/v1/invitations/verify', () =>
    inviteMode === 'dead' || inviteMode === 'joined'
      ? fail(INVITATION_INVALID, 404, 'invitation_invalid')
      : ok(
          {
            confirmationSent: true,
            email: inviteMode === 'ok' ? testUser.email : STAFF_INVITATION.email,
          },
          'Check your inbox to finish joining.',
          202
        )
  ),
  http.post('/api/v1/invitations/accept', () =>
    inviteMode === 'dead'
      ? fail(INVITATION_INVALID, 404, 'invitation_invalid')
      : ok(
          {
            tenant: STAFF_INVITATION.tenant,
            role: STAFF_INVITATION.role,
            alreadyMember: inviteMode === 'joined',
          },
          'Invitation accepted.'
        )
  ),
  // A mailed invitation confirmation, as `?inviteconfirm=` picks: the harness user is signed in and joined to the platform tenant.
  http.post('/api/v1/invitations/confirm', () => {
    if (inviteConfirmMode === 'dead') {
      return fail(INVITATION_CONFIRM_INVALID, 404, 'invitation_invalid')
    }
    if (inviteConfirmMode === 'readonly') return readOnly()
    hasRefreshCookie = true
    return ok(
      {
        user: testUser,
        accessToken: harnessToken(),
        isNewUser: false,
        tenant: STAFF_INVITATION.tenant,
        role: STAFF_INVITATION.role,
      },
      'Invitation accepted.'
    )
  }),
  http.post('/api/v1/auth/sessions/revoke-others', () =>
    ok({ revoked: 2 }, 'Other sessions signed out.')
  ),
  // A refresh is answered here so it never falls through to a real backend; its token carries the session's latest confirmation.
  http.post('/api/v1/auth/refresh', () =>
    hasRefreshCookie
      ? ok({ accessToken: harnessToken() }, 'Session refreshed.')
      : fail("You're signed out. Sign in to continue.", 401)
  )
)

// The page's query client, so a test can wait on a query's status instead of a sleep.
;(window as unknown as { __queryClient: typeof queryClient }).__queryClient = queryClient

await worker.start({ onUnhandledRequest: 'bypass', quiet: true })

// The real store state a signed-in (or, for `?session=none`, signed-out) user has. `isBootstrapped` skips the session refresh that the router would otherwise run before rendering.
useAuthStore.setState(
  signedOut
    ? { accessToken: null, user: null, isAuthenticated: false, isBootstrapped: true }
    : { accessToken: harnessToken(), user: testUser, isAuthenticated: true, isBootstrapped: true }
)

// `?profile=stale` seeds the profile cache as long out of date, so the page's `GET /profile` fires on mount and `?fail=/api/v1/profile` can fail it with the stored user on screen.
if (new URLSearchParams(location.search).get('profile') === 'stale') {
  queryClient.setQueryData(profileKeys.detail, testUser, { updatedAt: 0 })
}

/**
 * Which in-app route to mount, from `?path=`; the default is the Overview.
 * The handlers above answer every page the fixtures and the contrast suite
 * reach, so each renders without a backend.
 *
 * Only a same-origin absolute path is accepted (one slash, then neither `/` nor
 * `\`): a `?path=` that reached `replaceState` unchecked would be an
 * open-redirect shape.
 */
const requestedPath = new URLSearchParams(location.search).get('path')
const targetPath = requestedPath && /^\/[^/\\]/.test(requestedPath) ? requestedPath : '/overview'

/**
 * Sets the location with `replaceState` before the router mounts, since the
 * router reads it on mount. `router.navigate` would be a real navigation, which
 * the dev server answers with the root `index.html` and `main.tsx`, so the
 * harness would never run. A path may carry its own query
 * (`?path=/deliverability?range=30d`); the harness's parameters follow it after
 * an `&`, so the page reads that query as written.
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
