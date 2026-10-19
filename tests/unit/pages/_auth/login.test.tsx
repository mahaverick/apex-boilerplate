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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_INBOX_TITLE } from '@/components/features/auth/sign-in-link-form'
import { APP_NAME } from '@/constants/app'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { READ_ONLY_MODE_MESSAGE } from '@/lib/api-error'
import { toast } from '@/lib/toast'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

afterEach(() => {
  vi.restoreAllMocks()
})

const DESCRIPTION = "Enter your staff email and we'll send you a link to sign in."
const NOTE = 'Sign-in now uses email links.'

/**
 * Mounts the login page through a real RouterProvider rather than rendering the component alone: the
 * page reads `Route.useSearch()` and calls `useNavigate()`, which need a router, and `?redirect=`
 * handling is the heart of this page, so the router is the subject, not scaffolding.
 * @returns The router.
 */
function renderLoginAt(path: string): AnyRouter {
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
  return router as AnyRouter
}

/** A visitor with no refresh cookie, so `_auth`'s guard lets the login page render instead of bouncing them to /overview. */
function arriveSignedOut() {
  resetSessionForTests()
  queryClient.clear()
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

/** The bodies the link-request endpoint received, in order; it answers 202. */
function serveLinkRequests() {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/v1/auth/link/request', async ({ request }) => {
      bodies.push(await request.json())
      return ok(null, 'Check your inbox for a sign-in link.', 202)
    })
  )
  return bodies
}

/** Types an address and asks for a link, the way a visitor does. */
async function typeAndSend(email = 'ada@example.test') {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), email)
  await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
}

/** Sends a link and waits for the sent line. */
async function requestLink(email?: string) {
  await typeAndSend(email)
  await screen.findByText(/We sent a sign-in link to/)
}

/** The other tab used the link, so the shared refresh cookie now restores a session here. */
function signInFromAnotherTab(): BroadcastChannel {
  server.use(
    http.post('/api/v1/auth/refresh', () => ok({ accessToken: 'fresh-token' }, 'Token refreshed.')),
    http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.'))
  )
  const otherTab = new BroadcastChannel('auth')
  otherTab.postMessage({ type: 'signed_in' })
  return otherTab
}

/** Whether `b` comes after `a` in the document (DOCUMENT_POSITION_FOLLOWING). */
function follows(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('login page', () => {
  beforeEach(arriveSignedOut)

  it('shows one email field, the link button, the divider and Continue with Google', async () => {
    renderLoginAt('/login')

    const heading = await screen.findByRole('heading', { level: 1, name: 'Sign in to Apex' })
    expect(screen.getByText(APP_NAME)).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Forgot password?' })).not.toBeInTheDocument()
    const email = screen.getByLabelText('Email')
    const send = screen.getByRole('button', { name: 'Email me a sign-in link' })
    const divider = screen.getByText('or')
    const google = screen.getByRole('link', { name: 'Continue with Google' })
    expect(follows(heading, email)).toBe(true)
    expect(follows(email, send)).toBe(true)
    expect(follows(send, divider)).toBe(true)
    expect(follows(divider, google)).toBe(true)
  })

  it('shows no sign-up link and no terms line: Apex is internal and invitation-only', async () => {
    renderLoginAt('/login')
    await screen.findByRole('heading', { name: 'Sign in to Apex', level: 1 })

    expect(screen.queryByRole('link', { name: /create an account/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign up/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/terms of service/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/privacy policy/i)).not.toBeInTheDocument()
  })

  it('switches to Check your inbox after sending', async () => {
    serveLinkRequests()
    renderLoginAt('/login')
    await requestLink()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(CHECK_INBOX_TITLE)
    // The description and Google belong to the email step only.
    expect(screen.queryByText(DESCRIPTION)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument()
  })

  it('sends the safe redirect with the request', async () => {
    const bodies = serveLinkRequests()
    renderLoginAt(`/login?redirect=${encodeURIComponent('/tenants/abc?tab=members')}`)
    await requestLink()

    expect(bodies).toEqual([
      { email: 'ada@example.test', app: 'apex', redirect: '/tenants/abc?tab=members' },
    ])
  })

  it.each(['//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)'])(
    'drops an unsafe ?redirect before requesting the link (%s)',
    async (unsafe) => {
      const bodies = serveLinkRequests()
      renderLoginAt(`/login?redirect=${encodeURIComponent(unsafe)}`)
      await requestLink()

      expect(bodies).toHaveLength(1)
      expect(bodies[0]).not.toHaveProperty('redirect')
    }
  )

  it.each([
    `/auth/link?token=${'t'.repeat(43)}&email=a%40b.test`,
    `/auth/link/?token=${'t'.repeat(43)}`,
    `/Auth/Link?token=${'t'.repeat(43)}`,
    `/auth/confirm?token=${'t'.repeat(43)}`,
    `/invitations/accept?token=${'t'.repeat(43)}`,
    `/invitations/accept//?token=${'t'.repeat(43)}`,
  ])('does not carry a token page as the redirect (%s)', async (tokenPage) => {
    const bodies = serveLinkRequests()
    renderLoginAt(`/login?redirect=${encodeURIComponent(tokenPage)}`)
    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      GOOGLE_OAUTH_PATH
    )
    await requestLink()

    expect(bodies[0]).not.toHaveProperty('redirect')
  })

  it('points Continue with Google at the API with app=apex and the redirect', async () => {
    renderLoginAt(`/login?redirect=${encodeURIComponent('/tenants/abc')}`)

    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google?app=apex&redirect=%2Ftenants%2Fabc'
    )
  })

  it('points Continue with Google at app=apex alone without a safe redirect', async () => {
    renderLoginAt(`/login?redirect=${encodeURIComponent('//evil.test')}`)

    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google?app=apex'
    )
  })

  it('shows the sign-in-link note for notice=sign-in-link', async () => {
    renderLoginAt('/login?notice=sign-in-link')

    expect(await screen.findByText(NOTE)).toBeInTheDocument()
  })

  it('shows no note without the notice, and ignores an unknown one', async () => {
    const router = renderLoginAt('/login?notice=other')

    await screen.findByRole('button', { name: 'Email me a sign-in link' })
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
    expect(router.state.location.search).not.toHaveProperty('notice', 'other')
  })

  it('shows the read-only refusal inside the form, not as a toast', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/auth/link/request', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'The service is read-only for maintenance.',
            statusCode: 503,
            code: 'READ_ONLY_MODE',
            requestId: 'test-request-id',
          },
          { status: 503 }
        )
      )
    )
    renderLoginAt('/login')
    await typeAndSend()

    const message = await screen.findByText(READ_ONLY_MODE_MESSAGE)
    expect(message.closest('form')).not.toBeNull()
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(toastError).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in to Apex')
  })

  it('lands on the redirect when another tab signs in', async () => {
    serveLinkRequests()
    const router = renderLoginAt(`/login?redirect=${encodeURIComponent('/tenants?state=active')}`)
    await requestLink()

    const otherTab = signInFromAnotherTab()
    try {
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tenants')
      })
    } finally {
      otherTab.close()
    }
    expect(router.state.location.searchStr).toContain('state=active')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('lands on Overview when another tab signs in and there is no redirect', async () => {
    serveLinkRequests()
    const router = renderLoginAt('/login')
    await requestLink()

    const otherTab = signInFromAnotherTab()
    try {
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/overview')
      })
    } finally {
      otherTab.close()
    }
  })
})

/** Each `?error=` code the API's Google callback redirects here with. */
describe('OAuth failure messages', () => {
  beforeEach(arriveSignedOut)

  it('words a refused Google sign-in without saying the account is not staff', async () => {
    const toastError = vi.spyOn(toast, 'error')
    renderLoginAt('/login?error=google_auth_failed')

    const message =
      "Google sign-in didn't work for this account. Use your staff Google account, sign in with an email link, or ask an owner for an invitation."
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(toastError).toHaveBeenCalledWith(message)
    expect(screen.queryByText(/not (a )?staff/i)).not.toBeInTheDocument()
  })

  it.each([
    [
      'email_not_verified',
      "Google hasn't verified this email address. Verify it with Google, or sign in with an email link.",
    ],
    [
      'google_email_missing',
      "Your Google account didn't share an email address. Sign in with an email link.",
    ],
    [
      'processing_failed',
      "We couldn't finish signing you in with Google. Try again, or sign in with an email link.",
    ],
  ])('explains ?error=%s', async (code, message) => {
    renderLoginAt(`/login?error=${code}`)

    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it.each(['something_new', 'MAINTENANCE_MODE'])(
    'falls back to the generic message for ?error=%s',
    async (code) => {
      renderLoginAt(`/login?error=${code}`)

      expect(
        await screen.findByText("Sign-in didn't work. Try again, or sign in with an email link.")
      ).toBeInTheDocument()
    }
  )

  it('toasts the Google error once', async () => {
    const toastError = vi.spyOn(toast, 'error')
    serveLinkRequests()
    renderLoginAt('/login?error=google_auth_failed')
    await screen.findByText(/Google sign-in didn't work for this account/)
    // A re-render (the switch to Check your inbox) must not raise it again.
    await requestLink()

    expect(toastError).toHaveBeenCalledTimes(1)
  })
})
