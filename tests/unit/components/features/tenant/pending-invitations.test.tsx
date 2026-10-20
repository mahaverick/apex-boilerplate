import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingInvitations } from '@/components/features/tenant/pending-invitations'
import { StepUpContext, type StepUp } from '@/hooks/use-step-up'
import { markRefusedAfterConfirm } from '@/lib/step-up'
import { toast } from '@/lib/toast'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, INVITATION_SENT_MESSAGE, ok, testInvitation } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { REAUTH_REQUIRED, type TenantInvitation } from '@/types/api.types'

const RESEND_URL = '/api/v1/tenants/acme/invitations/:id/resend'
const EMAIL = testInvitation.email

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Serves the list with one invitation whose `resendAvailableAt` is `inMs` from now (or `null`). */
function serveInvitation(inMs: number | null, overrides: Partial<TenantInvitation> = {}) {
  const invitation: TenantInvitation = {
    ...testInvitation,
    lastSentAt: '2026-10-01T00:00:00.000Z',
    resendAvailableAt: inMs === null ? null : new Date(Date.now() + inMs).toISOString(),
    ...overrides,
  }
  server.use(
    http.get('/api/v1/tenants/acme/invitations', () =>
      ok(listPage([invitation]), 'Invitations retrieved.')
    )
  )
}

/** Counts the resend posts and answers them with `answer`. */
function serveResend(answer: () => Response = () => ok(null, INVITATION_SENT_MESSAGE, 202)) {
  const calls = { count: 0 }
  server.use(
    http.post(RESEND_URL, () => {
      calls.count += 1
      return answer()
    })
  )
  return calls
}

/** express's answer to a resend inside the cooldown: 429 with `Retry-After` in seconds. */
function cooldown(seconds: number): Response {
  return HttpResponse.json(
    {
      success: false,
      message: 'Wait before resending.',
      statusCode: 429,
      code: 'invitation_resend_cooldown',
      requestId: 'r',
    },
    { status: 429, headers: { 'Retry-After': String(seconds) } }
  )
}

/** A step-up runner that passes the write straight through. */
const PASS_THROUGH: StepUp['run'] = (action) => action()

/** A step-up runner whose confirmed retry is refused again, as `useStepUp().run` marks it. */
const REFUSED_AFTER_CONFIRM: StepUp['run'] = async (action) => {
  try {
    return await action()
  } catch (error) {
    markRefusedAfterConfirm(error)
    throw error
  }
}

/** Mounts the invitations panel for acme on a router of its own, as `myRole`; `asStaff` asks for a reason. */
function renderPanel(myRole: 'owner' | 'admin' = 'owner', asStaff = false, run = PASS_THROUGH) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <StepUpContext.Provider value={{ run }}>
          <PendingInvitations slug="acme" myRole={myRole} asStaff={asStaff} />
        </StepUpContext.Provider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

const WAITING = `Resend in 4 min, invitation to ${EMAIL}`
const READY = `Resend, invitation to ${EMAIL}`

describe('PendingInvitations resend countdown', () => {
  beforeEach(() => {
    vi.spyOn(toast, 'error')
  })

  it('disables Resend with the minutes left from resendAvailableAt', async () => {
    serveInvitation(4 * 60_000 - 5_000)
    renderPanel()

    const button = await screen.findByRole('button', { name: WAITING })
    expect(button).toHaveTextContent('Resend in 4 min')
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps the disabled Resend focusable and posts nothing when pressed', async () => {
    serveInvitation(4 * 60_000)
    const calls = serveResend()
    const user = userEvent.setup()
    renderPanel()

    const button = await screen.findByRole('button', { name: WAITING })
    button.focus()
    expect(button).toHaveFocus()
    await user.click(button)
    await user.keyboard('{Enter}')

    expect(calls.count).toBe(0)
  })

  it('keeps the countdown text out of any live region', async () => {
    serveInvitation(4 * 60_000)
    renderPanel()

    const button = await screen.findByRole('button', { name: WAITING })
    expect(button.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull()
  })

  it('enables Resend once the time passes, without a refetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(
          listPage([
            {
              ...testInvitation,
              lastSentAt: null,
              resendAvailableAt: new Date(Date.now() + 3_000).toISOString(),
            },
          ]),
          'Invitations retrieved.'
        )
      })
    )
    renderPanel()

    expect(
      await screen.findByRole('button', { name: `Resend in 3 seconds, invitation to ${EMAIL}` })
    ).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100)
    })

    const button = await screen.findByRole('button', { name: READY })
    expect(button).toHaveTextContent('Resend')
    expect(button).not.toHaveAttribute('aria-disabled', 'true')
    expect(listCalls).toBe(1)
  })

  it('counts down from Retry-After after a 429 cooldown', async () => {
    serveInvitation(null)
    serveResend(() => cooldown(300))
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: READY }))

    expect(
      await screen.findByRole('button', { name: `Resend in 5 min, invitation to ${EMAIL}` })
    ).toHaveTextContent('Resend in 5 min')
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Wait before resending.')
    })
  })

  it('treats a null resendAvailableAt as available', async () => {
    serveInvitation(null)
    const calls = serveResend()
    const user = userEvent.setup()
    renderPanel()

    const button = await screen.findByRole('button', { name: READY })
    expect(button).toHaveTextContent('Resend')
    expect(button).not.toHaveTextContent('NaN')
    await user.click(button)

    await waitFor(() => {
      expect(calls.count).toBe(1)
    })
  })

  it('shows the server message for a non-cooldown refusal and starts no countdown', async () => {
    serveInvitation(null)
    serveResend(() => fail('You cannot manage an invitation for that role.', 403))
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: READY }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('You cannot manage an invitation for that role.')
    })
    expect(screen.getByRole('button', { name: READY })).toBeInTheDocument()
  })

  it.each([
    [61_000, `Resend in 2 min, invitation to ${EMAIL}`, 'Resend in 2 min'],
    [59_000, `Resend in 59 seconds, invitation to ${EMAIL}`, 'Resend in 59 seconds'],
    [1_000, `Resend in 1 second, invitation to ${EMAIL}`, 'Resend in 1 second'],
  ])('reads %s ms left as "%s"', async (inMs, name, text) => {
    serveInvitation(inMs - 200)
    renderPanel()

    expect(await screen.findByRole('button', { name })).toHaveTextContent(text)
  })

  it('keeps the grant-rule reason over the countdown and holds no timer', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    serveInvitation(4 * 60_000, { role: 'owner' })
    renderPanel('admin')

    const button = await screen.findByRole('button', { name: READY })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Resend')
    expect(button).not.toHaveTextContent('Resend in')
    expect(button).toHaveAccessibleDescription(
      'Only an owner can resend or revoke an invitation for this role.'
    )
    expect(interval).not.toHaveBeenCalledWith(expect.any(Function), 1_000)
  })

  it('stays disabled from the resend until the refetched list lands', async () => {
    let posted = false
    let released = false
    server.use(
      http.get('/api/v1/tenants/acme/invitations', async () => {
        if (posted) await vi.waitFor(() => expect(released).toBe(true))
        return ok(
          listPage([
            {
              ...testInvitation,
              lastSentAt: null,
              resendAvailableAt: posted ? new Date(Date.now() + 10 * 60_000).toISOString() : null,
            },
          ]),
          'Invitations retrieved.'
        )
      }),
      http.post(RESEND_URL, () => {
        posted = true
        return ok(null, INVITATION_SENT_MESSAGE, 202)
      })
    )
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: READY }))

    // The POST is answered; the refetch is held, and the mutation stays pending on it.
    await waitFor(() => {
      expect(posted).toBe(true)
    })
    expect(screen.getByRole('button', { name: READY })).toHaveAttribute('aria-disabled', 'true')
    released = true
    expect(
      await screen.findByRole('button', { name: `Resend in 10 min, invitation to ${EMAIL}` })
    ).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('PendingInvitations resend countdown on the staff row', () => {
  beforeEach(() => {
    vi.spyOn(toast, 'error')
  })

  it('counts down on the staff row too, and never opens the reason dialog', async () => {
    serveInvitation(4 * 60_000 - 5_000)
    const calls = serveResend()
    const user = userEvent.setup()
    renderPanel('owner', true)

    const button = await screen.findByRole('button', { name: WAITING })
    expect(button).toHaveTextContent('Resend in 4 min')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    button.focus()
    expect(button).toHaveFocus()
    await user.click(button)
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls.count).toBe(0)
  })

  it('opens the reason dialog when no cooldown runs', async () => {
    serveInvitation(null)
    const user = userEvent.setup()
    renderPanel('owner', true)

    await user.click(await screen.findByRole('button', { name: READY }))

    expect(
      await screen.findByRole('alertdialog', { name: 'Resend this invitation?' })
    ).toBeVisible()
  })

  it('shows a 429 in the dialog, then counts down from Retry-After', async () => {
    serveInvitation(null)
    serveResend(() => cooldown(300))
    const user = userEvent.setup()
    renderPanel('owner', true)

    await user.click(await screen.findByRole('button', { name: READY }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Resend this invitation?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Lost the first mail')
    await user.click(within(dialog).getByRole('button', { name: 'Resend' }))

    expect(await within(dialog).findByText('Wait before resending.')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(
      await screen.findByRole('button', { name: `Resend in 5 min, invitation to ${EMAIL}` })
    ).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('PendingInvitations after a confirmed retry is refused again', () => {
  const NOT_CONFIRMED = 'We couldn’t confirm it’s you. Try the action again.'
  /** express's answer to a write whose sign-in is too old. */
  const reauth = () => fail("Confirm it's you to continue.", 401, REAUTH_REQUIRED)

  it('says the confirmation did not take on Resend', async () => {
    const toastError = vi.spyOn(toast, 'error')
    serveInvitation(null)
    serveResend(reauth)
    const user = userEvent.setup()
    renderPanel('owner', false, REFUSED_AFTER_CONFIRM)
    await user.click(await screen.findByRole('button', { name: READY }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(NOT_CONFIRMED))
  })

  it('says the confirmation did not take on Revoke', async () => {
    const toastError = vi.spyOn(toast, 'error')
    serveInvitation(null)
    server.use(http.delete('/api/v1/tenants/acme/invitations/:id', reauth))
    const user = userEvent.setup()
    renderPanel('owner', false, REFUSED_AFTER_CONFIRM)
    await user.click(await screen.findByRole('button', { name: `Revoke invitation to ${EMAIL}` }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(NOT_CONFIRMED))
  })
})
