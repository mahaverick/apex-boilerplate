import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_INBOX_TITLE } from '@/components/features/auth/sign-in-link-form'
import { CONFIRM_DEAD_TITLE } from '@/components/features/invitations/invitation-parts'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const TOKEN = 'c'.repeat(43)
/** The address the link names. The server's `user.email` is deliberately cased apart from it. */
const LINK_EMAIL = 'ADA@example.com'
const SERVER_EMAIL = 'ada@example.com'
const CONFIRM_PATH = `/invitations/confirm?token=${TOKEN}&email=${encodeURIComponent(LINK_EMAIL)}`
const JOINED = `You joined Platform as ${SERVER_EMAIL}.`
const DEAD_TITLE = CONFIRM_DEAD_TITLE
const DEAD_BODY =
  'Open your invitation email and select Join again to get a new link. If the invitation expired, ask the team for a new invite.'
const INCOMPLETE_TITLE = 'This link is incomplete'
const INVALID = 'This invitation is invalid or has expired.'

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

/** A signed-in, bootstrapped staff session whose address is `email`. */
function signIn(email = testUser.email) {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: { ...testUser, email },
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/** No refresh cookie, so the root's bootstrap settles signed out. */
function arriveSignedOut() {
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

/** What a recorded request carried. */
interface Seen {
  body: unknown
  authorization: string | null
}

/** Records every confirm post; each answers with the next of `answers`, the last one repeating. */
function serveConfirm(...answers: (() => Response | Promise<Response>)[]): Seen[] {
  const seen: Seen[] = []
  server.use(
    http.post('/api/v1/invitations/confirm', async ({ request }) => {
      const answer = answers[Math.min(seen.length, answers.length - 1)]
      seen.push({ body: await request.json(), authorization: request.headers.get('authorization') })
      return answer?.() ?? fail('No answer', 500)
    })
  )
  return seen
}

/** The confirm `200`: a staff session for the server's own address, joined to the platform tenant. */
function joined() {
  return () =>
    ok(
      {
        user: { ...testUser, email: SERVER_EMAIL, platformRole: 'viewer' },
        accessToken: 'confirm-token',
        isNewUser: true,
        tenant: { name: 'Platform', slug: 'platform' },
        role: 'viewer',
      },
      'Invitation accepted.'
    )
}

/** An answer that never arrives, so a test can grade the frame shown while it runs. */
function held() {
  return async () => {
    await delay('infinite')
    return ok(null)
  }
}

/** A 429 that says to wait `seconds`. */
function rateLimited(seconds: number) {
  return () => {
    const response = fail('Too many attempts. Please try again later.', 429)
    response.headers.set('Retry-After', String(seconds))
    return response
  }
}

/** Waits for the landing on Overview, which replaced the token page in history. */
async function expectLandedOnOverview(router: AnyRouter) {
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/overview')
  })
  expect((router.history as RouterHistory).length).toBe(1)
}

const realLocation = window.location

/** Replaces `window.location` with a copy whose `assign` is a spy; jsdom's own cannot be spied on. */
function stubAssign() {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, assign },
  })
  return assign
}

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
})

describe('confirm page: the link itself', () => {
  beforeEach(arriveSignedOut)

  it.each([
    ['no token', `/invitations/confirm?email=${encodeURIComponent(LINK_EMAIL)}`],
    ['no email', `/invitations/confirm?token=${TOKEN}`],
    ['a blank email', `/invitations/confirm?token=${TOKEN}&email=%20`],
    ['nothing at all', '/invitations/confirm'],
  ])('shows the incomplete state for %s, with no call', async (_case, path) => {
    const confirms = serveConfirm(joined())
    renderAt(path)

    expect(await screen.findByRole('heading', { level: 1, name: INCOMPLETE_TITLE })).toBeVisible()
    expect(
      screen.getByText(
        'Part of this link is missing. Open the most recent email from us and select its link.'
      )
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
    expect(confirms).toHaveLength(0)
  })

  it('shows the dead-link state for a malformed token, with no call', async () => {
    const confirms = serveConfirm(joined())
    renderAt(`/invitations/confirm?token=short&email=${encodeURIComponent(LINK_EMAIL)}`)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(DEAD_BODY)).toBeVisible()
    expect(screen.getByLabelText('Email')).toHaveValue(LINK_EMAIL)
    expect(confirms).toHaveLength(0)
  })
})

describe('confirm page, signed out', () => {
  beforeEach(arriveSignedOut)

  it('joins a signed-out staff invitee in one load and lands on Overview with the toast', async () => {
    const confirms = serveConfirm(joined())
    const router = renderAt(CONFIRM_PATH)

    await expectLandedOnOverview(router)
    expect(await screen.findAllByText(JOINED)).toHaveLength(1)
    expect(screen.getByText(JOINED).closest('.ph-sensitive.ph-mask')).not.toBeNull()
    await screen.findByRole('heading', { name: 'Overview', level: 1 })
    expect(useAuthStore.getState().user?.email).toBe(SERVER_EMAIL)
    expect(useAuthStore.getState().user?.platformRole).toBe('viewer')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(confirms).toEqual([{ body: { token: TOKEN, email: LINK_EMAIL }, authorization: null }])
  })

  it('shows Joining your team and the link’s address while it joins', async () => {
    serveConfirm(held())
    renderAt(CONFIRM_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Joining your team' })
    ).toBeVisible()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Joining your team…')
    expect(status).toHaveTextContent(`This link is for ${LINK_EMAIL}.`)
    expect(within(status).getByText(LINK_EMAIL)).toHaveClass('ph-sensitive', 'ph-mask')
  })

  it('posts the token exactly once under StrictMode', async () => {
    const confirms = serveConfirm(held())
    renderAt(CONFIRM_PATH)

    await screen.findByRole('heading', { level: 1, name: 'Joining your team' })
    await waitFor(() => expect(confirms).toHaveLength(1))
    // A second post would have no event of its own; give its handler time to record it.
    await act(() => settle(50, 'a second StrictMode post has no event to wait on'))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Joining your team')
    expect(confirms).toHaveLength(1)
  })

  it('sends the link’s email trimmed', async () => {
    const confirms = serveConfirm(held())
    renderAt(`/invitations/confirm?token=${TOKEN}&email=${encodeURIComponent('  ada@x.test ')}`)

    await waitFor(() => expect(confirms).toHaveLength(1))
    expect(confirms[0]?.body).toEqual({ token: TOKEN, email: 'ada@x.test' })
  })

  it('names the server’s address after success, not the link’s', async () => {
    serveConfirm(joined())
    let logouts = 0
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logouts += 1
        return ok(null, 'Signed out.')
      })
    )
    // The confirm signs in someone the link does not name; a page reading the live store would flash the switch prompt.
    const seenSwitch = { value: false }
    const observer = new MutationObserver(() => {
      if (screen.queryByRole('heading', { name: 'Join your team' })) seenSwitch.value = true
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const router = renderAt(
      `/invitations/confirm?token=${TOKEN}&email=${encodeURIComponent('mallory@evil.test')}`
    )

    expect(await screen.findByText(JOINED)).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/overview')
    })
    observer.disconnect()
    expect(seenSwitch.value).toBe(false)
    expect(logouts).toBe(0)
    await waitFor(() => {
      expect(screen.queryByText(/mallory@evil\.test/)).not.toBeInTheDocument()
    })
  })

  it.each([
    ['a 200', joined(), true],
    ['a 404', () => fail(INVALID, 404, 'invitation_invalid'), false],
    ['a failure', () => fail('Something broke.', 500), false],
  ])(
    'tells waiting tabs after a 200, and not after a 404 or a failure (%s)',
    async (_case, answer, tells) => {
      serveConfirm(answer)
      const heard: unknown[] = []
      const waitingTab = new BroadcastChannel('auth')
      waitingTab.addEventListener('message', (event: MessageEvent<unknown>) => {
        heard.push(event.data)
      })
      renderAt(CONFIRM_PATH)

      if (tells) {
        await vi.waitFor(() => expect(heard).toContainEqual({ type: 'signed_in' }))
        expect(await screen.findByText(JOINED)).toBeInTheDocument()
      } else {
        await screen.findByRole('heading', { level: 1, name: /can't be used|couldn’t add you/ })
        // A message that is not sent has no event to wait on.
        await act(() => settle(50, 'an unsent broadcast has no event to wait on'))
        expect(heard).not.toContainEqual({ type: 'signed_in' })
      }
      waitingTab.close()
    }
  )

  it('drops the token from the URL after the outcome', async () => {
    serveConfirm(() => fail(INVALID, 404, 'invitation_invalid'))
    const router = renderAt(CONFIRM_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    await waitFor(() => {
      expect(router.state.location.searchStr).not.toContain('token=')
    })
    expect(router.state.location.pathname).toBe('/invitations/confirm')
    expect((router.history as RouterHistory).length).toBe(1)
    // The page keeps its outcome; it does not turn into the incomplete link.
    expect(screen.getByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
  })

  it('shows the dead-link state on 404, with SignInLinkForm prefilled from the link’s email', async () => {
    serveConfirm(() => fail(INVALID, 404, 'invitation_invalid'))
    const requests: unknown[] = []
    server.use(
      http.post('/api/v1/auth/link/request', async ({ request }) => {
        requests.push(await request.json())
        return ok(null, 'Check your email.', 202)
      })
    )
    const user = userEvent.setup()
    renderAt(CONFIRM_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(DEAD_BODY)).toBeVisible()
    expect(screen.getByText('Or sign in:')).toBeVisible()
    expect(screen.getByLabelText('Email')).toHaveValue(LINK_EMAIL)
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeVisible()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(await screen.findByRole('heading', { level: 1, name: CHECK_INBOX_TITLE })).toBeVisible()
    // An apex link, so a staff invitee's request mails the invitation again.
    expect(requests).toEqual([{ email: SERVER_EMAIL, app: 'apex' }])
  })

  it.each([
    [
      '503 MAINTENANCE_MODE',
      () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Down for maintenance.',
            statusCode: 503,
            code: 'MAINTENANCE_MODE',
          },
          { status: 503 }
        ),
      'Down for maintenance.',
    ],
    [
      '503 READ_ONLY_MODE',
      () => fail('The service is read-only for maintenance.', 503, 'READ_ONLY_MODE'),
      'Changes are paused during maintenance.',
    ],
    ['429', rateLimited(42), 'Too many attempts. Try again in 42 seconds.'],
    ['403', () => fail('Origin not allowed.', 403), 'Origin not allowed.'],
    ['500', () => fail('Something broke.', 500), 'Something broke.'],
    [
      'a network error',
      () => HttpResponse.error(),
      "We couldn't reach the server. Check your connection, then try again.",
    ],
  ])('offers Try again on %s, and Try again posts again', async (_case, failure, message) => {
    const confirms = serveConfirm(failure, joined())
    const user = userEvent.setup()
    const router = renderAt(CONFIRM_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We couldn’t add you to your team' })
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText(DEAD_TITLE)).not.toBeInTheDocument()
    expect(confirms).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await expectLandedOnOverview(router)
    expect(confirms).toHaveLength(2)
    expect(confirms[1]?.body).toEqual({ token: TOKEN, email: LINK_EMAIL })
  })
})

describe('confirm page, signed in', () => {
  it('joins a signed-in user whose address matches (case-insensitive)', async () => {
    signIn(SERVER_EMAIL)
    const confirms = serveConfirm(joined())
    const router = renderAt(CONFIRM_PATH)

    await expectLandedOnOverview(router)
    expect(await screen.findAllByText(JOINED)).toHaveLength(1)
    // The server replaces the session; the old bearer is never sent.
    expect(confirms).toEqual([{ body: { token: TOKEN, email: LINK_EMAIL }, authorization: null }])
    expect(useAuthStore.getState().accessToken).toBe('confirm-token')
  })

  it('asks a different signed-in person before switching and spends nothing', async () => {
    signIn('someone@else.test')
    const confirms = serveConfirm(joined())
    let logouts = 0
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logouts += 1
        return ok(null, 'Signed out.')
      })
    )
    const assign = stubAssign()
    const user = userEvent.setup()
    const mailed = `${CONFIRM_PATH}&utm_source=email&utm_medium=email&utm_campaign=invitation_confirm&utm_content=primary_button`
    renderAt(mailed)

    expect(await screen.findByRole('heading', { level: 1, name: 'Join your team' })).toBeVisible()
    expect(screen.getByText(/This invitation is for/)).toHaveTextContent(
      `This invitation is for ${LINK_EMAIL}. You're signed in as someone@else.test.`
    )
    expect(confirms).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: `Continue as ${LINK_EMAIL}` }))

    await waitFor(() => expect(assign).toHaveBeenCalledOnce())
    // The reload keeps the link's campaign keys, so its page view is still attributed.
    expect(assign).toHaveBeenCalledWith(mailed)
    expect(logouts).toBe(1)
    expect(confirms).toHaveLength(0)
  })

  it('goes to Overview on Cancel, still signed in, and spends nothing', async () => {
    signIn('someone@else.test')
    const confirms = serveConfirm(joined())
    const user = userEvent.setup()
    const router = renderAt(CONFIRM_PATH)

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/overview'))
    expect(useAuthStore.getState().user?.email).toBe('someone@else.test')
    expect(confirms).toHaveLength(0)
  })

  it('offers Overview, not a sign-in form, on a dead link while signed in', async () => {
    signIn(SERVER_EMAIL)
    serveConfirm(() => fail(INVALID, 404, 'invitation_invalid'))
    renderAt(CONFIRM_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to Overview' })).toHaveAttribute(
      'href',
      '/overview'
    )
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(useAuthStore.getState().user?.email).toBe(SERVER_EMAIL)
  })
})
