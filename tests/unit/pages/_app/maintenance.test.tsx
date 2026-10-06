import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { STAFF_WRITES_NOTE } from '@/constants/maintenance-mode.constants'
import { maintenanceModeKeys } from '@/queries/maintenance-mode.queries'
import { queryClient } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import { fullMaintenanceView, maintenanceModeView } from '@/tests/fixtures/maintenance-mode'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { REAUTH_REQUIRED, type PlatformMaintenanceModeView } from '@/types/api.types'

/**
 * Serves the platform GET from `state.view` and answers each PUT with
 * `answer(body, n)` (n counts from 1); records every body sent.
 */
function serve(
  initial: PlatformMaintenanceModeView,
  answer: (body: Record<string, unknown>, n: number) => Response = (body) =>
    ok({ ...initial, ...body, version: initial.version + 1 }, 'Maintenance mode updated.')
) {
  const state = { view: initial, bodies: [] as Record<string, unknown>[] }
  server.use(
    http.get('/api/v1/platform/maintenance-mode', () =>
      ok(state.view, 'Maintenance mode retrieved.')
    ),
    http.put('/api/v1/platform/maintenance-mode', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      state.bodies.push(body)
      return answer(body, state.bodies.length)
    }),
    http.post('/api/v1/auth/reauthenticate', () =>
      ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
    )
  )
  return state
}

function signInAs(platformRole: 'owner' | 'admin' | 'viewer') {
  signIn({ ...testUser, platformRole })
}

async function openPage() {
  const user = userEvent.setup()
  renderAppAt('/maintenance')
  await screen.findByRole('region', { name: 'Customer access' })
  return user
}

describe('/maintenance', () => {
  beforeEach(() => {
    signInAs('owner')
  })

  it('shows the state, who set it, why, the customer message and every queue', async () => {
    serve(fullMaintenanceView())
    await openPage()
    expect(screen.getByRole('heading', { name: 'Maintenance', level: 1 })).toBeVisible()
    const state = screen.getByRole('region', { name: 'Customer access' })
    expect(within(state).getByText('Full')).toHaveAttribute('data-tone', 'destructive')
    expect(within(state).getByText('Sam Staff')).toBeInTheDocument()
    expect(within(state).getByText('Postgres 18 upgrade')).toBeInTheDocument()
    expect(
      within(state).getByText(
        (_, element) =>
          element?.textContent === 'We are upgrading the database.\nBack by 11:00 UTC.' &&
          element.tagName === 'SPAN'
      )
    ).toBeInTheDocument()
    expect(within(state).getByText(STAFF_WRITES_NOTE)).toBeInTheDocument()
    const queues = within(screen.getByRole('list', { name: 'Queues' })).getAllByRole('listitem')
    expect(queues.map((item) => item.textContent)).toEqual([
      'email: paused, 0 running',
      'notification: paused, 0 running',
      'maintenance: paused, 0 running',
      'analytics: paused, 1 running',
    ])
  })

  it.each(['admin', 'viewer'] as const)('gives an %s the state but no controls', async (role) => {
    signInAs(role)
    serve(fullMaintenanceView())
    await openPage()
    expect(screen.getByText('Only a platform owner can change maintenance mode.')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /Turn off|Turn on|Edit message|Switch to/ })
    ).toBeNull()
  })

  it('gives an owner the moves each mode allows', async () => {
    serve(maintenanceModeView())
    await openPage()
    expect(
      screen.getAllByRole('button', { name: /…$/ }).map((button) => button.textContent)
    ).toEqual(['Turn on maintenance…'])
  })

  it('shows RoleDenied when the API refuses the role', async () => {
    server.use(http.get('/api/v1/platform/maintenance-mode', () => fail('Not found', 404)))
    renderAppAt('/maintenance')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeVisible()
  })

  it('switches on through the guard: mode, message with preview, reason, typed environment, step-up', async () => {
    const state = serve(maintenanceModeView(), (body, n) =>
      n === 1
        ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        : ok(
            fullMaintenanceView({ message: String(body.message), reason: 'DB upgrade' }),
            'Updated.'
          )
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn on maintenance…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn on maintenance' })

    await user.click(within(dialog).getByRole('radio', { name: /^Full/ }))
    await user.type(within(dialog).getByLabelText('Message for customers'), 'Back by 11:00 UTC.')
    const preview = within(dialog).getByRole('region', { name: 'Customer preview' })
    expect(within(preview).getByText('Back by 11:00 UTC.')).toBeVisible()
    expect(within(preview).getByText('This page will refresh when we’re back.')).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: 'Switch to full' }))
    expect(await within(dialog).findByText('Enter a reason.')).toBeVisible()
    expect(within(dialog).getByText('Type staging exactly to confirm.')).toBeVisible()
    expect(state.bodies).toEqual([])

    await user.type(within(dialog).getByLabelText('Reason'), 'DB upgrade')
    await user.type(within(dialog).getByLabelText('Type staging to confirm'), 'staging')
    await user.click(within(dialog).getByRole('button', { name: 'Switch to full' }))

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(stepUp).getByLabelText('Password'), 'hunter22')
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Maintenance is now full.')).toBeInTheDocument()
    const sent = {
      mode: 'full',
      message: 'Back by 11:00 UTC.',
      expectedVersion: 4,
      reason: 'DB upgrade',
      confirm: 'staging',
    }
    expect(state.bodies).toEqual([sent, sent])
    expect(useAuthStore.getState().accessToken).toBe('stepped-up-token')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Turn on maintenance' })).toBeNull()
    )
  })

  it('previews the banner for read-only', async () => {
    serve(maintenanceModeView())
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn on maintenance…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn on maintenance' })
    expect(within(dialog).getByRole('radio', { name: /^Read-only/ })).toBeChecked()
    const preview = within(dialog).getByRole('region', { name: 'Customer preview' })
    expect(within(preview).getByText('Customers see this banner on every page:')).toBeVisible()
    expect(within(preview).getByText('Your message appears here.')).toBeVisible()
  })

  it('shows the server’s confirmation refusal on the confirm field', async () => {
    serve(maintenanceModeView(), () =>
      fail('confirm must equal this environment', 400, 'CONFIRMATION_MISMATCH')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn on maintenance…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn on maintenance' })
    await user.type(within(dialog).getByLabelText('Message for customers'), 'Back soon.')
    await user.type(within(dialog).getByLabelText('Reason'), 'DB upgrade')
    await user.type(within(dialog).getByLabelText('Type staging to confirm'), 'staging')
    await user.click(within(dialog).getByRole('button', { name: 'Switch to read-only' }))
    expect(await within(dialog).findByText('confirm must equal this environment')).toBeVisible()
  })

  it('eases full to read-only without a reason or a typed environment', async () => {
    const state = serve(fullMaintenanceView(), (body) =>
      ok(
        fullMaintenanceView({ mode: 'read_only', message: String(body.message), version: 6 }),
        'Updated.'
      )
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Switch to read-only…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Switch to read-only maintenance' })
    expect(within(dialog).queryByLabelText(/to confirm$/)).toBeNull()
    // Not a switch-on: the reason now saved is pre-filled, and the hint says so.
    expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue('Postgres 18 upgrade')
    expect(within(dialog).getByText(/It starts as the reason now saved\./)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Message for customers')).toHaveValue(
      'We are upgrading the database.\nBack by 11:00 UTC.'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Switch to read-only' }))
    expect(await screen.findByText('Maintenance is now read-only.')).toBeInTheDocument()
    expect(state.bodies).toEqual([
      {
        mode: 'read_only',
        message: 'We are upgrading the database.\nBack by 11:00 UTC.',
        reason: 'Postgres 18 upgrade',
        expectedVersion: 5,
      },
    ])
  })

  it('edits the message of the mode that is on', async () => {
    const state = serve(fullMaintenanceView())
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    const message = within(dialog).getByLabelText('Message for customers')
    await user.clear(message)
    await user.type(message, 'Nearly done.')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    expect(await screen.findByText('Customer message saved.')).toBeInTheDocument()
    expect(state.bodies).toEqual([
      { mode: 'full', message: 'Nearly done.', reason: 'Postgres 18 upgrade', expectedVersion: 5 },
    ])
  })

  it('leaves the reason empty for a switch-on, whatever was saved before', async () => {
    serve(maintenanceModeView({ reason: 'old reason' }))
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn on maintenance…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn on maintenance' })
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('')
  })

  it('sends the version it opened on when a poll lands before the submit, and shows the conflict', async () => {
    const state = serve(fullMaintenanceView(), () => {
      return fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
    })
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    // A poll moves the cache to version 6 while the dialog is open.
    state.view = fullMaintenanceView({
      version: 6,
      changedBy: { id: 'other', name: 'Ada Lovelace' },
    })
    await act(() => queryClient.refetchQueries({ queryKey: maintenanceModeKeys.view }))
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    expect(
      await within(dialog).findByText(/^Someone changed maintenance mode while you were editing/)
    ).toBeVisible()
    expect(state.bodies.map((body) => body.expectedVersion)).toEqual([5])
  })

  it('disables Cancel while the change is running', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const state = serve(fullMaintenanceView(), () => fail('x', 500))
    server.use(
      http.put('/api/v1/platform/maintenance-mode', async ({ request }) => {
        state.bodies.push((await request.json()) as Record<string, unknown>)
        await gate
        return ok(fullMaintenanceView({ message: 'Nearly done.', version: 6 }), 'Updated.')
      })
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(1))
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    release()
    expect(await screen.findByText('Customer message saved.')).toBeInTheDocument()
  })

  it('on a 409 shows what changed and resubmits with the version it just read', async () => {
    const state = serve(fullMaintenanceView(), (body, n) => {
      if (n === 1) {
        state.view = fullMaintenanceView({
          mode: 'read_only',
          version: 7,
          changedBy: { id: 'other', name: 'Ada Lovelace' },
        })
        return fail(
          'Maintenance mode changed since you loaded it.',
          409,
          'MAINTENANCE_MODE_CONFLICT'
        )
      }
      return ok(fullMaintenanceView({ message: String(body.message), version: 8 }), 'Updated.')
    })
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))

    expect(
      await within(dialog).findByText(
        /^Someone changed maintenance mode while you were editing: it is now read-only, set by Ada Lovelace at /
      )
    ).toBeVisible()
    // The page behind the modal dialog (hidden from the accessibility tree meanwhile) shows the state just read.
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Customer access', hidden: true })).getByText(
          'Read-only'
        )
      ).toBeInTheDocument()
    )
    // Read-only now, so keeping full is an escalation: a fresh reason replaces the pre-filled one, and the fresh version goes out.
    await user.clear(within(dialog).getByLabelText('Reason'))
    await user.type(within(dialog).getByLabelText('Reason'), 'still migrating')
    await user.type(within(dialog).getByLabelText('Type staging to confirm'), 'staging')
    await user.click(within(dialog).getByRole('button', { name: 'Switch to full' }))
    expect(await screen.findByText('Maintenance is now full.')).toBeInTheDocument()
    expect(state.bodies.map((body) => body.expectedVersion)).toEqual([5, 7])
    expect(state.bodies[1]).toMatchObject({ reason: 'still migrating', confirm: 'staging' })
  })

  it('clears the pre-filled reason when a 409 turns the edit into a switch-on', async () => {
    const state = serve(fullMaintenanceView(), (_body, n) => {
      if (n === 1) {
        state.view = fullMaintenanceView({ mode: 'read_only', version: 7 })
        return fail(
          'Maintenance mode changed since you loaded it.',
          409,
          'MAINTENANCE_MODE_CONFLICT'
        )
      }
      return ok(fullMaintenanceView({ version: 8 }), 'Updated.')
    })
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue('Postgres 18 upgrade')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await within(dialog).findByText(/^Someone changed maintenance mode while you were editing/)
    // Read-only now, so keeping full is an escalation: its hint is gone, so the old reason must not linger unseen.
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('')
    expect(within(dialog).queryByText(/It starts as the reason now saved\./)).toBeNull()
  })

  it('keeps a reason the owner typed when a 409 turns the edit into a switch-on', async () => {
    const state = serve(fullMaintenanceView(), () => {
      state.view = fullMaintenanceView({ mode: 'read_only', version: 7 })
      return fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
    })
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    const reason = within(dialog).getByLabelText('Reason (optional)')
    await user.clear(reason)
    await user.type(reason, 'my own reason')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await within(dialog).findByText(/^Someone changed maintenance mode while you were editing/)
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('my own reason')
  })

  it('validates and submits from the one mode the dialog opened on, whatever a poll reads meanwhile', async () => {
    const state = serve(fullMaintenanceView(), () =>
      ok(fullMaintenanceView({ message: 'Nearly done.', version: 6 }), 'Updated.')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    // A poll moves the cache to read-only: against that, keeping full would read as an escalation.
    state.view = fullMaintenanceView({ mode: 'read_only', version: 6 })
    await act(() => queryClient.refetchQueries({ queryKey: maintenanceModeKeys.view }))
    // The dialog opened on full, so it is still an edit: no typed environment, an optional reason.
    expect(within(dialog).queryByLabelText(/to confirm$/)).toBeNull()
    await user.clear(within(dialog).getByLabelText('Reason (optional)'))
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(1))
    expect(state.bodies[0]).toEqual({
      mode: 'full',
      message: 'We are upgrading the database.\nBack by 11:00 UTC.',
      expectedVersion: 5,
    })
  })

  it('lands a 400 "Validation failed" on the dialog’s message and reason fields', async () => {
    serve(maintenanceModeView(), () =>
      HttpResponse.json(
        {
          success: false,
          message: 'Validation failed',
          statusCode: 400,
          requestId: 'r',
          errors: {
            message: ['Message contains characters that are not allowed.'],
            reason: ['Reason contains characters that are not allowed.'],
          },
        },
        { status: 400 }
      )
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn on maintenance…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Turn on maintenance' })
    await user.type(within(dialog).getByLabelText('Message for customers'), 'Back soon.')
    await user.type(within(dialog).getByLabelText('Reason'), 'DB upgrade')
    await user.type(within(dialog).getByLabelText('Type staging to confirm'), 'staging')
    await user.click(within(dialog).getByRole('button', { name: 'Switch to read-only' }))
    expect(
      await within(dialog).findByText('Message contains characters that are not allowed.')
    ).toBeVisible()
    expect(
      within(dialog).getByText('Reason contains characters that are not allowed.')
    ).toBeVisible()
    expect(within(dialog).getByLabelText('Message for customers')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(within(dialog).getByLabelText('Reason')).toHaveAttribute('aria-invalid', 'true')
    // The generic message is for a failure with no field detail; this one has some.
    expect(within(dialog).queryByText('Validation failed')).toBeNull()
  })

  it('hides "Set by" while maintenance is off, though the API still names who switched it off', async () => {
    serve(maintenanceModeView())
    await openPage()
    const state = screen.getByRole('region', { name: 'Customer access' })
    expect(within(state).getByText('Off')).toBeInTheDocument()
    expect(within(state).queryByText('Set by')).toBeNull()
    expect(within(state).queryByText('Sam Staff')).toBeNull()
  })

  it('turns off with one confirmation, through step-up', async () => {
    const state = serve(fullMaintenanceView(), (_body, n) =>
      n === 1
        ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        : ok(maintenanceModeView({ version: 6 }), 'Updated.')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn off…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off maintenance?' })
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(stepUp).getByLabelText('Password'), 'hunter22')
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Maintenance is off.')).toBeInTheDocument()
    expect(state.bodies).toEqual([
      { mode: 'off', expectedVersion: 5 },
      { mode: 'off', expectedVersion: 5 },
    ])
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Customer access' })).getByText('Off')
      ).toBeInTheDocument()
    )
  })

  it('says so when the step-up is dismissed, and keeps the dialog open', async () => {
    serve(fullMaintenanceView(), () => fail('Recent sign-in required', 401, REAUTH_REQUIRED))
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn off…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off maintenance?' })
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.click(within(stepUp).getByRole('button', { name: 'Cancel' }))
    expect(await within(dialog).findByText('Confirm it’s you to continue.')).toBeVisible()
  })

  it('turns off with the version it opened on when a poll lands first, and shows the conflict', async () => {
    const state = serve(fullMaintenanceView(), () =>
      fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn off…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off maintenance?' })
    state.view = fullMaintenanceView({ version: 6 })
    await act(() => queryClient.refetchQueries({ queryKey: maintenanceModeKeys.view }))
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))
    expect(
      await within(dialog).findByText(/^Someone changed maintenance mode while you were editing/)
    ).toBeVisible()
    expect(state.bodies.map((body) => body.expectedVersion)).toEqual([5])
  })

  it('shows a 409 on switch-off inside its dialog', async () => {
    const state = serve(fullMaintenanceView(), () => {
      state.view = maintenanceModeView({ version: 6 })
      return fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
    })
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn off…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off maintenance?' })
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))
    expect(
      await within(dialog).findByText(
        /^Someone changed maintenance mode while you were editing: it is now off/
      )
    ).toBeVisible()
  })
})
