/**
 * The e2e fixture harness. Not part of the shipped app — nothing in `src/`
 * imports it, and `index.html` is the only Vite entry that builds.
 *
 * Playwright's `fixtures` project needs the REAL shell, the real router and
 * the real CSS in a real browser, but not a real backend. This boots the
 * actual router with MSW answering the same fixtures `tests/unit/a11y.test.tsx`
 * uses, and the same signed-in store state.
 *
 * The harness user is a platform admin, so every staff page renders.
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
  USER_ID,
  USER_ID_2,
} from '../../tests/fixtures/ids'

/** The one tenant the activity rows and the tenant filter name. */
const ACME = { id: TENANT_ID, name: 'Acme Corp', slug: 'acme' }

/** The platform tenant's staff, for the activity page's actor filter. */
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

const testUser = {
  id: USER_ID,
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: 'admin' as const,
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

const worker = setupWorker(
  // The overview, the harness's default route: its KPI cards and both charts.
  http.get('/api/v1/platform/stats', ({ request }) =>
    ok(
      { ...STATS, range: new URL(request.url).searchParams.get('range') ?? STATS.range },
      'Platform stats retrieved.'
    )
  ),
  // The activity page: the platform log, its actor filter's staff list and its tenant filter's search.
  http.get('/api/v1/platform/audit-log', () =>
    ok(
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
  ),
  http.get('/api/v1/tenants/platform/members', () => ok(MEMBERS, 'Members retrieved.')),
  http.get('/api/v1/platform/tenants', () =>
    ok(
      {
        tenants: [
          {
            ...ACME,
            lifecycleState: 'active',
            memberCount: 2,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
      'Tenants retrieved.'
    )
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
 * /auth/providers and the activity page's three requests, so those pages
 * render without a backend.
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
