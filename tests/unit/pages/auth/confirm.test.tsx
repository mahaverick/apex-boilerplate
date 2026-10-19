import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pageTitle } from '@/constants/app'
import { resetSessionForTests } from '@/http/session'
import { STEP_UP_WAIT_LOCK } from '@/lib/step-up-presence'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { removeWebLocks, stubWebLocks } from '@/tests/mocks/web-locks'

const TOKEN = 't'.repeat(43)
const LINK_PATH = `/auth/confirm?token=${TOKEN}`
const VERIFY_URL = '/api/v1/auth/step-up/link/verify'

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

/** The session that asked for the link, already restored. */
function signIn() {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/** A browser with no session: the bootstrap already settled signed out. */
function signOut() {
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: true,
  })
}

/** Records every verify call's body and bearer, answering with `respond`. */
function serveVerify(respond: () => Response = () => ok({ accessToken: 'stepped-up' })) {
  const calls: { body: unknown; authorization: string | null }[] = []
  server.use(
    http.post(VERIFY_URL, async ({ request }) => {
      calls.push({
        body: await request.json(),
        authorization: request.headers.get('authorization'),
      })
      return respond()
    })
  )
  return calls
}

/** Channels standing in for the waiting tab; closed after each test. */
let otherTabs: BroadcastChannel[] = []

/**
 * Opens a channel standing in for the tab that waits on the confirmation.
 * @returns What that tab has heard.
 */
function openWaitingTab() {
  const tab = new BroadcastChannel('auth')
  const received: unknown[] = []
  tab.addEventListener('message', (event: MessageEvent<unknown>) => {
    received.push(event.data)
  })
  otherTabs.push(tab)
  return received
}

/** Lets an already-queued channel delivery or a stray request land before a negative check. */
async function letStragglersLand() {
  await settle(50, 'absence has no event: let a queued post or channel delivery arrive')
}

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  signIn()
})

afterEach(() => {
  for (const tab of otherTabs) tab.close()
  otherTabs = []
  removeWebLocks()
  vi.restoreAllMocks()
})

describe('/auth/confirm with an emailed link', () => {
  it('confirms, swaps the token in and broadcasts step_up_confirmed', async () => {
    const calls = serveVerify()
    const received = openWaitingTab()
    renderAt(LINK_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: 'Confirmed' })).toBeInTheDocument()
    expect(useAuthStore.getState().accessToken).toBe('stepped-up')
    expect(calls).toEqual([{ body: { token: TOKEN }, authorization: 'Bearer access-token' }])
    await vi.waitFor(() => expect(received).toEqual([{ type: 'step_up_confirmed' }]))
    await letStragglersLand()
    expect(received).toEqual([{ type: 'step_up_confirmed' }])
    expect(document.title).toBe(pageTitle('Confirm it’s you'))
  })

  it('posts the token exactly once under StrictMode', async () => {
    const calls = serveVerify()
    renderAt(LINK_PATH)

    await screen.findByRole('heading', { level: 1, name: 'Confirmed' })
    await letStragglersLand()
    expect(calls).toHaveLength(1)
  })

  it('shows the verifying frame while the confirmation runs', async () => {
    server.use(http.post(VERIFY_URL, () => new Promise<never>(() => {})))
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Confirming it’s you' })
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Confirming it’s you…')
  })

  it('says close this tab while a waiting tab holds the lock', async () => {
    const events: string[] = []
    const locks = stubWebLocks(() => events.push('query'))
    locks.held.push({ name: STEP_UP_WAIT_LOCK, mode: 'shared' })
    serveVerify(() => {
      events.push('verify')
      // The waiting tab lets go once it hears the broadcast; the page's answer must not change.
      locks.held.length = 0
      return ok({ accessToken: 'stepped-up' })
    })
    renderAt(LINK_PATH)

    expect(await screen.findByText('You can close this tab.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Confirmed' })).toBeInTheDocument()
    // Read before the post: once the broadcast lands, the waiting tab retries and releases the lock.
    expect(events).toEqual(['query', 'verify'])
  })

  it('says go back and try again when no tab waits', async () => {
    stubWebLocks()
    serveVerify()
    renderAt(LINK_PATH)

    expect(await screen.findByText('Go back to Apex and try the action again.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Overview' })).toHaveAttribute(
      'href',
      '/overview'
    )
  })

  it('says return to the starting tab where Web Locks are missing', async () => {
    expect('locks' in navigator).toBe(false)
    serveVerify()
    renderAt(LINK_PATH)

    expect(
      await screen.findByText(
        'Return to the Apex tab where you started. If you closed it, try the action again.'
      )
    ).toBeInTheDocument()
  })

  it('says go back and try again where BroadcastChannel is missing, since no tab can hear', async () => {
    const locks = stubWebLocks()
    locks.held.push({ name: STEP_UP_WAIT_LOCK, mode: 'shared' })
    vi.stubGlobal('BroadcastChannel', undefined)
    serveVerify()
    try {
      renderAt(LINK_PATH)
      expect(
        await screen.findByText('Go back to Apex and try the action again.')
      ).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('posts nothing and names the starting browser when signed out', async () => {
    signOut()
    const calls = serveVerify()
    const received = openWaitingTab()
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to confirm' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This link works only in the browser and session that asked for it. If you signed out here, sign in and repeat the action.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    await letStragglersLand()
    expect(calls).toEqual([])
    expect(received).toEqual([])
  })

  it('names the fix when the link carries no token', async () => {
    const calls = serveVerify()
    renderAt('/auth/confirm')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link is incomplete' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Open the most recent confirmation email and use its link.')
    ).toBeInTheDocument()
    await letStragglersLand()
    expect(calls).toEqual([])
  })

  it('shows the one dead-link message on a 400 and broadcasts nothing', async () => {
    serveVerify(() => fail('This link has expired or was already used.', 400, 'LINK_INVALID'))
    const received = openWaitingTab()
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link didn’t confirm it’s you' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Open it in the browser where you asked for it, within 15 minutes. For a new link, try the action again.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await letStragglersLand()
    expect(received).toEqual([])
    expect(useAuthStore.getState().accessToken).toBe('access-token')
  })

  it('treats the validation 400 as the same dead link', async () => {
    serveVerify(() => fail('Validation failed', 400))
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link didn’t confirm it’s you' })
    ).toBeInTheDocument()
  })

  it('shows the staff-access message on a 404', async () => {
    const received = openWaitingTab()
    serveVerify(() => fail('Route not found', 404))
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your staff access changed' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Ask a platform owner to check your role, then go to Overview.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Overview' })).toHaveAttribute(
      'href',
      '/overview'
    )
    await letStragglersLand()
    expect(received).toEqual([])
  })

  it('says the session ended on a 401 and does not redirect', async () => {
    const assign = vi.fn()
    // jsdom's Location accessors live on the prototype, so a spread copies none of them.
    const { origin, protocol, host, hostname, port } = window.location
    vi.stubGlobal('location', {
      origin,
      protocol,
      host,
      hostname,
      port,
      href: `${origin}${LINK_PATH}`,
      pathname: '/auth/confirm',
      search: `?token=${TOKEN}`,
      hash: '',
      assign,
      replace: assign,
    })
    let refreshes = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshes += 1
        return fail('Unauthorized', 401)
      })
    )
    const calls = serveVerify(() => fail('Session ended', 401, 'ACCESS_TOKEN_EXPIRED'))
    try {
      const router = renderAt(LINK_PATH)

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Your session ended' })
      ).toBeInTheDocument()
      expect(screen.getByText('Sign in again, then repeat the action.')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
      await letStragglersLand()
      expect(calls).toHaveLength(1)
      expect(refreshes).toBe(0)
      expect(assign).not.toHaveBeenCalled()
      expect(router.state.location.pathname).toBe('/auth/confirm')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    [429, () => fail('Too many requests. Try again in 60 seconds.', 429)],
    [503, () => fail('Service Unavailable', 503)],
    ['network', () => HttpResponse.error()],
  ] as const)('offers Try again on %s', async (_label, failure) => {
    let answer: () => Response = failure
    const calls = serveVerify(() => answer())
    const received = openWaitingTab()
    const user = userEvent.setup()
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We couldn’t confirm it’s you' })
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement()
    expect(received).toEqual([])

    answer = () => ok({ accessToken: 'stepped-up' })
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Confirmed' })).toBeInTheDocument()
    expect(calls).toHaveLength(2)
    expect(useAuthStore.getState().accessToken).toBe('stepped-up')
    await vi.waitFor(() => expect(received).toEqual([{ type: 'step_up_confirmed' }]))
  })
})

describe('/auth/confirm as the Google popup lands', () => {
  it('reports a Google confirmation to the opener and closes the window', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const calls = serveVerify()
    const received = openWaitingTab()
    renderAt('/auth/confirm?result=confirmed')

    expect(await screen.findByRole('heading', { level: 1, name: 'Confirmed' })).toBeInTheDocument()
    expect(screen.getByText('You can close this window.')).toBeInTheDocument()
    await vi.waitFor(() => expect(received).toEqual([{ type: 'step_up_confirmed' }]))
    await letStragglersLand()
    expect(received).toEqual([{ type: 'step_up_confirmed' }])
    expect(close).toHaveBeenCalledOnce()
    expect(calls).toEqual([])
  })

  it('reports it signed out too, since the waiting tab refreshes its own session', async () => {
    signOut()
    vi.spyOn(window, 'close').mockImplementation(() => {})
    const received = openWaitingTab()
    renderAt('/auth/confirm?result=confirmed')

    await vi.waitFor(() => expect(received).toEqual([{ type: 'step_up_confirmed' }]))
  })

  it('reports a Google failure without broadcasting', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const calls = serveVerify()
    const received = openWaitingTab()
    renderAt('/auth/confirm?error=step_up_failed')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We couldn’t confirm it’s you' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Google didn’t confirm your sign-in. Close this window, then try again in Apex or use the email link.'
      )
    ).toBeInTheDocument()
    await letStragglersLand()
    expect(received).toEqual([])
    expect(close).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('drops an unknown result or error, leaving the incomplete-link message', async () => {
    const received = openWaitingTab()
    renderAt('/auth/confirm?result=maybe&error=other')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link is incomplete' })
    ).toBeInTheDocument()
    await letStragglersLand()
    expect(received).toEqual([])
  })
})

describe('/auth/confirm reached signed in', () => {
  it('stays on the page instead of bouncing to Overview', async () => {
    serveVerify()
    const router = renderAt(LINK_PATH)

    await screen.findByRole('heading', { level: 1, name: 'Confirmed' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/auth/confirm'))
  })
})
