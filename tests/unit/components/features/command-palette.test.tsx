import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommandPalette } from '@/components/features/command-palette'
import { SEARCH_DEBOUNCE_MS } from '@/queries/platform.queries'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const ACME = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme Corp',
  slug: 'acme',
  lifecycleState: 'active',
  memberCount: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const CLEO = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'cleo@example.com',
  firstName: 'Cleo',
  lastName: 'Doe',
  active: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lastLoggedInAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  platformRole: null,
  membershipCount: 1,
}

function renderPalette() {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <CommandPalette />
        <Outlet />
      </>
    ),
  })
  const pages = [
    '/overview',
    '/tenants',
    '/activity',
    '/users',
    '/staff',
    '/users/$userId',
    '/tenants/$tenantId',
  ].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => <h1>{path}</h1> })
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(pages),
    history: createMemoryHistory({ initialEntries: ['/overview'] }),
  })
  const queryClient = new QueryClient({
    // The palette's query sets its own `retry`; a zero delay keeps the 500 case fast.
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { ...testUser, platformRole: 'viewer' }, isAuthenticated: true })
    useCommandPaletteStore.setState({ open: false })
    // Every search asks for both; a test's own `server.use` still wins.
    server.use(
      http.get('/api/v1/platform/users', () =>
        ok({ users: [], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      ),
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: [], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      )
    )
  })

  afterEach(() => {
    useCommandPaletteStore.setState({ open: false })
  })

  it('opens on Ctrl+K and on Meta+K', async () => {
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  })

  it("lists only the viewer's pages, and Enter goes to the highlighted one", async () => {
    const user = userEvent.setup()
    const router = renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')

    await user.keyboard('ten')
    expect(await screen.findByRole('option', { name: 'Tenants' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Activity log' })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it('finds a tenant through the API and opens its page', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        return ok(
          { tenants: q === 'acme' ? [ACME] : [], nextCursor: null, prevCursor: null },
          'Tenants retrieved.'
        )
      })
    )
    const user = userEvent.setup()
    const router = renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')

    await user.keyboard('acme')
    await user.click(await screen.findByRole('option', { name: /Acme Corp/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/tenants/${ACME.id}`))
  })

  it('never acts on a previous term’s tenants', async () => {
    let release: (() => void) | undefined
    server.use(
      http.get('/api/v1/platform/tenants', async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        if (q === 'acmez') {
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return ok({ tenants: [], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
        }
        return ok({ tenants: [ACME], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('acme')
    await screen.findByRole('option', { name: /Acme Corp/ })

    try {
      await user.keyboard('z')
      // The new term's request is in flight: the window a stale list could take the Enter.
      await waitFor(() => expect(release).toBeDefined())
      expect(screen.queryByRole('option', { name: /Acme Corp/ })).not.toBeInTheDocument()
    } finally {
      release?.()
    }
  })

  it('finds a user by email, first 8 only, and Enter opens their page', async () => {
    let limit: string | null = null
    server.use(
      http.get('/api/v1/platform/users', ({ request }) => {
        const params = new URL(request.url).searchParams
        limit = params.get('limit')
        return ok(
          { users: params.get('q') === 'cleo' ? [CLEO] : [], nextCursor: null, prevCursor: null },
          'Users retrieved.'
        )
      })
    )
    const user = userEvent.setup()
    const router = renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')

    await user.keyboard('cleo')
    expect(await screen.findByRole('option', { name: /cleo@example\.com/ })).toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(router.state.location.pathname).toBe(`/users/${CLEO.id}`))
    expect(limit).toBe('8')
  })

  it('never acts on a previous term’s users', async () => {
    let release: (() => void) | undefined
    server.use(
      http.get('/api/v1/platform/users', async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        if (q === 'cleox') {
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return ok({ users: [], nextCursor: null, prevCursor: null }, 'Users retrieved.')
        }
        return ok({ users: [CLEO], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('cleo')
    await screen.findByRole('option', { name: /cleo@example\.com/ })

    await user.keyboard('x')
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /cleo@example\.com/ })).not.toBeInTheDocument()
    )
    await user.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/overview')
    release?.()
  })

  it('says the tenant search failed, and keeps the page items usable', async () => {
    server.use(http.get('/api/v1/platform/tenants', () => fail('Boom', 500)))
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('o')

    expect(await screen.findByText('Some results could not be loaded.')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Overview' })).toBeInTheDocument()
  })

  it('says the user search failed, and keeps the tenants it found', async () => {
    server.use(
      http.get('/api/v1/platform/users', () => fail('Boom', 500)),
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: [ACME], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      )
    )
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('acme')

    expect(await screen.findByText('Some results could not be loaded.')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Acme Corp/ })).toBeInTheDocument()
  })

  it('opens empty after the shortcut closed it mid-search', async () => {
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('ov')
    expect(screen.getByRole('combobox')).toHaveValue('ov')

    await user.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.keyboard('{Control>}k{/Control}')

    expect(await screen.findByRole('combobox')).toHaveValue('')
  })

  it.each([
    ['a repeat', { repeat: true }],
    ['an IME composition', { isComposing: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['no modifier', { ctrlKey: false }],
    ['another key', { code: 'KeyJ', key: 'j' }],
  ])('ignores the shortcut with %s', async (_label, overrides) => {
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true, ...overrides })
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it('ignores a shortcut something else already handled', async () => {
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    const claim = (event: Event) => event.preventDefault()
    window.addEventListener('keydown', claim, { capture: true })
    try {
      fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true })
    } finally {
      window.removeEventListener('keydown', claim, { capture: true })
    }
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it('opens on the physical K key on a non-Latin layout', async () => {
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    fireEvent.keyDown(window, { key: 'л', code: 'KeyK', metaKey: true })
    expect(useCommandPaletteStore.getState().open).toBe(true)
  })

  it('never asks for tenants or users when the user is not staff', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/tenants', () => {
        calls += 1
        return ok({ tenants: [ACME], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      }),
      http.get('/api/v1/platform/users', () => {
        calls += 1
        return ok({ users: [CLEO], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      })
    )
    useAuthStore.setState({ user: { ...testUser, platformRole: null } })
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('acme')

    await settle(
      SEARCH_DEBOUNCE_MS * 2,
      'absence has no event: a request would follow the debounce'
    )
    expect(calls).toBe(0)
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
  })

  it('says nothing about tenants when the role is refused', async () => {
    server.use(http.get('/api/v1/platform/tenants', () => fail('Not found', 404)))
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('o')

    expect(await screen.findByText('Searching…')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Searching…')).not.toBeInTheDocument())
    expect(screen.queryByText('Some results could not be loaded.')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Overview' })).toBeInTheDocument()
  })

  it('does not show the previous term’s error while the next term waits', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        return q === 'o'
          ? fail('Boom', 500)
          : ok({ tenants: [], nextCursor: null, prevCursor: null })
      })
    )
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('o')
    await screen.findByText('Some results could not be loaded.')

    await user.keyboard('v')
    expect(screen.queryByText('Some results could not be loaded.')).not.toBeInTheDocument()
    expect(screen.getByText('Searching…')).toBeInTheDocument()
  })

  it('does not say "No results." while tenants are still being searched', async () => {
    let release: (() => void) | undefined
    server.use(
      http.get('/api/v1/platform/tenants', async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return ok({ tenants: [], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    try {
      await user.keyboard('zzz')
      await waitFor(() => expect(release).toBeDefined())
      expect(screen.getByText('Searching…')).toBeInTheDocument()
      expect(screen.queryByText('No results.')).not.toBeInTheDocument()
    } finally {
      release?.()
    }
    expect(await screen.findByText('No results.')).toBeInTheDocument()
  })

  it('ignores Enter typed before the new term is searched', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        ok({ tenants: [ACME], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
      )
    )
    const user = userEvent.setup()
    const router = renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('acme')
    await screen.findByRole('option', { name: /Acme Corp/ })

    await user.keyboard('z{Enter}')
    // The new term's results arrive after the Enter: had it acted, it would already have navigated.
    expect(await screen.findByRole('option', { name: /Acme Corp/ })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/overview')
    expect(useCommandPaletteStore.getState().open).toBe(true)
  })
})
