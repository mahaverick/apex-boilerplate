import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { track } from '@/observability/telemetry'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** While `on`, the page's navigate does nothing, so the card stays on screen to be asserted. */
const holdNavigation = vi.hoisted(() => ({ on: false }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate()
      return holdNavigation.on ? () => Promise.resolve() : navigate
    },
  }
})

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
}))

/** Mounts the real route tree at `path`, under StrictMode as dev runs it, and returns the router. */
function renderAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...ROUTER_DEFAULTS,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </StrictMode>
  )
  return router as AnyRouter
}

/** The API just set the refresh cookie, so the root's bootstrap restores a staff session. */
function arriveSignedIn() {
  server.use(
    http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Token refreshed.')),
    http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.'))
  )
}

/** Google refused, or the cookie never arrived: the bootstrap settles signed out. */
function arriveSignedOut() {
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

beforeEach(() => {
  holdNavigation.on = false
  resetSessionForTests()
  queryClient.clear()
  vi.mocked(track).mockReset()
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
})

describe('/auth/callback', () => {
  it('shows the signing-in card: one h1 and a status region in the main landmark', async () => {
    holdNavigation.on = true
    arriveSignedIn()
    renderAt('/auth/callback')

    expect(await screen.findByRole('heading', { name: 'Signing in', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Completing sign-in…')
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('status'))
  })

  it('lands a signed-in user on the safe redirect, else Overview', async () => {
    arriveSignedIn()
    const router = renderAt(
      `/auth/callback?redirect=${encodeURIComponent('/tenants?state=active')}`
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tenants')
    })
    expect(router.state.location.searchStr).toContain('state=active')
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it('lands a signed-in user with no redirect on Overview, replacing the callback', async () => {
    arriveSignedIn()
    const router = renderAt('/auth/callback')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it('ignores new=1: Google never creates an Apex account, and Apex has no welcome page', async () => {
    arriveSignedIn()
    const router = renderAt('/auth/callback?new=1')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
  })

  it.each(['//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)'])(
    'lands an unsafe callback redirect on Overview (%s)',
    async (unsafe) => {
      arriveSignedIn()
      const router = renderAt(`/auth/callback?redirect=${encodeURIComponent(unsafe)}`)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/overview')
      })
      expect(router.state.location.href).not.toContain('evil')
    }
  )

  it.each(['/auth/link?token=abc', '/auth/confirm?token=abc', '/AUTH/Link/'])(
    'does not land on a token page (%s); the user goes to Overview',
    async (tokenPage) => {
      arriveSignedIn()
      const router = renderAt(`/auth/callback?redirect=${encodeURIComponent(tokenPage)}`)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/overview')
      })
      expect(router.state.location.href).not.toContain('token')
    }
  )

  it('tracks sign_in_completed with method google, once under StrictMode', async () => {
    arriveSignedIn()
    const router = renderAt('/auth/callback')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'sign_in_completed')).toEqual([
      ['sign_in_completed', { method: 'google' }],
    ])
  })

  it('sends a signed-out callback to /login with google_auth_failed', async () => {
    arriveSignedOut()
    const router = renderAt(`/auth/callback?redirect=${encodeURIComponent('/tenants')}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(router.state.location.search).toEqual({ error: 'google_auth_failed' })
    expect(track).not.toHaveBeenCalledWith('sign_in_completed', expect.anything())
  })
})
