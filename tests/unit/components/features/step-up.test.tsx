import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { GOOGLE_STEP_UP_PATH } from '@/constants/routes'
import { useStepUp } from '@/hooks/use-step-up'
import { apiClient } from '@/http/client'
import { resetSessionForTests } from '@/http/session'
import { STEP_UP_WAIT_LOCK } from '@/lib/step-up-presence'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { freshlyConfirmedToken, testJwt } from '@/tests/mocks/jwt'
import { server } from '@/tests/mocks/server'
import { STEP_UP_EMAIL_WAIT } from '@/tests/mocks/step-up'
import { removeWebLocks, stubWebLocks } from '@/tests/mocks/web-locks'
import { REAUTH_REQUIRED } from '@/types/api.types'

const DIALOG = 'Confirm it’s you'
const CHOOSE_BODY =
  'This action needs you to confirm it’s you within the last 10 minutes. Choose how to confirm it’s you.'
const GOOGLE_WAIT =
  'Finish in the Google window. This dialog continues on its own when you’re done.'
const EXPIRED = 'That link expired. Send a new link to continue.'
const RESUME_FAILED =
  'You confirmed, but we couldn’t reach Apex. Check your connection, then select Try again.'

/** Every event the server and the popup saw, in order, so a test can assert what ran first. */
let events: string[] = []

/** Runs one guarded request through `useStepUp` and prints how it ended. */
function Harness() {
  const stepUp = useStepUp()
  const [outcome, setOutcome] = useState('idle')
  return (
    <>
      <button
        type="button"
        onClick={() => {
          stepUp
            .run(() => apiClient.post('/danger', { reason: 'r' }))
            .then(
              () => setOutcome('done'),
              () => setOutcome('failed')
            )
        }}
      >
        Do it
      </button>
      <p>outcome: {outcome}</p>
    </>
  )
}

/** Mounts `Harness` inside `StepUpProvider` with a query client that does not retry. */
function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StepUpProvider>
        <Harness />
      </StepUpProvider>
    </QueryClientProvider>
  )
}

/** `/danger` refuses the first `stale` calls with REAUTH_REQUIRED, then succeeds; returns the bearers it saw. */
function dangerRoute(stale: number) {
  const calls: string[] = []
  server.use(
    http.post('/api/v1/danger', ({ request }) => {
      calls.push(request.headers.get('authorization') ?? '')
      events.push('action')
      return calls.length <= stale
        ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        : ok(null, 'Done.')
    })
  )
  return calls
}

/** The step-up link request: answers 202 one minute out by default, and records each body. */
function linkRoute(answer?: () => Response) {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/v1/auth/step-up/link/request', async ({ request }) => {
      bodies.push(await request.json())
      events.push('link')
      return (
        answer?.() ??
        ok(
          { resendAvailableAt: new Date(Date.now() + 60_000).toISOString() },
          'Check your inbox for a confirmation link.',
          202
        )
      )
    })
  )
  return bodies
}

/** The refresh after a confirmation: a token minted by `mint`, recorded in `events`. */
function refreshRoute(mint: () => Response = () => ok({ accessToken: freshlyConfirmedToken() })) {
  server.use(
    http.post('/api/v1/auth/refresh', () => {
      events.push('refresh')
      return mint()
    })
  )
}

/** A 429 as express sends it, with `Retry-After` in seconds. */
function tooMany(message: string, code: string, seconds: number) {
  return HttpResponse.json(
    { success: false, message, statusCode: 429, code, requestId: 'r' },
    { status: 429, headers: { 'Retry-After': String(seconds) } }
  )
}

/** Serves the caller's sign-in methods with Google linked. */
function withGoogle() {
  server.use(
    http.get('/api/v1/auth/providers', () =>
      ok(
        {
          providers: [
            { provider: 'email', linkedAt: '2026-01-01T00:00:00.000Z' },
            { provider: 'google', linkedAt: '2026-01-02T00:00:00.000Z' },
          ],
        },
        'Auth providers retrieved.'
      )
    )
  )
}

/** A stand-in popup: jsdom's `window.open` is not implemented. */
function stubPopup(blocked = false) {
  const popup = { location: { assign: vi.fn() }, close: vi.fn(), closed: false }
  const open = vi.spyOn(window, 'open').mockImplementation(() => {
    events.push('open')
    return blocked ? null : (popup as unknown as Window)
  })
  return { popup, open }
}

/** Channels standing in for the confirm tab; closed after each test. */
let otherTabs: BroadcastChannel[] = []

/** Posts `step_up_confirmed` from another tab, as `/auth/confirm` does. */
function confirmFromAnotherTab() {
  const tab = new BroadcastChannel('auth')
  otherTabs.push(tab)
  tab.postMessage({ type: 'step_up_confirmed' })
}

/** Opens the dialog over the guarded action and returns it. */
async function openStepUp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Do it' }))
  return screen.findByRole('dialog', { name: DIALOG })
}

/** Opens the dialog and sends a link, then returns the dialog in its wait view. */
async function sendLink(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openStepUp(user)
  await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
  await within(dialog).findByText(STEP_UP_EMAIL_WAIT)
  return dialog
}

/** Whether the step-up wait lock is held on the stubbed lock manager. */
function holdsWaitLock(locks: ReturnType<typeof stubWebLocks>) {
  return locks.held.some((lock) => lock.name === STEP_UP_WAIT_LOCK)
}

beforeEach(() => {
  events = []
  resetSessionForTests()
  useAuthStore.setState({
    accessToken: 'old-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

afterEach(() => {
  for (const tab of otherTabs) tab.close()
  otherTabs = []
  removeWebLocks()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useStepUp', () => {
  it('throws outside <StepUpProvider>', () => {
    /** Calls the hook with no provider above it. */
    function Orphan() {
      useStepUp()
      return null
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Orphan />)).toThrow('useStepUp must be used inside <StepUpProvider>')
    consoleError.mockRestore()
  })

  it('runs the action straight through when no step-up is needed', async () => {
    const calls = dangerRoute(0)
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rejects any other failure unchanged, without asking', async () => {
    let calls = 0
    server.use(
      http.post('/api/v1/danger', () => {
        calls += 1
        return fail('Tenant is already suspended.', 409)
      })
    )
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    expect(calls).toBe(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('retries without asking when another confirmation already swapped a fresher token in', async () => {
    const calls: string[] = []
    server.use(
      http.post('/api/v1/danger', ({ request }) => {
        calls.push(request.headers.get('authorization') ?? '')
        if (calls.length === 1) {
          // Another action's confirmation lands while this request is in flight.
          useAuthStore.getState().setToken('newer-token')
          return fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        }
        return ok(null, 'Done.')
      })
    )
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(calls).toEqual(['Bearer old-token', 'Bearer newer-token'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('StepUpDialog: choose', () => {
  it('opens Confirm it’s you on REAUTH_REQUIRED with the email option, and Google only when linked', async () => {
    dangerRoute(1)
    const user = userEvent.setup()
    const { unmount } = renderHarness()
    const dialog = await openStepUp(user)
    expect(within(dialog).getByText(CHOOSE_BODY)).toBeInTheDocument()
    const email = within(dialog).getByRole('button', { name: 'Email me a link' })
    await waitFor(() => expect(email).toHaveFocus())
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    // The default providers list only email: wait for them, then look for Google.
    await settle(50, 'the providers read settles with no element to wait on')
    expect(
      within(dialog).queryByRole('button', { name: 'Re-confirm with Google' })
    ).not.toBeInTheDocument()
    unmount()

    dangerRoute(1)
    withGoogle()
    renderHarness()
    const linked = await openStepUp(user)
    expect(
      await within(linked).findByRole('button', { name: 'Re-confirm with Google' })
    ).toBeInTheDocument()
  })

  it('shows the email choice at once while the sign-in methods load, and no error when they fail', async () => {
    dangerRoute(1)
    server.use(http.get('/api/v1/auth/providers', () => new Promise<Response>(() => {})))
    const user = userEvent.setup()
    const { unmount } = renderHarness()
    const loading = await openStepUp(user)
    expect(within(loading).getByRole('button', { name: 'Email me a link' })).toBeInTheDocument()
    expect(within(loading).queryByRole('button', { name: /Google/ })).not.toBeInTheDocument()
    unmount()

    dangerRoute(1)
    let reads = 0
    server.use(
      http.get('/api/v1/auth/providers', () => {
        reads += 1
        return fail('Server error', 500)
      })
    )
    renderHarness()
    const failed = await openStepUp(user)
    await waitFor(() => expect(reads).toBeGreaterThan(0))
    await settle(50, 'the failed providers read renders nothing to wait on')
    expect(within(failed).getByRole('button', { name: 'Email me a link' })).toBeInTheDocument()
    expect(within(failed).queryByRole('button', { name: /Google/ })).not.toBeInTheDocument()
    expect(within(failed).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('with no dialog open beneath, Escape in the choices dismisses and focus goes back to what asked', async () => {
    dangerRoute(1)
    const user = userEvent.setup()
    renderHarness()
    const trigger = screen.getByRole('button', { name: 'Do it' })
    await openStepUp(user)
    await user.keyboard('{Escape}')
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('says the role changed on a 404 from the link request, and stays on the choices', async () => {
    dangerRoute(1)
    linkRoute(() => fail('Not found', 404))
    const user = userEvent.setup()
    renderHarness()
    const dialog = await openStepUp(user)
    await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Your role can’t do this any more. If your access just changed, reload the page.'
    )
    expect(within(dialog).getByText(CHOOSE_BODY)).toBeInTheDocument()
  })

  it('shows a rate limit on the choices with the server’s words', async () => {
    dangerRoute(1)
    linkRoute(() => tooMany('Too many attempts. Try again in 5 minutes.', 'RATE_LIMITED', 300))
    const user = userEvent.setup()
    renderHarness()
    const dialog = await openStepUp(user)
    await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 5 minutes.'
    )
    expect(within(dialog).queryByText(STEP_UP_EMAIL_WAIT)).not.toBeInTheDocument()
  })
})

describe('StepUpDialog: email', () => {
  it('sends a link and shows the wait with a live resend countdown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    const bodies = linkRoute()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await sendLink(user)

    expect(bodies).toEqual([{}])
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      `We sent the link to ${testUser.email}. It expires in 15 minutes.`
    )
    expect(within(dialog).getByRole('button', { name: 'Resend in 1:00' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(within(dialog).getByRole('button', { name: 'Resend in 0:59' })).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(59_000))
    await user.click(within(dialog).getByRole('button', { name: 'Resend link' }))
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    await vi.waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Resend in 1:00' })).toBeInTheDocument()
    )
  })

  it('moves focus to Resend once the link is sent, so the keyboard is not stranded', async () => {
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /^Resend in/ })).toHaveFocus()
    )
  })

  it('keeps the email view and counts from Retry-After on a 429 STEP_UP_LINK_COOLDOWN', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    linkRoute(() =>
      tooMany(
        'Check your inbox for the link we sent. You can ask for another in 42 seconds.',
        'STEP_UP_LINK_COOLDOWN',
        42
      )
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await sendLink(user)
    expect(within(dialog).getByRole('button', { name: 'Resend in 0:42' })).toBeInTheDocument()
  })

  it('raises the resend wait and toasts on a rate limit while waiting, and stays in the wait', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    let refuse = false
    linkRoute(() =>
      refuse
        ? tooMany('Too many attempts. Try again in 2 minutes.', 'RATE_LIMITED', 120)
        : ok(
            { resendAvailableAt: new Date(Date.now() + 60_000).toISOString() },
            'Check your inbox for a confirmation link.',
            202
          )
    )
    const error = vi.spyOn(toast, 'error')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await sendLink(user)
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    refuse = true
    await user.click(within(dialog).getByRole('button', { name: 'Resend link' }))
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('Too many attempts. Try again in 2 minutes.')
    )
    expect(within(dialog).getByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Resend in 2:00' })).toBeInTheDocument()
  })

  it('says the link expired after 15 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await sendLink(user)
    await act(() => vi.advanceTimersByTimeAsync(15 * 60_000 - 1_000))
    expect(within(dialog).queryByText(EXPIRED)).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(within(dialog).getByText(EXPIRED)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Resend link' })).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()
  })

  it('refreshes, then retries the action once, on step_up_confirmed', async () => {
    const calls = dangerRoute(1)
    linkRoute()
    refreshRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)

    confirmFromAnotherTab()

    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(events).toEqual(['action', 'link', 'refresh', 'action'])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toBe(`Bearer ${useAuthStore.getState().accessToken}`)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('stays open with Try again when the refresh fails', async () => {
    dangerRoute(1)
    linkRoute()
    let refuse = true
    refreshRoute(() =>
      refuse ? fail('Service unavailable', 503) : ok({ accessToken: freshlyConfirmedToken() })
    )
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)

    confirmFromAnotherTab()

    expect(await within(dialog).findByText(RESUME_FAILED)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()
    expect(events).toEqual(['action', 'link', 'refresh'])
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    refuse = false
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(events).toEqual(['action', 'link', 'refresh', 'refresh', 'action'])
  })

  it('sends a tab whose refresh is refused to /login', async () => {
    dangerRoute(1)
    linkRoute()
    refreshRoute(() => fail('Session ended', 401, 'ACCESS_TOKEN_EXPIRED'))
    const assign = vi.fn()
    const { origin, protocol, host, hostname, port } = window.location
    const user = userEvent.setup()
    renderHarness()
    await sendLink(user)
    // jsdom's Location accessors live on the prototype, so a spread copies none of them.
    vi.stubGlobal('location', {
      origin,
      protocol,
      host,
      hostname,
      port,
      href: `${origin}/tenants`,
      pathname: '/tenants',
      search: '',
      hash: '',
      assign,
    })

    confirmFromAnotherTab()

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login?redirect=%2Ftenants'))
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(events).toEqual(['action', 'link', 'refresh'])
  })

  it('ignores a step_up_confirmed whose refresh brings no new auth_time', async () => {
    const signedInAt = 1_760_000_000
    useAuthStore.setState({ accessToken: testJwt({ auth_time: signedInAt }) })
    dangerRoute(1)
    linkRoute()
    refreshRoute(() => ok({ accessToken: testJwt({ auth_time: signedInAt }) }))
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)

    confirmFromAnotherTab()

    await waitFor(() => expect(events).toEqual(['action', 'link', 'refresh']))
    expect(await within(dialog).findByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()

    refreshRoute(() => ok({ accessToken: testJwt({ auth_time: signedInAt + 900 }) }))
    confirmFromAnotherTab()
    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
  })

  it('keeps waiting when the confirm page posted nothing', async () => {
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)
    await settle(100, 'no message arrives: absence has no event to wait on')
    expect(within(dialog).getByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()
    expect(events).toEqual(['action', 'link'])
  })

  it('ignores Escape while waiting and dismisses only on Cancel', async () => {
    const calls = dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)

    await user.keyboard('{Escape}')
    expect(within(dialog).getByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })

  it('retries only once: a second REAUTH_REQUIRED fails instead of reopening', async () => {
    const calls = dangerRoute(2)
    linkRoute()
    refreshRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)
    confirmFromAnotherTab()
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    expect(calls).toHaveLength(2)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('StepUpDialog: Google', () => {
  it('opens the popup in the click, then points it at the Google step-up after the start', async () => {
    dangerRoute(1)
    withGoogle()
    const { popup, open } = stubPopup()
    let body: unknown
    server.use(
      http.post('/api/v1/auth/step-up/google/start', async ({ request }) => {
        body = await request.json()
        events.push('start')
        return new HttpResponse(null, { status: 204 })
      })
    )
    const user = userEvent.setup()
    renderHarness()
    const dialog = await openStepUp(user)
    await user.click(await within(dialog).findByRole('button', { name: 'Re-confirm with Google' }))

    expect(await within(dialog).findByText(GOOGLE_WAIT)).toBeInTheDocument()
    expect(open).toHaveBeenCalledWith('about:blank', 'apex-step-up', 'popup,width=520,height=640')
    expect(events).toEqual(['action', 'open', 'start'])
    expect(body).toEqual({})
    expect(popup.location.assign).toHaveBeenCalledWith(
      `${window.location.origin}/api/v1/auth/step-up/google`
    )
    expect(popup.location.assign).toHaveBeenCalledWith(
      new URL(GOOGLE_STEP_UP_PATH, window.location.origin).href
    )
    expect(
      within(dialog).getByRole('button', { name: 'Re-confirm with Google' })
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Email me a link instead' })
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(within(dialog).getByText(GOOGLE_WAIT)).toBeInTheDocument()
  })

  it.each([
    ['blocked', 'Allow pop-ups, or use the email link'],
    [409, 'Your account has no linked Google account. Confirm by email instead.'],
    [404, 'Google confirmation isn’t available. Use the email link.'],
  ] as const)('falls back to the email link when Google is %s', async (refusal, notice) => {
    dangerRoute(1)
    withGoogle()
    const bodies = linkRoute()
    const { popup, open } = stubPopup(refusal === 'blocked')
    let starts = 0
    server.use(
      http.post('/api/v1/auth/step-up/google/start', () => {
        starts += 1
        return refusal === 409
          ? fail(notice, 409, 'google_not_linked')
          : fail('Route not found', 404)
      })
    )
    const user = userEvent.setup()
    renderHarness()
    const dialog = await openStepUp(user)
    await user.click(await within(dialog).findByRole('button', { name: 'Re-confirm with Google' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(notice)
    expect(open).toHaveBeenCalledTimes(1)
    if (refusal === 'blocked') {
      expect(starts).toBe(0)
    } else {
      expect(starts).toBe(1)
      expect(popup.close).toHaveBeenCalled()
      expect(popup.location.assign).not.toHaveBeenCalled()
    }
    expect(within(dialog).getByText(CHOOSE_BODY)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
    expect(await within(dialog).findByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(bodies).toEqual([{}])
  })

  it('returns to the choices after 5 minutes of waiting on Google', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    withGoogle()
    stubPopup()
    server.use(
      http.post('/api/v1/auth/step-up/google/start', () => new HttpResponse(null, { status: 204 }))
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await openStepUp(user)
    await user.click(await within(dialog).findByRole('button', { name: 'Re-confirm with Google' }))
    await within(dialog).findByText(GOOGLE_WAIT)

    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000 - 1_000))
    expect(within(dialog).getByText(GOOGLE_WAIT)).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The Google window expired after 5 minutes. Try again, or use the email link.'
    )
    expect(within(dialog).getByText(CHOOSE_BODY)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()
  })

  it('confirms through Google the same way: refresh, then the retry', async () => {
    const calls = dangerRoute(1)
    withGoogle()
    stubPopup()
    refreshRoute()
    server.use(
      http.post('/api/v1/auth/step-up/google/start', () => new HttpResponse(null, { status: 204 }))
    )
    const user = userEvent.setup()
    renderHarness()
    const dialog = await openStepUp(user)
    await user.click(await within(dialog).findByRole('button', { name: 'Re-confirm with Google' }))
    await within(dialog).findByText(GOOGLE_WAIT)

    confirmFromAnotherTab()

    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(calls).toHaveLength(2)
  })
})

describe('StepUpDialog: the wait lock', () => {
  it('holds the wait lock while waiting and releases it on finish', async () => {
    const locks = stubWebLocks()
    dangerRoute(1)
    linkRoute()
    refreshRoute()
    const user = userEvent.setup()
    renderHarness()
    await openStepUp(user)
    expect(holdsWaitLock(locks)).toBe(false)

    const dialog = screen.getByRole('dialog', { name: DIALOG })
    await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
    await within(dialog).findByText(STEP_UP_EMAIL_WAIT)
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(true))
    expect(locks.requests).toContainEqual({ name: STEP_UP_WAIT_LOCK, mode: 'shared' })

    confirmFromAnotherTab()

    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(false))
  })

  it('releases the wait lock on Cancel', async () => {
    const locks = stubWebLocks()
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(true))
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(false))
  })

  it('releases the wait lock on unmount', async () => {
    const locks = stubWebLocks()
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    const { unmount } = renderHarness()
    await sendLink(user)
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(true))
    unmount()
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(false))
  })
})
