import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_INBOX_TITLE, LINK_DEAD_TITLE } from '@/components/features/auth/sign-in-link-form'
import { pageTitle } from '@/constants/app'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const TOKEN = 't'.repeat(43)
/** The address the link was mailed to, which is not the signed-in test user's. */
const LINK_EMAIL = 'ada@example.test'
const LINK_PATH = `/auth/link?token=${TOKEN}&email=${encodeURIComponent(LINK_EMAIL)}`
/** The staff member the link signs in. */
const ADA = { ...testUser, email: LINK_EMAIL }
/** The API's one answer to every link that signs nobody in. */
const DEAD = () => fail('This link has expired or was already used.', 400, 'LINK_INVALID')

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

/** No refresh cookie: the root's bootstrap settles signed out. */
function arriveSignedOut() {
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

/** A refresh cookie for the test user (a.b@example.com): the root's bootstrap restores that session. */
function arriveSignedIn() {
  server.use(
    http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Token refreshed.')),
    http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.'))
  )
}

/** Counts every verify post; each answers with the next of `answers`, the last one repeating. */
function serveVerify(...answers: (() => Response)[]): { calls: () => number } {
  let calls = 0
  server.use(
    http.post('/api/v1/auth/link/verify', () => {
      const answer = answers[Math.min(calls, answers.length - 1)]
      calls += 1
      return answer?.() ?? fail('No answer', 500)
    })
  )
  return { calls: () => calls }
}

/** Records every link request's body, answering 202. */
function serveLinkRequests(): unknown[] {
  const requests: unknown[] = []
  server.use(
    http.post('/api/v1/auth/link/request', async ({ request }) => {
      requests.push(await request.json())
      return ok(null, 'Check your inbox for a sign-in link.', 202)
    })
  )
  return requests
}

/** A verify that signs Ada in. */
function signedIn(extra: { redirect?: string | null } = {}) {
  return () =>
    ok(
      { user: ADA, accessToken: 'link-token', isNewUser: false, redirect: null, ...extra },
      'Signed in.'
    )
}

/**
 * Records every text the page's `<h1>` and status line show, from the first
 * render on, so a state that flashes between two checks is still seen.
 */
function watchTexts(): { seen: Set<string>; stop: () => void } {
  const seen = new Set<string>()
  /** Adds what the heading and status line show now. */
  const record = () => {
    for (const node of document.querySelectorAll('h1, [role="status"]')) {
      if (node.textContent) seen.add(node.textContent)
    }
  }
  const observer = new MutationObserver(record)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  return { seen, stop: () => observer.disconnect() }
}

/** Replaces `window.location` with a copy whose `assign` is a spy; jsdom's own cannot be spied on. */
function stubAssign() {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, assign },
  })
  return assign
}

const realLocation = window.location

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  window.history.replaceState(null, '', '/')
})

describe('/auth/link, signed out', () => {
  beforeEach(arriveSignedOut)

  it('signs in and lands on Overview', async () => {
    serveVerify(signedIn())
    const router = renderAt(LINK_PATH)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    expect(useAuthStore.getState().user).toEqual(ADA)
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it('names the address while it verifies, under the page title', async () => {
    server.use(
      http.post('/api/v1/auth/link/verify', async () => {
        await delay('infinite')
        return ok(null)
      })
    )
    renderAt(LINK_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: 'Signing you in' })).toBeVisible()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Signing you in…')
    expect(status).toHaveTextContent(`This link is for ${LINK_EMAIL}.`)
    await waitFor(() => {
      expect(document.title).toBe(pageTitle('Signing in'))
    })
  })

  it('lands on the stored redirect', async () => {
    serveVerify(signedIn({ redirect: `/tenants/${TENANT_ID}/members` }))
    const router = renderAt(LINK_PATH)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/tenants/${TENANT_ID}/members`)
    })
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it("lands on the link's own redirect when the response has none", async () => {
    serveVerify(signedIn())
    const router = renderAt(`${LINK_PATH}&redirect=${encodeURIComponent('/activity')}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/activity')
    })
  })

  it('lands on the response redirect, not the hint, after a signed-out verify', async () => {
    serveVerify(signedIn({ redirect: '/users' }))
    const texts = watchTexts()
    const router = renderAt(`${LINK_PATH}&redirect=${encodeURIComponent('/activity')}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/users')
    })
    texts.stop()
    // The verify's own sign-in must not turn the page into a signed-in row, which would land on the hint.
    expect([...texts.seen]).not.toContain('Switch account?')
  })

  it('names the signed-in account, never a switch, once the verify signs in a link with no address', async () => {
    serveVerify(signedIn())
    const texts = watchTexts()
    // No address on the link, so a page that re-read the store after the verify would ask to switch.
    const router = renderAt(`/auth/link?token=${TOKEN}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    texts.stop()
    expect([...texts.seen]).not.toContain('Switch account?')
    expect(useAuthStore.getState().user).toEqual(ADA)
  })

  it('names the server-confirmed address once signed in, not the one in the link', async () => {
    serveVerify(signedIn())
    const texts = watchTexts()
    const router = renderAt(
      `/auth/link?token=${TOKEN}&email=${encodeURIComponent('ADA@example.test')}`
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    texts.stop()
    expect([...texts.seen]).toContain(`Signing you in…This link is for ADA@example.test.`)
    expect([...texts.seen]).toContain(`Signing you in…This link is for ${LINK_EMAIL}.`)
  })

  it.each(['//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)'])(
    'ignores an off-origin redirect from the link and from the response (%s)',
    async (unsafe) => {
      serveVerify(signedIn({ redirect: unsafe }))
      const router = renderAt(`${LINK_PATH}&redirect=${encodeURIComponent(unsafe)}`)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/overview')
      })
      expect(router.state.location.href).not.toContain('evil')
    }
  )

  it.each([
    ['/auth/link', `/auth/link?token=${'y'.repeat(43)}`],
    ['/invitations/accept', '/invitations/accept?token=probe'],
    ['/auth/confirm', `/auth/confirm?token=${'y'.repeat(43)}`],
    ['/auth/link, cased and slashed', `/Auth/Link/?token=${'y'.repeat(43)}`],
  ])('treats a redirect back to a token page (%s) as no redirect', async (_name, tokenPage) => {
    const verify = serveVerify(signedIn({ redirect: tokenPage }))
    const router = renderAt(`${LINK_PATH}&redirect=${encodeURIComponent(tokenPage)}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    expect(verify.calls()).toBe(1)
  })

  it.each([
    ['a bare ?email=', `/auth/link?token=${TOKEN}&email=`],
    ['a whitespace ?email=', `/auth/link?token=${TOKEN}&email=%20%20`],
  ])(
    'posts { token } only for %s, which the server would count as a mismatch',
    async (_name, path) => {
      const bodies: unknown[] = []
      server.use(
        http.post('/api/v1/auth/link/verify', async ({ request }) => {
          bodies.push(await request.json())
          return signedIn()()
        })
      )
      const router = renderAt(path)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/overview')
      })
      expect(bodies).toEqual([{ token: TOKEN }])
    }
  )

  it('posts the token exactly once under StrictMode', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/auth/link/verify', async ({ request }) => {
        bodies.push(await request.json())
        return signedIn()()
      })
    )
    const router = renderAt(LINK_PATH)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    expect(bodies).toEqual([{ token: TOKEN, email: LINK_EMAIL }])
  })

  it('broadcasts signed_in after verifying', async () => {
    const heard: unknown[] = []
    const otherTab = new BroadcastChannel('auth')
    otherTab.addEventListener('message', (event: MessageEvent) => heard.push(event.data))
    serveVerify(signedIn())
    renderAt(LINK_PATH)

    await waitFor(() => {
      expect(heard).toContainEqual({ type: 'signed_in' })
    })
    otherTab.close()
  })

  it('shows the dead link with the address prefilled on a 400, and one click resends with app apex', async () => {
    serveVerify(DEAD)
    const requests = serveLinkRequests()
    const user = userEvent.setup()
    renderAt(LINK_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: LINK_DEAD_TITLE })).toBeVisible()
    expect(screen.getByText('The link works once and expires in 15 minutes.')).toBeVisible()
    expect(screen.getByLabelText('Email')).toHaveValue(LINK_EMAIL)
    await user.click(screen.getByRole('button', { name: 'Email me a new link' }))

    expect(await screen.findByRole('heading', { level: 1, name: CHECK_INBOX_TITLE })).toBeVisible()
    expect(requests).toEqual([{ email: LINK_EMAIL, app: 'apex' }])
    // The inbox step carries its own copy of the rule; the page's is gone, so it reads once.
    expect(screen.getAllByText('The link works once and expires in 15 minutes.')).toHaveLength(1)
  })

  it("carries the old link's redirect into the new link, and lands there", async () => {
    serveVerify(DEAD)
    const requests = serveLinkRequests()
    const user = userEvent.setup()
    const router = renderAt(`${LINK_PATH}&redirect=${encodeURIComponent('/activity?range=7d')}`)
    await user.click(await screen.findByRole('button', { name: 'Email me a new link' }))
    await screen.findByRole('heading', { level: 1, name: CHECK_INBOX_TITLE })
    expect(requests).toEqual([{ email: LINK_EMAIL, app: 'apex', redirect: '/activity?range=7d' }])

    // The other tab set the shared cookie, so this tab's restore now succeeds.
    arriveSignedIn()
    const otherTab = new BroadcastChannel('auth')
    otherTab.postMessage({ type: 'signed_in' })
    otherTab.close()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/activity')
    })
  })

  it.each([
    `/auth/link?token=${'y'.repeat(43)}`,
    '/invitations/accept?token=probe',
    `/auth/confirm?token=${'y'.repeat(43)}`,
    '//evil.test',
  ])("does not carry %s into the new link's redirect", async (unsafe) => {
    serveVerify(DEAD)
    const requests = serveLinkRequests()
    const user = userEvent.setup()
    renderAt(`${LINK_PATH}&redirect=${encodeURIComponent(unsafe)}`)
    await user.click(await screen.findByRole('button', { name: 'Email me a new link' }))
    await screen.findByRole('heading', { level: 1, name: CHECK_INBOX_TITLE })

    expect(requests).toEqual([{ email: LINK_EMAIL, app: 'apex' }])
  })

  it('lands on Overview when another tab uses the new link', async () => {
    serveVerify(DEAD)
    const user = userEvent.setup()
    const router = renderAt(LINK_PATH)
    await user.click(await screen.findByRole('button', { name: 'Email me a new link' }))
    await screen.findByRole('heading', { level: 1, name: CHECK_INBOX_TITLE })

    arriveSignedIn()
    const otherTab = new BroadcastChannel('auth')
    otherTab.postMessage({ type: 'signed_in' })
    otherTab.close()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
  })

  it('shows the dead link and starts no session when the address does not match the token', async () => {
    let refreshes = 0
    const sent: unknown[] = []
    server.use(
      // The server checks the address against the token's own: an attacker's token with a victim's address is refused.
      http.post('/api/v1/auth/link/verify', async ({ request }) => {
        const body = (await request.json()) as { token: string; email?: string }
        sent.push(body)
        return body.email === 'attacker@example.test' ? signedIn()() : DEAD()
      }),
      http.post('/api/v1/auth/refresh', () => {
        refreshes += 1
        return fail('Unauthorized', 401)
      })
    )
    renderAt(`/auth/link?token=${TOKEN}&email=${encodeURIComponent('victim@example.test')}`)

    expect(await screen.findByRole('heading', { level: 1, name: LINK_DEAD_TITLE })).toBeVisible()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(screen.queryByText(/This link is for/)).not.toBeInTheDocument()
    expect(sent).toEqual([{ token: TOKEN, email: 'victim@example.test' }])
    // Only the root's bootstrap tried to restore a session; the verify failure added none.
    expect(refreshes).toBe(1)
  })

  it('never says which kind of dead link it was', async () => {
    serveVerify(DEAD)
    renderAt(LINK_PATH)
    await screen.findByRole('heading', { level: 1, name: LINK_DEAD_TITLE })
    const invalid = document.querySelector('main')?.textContent
    cleanup()

    queryClient.clear()
    resetSessionForTests()
    useAuthStore.setState({ isBootstrapped: false })
    serveVerify(() => fail('Validation failed', 400))
    renderAt(LINK_PATH)
    await screen.findByRole('heading', { level: 1, name: LINK_DEAD_TITLE })

    expect(document.querySelector('main')?.textContent).toBe(invalid)
    expect(invalid).not.toContain('Validation')
  })

  it.each([
    [
      429,
      () => {
        const response = fail('Too many attempts. Please try again later.', 429)
        response.headers.set('Retry-After', '42')
        return response
      },
      'Too many sign-in attempts. Try again in 42 seconds.',
    ],
    [
      503,
      () => fail('The service is unavailable. Try again in 1 minute.', 503),
      'The service is unavailable. Try again in 1 minute.',
    ],
    [
      'network',
      () => HttpResponse.error(),
      "We couldn't reach the server. Check your connection, then try again.",
    ],
  ])('offers Try again, not the dead link, on %s', async (_name, failure, message) => {
    const verify = serveVerify(failure, signedIn())
    const user = userEvent.setup()
    const router = renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: "We couldn't sign you in" })
    ).toBeVisible()
    expect(screen.queryByText(LINK_DEAD_TITLE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Email me a new link' })).not.toBeInTheDocument()
    expect(verify.calls()).toBe(1)
    expect(screen.getByRole('alert')).toHaveTextContent(message)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    expect(verify.calls()).toBe(2)
  })

  it('handles a link with no token', async () => {
    const verify = serveVerify(signedIn())
    renderAt(`/auth/link?email=${encodeURIComponent(LINK_EMAIL)}`)

    expect(await screen.findByRole('heading', { level: 1, name: LINK_DEAD_TITLE })).toBeVisible()
    expect(screen.getByLabelText('Email')).toHaveValue(LINK_EMAIL)
    expect(screen.getByRole('button', { name: 'Email me a new link' })).toBeVisible()
    expect(verify.calls()).toBe(0)
  })
})

describe('/auth/link, signed in', () => {
  beforeEach(arriveSignedIn)

  it('skips verify for the same signed-in person', async () => {
    const verify = serveVerify(signedIn())
    const router = renderAt(
      `/auth/link?token=${TOKEN}&email=${encodeURIComponent('A.B@Example.com')}&redirect=${encodeURIComponent('/activity')}`
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/activity')
    })
    expect(verify.calls()).toBe(0)
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it.each([
    `/auth/link?token=${'y'.repeat(43)}`,
    '/invitations/accept?token=probe',
    `/auth/confirm?token=${'y'.repeat(43)}`,
  ])(
    'sends the same signed-in person past a token-page redirect (%s) to Overview',
    async (tokenPage) => {
      const verify = serveVerify(signedIn())
      const router = renderAt(
        `/auth/link?token=${TOKEN}&email=${encodeURIComponent(testUser.email)}&redirect=${encodeURIComponent(tokenPage)}`
      )

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/overview')
      })
      expect(verify.calls()).toBe(0)
    }
  )

  it('asks before switching for a different signed-in person and spends nothing', async () => {
    const verify = serveVerify(signedIn())
    let logouts = 0
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logouts += 1
        return ok(null, 'Signed out.')
      })
    )
    // The memory history leaves jsdom's address alone, so put the link there as a browser would.
    window.history.replaceState(null, '', LINK_PATH)
    const assign = stubAssign()
    const user = userEvent.setup()
    renderAt(LINK_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: 'Switch account?' })).toBeVisible()
    expect(screen.getByText(/You're signed in as/)).toHaveTextContent(
      `You're signed in as ${testUser.email}. This link is for ${LINK_EMAIL}.`
    )
    expect(verify.calls()).toBe(0)

    await user.click(screen.getByRole('button', { name: `Continue as ${LINK_EMAIL}` }))

    await waitFor(() => {
      expect(assign).toHaveBeenCalledOnce()
    })
    // The signed-out reload must reopen this link, token and address included, so it verifies there.
    const reload = new URL(String(assign.mock.calls[0]?.[0]), realLocation.origin)
    expect(reload.pathname).toBe('/auth/link')
    expect(reload.searchParams.get('token')).toBe(TOKEN)
    expect(reload.searchParams.get('email')).toBe(LINK_EMAIL)
    expect(logouts).toBe(1)
    expect(verify.calls()).toBe(0)
  })

  it('asks before switching when the link names no address', async () => {
    const verify = serveVerify(signedIn())
    renderAt(`/auth/link?token=${TOKEN}`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Switch account?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Continue with this link' })).toBeVisible()
    expect(verify.calls()).toBe(0)
  })

  it('stays signed in and goes to Overview on Stay', async () => {
    const verify = serveVerify(signedIn())
    const user = userEvent.setup()
    const router = renderAt(LINK_PATH)

    await user.click(
      await screen.findByRole('button', { name: `Stay signed in as ${testUser.email}` })
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    expect(useAuthStore.getState().user).toEqual(testUser)
    expect(verify.calls()).toBe(0)
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it('sends a signed-in visitor with no token to Overview', async () => {
    const verify = serveVerify(signedIn())
    const router = renderAt(`/auth/link?email=${encodeURIComponent(LINK_EMAIL)}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    expect(screen.queryByText(LINK_DEAD_TITLE)).not.toBeInTheDocument()
    expect(verify.calls()).toBe(0)
    expect((router.history as RouterHistory).length).toBe(1)
  })
})
