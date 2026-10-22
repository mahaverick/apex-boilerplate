import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { useStepUp } from '@/hooks/use-step-up'
import { apiClient } from '@/http/client'
import { ROLE_DENIED_ACTION } from '@/lib/staff-message'
import { requestPasskey } from '@/lib/webauthn'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { REAUTH_REQUIRED } from '@/types/api.types'

// The browser prompt is not under test; `passkeyFailure` and the rest stay real.
vi.mock('@/lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webauthn')>()),
  requestPasskey: vi.fn(),
}))

const DIALOG = 'Confirm it’s you'
const OPTIONS = { challenge: 'CHALLENGE', rpId: 'localhost', timeout: 60_000 }
const RESPONSE = { id: 'CRED', rawId: 'CRED', type: 'public-key', response: {} }

/** A client that does not retry, around `StepUpProvider`. */
function withProvider(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StepUpProvider>{children}</StepUpProvider>
    </QueryClientProvider>
  )
}

/** A button whose write needs a recent sign-in. */
function Trigger() {
  const stepUp = useStepUp()
  return (
    <button
      type="button"
      onClick={() => void stepUp.run(() => apiClient.post('/danger', {})).catch(() => {})}
    >
      Do it
    </button>
  )
}

/** A reason dialog, open, whose confirm sends the typed reason through `useStepUp().run`. */
function ReasonHarness() {
  const stepUp = useStepUp()
  const [open, setOpen] = useState(true)
  return (
    <ReasonDialog
      open={open}
      onOpenChange={setOpen}
      title="Suspend Acme?"
      description="Members lose access until it is reactivated."
      confirmLabel="Suspend"
      onConfirm={async (reason) => {
        await stepUp.run(() => apiClient.post('/danger', { reason }))
      }}
    />
  )
}

beforeEach(() => {
  vi.mocked(requestPasskey).mockReset()
  useAuthStore.setState({
    accessToken: 'old-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

describe('Confirm it’s you, as apex words it', () => {
  it('a not_found 404 on the link request shows ROLE_DENIED_ACTION', async () => {
    server.use(
      http.post('/api/v1/danger', () => fail('Recent sign-in required', 401, REAUTH_REQUIRED)),
      http.post('/api/v1/auth/step-up/link/request', () =>
        fail('No route matches this method and path. Check both, then try again.', 404, 'not_found')
      )
    )
    const user = userEvent.setup()
    withProvider(<Trigger />)
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    const dialog = await screen.findByRole('dialog', { name: DIALOG })
    await user.click(await within(dialog).findByRole('button', { name: 'Email me a link' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(ROLE_DENIED_ACTION)
  })

  it('a passkey confirmation over the reason dialog returns focus to its field and retries with the reason', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/danger', async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
          : fail('Tenant is already suspended.', 409, 'already_suspended')
      }),
      http.post('/api/v1/auth/passkeys/step-up/options', () =>
        ok({ challengeId: 'C1', options: OPTIONS }, 'Options.')
      ),
      http.post('/api/v1/auth/passkeys/step-up/verify', () =>
        ok({ accessToken: 'fresh-token' }, 'Confirmed.')
      )
    )
    vi.mocked(requestPasskey).mockResolvedValue(RESPONSE as never)
    const user = userEvent.setup()
    withProvider(<ReasonHarness />)
    await user.type(await screen.findByLabelText('Reason'), 'unpaid')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))

    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies).toEqual([{ reason: 'unpaid' }, { reason: 'unpaid' }])
    const reason = screen.getByRole('alertdialog', { name: 'Suspend Acme?' })
    expect(await within(reason).findByText('Tenant is already suspended.')).toBeInTheDocument()
    await waitFor(() => expect(within(reason).getByLabelText('Reason')).toHaveFocus())
    expect(reason).toContainElement(document.activeElement as HTMLElement)
  })
})
