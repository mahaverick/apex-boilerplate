import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { useStepUp } from '@/hooks/use-step-up'
import { apiClient } from '@/http/client'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { REAUTH_REQUIRED } from '@/types/api.types'

// No router is mounted here, and `Link` needs one. The stand-in fills path params as the router would.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Link: ({
    children,
    onClick,
    to,
    params,
  }: {
    children: ReactNode
    onClick?: () => void
    to: string
    params?: Record<string, string>
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [name, value]) => path.replace(`$${name}`, value),
        to
      )}
      onClick={(event) => {
        event.preventDefault()
        onClick?.()
      }}
    >
      {children}
    </a>
  ),
}))

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

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StepUpProvider>
        <Harness />
      </StepUpProvider>
    </QueryClientProvider>
  )
}

/** `/danger` refuses the first `stale` calls with REAUTH_REQUIRED, then succeeds; returns the call log. */
function dangerRoute(stale: number) {
  const calls: string[] = []
  server.use(
    http.post('/api/v1/danger', ({ request }) => {
      calls.push(request.headers.get('authorization') ?? '')
      return calls.length <= stale
        ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        : ok(null, 'Done.')
    })
  )
  return calls
}

describe('useStepUp', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 'old-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('throws outside <StepUpProvider>', () => {
    function Orphan() {
      useStepUp()
      return null
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<Orphan />)).toThrow('useStepUp must be used inside <StepUpProvider>')
    } finally {
      consoleError.mockRestore()
    }
  })

  it('with no dialog open beneath, closing leaves focus to the default: back on what asked', async () => {
    dangerRoute(1)
    const user = userEvent.setup()
    renderHarness()
    const trigger = screen.getByRole('button', { name: 'Do it' })
    await user.click(trigger)
    await screen.findByLabelText('Password')

    await user.keyboard('{Escape}')

    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
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

  it('asks for the password, stores the new token, and retries once with it', async () => {
    const calls = dangerRoute(1)
    let body: unknown
    server.use(
      http.post('/api/v1/auth/reauthenticate', async ({ request }) => {
        body = await request.json()
        return ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      })
    )
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(await screen.findByLabelText('Password'), 'hunter22')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(body).toEqual({ password: 'hunter22' })
    expect(calls).toEqual(['Bearer old-token', 'Bearer stepped-up-token'])
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'stepped-up-token',
      isAuthenticated: true,
    })
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('keeps the dialog open with the error on a wrong password, and stays signed in', async () => {
    const calls = dangerRoute(1)
    let refreshes = 0
    server.use(
      http.post('/api/v1/auth/reauthenticate', () => fail('Incorrect password.', 400)),
      http.post('/api/v1/auth/refresh', () => {
        refreshes += 1
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      })
    )
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    await user.type(await screen.findByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Confirm it’s you' })).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'old-token',
      isAuthenticated: true,
    })
    expect(calls).toHaveLength(1)
    expect(refreshes).toBe(0)
  })

  it('asks for the password before sending anything', async () => {
    let confirms = 0
    dangerRoute(1)
    server.use(
      http.post('/api/v1/auth/reauthenticate', () => {
        confirms += 1
        return ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      })
    )
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    await screen.findByLabelText('Password')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Enter your password.')).toBeInTheDocument()
    expect(confirms).toBe(0)
  })

  it('rejects with the original error when the dialog is dismissed', async () => {
    const calls = dangerRoute(1)
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    await screen.findByRole('dialog', { name: 'Confirm it’s you' })

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
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

  it('retries only once: a second REAUTH_REQUIRED fails instead of looping', async () => {
    const calls = dangerRoute(2)
    server.use(
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      )
    )
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    await user.type(await screen.findByLabelText('Password'), 'hunter22')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    expect(calls).toHaveLength(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens with focus on the Password field, so typing starts at once', async () => {
    dangerRoute(1)
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    const password = await screen.findByLabelText('Password')
    await waitFor(() => expect(password).toHaveFocus())
  })

  it('sends an account without a password to its own user page for a set-password link, and offers no Google path', async () => {
    dangerRoute(1)
    server.use(
      http.get('/api/v1/auth/providers', () =>
        ok(
          {
            providers: [{ provider: 'google', linkedAt: '2026-01-01T00:00:00.000Z' }],
            hasPassword: false,
          },
          'Auth providers retrieved.'
        )
      )
    )
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    expect(
      await screen.findByText(
        'Your account has no password. Open your user page and use Send set-password link, then set a password from the email. Setting it signs you out everywhere, so sign in again before you repeat this action.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Google/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Forgot password/)).not.toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Open your user page' })
    expect(link).toHaveAttribute('href', `/users/${testUser.id}`)
    await user.click(link)
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
  })

  it('offers a retry when the sign-in methods cannot load', async () => {
    dangerRoute(1)
    server.use(http.get('/api/v1/auth/providers', () => fail('Server error', 500)))
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    expect(await screen.findByText('We could not load your sign-in methods.')).toBeInTheDocument()
  })
})
