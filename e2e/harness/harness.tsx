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
 * `?role=none` signs them in with no platform role (see `platformRole`).
 */
import '@/lib/zod-jitless'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { http } from 'msw'
import { setupWorker } from 'msw/browser'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { queryClient, router } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import {
  AUDIT_ID_1,
  AUDIT_ID_2,
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  PLATFORM_TENANT_ID,
  STAFF_USER_ID,
  TENANT_ID,
  TENANT_ID_2,
  TENANT_ID_3,
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
 * `?role=none` is the one other value accepted: a signed-in user who is not
 * staff, so /no-access renders instead of redirecting to the overview.
 */
const platformRole =
  new URLSearchParams(location.search).get('role') === 'none' ? null : ('admin' as const)

const testUser = {
  id: USER_ID,
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole,
}

/**
 * The Overview's figures: the same seven days as `testStats` in
 * `tests/mocks/handlers.ts`, restated because that file's `@/tests` imports
 * do not resolve under Vite. One failed attempt, so both bar series draw.
 */
const STATS = {
  range: '7d' as const,
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
 * render frozen and nothing on its page is Acme's.
 */
function tenantDetail(tenantId: string) {
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
  http.get('/api/v1/platform/tenants/:tenantId', ({ params }) =>
    ok(tenantDetail(String(params.tenantId)), 'Tenant retrieved.')
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
        role: 'admin',
        access: 'platform',
      },
      'Tenant retrieved.'
    )
  ),
  http.get('/api/v1/tenants/acme/members', () =>
    ok(
      MEMBERS.map((member) => ({
        ...member,
        membership: { ...member.membership, tenantId: TENANT_ID },
      })),
      'Members retrieved.'
    )
  ),
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
  // Suspending a tenant and deactivating a user always ask for a recent sign-in, so the fixtures can open the stacked step-up dialog.
  http.post('/api/v1/platform/tenants/:tenantId/suspend', reauthRequired),
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
 * requests, the Staff page's three, the users list and a user's page, and a
 * tenant's page with its tabs, so those pages render without a backend.
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
 * it first is enough.
 */
history.replaceState(null, '', targetPath + location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
