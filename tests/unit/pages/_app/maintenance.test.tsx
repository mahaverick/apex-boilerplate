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
import { settle } from '@/tests/fixtures/timing'
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

/** What the change dialog says when the state could not be read again after a 409. */
const UNREAD =
  'Someone changed maintenance mode, and the current state could not be loaded. Try again; what you typed is kept.'

/** What the switch-off dialog says in the same case. */
const UNREAD_TURN_OFF =
  'Someone changed maintenance mode, and the current state could not be loaded. Try again.'

/**
 * Adds to the pre-filled customer message, so a save changes something.
 * @param user - The test's user-event instance.
 * @param dialog - The open change dialog.
 */
async function touchMessage(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.type(within(dialog).getByLabelText('Message for customers'), ' More soon.')
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
    await touchMessage(user, dialog)
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
    await touchMessage(user, dialog)
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
    await touchMessage(user, dialog)
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
    await touchMessage(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await within(dialog).findByText(/^Someone changed maintenance mode while you were editing/)
    // Read-only now, so keeping full is an escalation: its hint is gone, so the old reason must not linger unseen.
    expect(within(dialog).getByLabelText('Reason')).toHaveValue('')
    expect(within(dialog).queryByText(/It starts as the reason now saved\./)).toBeNull()
    // The field was cleared, not matched to theirs, so the alert must not say it was.
    expect(within(dialog).getByRole('alert')).not.toHaveTextContent(/reason now matches/)
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
      reason: null,
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

describe('E1-24 / E1-40: a reason-only edit, and a 409 whose re-read fails', () => {
  beforeEach(() => {
    signInAs('owner')
  })

  it('E1-24 + E1-40(10): does not say "saved" when express answers a reason-only edit as a no-op (same version)', async () => {
    // An answer with the version unchanged means express stored nothing.
    const state = serve(fullMaintenanceView(), () =>
      ok(fullMaintenanceView(), 'Maintenance mode updated.')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    const reason = within(dialog).getByLabelText('Reason (optional)')
    await user.clear(reason)
    await user.type(reason, 'New reason, same message')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(1))
    expect(state.bodies[0]).toMatchObject({ reason: 'New reason, same message' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText('Customer message saved.')).toBeNull()
    expect(await screen.findByText('Nothing changed.')).toBeInTheDocument()
  })

  it('E1-40(6): a 409 whose re-read fails is not shown as what someone else saved', async () => {
    const state = serve(fullMaintenanceView(), () =>
      fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await touchMessage(user, dialog)
    server.use(http.get('/api/v1/platform/maintenance-mode', () => fail('Server error', 500)))
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(1))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeVisible())
    // The cache still holds the version-5 state this dialog opened on; presenting it as the other owner's change is false.
    expect(within(dialog).queryByText(/it is now full, set by Sam Staff/)).toBeNull()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(UNREAD)
    // The version is unknown, so a resubmit sends the one the dialog opened on and conflicts again rather than overwriting.
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(2))
    expect(state.bodies.map((body) => body.expectedVersion)).toEqual([5, 5])
  })

  it('says the same on switch-off when the re-read after a 409 fails', async () => {
    const state = serve(fullMaintenanceView(), () =>
      fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Turn off…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off maintenance?' })
    server.use(http.get('/api/v1/platform/maintenance-mode', () => fail('Server error', 500)))
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(UNREAD_TURN_OFF)
    expect(state.bodies.map((body) => body.expectedVersion)).toEqual([5])
  })
})

describe('E1-41: stale pre-filled reason, and clearing the reason on a same-mode save', () => {
  beforeEach(() => {
    signInAs('owner')
  })

  it('(a) after a 409 where another owner changed the reason, a resubmit does not send back the stale pre-filled one', async () => {
    const state = serve(fullMaintenanceView(), (body, n) => {
      if (n === 1) {
        state.view = fullMaintenanceView({
          version: 7,
          reason: 'Other owner: extended window',
          changedBy: { id: 'other', name: 'Ada Lovelace' },
        })
        return fail(
          'Maintenance mode changed since you loaded it.',
          409,
          'MAINTENANCE_MODE_CONFLICT'
        )
      }
      return ok(fullMaintenanceView({ version: 8, message: String(body.message) }), 'Updated.')
    })
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    const message = within(dialog).getByLabelText('Message for customers')
    await user.clear(message)
    await user.type(message, 'Nearly done.')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await within(dialog).findByText(/^Someone changed maintenance mode while you were editing/)
    expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue(
      'Other owner: extended window'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(2))
    // The owner never touched Reason; resending the reason read before the 409 overwrites Ada's.
    expect(state.bodies[1]?.reason).not.toBe('Postgres 18 upgrade')
  })

  it('keeps a reason the owner typed when a 409 finds another owner changed it', async () => {
    const state = serve(fullMaintenanceView(), () => {
      state.view = fullMaintenanceView({ version: 7, reason: 'Other owner: extended window' })
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
    expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue('my own reason')
  })

  it('(b) emptying Reason on a same-mode save clears the stored reason (express semantics: an absent reason keeps the stored one)', async () => {
    const state = serve(fullMaintenanceView(), (body) =>
      ok(
        fullMaintenanceView({
          version: 6,
          message: String(body.message),
          // express coalesces: no reason in the body keeps the stored one.
          reason:
            (body.reason as string | null | undefined) === undefined
              ? 'Postgres 18 upgrade'
              : (body.reason as string | null),
        }),
        'Updated.'
      )
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await user.clear(within(dialog).getByLabelText('Reason (optional)'))
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(1))
    expect(state.bodies[0]).toMatchObject({ reason: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const facts = screen.getByRole('region', { name: 'Customer access' })
    expect(within(facts).queryByText('Postgres 18 upgrade')).toBeNull()
  })

  it('sends no reason on a same-mode save when none was saved and the field stays empty', async () => {
    const state = serve(fullMaintenanceView({ reason: null }))
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await user.type(within(dialog).getByLabelText('Message for customers'), ' More soon.')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(1))
    expect(state.bodies[0]).not.toHaveProperty('reason')
  })
})

describe('after a 409: a fresh read, the pre-filled message, the reason hint, an unchanged save', () => {
  beforeEach(() => {
    signInAs('owner')
  })

  /** A 409 that moves the stored state to `next` first, as another owner's save would. */
  function conflictTo(
    state: { view: PlatformMaintenanceModeView },
    next: PlatformMaintenanceModeView
  ) {
    state.view = next
    return fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
  }

  const ADA = { id: 'other', name: 'Ada Lovelace' }
  const HINT_BASE = 'For staff only. Recorded in the audit log with your name.'
  const HINT_SAVED = `${HINT_BASE} It starts as the reason now saved. Empty it to clear that reason.`

  it('reads the state again after a 409 instead of reusing a poll already on its way', async () => {
    const state = serve(fullMaintenanceView(), (_body, n) =>
      n === 1
        ? conflictTo(state, fullMaintenanceView({ mode: 'read_only', version: 7, changedBy: ADA }))
        : ok(fullMaintenanceView({ version: 8 }), 'Updated.')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await touchMessage(user, dialog)
    let gets = 0
    server.use(
      http.get('/api/v1/platform/maintenance-mode', async () => {
        gets += 1
        // What the state was when this read started, answered late, as a poll held up by a slow Redis is.
        const answer = state.view
        await settle(300, 'injected latency: a poll still on its way when the 409 lands')
        return ok(answer, 'Maintenance mode retrieved.')
      })
    )
    void queryClient.refetchQueries({ queryKey: maintenanceModeKeys.view }).catch(() => undefined)
    await waitFor(() => expect(gets).toBe(1))
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    expect(
      await within(dialog).findByText(/it is now read-only, set by Ada Lovelace/)
    ).toBeVisible()
    expect(gets).toBe(2)
  })

  it('shows only the staff-only hint when no reason is saved', async () => {
    serve(fullMaintenanceView({ reason: null }))
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    expect(within(dialog).getByText(HINT_BASE, { exact: true })).toBeInTheDocument()
    expect(within(dialog).queryByText(/Empty it to clear that reason\./)).toBeNull()
  })

  it('keeps the hint on the reason the field started from when a poll brings a new one', async () => {
    const state = serve(fullMaintenanceView({ reason: null }))
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    state.view = fullMaintenanceView({ version: 6, reason: 'Other owner: extended window' })
    await act(() => queryClient.refetchQueries({ queryKey: maintenanceModeKeys.view }))
    // The page behind the modal dialog has taken the poll, so the dialog has its new view.
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Customer access', hidden: true })).getByText(
          'Other owner: extended window'
        )
      ).toBeInTheDocument()
    )
    // The field still starts empty, so it does not start as the reason now saved.
    expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue('')
    expect(within(dialog).getByText(HINT_BASE, { exact: true })).toBeInTheDocument()
  })

  it('says the field starts as the saved reason, and how to clear it, when one is saved', async () => {
    serve(fullMaintenanceView())
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    expect(within(dialog).getByText(HINT_SAVED, { exact: true })).toBeInTheDocument()
  })

  it('shows the full hint once a 409 finds a reason where none was saved', async () => {
    const state = serve(fullMaintenanceView({ reason: null }), () =>
      conflictTo(state, fullMaintenanceView({ version: 7, reason: 'B', changedBy: ADA }))
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await touchMessage(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await within(dialog).findByText(/^Someone changed maintenance mode while you were editing/)
    expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue('B')
    expect(within(dialog).getByText(HINT_SAVED, { exact: true })).toBeInTheDocument()
  })

  it('after a 409 that changed the message, a resubmit sends the other owner’s message, not the stale pre-filled one', async () => {
    const state = serve(fullMaintenanceView(), (body, n) =>
      n === 1
        ? conflictTo(
            state,
            fullMaintenanceView({
              version: 7,
              message: 'Other owner: back by 13:00.',
              changedBy: ADA,
            })
          )
        : ok(fullMaintenanceView({ version: 8, message: String(body.message) }), 'Updated.')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    const reason = within(dialog).getByLabelText('Reason (optional)')
    await user.clear(reason)
    await user.type(reason, 'mine')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Check the page and try again\. The message now matches theirs\.$/
    )
    expect(within(dialog).getByLabelText('Message for customers')).toHaveValue(
      'Other owner: back by 13:00.'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(2))
    expect(state.bodies[1]).toEqual({
      mode: 'full',
      message: 'Other owner: back by 13:00.',
      reason: 'mine',
      expectedVersion: 7,
    })
  })

  it('keeps a message and reason the owner typed when a 409 finds another owner changed both, and says so', async () => {
    const state = serve(fullMaintenanceView(), () =>
      conflictTo(
        state,
        fullMaintenanceView({
          version: 7,
          message: 'Other owner: back by 13:00.',
          reason: 'Other owner: extended window',
          changedBy: ADA,
        })
      )
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    const message = within(dialog).getByLabelText('Message for customers')
    await user.clear(message)
    await user.type(message, 'Mine.')
    const reason = within(dialog).getByLabelText('Reason (optional)')
    await user.clear(reason)
    await user.type(reason, 'my own reason')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /They also changed the message and reason; yours are kept\.$/
    )
    expect(message).toHaveValue('Mine.')
    expect(reason).toHaveValue('my own reason')
  })

  it('says a typed message is kept when a 409 finds the other owner changed it', async () => {
    const state = serve(fullMaintenanceView(), () =>
      conflictTo(
        state,
        fullMaintenanceView({ version: 7, message: 'Other owner: back by 13:00.', changedBy: ADA })
      )
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await touchMessage(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /They also changed the message; yours is kept\.$/
    )
    expect(within(dialog).getByLabelText('Message for customers')).toHaveValue(
      'We are upgrading the database.\nBack by 11:00 UTC. More soon.'
    )
  })

  it('says the reason now matches theirs when a 409 moves an untouched reason', async () => {
    const state = serve(fullMaintenanceView(), () =>
      conflictTo(state, fullMaintenanceView({ version: 7, reason: 'Other owner: extended window' }))
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await touchMessage(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Check the page and try again\. The reason now matches theirs\.$/
    )
  })

  it('says the message and reason now match theirs when a 409 moves both untouched', async () => {
    const state = serve(fullMaintenanceView(), () =>
      conflictTo(
        state,
        fullMaintenanceView({
          version: 7,
          message: 'Other owner: back by 13:00.',
          reason: 'Other owner: extended window',
          changedBy: ADA,
        })
      )
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Switch to read-only…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Switch to read-only maintenance' })
    await user.click(within(dialog).getByRole('button', { name: 'Switch to read-only' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Check the page and try again\. The message and reason now match theirs\.$/
    )
    expect(within(dialog).getByLabelText('Message for customers')).toHaveValue(
      'Other owner: back by 13:00.'
    )
    expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue(
      'Other owner: extended window'
    )
  })

  it('clears a reason a 409 brought in when the owner then empties it', async () => {
    const state = serve(fullMaintenanceView({ reason: null }), (_body, n) =>
      n === 1
        ? conflictTo(state, fullMaintenanceView({ version: 7, reason: 'B', changedBy: ADA }))
        : ok(fullMaintenanceView({ version: 8, reason: null }), 'Updated.')
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    await touchMessage(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await within(dialog).findByText(/^Someone changed maintenance mode while you were editing/)
    expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue('B')
    await user.clear(within(dialog).getByLabelText('Reason (optional)'))
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await waitFor(() => expect(state.bodies).toHaveLength(2))
    expect(state.bodies[1]).toMatchObject({ reason: null, expectedVersion: 7 })
  })

  it('has nothing left to save after a 409 finds the other owner saved what was typed', async () => {
    const state = serve(fullMaintenanceView(), () =>
      conflictTo(state, fullMaintenanceView({ version: 7, message: 'Mine.', changedBy: ADA }))
    )
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    const message = within(dialog).getByLabelText('Message for customers')
    await user.clear(message)
    await user.type(message, 'Mine.')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    await within(dialog).findByText(/^Someone changed maintenance mode while you were editing/)
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    expect(
      await within(dialog).findByText('Change the message or reason before saving.')
    ).toBeVisible()
    expect(state.bodies).toHaveLength(1)
  })

  it('refuses a save that changes nothing in place, before the step-up', async () => {
    const state = serve(fullMaintenanceView())
    const user = await openPage()
    await user.click(screen.getByRole('button', { name: 'Edit message…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit the customer message' })
    // Spaces around the text are trimmed, so they change nothing either.
    await user.type(within(dialog).getByLabelText('Message for customers'), '  ')
    await user.type(within(dialog).getByLabelText('Reason (optional)'), '  ')
    await user.click(within(dialog).getByRole('button', { name: 'Save message' }))
    expect(
      await within(dialog).findByText('Change the message or reason before saving.')
    ).toBeVisible()
    expect(state.bodies).toHaveLength(0)
    expect(screen.queryByRole('dialog', { name: 'Confirm it’s you' })).toBeNull()
  })
})
