import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { bootstrapSession, queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('session bootstrap', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  it('restores a session from the refresh cookie', async () => {
    await bootstrapSession()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.isBootstrapped).toBe(true)
  })

  it('settles as signed-out when there is no valid cookie', async () => {
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await bootstrapSession()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    // Bootstrapped must be true even on failure, or a guard waiting on it would hang instead of redirecting.
    expect(s.isBootstrapped).toBe(true)
  })

  it('runs the refresh only once across concurrent callers', async () => {
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return HttpResponseOk()
      })
    )
    await Promise.all([bootstrapSession(), bootstrapSession(), bootstrapSession()])
    expect(refreshCount).toBe(1)
  })

  it('listens for another tab signing out once the session is restored', async () => {
    await bootstrapSession()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    const assign = vi.fn()
    vi.stubGlobal('location', {
      ...window.location,
      href: `${window.location.origin}/overview`,
      pathname: '/overview',
      search: '',
      hash: '',
      assign,
    })
    const otherTab = new BroadcastChannel('auth')

    try {
      otherTab.postMessage({ type: 'logout' })
      await vi.waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
      expect(assign).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent('/overview')}`)
    } finally {
      otherTab.close()
      vi.unstubAllGlobals()
    }
  })
})

/** A 200 `/auth/refresh` answer carrying `fresh-token`, as a plain `Response`. */
function HttpResponseOk() {
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Token refreshed.',
      statusCode: 200,
      data: { accessToken: 'fresh-token' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * The guards themselves, driven through a real RouterProvider. The bootstrap tests above prove
 * `bootstrapSession()` settles correctly; these prove the guards wait for it, which is why the await
 * sits in __root's beforeLoad and not in a useEffect.
 *
 * Each refresh handler here is delayed: a guard that ran before the session settled would observe an
 * empty store, and the signed-in case below would leave the user on /login instead of moving them to
 * /overview.
 */
describe('route guards', () => {
  let snapshots: { isAuthenticated: boolean; isBootstrapped: boolean }[] = []
  let getState: typeof useAuthStore.getState

  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    // The last store read of a navigation is always a guard's, since bootstrapSession() runs first; asserting on it proves no guard saw a half-restored store.
    snapshots = []
    getState = useAuthStore.getState.bind(useAuthStore)
    vi.spyOn(useAuthStore, 'getState').mockImplementation(() => {
      const state = getState()
      snapshots.push({
        isAuthenticated: state.isAuthenticated,
        isBootstrapped: state.isBootstrapped,
      })
      return state
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Mounts the real route tree at `path`; returns the router. */
  function renderAt(path: string): AnyRouter {
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: [path] }),
    })
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    )
    return router as AnyRouter
  }

  /**
   * A valid refresh cookie for a user with this platform role, answered after
   * a delay so a guard that ran before the session settled would be caught.
   */
  function signedInAs(platformRole: 'viewer' | 'admin' | null) {
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await delay(20)
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      }),
      http.get('/api/v1/profile', () => ok({ ...testUser, platformRole }, 'Profile retrieved.'))
    )
  }

  /** The guard that ran last must have seen a settled store. */
  function expectGuardSawSettledStore() {
    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots.at(-1)?.isBootstrapped).toBe(true)
  }

  it('sends a signed-out visitor from /overview to /login, preserving where they were going', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await delay(20)
        return fail('Unauthorized', 401)
      })
    )
    const router = renderAt('/overview')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    // Asserted by value, not presence: nothing consumes this param until the login page, so this is the only thing pinning it. The guard reads the validated location, so Overview's defaulted `range` rides along.
    expect(router.state.location.search).toEqual({ redirect: '/overview?range=7d' })
    expectGuardSawSettledStore()
  })

  it('sends a signed-in visitor from /login to /overview', async () => {
    signedInAs('viewer')
    const router = renderAt('/login')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expectGuardSawSettledStore()
  })

  it('sends a signed-out visitor from / to /login', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await delay(20)
        return fail('Unauthorized', 401)
      })
    )
    const router = renderAt('/')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expectGuardSawSettledStore()
  })

  it('sends a signed-in user who is not staff to /no-access', async () => {
    signedInAs(null)
    const router = renderAt('/overview')
    await waitFor(() => expect(router.state.location.pathname).toBe('/no-access'))
    expectGuardSawSettledStore()
  })

  it('lets a staff viewer into /overview', async () => {
    signedInAs('viewer')
    const router = renderAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })
    expect(router.state.location.pathname).toBe('/overview')
  })

  it('sends staff away from /no-access to /overview', async () => {
    signedInAs('viewer')
    const router = renderAt('/no-access')
    await waitFor(() => expect(router.state.location.pathname).toBe('/overview'))
    expectGuardSawSettledStore()
  })

  it('sends a signed-out visitor from /no-access to /login', async () => {
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await delay(20)
        return fail('Unauthorized', 401)
      })
    )
    const router = renderAt('/no-access')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expectGuardSawSettledStore()
  })
})

/**
 * `/reset-password` and `/verify-email` are top-level file routes, outside `_auth` on purpose: under
 * `_auth` its guard would send an authenticated visitor to /overview, so a user already signed in on this
 * browser who clicked the link in their inbox would be bounced and the token never consumed. The paths
 * cannot move under `/auth/` either, because the backend builds these links as
 * `${WEB_URL}/reset-password?token=` and `${WEB_URL}/verify-email?token=` with no prefix. These tests
 * hold both halves in place: no guard, and the same URLs.
 */
describe('token routes outside the auth guard', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    // A valid cookie: this visitor is signed in, which is the case `_auth` would redirect.
    server.use(
      http.post('/api/v1/auth/refresh', async () => {
        await delay(20)
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      }),
      http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.'))
    )
  })

  /** Mounts the real route tree at `path`; returns the router. */
  function renderAt(path: string): AnyRouter {
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: [path] }),
    })
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    )
    return router as AnyRouter
  }

  it('lets a signed-in visitor open a reset link instead of bouncing them', async () => {
    const router = renderAt('/reset-password?token=reset-token')

    expect(await screen.findByText('Choose a new password')).toBeInTheDocument()
    // Without this the test would pass for a visitor who was never signed in.
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(router.state.location.pathname).toBe('/reset-password')
  })

  it('lets a signed-in visitor open a verification link instead of bouncing them', async () => {
    const router = renderAt('/verify-email?token=verify-token')

    expect(await screen.findByText('Verify your email')).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(router.state.location.pathname).toBe('/verify-email')
  })
})
