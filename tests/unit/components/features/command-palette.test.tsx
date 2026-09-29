import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommandPalette } from '@/components/features/command-palette'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'
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

function renderPalette() {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <CommandPalette />
        <Outlet />
      </>
    ),
  })
  const pages = ['/overview', '/tenants', '/activity'].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => <h1>{path}</h1> })
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(pages),
    history: createMemoryHistory({ initialEntries: ['/overview'] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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

  it('finds a tenant through the API and opens the tenants page filtered to it', async () => {
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        return ok({ tenants: q === 'acme' ? [ACME] : [], nextCursor: null }, 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')

    await user.keyboard('acme')
    await user.click(await screen.findByRole('option', { name: /Acme Corp/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
    expect(router.state.location.search).toEqual({ q: 'Acme Corp' })
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
          return ok({ tenants: [], nextCursor: null }, 'Tenants retrieved.')
        }
        return ok({ tenants: [ACME], nextCursor: null }, 'Tenants retrieved.')
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

  it('says the tenant search failed, and keeps the page items usable', async () => {
    server.use(http.get('/api/v1/platform/tenants', () => fail('Boom', 500)))
    const user = userEvent.setup()
    renderPalette()
    await screen.findByRole('heading', { name: '/overview' })
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('o')

    expect(await screen.findByText('Tenants could not be searched.')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Overview' })).toBeInTheDocument()
  })
})
