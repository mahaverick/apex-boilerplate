import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { http } from 'msw'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { useStepUp } from '@/hooks/use-step-up'
import { apiClient } from '@/http/client'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { REAUTH_REQUIRED } from '@/types/api.types'

function apiFailure(status: number, message: string, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError(message, 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, message, statusCode: status, code, requestId: 'r' },
  })
}

function Harness({
  onConfirm,
  confirmText,
  refusalMessage,
}: {
  onConfirm: (reason: string) => Promise<void>
  confirmText?: string
  refusalMessage?: (error: unknown) => string | undefined
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <p>open: {String(open)}</p>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Suspend Acme?"
        description="Members lose access until it is reactivated."
        confirmLabel="Suspend"
        destructive
        confirmText={confirmText}
        refusalMessage={refusalMessage}
        onConfirm={onConfirm}
      />
    </>
  )
}

describe('ReasonDialog', () => {
  it('requires a reason before calling onConfirm', async () => {
    const onConfirm = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)
    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('Enter a reason.')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('refuses a reason over 500 characters', async () => {
    const onConfirm = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)
    await user.click(await screen.findByLabelText('Reason'))
    await user.paste('x'.repeat(501))
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('Reason must be at most 500 characters.')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('passes the trimmed reason and closes once onConfirm resolves', async () => {
    const onConfirm = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)
    await user.type(await screen.findByLabelText('Reason'), '  unpaid invoices  ')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    await waitFor(() => expect(screen.getByText('open: false')).toBeInTheDocument())
    expect(onConfirm).toHaveBeenCalledWith('unpaid invoices')
  })

  it('keeps a multi-line reason: the field is a textarea, as the API allows', async () => {
    const onConfirm = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)
    const field = await screen.findByLabelText('Reason')
    expect(field.tagName).toBe('TEXTAREA')
    await user.type(field, 'line one{Enter}line two')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('line one\nline two'))
  })

  it('requires the typed confirmation to match exactly', async () => {
    const onConfirm = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} confirmText="acme" />)
    await user.type(await screen.findByLabelText('Reason'), 'closed')
    await user.type(screen.getByLabelText('Type acme to confirm'), 'acm')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('Type acme exactly to confirm.')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Type acme to confirm'), 'e')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('closed'))
  })

  it.each([
    [403, 'Only an owner can act on another owner.'],
    [409, 'Tenant is already suspended.'],
  ])('shows a %i message inline and stays open', async (status, message) => {
    const onConfirm = vi.fn(() => Promise.reject(apiFailure(status, message)))
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)
    await user.type(await screen.findByLabelText('Reason'), 'why')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText('open: true')).toBeInTheDocument()
  })

  it('says to confirm identity when step-up was dismissed', async () => {
    const onConfirm = vi.fn(() =>
      Promise.reject(apiFailure(401, 'Recent sign-in required', REAUTH_REQUIRED))
    )
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)
    await user.type(await screen.findByLabelText('Reason'), 'why')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('Confirm it’s you to continue.')).toBeInTheDocument()
  })

  it('says the role can no longer do this on a 404, and stays open', async () => {
    const onConfirm = vi.fn(() => Promise.reject(apiFailure(404, 'Not found')))
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)
    await user.type(await screen.findByLabelText('Reason'), 'why')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(
      await screen.findByText(
        'Your role can’t do this any more. If your access just changed, reload the page.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('open: true')).toBeInTheDocument()
  })

  it('words a 409 its own way when asked, and keeps the server’s sentence otherwise', async () => {
    const onConfirm = vi
      .fn<(reason: string) => Promise<void>>()
      .mockRejectedValueOnce(apiFailure(409, 'Too soon', 'reminded_recently'))
      .mockRejectedValueOnce(apiFailure(409, 'No owner', 'no_owner'))
    const refusalMessage = (error: unknown) =>
      error instanceof AxiosError &&
      (error.response?.data as { code?: string }).code === 'reminded_recently'
        ? 'Try again tomorrow.'
        : undefined
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} refusalMessage={refusalMessage} />)
    await user.type(await screen.findByLabelText('Reason'), 'why')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('Try again tomorrow.')).toBeInTheDocument()
    expect(screen.queryByText('Too soon')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('No owner')).toBeInTheDocument()
    expect(screen.getByText('open: true')).toBeInTheDocument()
  })

  it('shows the server’s own sentence for a 404 that carries a code, and stays open', async () => {
    const onConfirm = vi.fn(() =>
      Promise.reject(apiFailure(404, 'Invitation not found', 'invitation_not_found'))
    )
    const user = userEvent.setup()
    render(<Harness onConfirm={onConfirm} />)
    await user.type(await screen.findByLabelText('Reason'), 'why')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByText('Invitation not found')).toBeInTheDocument()
    expect(screen.queryByText(/Your role can’t do this any more/)).not.toBeInTheDocument()
    expect(screen.getByText('open: true')).toBeInTheDocument()
  })

  it('Escape in the stacked step-up dialog closes only that dialog; the reason survives', async () => {
    useAuthStore.setState({
      accessToken: 'old-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    let dangerCalls = 0
    server.use(
      http.post('/api/v1/danger', () => {
        dangerCalls += 1
        return dangerCalls <= 2
          ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
          : ok(null, 'Done.')
      }),
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      )
    )
    function Stacked() {
      const stepUp = useStepUp()
      return (
        <Harness
          onConfirm={async () => {
            await stepUp.run(() => apiClient.post('/danger', {}))
          }}
        />
      )
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <StepUpProvider>
          <Stacked />
        </StepUpProvider>
      </QueryClientProvider>
    )
    await user.type(await screen.findByLabelText('Reason'), 'unpaid')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    await user.type(await screen.findByLabelText('Password'), 'half-typed')

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Confirm it’s you' })).not.toBeInTheDocument()
    )
    const reason = screen.getByRole('alertdialog', { name: 'Suspend Acme?' })
    expect(within(reason).getByLabelText('Reason')).toHaveValue('unpaid')
    expect(await within(reason).findByText('Confirm it’s you to continue.')).toBeInTheDocument()
    expect(screen.getByText('open: true')).toBeInTheDocument()
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'old-token',
      isAuthenticated: true,
    })

    // Trying again asks afresh; this time the password is confirmed and the action goes through.
    await user.click(within(reason).getByRole('button', { name: 'Suspend' }))
    const password = await screen.findByLabelText('Password')
    expect(password).toHaveValue('')
    await user.type(password, 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.getByText('open: false')).toBeInTheDocument())
    expect(dangerCalls).toBe(3)
    expect(useAuthStore.getState().accessToken).toBe('stepped-up-token')
  })

  it('Escape in the stacked step-up puts focus back inside the still-open reason dialog', async () => {
    useAuthStore.setState({
      accessToken: 'old-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    server.use(
      http.post('/api/v1/danger', () => fail('Recent sign-in required', 401, REAUTH_REQUIRED))
    )
    // Opened from a trigger on the page, as the actions menus open it: that trigger is where focus must not go.
    function Page() {
      const stepUp = useStepUp()
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Actions
          </button>
          <ReasonDialog
            open={open}
            onOpenChange={setOpen}
            title="Suspend Acme?"
            description="Members lose access until it is reactivated."
            confirmLabel="Suspend"
            onConfirm={async () => {
              await stepUp.run(() => apiClient.post('/danger', {}))
            }}
          />
        </>
      )
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <StepUpProvider>
          <Page />
        </StepUpProvider>
      </QueryClientProvider>
    )
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.type(await screen.findByLabelText('Reason'), 'unpaid')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))
    await screen.findByLabelText('Password')

    await user.keyboard('{Escape}')

    const reason = screen.getByRole('alertdialog', { name: 'Suspend Acme?' })
    expect(await within(reason).findByText('Confirm it’s you to continue.')).toBeInTheDocument()
    await waitFor(() => expect(within(reason).getByLabelText('Reason')).toHaveFocus())
  })

  it('the stacked step-up dialog takes the password, confirms, retries, and the reason dialog closes', async () => {
    useAuthStore.setState({
      accessToken: 'old-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    let dangerCalls = 0
    server.use(
      http.post('/api/v1/danger', () => {
        dangerCalls += 1
        return dangerCalls === 1
          ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
          : ok(null, 'Done.')
      }),
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      )
    )
    function Stacked() {
      const stepUp = useStepUp()
      return (
        <Harness
          onConfirm={async () => {
            await stepUp.run(() => apiClient.post('/danger', {}))
          }}
        />
      )
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <StepUpProvider>
          <Stacked />
        </StepUpProvider>
      </QueryClientProvider>
    )
    await user.type(await screen.findByLabelText('Reason'), 'unpaid')
    await user.click(screen.getByRole('button', { name: 'Suspend' }))

    // Focus and typing must reach the dialog stacked over the alert dialog.
    await user.type(await screen.findByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.getByText('open: false')).toBeInTheDocument())
    expect(dangerCalls).toBe(2)
    expect(useAuthStore.getState().accessToken).toBe('stepped-up-token')
  })
})
