import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import {
  AUDIT_ID_1,
  AUDIT_ID_2,
  AUDIT_ID_4,
  AUDIT_ID_5,
  PLATFORM_AUDIT_ID,
  PLATFORM_TENANT_ID,
  STAFF_USER_ID,
  TENANT_ID,
  TENANT_ID_2,
  USER_ID_2,
} from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformAuditEntry, PlatformTenantRow, PlatformUserRow } from '@/types/api.types'

const STAFF_VISIT: PlatformAuditEntry = {
  id: PLATFORM_AUDIT_ID,
  occurredAt: '2026-09-25T10:00:00.000Z',
  action: 'tenant.accessed_by_platform',
  access: 'platform',
  actor: { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' },
  target: { type: 'tenant', id: TENANT_ID },
  metadata: { platformRole: 'viewer' },
  tenant: { id: TENANT_ID, name: 'Acme Corp', slug: 'acme' },
}

/** Signs in as `testUser` with `platformRole`; `null` is a signed-in user who is not staff. */
function signInAs(platformRole: MembershipRole | null) {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: { ...testUser, platformRole },
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/**
 * Serves the platform audit log through `respond`, and an empty users directory.
 * @returns Every audit-log URL requested, in order.
 */
function mockLog(respond: (url: URL) => Response) {
  const seen: URL[] = []
  server.use(
    http.get('/api/v1/platform/audit-log', ({ request }) => {
      const url = new URL(request.url)
      seen.push(url)
      return respond(url)
    }),
    http.get('/api/v1/platform/users', () => ok(listPage([]), 'Users retrieved.')),
    http.get('/api/v1/platform/tenants', () => ok(listPage([]), 'Tenants retrieved.'))
  )
  return seen
}

const ACME_ROW: PlatformTenantRow = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  lifecycleState: 'active',
  memberCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
}
const GLOBEX_ROW: PlatformTenantRow = {
  ...ACME_ROW,
  id: TENANT_ID_2,
  name: 'Globex',
  slug: 'globex',
}

/** The staff member, as the users directory lists them. */
const SAM: PlatformUserRow = {
  id: STAFF_USER_ID,
  email: 'sam@platform.test',
  firstName: 'Sam',
  lastName: 'Staff',
  active: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lastLoggedInAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  platformRole: 'admin',
  membershipCount: 0,
}
const STAFF = [SAM]

/** Ada, a customer user the directory finds only by search, with no name on her account. */
const ADA: PlatformUserRow = {
  ...SAM,
  id: USER_ID_2,
  email: 'ada@example.com',
  firstName: null,
  lastName: null,
  platformRole: null,
  membershipCount: 1,
}

/** Answers the users directory, recording each request's query string in order. */
function mockUserSearch(respond: (search: string | null) => Response | Promise<Response>) {
  const queries: string[] = []
  server.use(
    http.get('/api/v1/platform/users', ({ request }) => {
      const url = new URL(request.url)
      queries.push(url.search)
      return respond(url.searchParams.get('search'))
    })
  )
  return queries
}

/** Answers the platform tenant search, recording each request's `search` in order (null when absent). */
function mockTenantSearch(respond: (search: string | null) => Response | Promise<Response>) {
  const terms: (string | null)[] = []
  server.use(
    http.get('/api/v1/platform/tenants', ({ request }) => {
      const search = new URL(request.url).searchParams.get('search')
      terms.push(search)
      return respond(search)
    })
  )
  return terms
}

/** Serves the audit log through `respond`, as a one-page answer. */
function page(entries: PlatformAuditEntry[], nextCursor?: string) {
  return ok(
    listPage(entries, nextCursor === undefined ? {} : { hasNext: true, nextCursor }),
    'Audit log retrieved.'
  )
}

/** Mounts the real route tree at `path`; returns the router. */
function renderPlatformActivity(path = '/activity') {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...ROUTER_DEFAULTS,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

/**
 * Opens a facet's popover on the page's one table.
 * @param user - The user-event instance.
 * @param name - The facet's label, such as "tenant".
 * @returns The open popover.
 */
async function openFacet(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Filter by ${name}, Activity` }))
  return screen.findByRole('dialog', { name: `Filter by ${name}, Activity` })
}

/** The table row holding `text`. */
function rowFor(text: RegExp | string) {
  const row = screen.getByText(text).closest('tr')
  if (!row) throw new Error(`no row for ${String(text)}`)
  return within(row)
}

describe('platform activity page', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists activity across tenants, each row naming its tenant', async () => {
    signInAs('admin')
    mockLog(() => page([STAFF_VISIT]))
    renderPlatformActivity()

    expect(await screen.findByRole('heading', { name: 'Activity', level: 1 })).toBeVisible()
    await screen.findByText(/^opened this tenant as platform staff \(Viewer\)/)
    const row = rowFor(/^opened this tenant as platform staff \(Viewer\)/)
    expect(screen.getByRole('table', { name: 'Activity' })).toBeVisible()
    expect(row.getByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
      'href',
      `/tenants/${TENANT_ID}`
    )
    expect(row.getByRole('link', { name: 'View tenant' })).toHaveAttribute(
      'href',
      `/tenants/${TENANT_ID}`
    )
    expect(row.getByText('Staff')).toBeInTheDocument()
  })

  // A relative time read once at render froze at "just now" while the page stayed open.
  it('moves its relative times on as the clock ticks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(Date.parse(STAFF_VISIT.occurredAt))
    signInAs('admin')
    mockLog(() => page([STAFF_VISIT]))
    renderPlatformActivity()

    expect(await screen.findByText('just now')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(screen.getByText('2 minutes ago')).toBeInTheDocument()
  })

  it('sends someone who is not staff to /no-access and never asks the API', async () => {
    signInAs(null)
    const seen = mockLog(() => page([]))
    const router = renderPlatformActivity()

    // The guard redirects before the page mounts, so reaching the no-access heading means any /activity request would already have gone out.
    expect(
      await screen.findByRole('heading', { name: 'This account has no platform access', level: 1 })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/no-access')
    expect(seen).toHaveLength(0)
  })

  // Matches the API's 404: the page must not tell a non-admin it exists.
  it.each([
    ['a staff viewer', 'viewer'],
    ['a staff editor', 'editor'],
  ] as const)('shows %s a not-found panel and never asks the API', async (_who, role) => {
    signInAs(role)
    const seen = mockLog(() => page([]))
    renderPlatformActivity()

    expect(await screen.findByRole('heading', { name: 'Page not available' })).toBeInTheDocument()
    expect(seen).toHaveLength(0)
  })

  // Demoted after the profile loaded: the API's 404 gets the role-denied state, under the page's own h1.
  it('turns a 404 from the API into the role-denied state', async () => {
    signInAs('admin')
    mockLog(() => fail('Not found', 404))
    renderPlatformActivity()

    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Activity', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Page not available' })).not.toBeInTheDocument()
    // A platform 404 is a role verdict, not a session verdict: the user stays signed in.
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('shows a 500 as a load failure with a retry, not as the role-denied state', async () => {
    signInAs('admin')
    let calls = 0
    mockLog(() => {
      calls += 1
      return calls <= 2 ? fail('Something went wrong', 500) : page([STAFF_VISIT])
    })
    const user = userEvent.setup()
    renderPlatformActivity()

    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/Your role can’t see this any more/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    await user.click(retry)
    expect(
      await screen.findByText(/^opened this tenant as platform staff \(Viewer\)/)
    ).toBeInTheDocument()
  })

  it('narrows to what staff did with the Access facet, through ?access=platform', async () => {
    signInAs('owner')
    const seen = mockLog(() => page([STAFF_VISIT]))
    const user = userEvent.setup()
    const router = renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    const popup = await openFacet(user, 'access')
    await user.click(within(popup).getByRole('checkbox', { name: 'Staff' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ access: 'platform' }))
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('access')).toBe('platform'))
  })

  it('keeps every filter in the URL, so Back undoes one', async () => {
    signInAs('owner')
    mockLog(() => page([STAFF_VISIT]))
    const user = userEvent.setup()
    const router = renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    const action = await openFacet(user, 'action')
    await user.click(within(action).getByRole('checkbox', { name: 'Staff visit' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ action: 'tenant.accessed_by_platform' })
    )
    await user.keyboard('{Escape}')
    const access = await openFacet(user, 'access')
    await user.click(within(access).getByRole('checkbox', { name: 'Staff' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        action: 'tenant.accessed_by_platform',
        access: 'platform',
      })
    )

    act(() => {
      router.history.back()
    })

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ action: 'tenant.accessed_by_platform' })
    )
  })

  it('searches tenants from the tenant facet, and filters to the one picked', async () => {
    signInAs('admin')
    const seen = mockLog(() => page([STAFF_VISIT]))
    const terms = mockTenantSearch((search) =>
      ok(listPage(search === 'glob' ? [GLOBEX_ROW] : [ACME_ROW, GLOBEX_ROW]), 'Tenants retrieved.')
    )
    const user = userEvent.setup()
    const router = renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    const popup = await openFacet(user, 'tenant')
    await user.type(within(popup).getByLabelText('Search tenant'), 'glob')
    await waitFor(() => expect(terms).toContain('glob'))
    await user.click(await within(popup).findByRole('checkbox', { name: 'Globex' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ tenant: TENANT_ID_2 }))
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('tenant')).toBe(TENANT_ID_2))
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Tenant: Globex' })
    ).toBeInTheDocument()
  })

  it('lists users in the Actor facet and filters by one, through ?actor=', async () => {
    signInAs('admin')
    const seen = mockLog(() => page([STAFF_VISIT]))
    mockUserSearch(() => ok(listPage(STAFF), 'Users retrieved.'))
    const user = userEvent.setup()
    const router = renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    const popup = await openFacet(user, 'actor')
    await user.click(await within(popup).findByRole('checkbox', { name: 'Sam Staff' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ actor: STAFF_USER_ID }))
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('actor')).toBe(STAFF_USER_ID))
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Actor: Sam Staff' })
    ).toBeInTheDocument()
  })

  it('says the users could not be loaded, in the actor facet, and retries them', async () => {
    signInAs('admin')
    mockLog(() => page([STAFF_VISIT]))
    let attempts = 0
    mockUserSearch(() => {
      attempts += 1
      return attempts <= 2
        ? fail('Something went wrong', 500)
        : ok(listPage(STAFF), 'Users retrieved.')
    })
    const user = userEvent.setup()
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    const popup = await openFacet(user, 'actor')
    expect(await within(popup).findByText('Actor could not be loaded.')).toBeInTheDocument()
    await user.click(within(popup).getByRole('button', { name: 'Try again' }))
    expect(await within(popup).findByRole('checkbox', { name: 'Sam Staff' })).toBeInTheDocument()
  })

  it('searches actors on the server, twenty at a time', async () => {
    signInAs('admin')
    mockLog(() => page([STAFF_VISIT]))
    const queries = mockUserSearch((search) =>
      ok(listPage(search === 'ada' ? [ADA] : STAFF), 'Users retrieved.')
    )
    const user = userEvent.setup()
    const router = renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    const popup = await openFacet(user, 'actor')
    await within(popup).findByRole('checkbox', { name: 'Sam Staff' })
    await user.type(within(popup).getByLabelText('Search actor'), 'ada')
    await user.click(await within(popup).findByRole('checkbox', { name: 'ada@example.com' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ actor: USER_ID_2 }))
    // The debounce sends the finished term, once; no keystroke before it reaches the API.
    expect(queries.filter((query) => query.includes('search='))).toEqual(['?search=ada&limit=20'])
    expect(queries[0]).toBe('?limit=20')
  })

  it('names a selected actor who is not in the results', async () => {
    signInAs('admin')
    const seen = mockLog(() => page([STAFF_VISIT]))
    mockUserSearch(() => ok(listPage(STAFF), 'Users retrieved.'))
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () =>
        ok(
          { ...ADA, authProviders: [], memberships: [], pendingInvitations: [] },
          'User retrieved.'
        )
      )
    )
    renderPlatformActivity(`/activity?actor=${USER_ID_2}`)

    expect(
      await screen.findByRole('button', { name: 'Remove filter: Actor: ada@example.com' })
    ).toBeInTheDocument()
    expect(seen.at(-1)?.searchParams.get('actor')).toBe(USER_ID_2)
  })

  it('says the tenant list could not be loaded, in the tenant facet', async () => {
    signInAs('admin')
    mockLog(() => page([STAFF_VISIT]))
    mockTenantSearch(() => fail('Something went wrong', 500))
    const user = userEvent.setup()
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    const popup = await openFacet(user, 'tenant')
    expect(await within(popup).findByText('Tenant could not be loaded.')).toBeInTheDocument()
  })

  it('asks the tenant picker for no total', async () => {
    signInAs('admin')
    mockLog(() => page([STAFF_VISIT]))
    const totals: (string | null)[] = []
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) => {
        totals.push(new URL(request.url).searchParams.get('total'))
        return ok(listPage([ACME_ROW]), 'Tenants retrieved.')
      })
    )
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)
    await waitFor(() => expect(totals.length).toBeGreaterThan(0))
    expect(totals.every((total) => total === null)).toBe(true)
  })

  it('pages with Next page, keeping the cursor in the URL', async () => {
    signInAs('admin')
    mockLog((url) =>
      url.searchParams.get('cursor') === 'c2'
        ? page([{ ...STAFF_VISIT, id: AUDIT_ID_1, action: 'tenant.suspended' }])
        : page([STAFF_VISIT], 'c2')
    )
    const user = userEvent.setup()
    const router = renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c2' }))
    expect(await screen.findByText(/suspended the tenant/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument()
  })

  it('offers no retired action, sends one named in the URL, and words its entries', async () => {
    signInAs('admin')
    const seen = mockLog(() =>
      page([{ ...STAFF_VISIT, action: 'tenant.errors_viewed', metadata: {} }])
    )
    const user = userEvent.setup()
    renderPlatformActivity('/activity?action=tenant.errors_viewed')

    expect(await screen.findByText('performed tenant errors viewed')).toBeInTheDocument()
    expect(seen.at(-1)?.searchParams.get('action')).toBe('tenant.errors_viewed')
    await user.click(screen.getByRole('button', { name: /^Filter by action, Activity/ }))
    const popup = await screen.findByRole('dialog', { name: /^Filter by action, Activity/ })
    expect(within(popup).getByRole('checkbox', { name: 'Staff visit' })).toBeInTheDocument()
    expect(
      within(popup).queryByRole('checkbox', { name: /errors viewed/i })
    ).not.toBeInTheDocument()
  })

  /** A suspension carrying a staff-typed reason, which can name a person. */
  const REASONED = {
    ...STAFF_VISIT,
    action: 'tenant.suspended',
    metadata: { reason: 'Cleo D asked' },
  }

  it('masks the sentence, which carries staff-typed reasons, in the table', async () => {
    signInAs('admin')
    mockLog(() => page([REASONED]))
    renderPlatformActivity()
    const sentence = await screen.findByText(/suspended the tenant: “Cleo D asked”/)
    expect(sentence).toHaveClass('ph-sensitive', 'ph-mask')
  })

  it('masks the sentence in the phone cards too', async () => {
    const realWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    try {
      signInAs('admin')
      mockLog(() => page([REASONED]))
      renderPlatformActivity()
      const sentence = await screen.findByText(/suspended the tenant: “Cleo D asked”/)
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(sentence).toHaveClass('ph-sensitive', 'ph-mask')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: realWidth })
    }
  })

  it('names a retired action in words on its chip, as its rows do', async () => {
    signInAs('admin')
    mockLog(() => page([STAFF_VISIT]))
    renderPlatformActivity('/activity?action=tenant.errors_viewed')
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Action: tenant errors viewed' })
    ).toBeInTheDocument()
  })

  it('promises only what the API searches in the search box', async () => {
    signInAs('admin')
    mockLog(() => page([STAFF_VISIT]))
    renderPlatformActivity()
    expect(await screen.findByPlaceholderText('Search by email or action')).toBeInTheDocument()
  })

  it('labels every target kind, and words an unknown one rather than leaving it blank', async () => {
    signInAs('admin')
    /** An entry of `action` acting on a record of kind `type`. */
    const entry = (id: string, action: string, type: string): PlatformAuditEntry => ({
      ...STAFF_VISIT,
      id,
      action,
      metadata: {},
      target: { type, id: TENANT_ID },
    })
    mockLog(() =>
      page([
        entry(AUDIT_ID_1, 'email.resent', 'email_suppression'),
        entry(AUDIT_ID_2, 'platform.maintenance_mode_changed', 'platform'),
        entry(PLATFORM_AUDIT_ID, 'email.thing', 'email_message'),
        entry(AUDIT_ID_4, 'billing.plan_changed', 'billing_plan'),
        {
          ...STAFF_VISIT,
          id: AUDIT_ID_5,
          action: 'odd.thing',
          target: { type: 'constructor', id: 'x' },
        },
      ])
    )
    renderPlatformActivity()
    await screen.findByText('performed odd thing')
    expect(rowFor(/performed odd thing/).getByText('Constructor')).toBeInTheDocument()
    expect(rowFor(/performed billing plan changed/).getByText('Billing plan')).toBeInTheDocument()
    expect(rowFor(/performed email thing/).getByText('Email')).toBeInTheDocument()
    expect(rowFor(/^resent an email/).getByText('Suppression')).toBeInTheDocument()
    expect(rowFor(/maintenance/).getByText('Platform')).toBeInTheDocument()
  })

  it('refetches the log when the page is opened again, since it is never fresh', async () => {
    signInAs('admin')
    const seen = mockLog(() => page([STAFF_VISIT]))
    const router = renderPlatformActivity()
    await screen.findByText(/opened this tenant/)
    const before = seen.length

    await act(() => router.navigate({ to: '/overview' }))
    await screen.findByRole('heading', { name: 'Overview', level: 1 })
    await act(() => router.navigate({ to: '/activity' }))
    await screen.findByText(/opened this tenant/)
    await waitFor(() => expect(seen.length).toBeGreaterThan(before))
  })

  it('says nothing matches, rather than nothing happened, under a filter', async () => {
    signInAs('admin')
    mockLog(() => page([]))
    renderPlatformActivity()
    expect(await screen.findByText('Nothing has happened yet.')).toBeInTheDocument()
    cleanup()
    renderPlatformActivity('/activity?access=member')
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
  })

  it('links an entry’s actor and its user target to their pages', async () => {
    signInAs('admin')
    mockLog(() =>
      page([
        {
          id: AUDIT_ID_1,
          occurredAt: '2026-09-25T09:00:00.000Z',
          action: 'user.deactivated',
          access: 'platform',
          actor: { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' },
          target: { type: 'user', id: USER_ID_2 },
          metadata: { reason: 'left the company' },
          tenant: { id: PLATFORM_TENANT_ID, name: 'Platform', slug: 'platform' },
        },
      ])
    )
    renderPlatformActivity()
    expect(await screen.findByRole('link', { name: 'Sam Staff' })).toHaveAttribute(
      'href',
      `/users/${STAFF_USER_ID}`
    )
    expect(screen.getByRole('link', { name: 'View user' })).toHaveAttribute(
      'href',
      `/users/${USER_ID_2}`
    )
  })
})
