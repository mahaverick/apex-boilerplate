import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLATFORM_TENANT_SLUG } from '@/constants/routes'
import { toast } from '@/lib/toast'
import { tenantAdminKeys } from '@/queries/tenant-admin.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { userAdminKeys } from '@/queries/user-admin.queries'
import { queryClient } from '@/router'
import { expectMaskedToast } from '@/tests/fixtures/content'
import {
  AUDIT_ID_1,
  AUDIT_ID_2,
  INVITATION_ID,
  PLATFORM_TENANT_ID,
  STAFF_USER_ID,
  TENANT_ID,
  TENANT_ID_2,
  USER_ID_2,
} from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp } from '@/tests/mocks/step-up'
import type { PlatformUserDetail } from '@/types/api.types'

const DETAIL: PlatformUserDetail = {
  id: USER_ID_2,
  email: 'cleo@example.com',
  firstName: 'Cleo',
  lastName: 'Doe',
  active: true,
  emailVerifiedAt: null,
  lastLoggedInAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  platformRole: null,
  membershipCount: 1,
  authProviders: ['email'],
  memberships: [
    {
      tenantId: TENANT_ID,
      tenantName: 'Acme Corp',
      tenantSlug: 'acme',
      lifecycleState: 'active',
      role: 'editor',
      joinedAt: '2026-02-01T00:00:00.000Z',
    },
  ],
  pendingInvitations: [
    {
      id: INVITATION_ID,
      tenantId: TENANT_ID_2,
      tenantName: 'Beta Ltd',
      role: 'viewer',
      expiresAt: '2026-10-01T00:00:00.000Z',
      lastSentAt: null,
      resendAvailableAt: null,
    },
  ],
}

/** Answers the detail read for `USER_ID_2` with `detail`. */
function answer(detail: PlatformUserDetail = DETAIL) {
  server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(detail, 'User retrieved.')))
}

/**
 * Opens the Actions menu for Cleo's account.
 * @returns The open menu.
 */
async function openActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Actions for cleo@example.com' }))
  return screen.findByRole('menu')
}

describe('/users/$userId', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('shows the account, its tenants, sign-in methods and pending invitations', async () => {
    answer()
    renderAppAt(`/users/${USER_ID_2}`)
    expect(await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Never signed in')).toBeInTheDocument()
    const tenants = screen.getByRole('region', { name: 'Tenants' })
    expect(within(tenants).getByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
      'href',
      `/tenants/${TENANT_ID}`
    )
    expect(within(tenants).getByText('Editor')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Sign-in methods' })).toHaveTextContent('Email link')
    expect(screen.getByRole('region', { name: 'Pending invitations' })).toHaveTextContent(
      'Beta Ltd'
    )
  })

  it('holds the user page’s header and five cards while the user loads', async () => {
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => new Promise<never>(() => {})))
    renderAppAt(`/users/${USER_ID_2}`)
    expect(await screen.findByRole('heading', { name: 'User', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('main').querySelectorAll('[data-slot="card"]')).toHaveLength(5)
  })

  it('marks the user page busy while the user loads', async () => {
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => new Promise<never>(() => {})))
    renderAppAt(`/users/${USER_ID_2}`)
    const heading = await screen.findByRole('heading', { name: 'User', level: 1 })
    expect(heading.parentElement).toHaveAttribute('aria-busy', 'true')
  })

  it('does not mark the loaded user page busy', async () => {
    answer()
    renderAppAt(`/users/${USER_ID_2}`)
    expect(await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })).toBeInTheDocument()
    // The Emails card reads its own list; busy is only the part still loading.
    expect(await screen.findByText('No emails sent to this account yet.')).toBeInTheDocument()
    expect(screen.getByRole('main').querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('keeps the loaded page with one alert above it when a refetch fails', async () => {
    answer()
    renderAppAt(`/users/${USER_ID_2}`)
    expect(await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })).toBeInTheDocument()
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Boom', 500)))
    await act(() => queryClient.refetchQueries({ queryKey: userAdminKeys.detail(USER_ID_2) }))
    expect(await screen.findAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'We couldn’t load this user. Select Try again.'
    )
    expect(screen.getByRole('heading', { name: 'Cleo Doe', level: 1 })).toBeInTheDocument()
  })

  it('says the user does not exist when a loaded user answers 404 on refetch', async () => {
    answer()
    renderAppAt(`/users/${USER_ID_2}`)
    expect(await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })).toBeInTheDocument()
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)))
    await act(() => queryClient.refetchQueries({ queryKey: userAdminKeys.detail(USER_ID_2) }))
    expect(
      await screen.findByRole('heading', { name: 'User not found', level: 1 })
    ).toBeInTheDocument()
  })

  it('says the user does not exist on a 404', async () => {
    server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)))
    renderAppAt(`/users/${USER_ID_2}`)
    expect(
      await screen.findByRole('heading', { name: 'User not found', level: 1 })
    ).toBeInTheDocument()
  })

  it('offers a viewer no actions at all', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    answer()
    renderAppAt(`/users/${USER_ID_2}`)
    await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
  })

  it('hides every action an admin would be refused on a staff owner', async () => {
    answer({ ...DETAIL, platformRole: 'owner', emailVerifiedAt: '2026-01-01T00:00:00.000Z' })
    renderAppAt(`/users/${USER_ID_2}`)
    await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
  })

  it('offers an admin a sign-in link and soft delete on an unverified account', async () => {
    answer()
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    expect(items).toEqual([
      'Edit name',
      'Send sign-in link',
      'Sign out everywhere',
      'Deactivate',
      'Delete',
    ])
  })

  it('hides the mail actions and sign-out on an inactive account', async () => {
    answer({ ...DETAIL, active: false })
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Edit name', 'Reactivate', 'Delete'])
  })

  it('lets an owner act on another staff owner', async () => {
    signIn({ ...testUser, platformRole: 'owner' })
    answer({ ...DETAIL, platformRole: 'owner' })
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    expect(within(menu).getByRole('menuitem', { name: 'Deactivate' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('deactivates with a reason, retrying through step-up once', async () => {
    answer()
    let calls = 0
    let body: unknown
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/deactivate`, async ({ request }) => {
        calls += 1
        body = await request.json()
        if (calls === 1) return fail('Please confirm it is you.', 401, 'REAUTH_REQUIRED')
        return ok({ ...DETAIL, active: false }, 'User deactivated.')
      })
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Deactivate account' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Chargeback fraud')
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    await confirmStepUp(user)

    await waitFor(() => expect(success).toHaveBeenCalledWith('Account deactivated.'))
    expect(calls).toBe(2)
    expect(body).toEqual({ reason: 'Chargeback fraud' })
    // Not signed out: the stale step-up was not a verdict.
    expect(screen.getByRole('heading', { name: 'Cleo Doe', level: 1 })).toBeInTheDocument()
  })

  it('deactivating a staff owner marks the Staff members list and a tenant’s owners stale', async () => {
    signIn({ ...testUser, platformRole: 'owner' })
    answer({ ...DETAIL, platformRole: 'owner' })
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/deactivate`, () =>
        ok({ ...DETAIL, active: false }, 'User deactivated.')
      )
    )
    const staffMembers = tenantKeys.members(PLATFORM_TENANT_SLUG)
    const tenantDetail = tenantAdminKeys.detail(TENANT_ID)
    const tenantMembers = tenantKeys.members('acme', TENANT_ID)
    queryClient.setQueryData(staffMembers, [])
    queryClient.setQueryData(tenantDetail, { id: TENANT_ID })
    queryClient.setQueryData(tenantMembers, [])
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Deactivate account' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Left the company')
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => expect(queryClient.getQueryState(staffMembers)?.isInvalidated).toBe(true))
    expect(queryClient.getQueryState(tenantDetail)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(tenantMembers)?.isInvalidated).toBe(true)
  })

  it('keeps the reason dialog open with a 409 in it', async () => {
    // The page still shows the account inactive, but someone reactivated it meanwhile.
    answer({ ...DETAIL, active: false })
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/reactivate`, () =>
        fail('This user is already active. Refresh the page to see their status.', 409)
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Reactivate' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Reactivate account' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Appeal upheld')
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This user is already active. Refresh the page to see their status.'
    )
  })

  it('lets an admin delete only after typing the email; the page then shows the deleted account', async () => {
    let deleted = false
    let body: unknown
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () =>
        ok(
          deleted ? { ...DETAIL, deletedAt: '2026-09-29T00:00:00.000Z', active: false } : DETAIL,
          'User retrieved.'
        )
      ),
      http.delete(`/api/v1/platform/users/${USER_ID_2}`, async ({ request }) => {
        body = await request.json()
        deleted = true
        return ok(null, 'User deleted.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete user' })
    await user.type(within(dialog).getByLabelText('Reason'), 'GDPR request')
    await user.click(within(dialog).getByRole('button', { name: 'Delete user' }))
    expect(
      await within(dialog).findByText('Type cleo@example.com exactly to confirm.')
    ).toBeInTheDocument()
    expect(body).toBeUndefined()

    await user.type(
      within(dialog).getByLabelText('Type cleo@example.com to confirm'),
      'cleo@example.com'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Delete user' }))

    expect(await screen.findByText(/This account was deleted on/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/users/${USER_ID_2}`)
    expect(body).toEqual({ reason: 'GDPR request' })
    // An admin cannot purge, so a deleted account offers them nothing.
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
    // The trigger that opened the dialog is gone, so focus lands on the page heading, not <body>.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Cleo Doe', level: 1 })).toHaveFocus()
    )
  })

  it('puts focus on the page heading after a soft delete whose refetches are slow', async () => {
    let deleted = false
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () =>
        ok(
          deleted ? { ...DETAIL, deletedAt: '2026-09-29T00:00:00.000Z', active: false } : DETAIL,
          'User retrieved.'
        )
      ),
      http.delete(`/api/v1/platform/users/${USER_ID_2}`, () => {
        deleted = true
        return ok(null, 'User deleted.')
      }),
      // Falls through to the handlers above once the injected latency has passed.
      http.get('/api/v1/*', async () => {
        if (deleted) await delay(150)
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete user' })
    await user.type(within(dialog).getByLabelText('Reason'), 'GDPR request')
    await user.type(
      within(dialog).getByLabelText('Type cleo@example.com to confirm'),
      'cleo@example.com'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Delete user' }))

    expect(await screen.findByText(/This account was deleted on/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Cleo Doe', level: 1 })).toHaveFocus()
    )
  })

  it('lets an owner permanently delete a deleted account, behind step-up, then lists deleted users', async () => {
    signIn({ ...testUser, platformRole: 'owner' })
    const bodies: unknown[] = []
    let purged = false
    let readsAfterPurge = 0
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () => {
        if (purged) {
          readsAfterPurge += 1
          return fail('User not found', 404)
        }
        return ok({ ...DETAIL, deletedAt: '2026-09-29T00:00:00.000Z', active: false }, 'ok')
      }),
      http.post(`/api/v1/platform/users/${USER_ID_2}/purge`, async ({ request }) => {
        bodies.push(await request.json())
        if (bodies.length === 1) return fail('Recent sign-in required', 401, 'REAUTH_REQUIRED')
        purged = true
        return ok(null, 'User permanently deleted.')
      }),
      http.get('/api/v1/platform/users', () => ok(listPage([]), 'Users retrieved.'))
    )
    const user = userEvent.setup()
    const router = renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Delete permanently'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete permanently' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Permanently delete this account?',
    })
    await user.type(within(dialog).getByLabelText('Reason'), 'Erasure request')
    await user.type(
      within(dialog).getByLabelText('Type cleo@example.com to confirm'),
      'cleo@example.com'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))
    await confirmStepUp(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/users'))
    expect(router.state.location.search).toEqual({ status: 'deleted' })
    expect(bodies).toEqual([{ reason: 'Erasure request' }, { reason: 'Erasure request' }])
    // The page left before its cached detail was dropped, so nothing asked for the purged account again.
    await waitFor(() =>
      expect(queryClient.getQueryState(userAdminKeys.detail(USER_ID_2))).toBeUndefined()
    )
    expect(readsAfterPurge).toBe(0)
    expect(screen.queryByRole('heading', { name: 'User not found' })).not.toBeInTheDocument()
  })

  it('focuses the Users heading after Delete permanently', async () => {
    signIn({ ...testUser, platformRole: 'owner' })
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () =>
        ok({ ...DETAIL, deletedAt: '2026-09-29T00:00:00.000Z', active: false }, 'ok')
      ),
      http.post(`/api/v1/platform/users/${USER_ID_2}/purge`, () =>
        ok(null, 'User permanently deleted.')
      ),
      http.get('/api/v1/platform/users', () => ok(listPage([]), 'Users retrieved.'))
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete permanently' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Permanently delete this account?',
    })
    await user.type(within(dialog).getByLabelText('Reason'), 'Erasure request')
    await user.type(
      within(dialog).getByLabelText('Type cleo@example.com to confirm'),
      'cleo@example.com'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))

    const heading = await screen.findByRole('heading', { name: 'Users', level: 1 })
    await waitFor(() => expect(heading).toHaveFocus())
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(heading).toHaveFocus()
  })

  it('returns focus to Actions when Delete permanently is cancelled', async () => {
    signIn({ ...testUser, platformRole: 'owner' })
    answer({ ...DETAIL, deletedAt: '2026-09-29T00:00:00.000Z', active: false })
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete permanently' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Permanently delete this account?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Actions for cleo@example.com' })).toHaveFocus()
    )
  })

  it('sends a sign-in link from the confirm dialog and toasts', async () => {
    answer()
    const bodies: unknown[] = []
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/sign-in-link`, async ({ request }) => {
        bodies.push(await request.json())
        return ok({ emailSent: true }, 'Sign-in link sent.')
      })
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Send sign-in link' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send a sign-in link?' })
    // Nothing goes until the staff member confirms.
    expect(bodies).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    expectMaskedToast(
      success.mock.calls[0]![0],
      'Sign-in link sent to cleo@example.com.',
      'cleo@example.com'
    )
    expect(bodies).toEqual([{}])
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('keeps the dialog open with a retry notice when the sign-in link email did not go', async () => {
    answer()
    let sent = 0
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/sign-in-link`, () => {
        sent += 1
        return ok({ emailSent: sent > 1 }, 'Sign-in link sent.')
      })
    )
    const warning = vi.spyOn(toast, 'warning')
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Send sign-in link' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send a sign-in link?' })
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))

    expect(
      await within(dialog).findByText('The email couldn’t be sent. Select Send link to try again.')
    ).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
    expect(warning).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()

    // Send link again: this time the email goes, so the dialog closes with the success toast.
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(sent).toBe(2)
  })

  it('stays open, still sending, when Escape is pressed mid-request', async () => {
    answer()
    const settle: { release?: () => void } = {}
    const held = new Promise<void>((resolve) => {
      settle.release = resolve
    })
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/sign-in-link`, async () => {
        await held
        return ok({ emailSent: true }, 'Sign-in link sent.')
      })
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Send sign-in link' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send a sign-in link?' })
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))
    expect(await within(dialog).findByRole('button', { name: /Sending…/ })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Send a sign-in link?' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Sending…/ })).toBeInTheDocument()

    settle.release?.()
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it.each([
    ['staff', 'admin' as const, 'Apex'],
    ['others', null, 'the customer app'],
  ])('names Apex for staff and the customer app for others (%s)', async (_who, role, target) => {
    signIn({ ...testUser, platformRole: 'owner' })
    answer({ ...DETAIL, platformRole: role })
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Send sign-in link' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send a sign-in link?' })
    expect(dialog).toHaveTextContent(
      `We email cleo@example.com a link that signs them in to ${target}. It works once and expires in 15 minutes.`
    )
    expect(within(dialog).getByText('cleo@example.com')).toHaveClass('ph-sensitive')
  })

  it('words a role-gate 404 on the send as staff copy, not the route sentence', async () => {
    answer()
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/sign-in-link`, () =>
        fail('No route matches this method and path. Check both, then try again.', 404, 'not_found')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Send sign-in link' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send a sign-in link?' })
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Your role no longer allows this action. Ask a platform owner to check your role.'
    )
    expect(within(dialog).queryByText(/No route matches/)).not.toBeInTheDocument()
  })

  it('keeps the dialog open with the 409 message for a deactivated user', async () => {
    // The page still shows the account active, but someone deactivated it meanwhile.
    answer()
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/sign-in-link`, () =>
        fail('This account is deactivated. Reactivate it, then try again.', 409)
      )
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Send sign-in link' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send a sign-in link?' })
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This account is deactivated. Reactivate it, then try again.'
    )
    expect(dialog).toBeInTheDocument()
    expect(success).not.toHaveBeenCalled()

    // Cancel, then open it again: the earlier refusal is gone.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await user.click(
      within(await openActions(user)).getByRole('menuitem', { name: 'Send sign-in link' })
    )
    const reopened = await screen.findByRole('alertdialog', { name: 'Send a sign-in link?' })
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lists Email link and Google, with no password wording', async () => {
    answer({ ...DETAIL, authProviders: ['email', 'google'] })
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Sign-in methods' })
    expect(within(card).getByText('Email link')).toBeInTheDocument()
    expect(within(card).getByText('Google')).toBeInTheDocument()
    expect(card).not.toHaveTextContent(/password/i)
  })

  it('lists only Email link for an account without Google', async () => {
    answer()
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Sign-in methods' })
    expect(within(card).getByText('Email link')).toBeInTheDocument()
    expect(within(card).queryByText('Google')).not.toBeInTheDocument()
  })

  it('saves only the name that changed', async () => {
    answer()
    let body: unknown
    server.use(
      http.patch(`/api/v1/platform/users/${USER_ID_2}`, async ({ request }) => {
        body = await request.json()
        return ok({ ...DETAIL, firstName: 'Cleopatra' }, 'User updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit name' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit name' })
    const first = within(dialog).getByLabelText('First name')
    await user.clear(first)
    await user.type(first, 'Cleopatra')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toEqual({ firstName: 'Cleopatra' }))
  })

  it('sets just a first name on an account that has only an email', async () => {
    answer({ ...DETAIL, firstName: null, lastName: null })
    let body: unknown
    server.use(
      http.patch(`/api/v1/platform/users/${USER_ID_2}`, async ({ request }) => {
        body = await request.json()
        return ok({ ...DETAIL, firstName: 'Nia', lastName: null }, 'User updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit name' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit name' })
    await user.type(within(dialog).getByLabelText('First name'), 'Nia')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toEqual({ firstName: 'Nia' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit name' })).not.toBeInTheDocument()
    )
  })

  it('clears a last name by sending null', async () => {
    answer()
    let body: unknown
    server.use(
      http.patch(`/api/v1/platform/users/${USER_ID_2}`, async ({ request }) => {
        body = await request.json()
        return ok({ ...DETAIL, lastName: null }, 'User updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit name' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit name' })
    await user.clear(within(dialog).getByLabelText('Last name'))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toEqual({ lastName: null }))
  })

  it('sends nothing when no name changed, and says so', async () => {
    answer()
    let calls = 0
    server.use(
      http.patch(`/api/v1/platform/users/${USER_ID_2}`, () => {
        calls += 1
        return ok(DETAIL, 'User updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit name' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit name' })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Change a name before saving.'
    )
    expect(calls).toBe(0)

    await user.type(within(dialog).getByLabelText('Last name'), 'r')
    await waitFor(() => {
      expect(within(dialog).queryByText('Change a name before saving.')).not.toBeInTheDocument()
    })
  })

  /**
   * Serves a user detail the test can change before a refetch, and records every PATCH body; the first
   * `failures` PATCHes answer 500.
   * @returns The served detail and the PATCH bodies.
   */
  function answerEditable(initial: PlatformUserDetail, failures = 0) {
    const state = { served: initial, bodies: [] as unknown[] }
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(state.served, 'User retrieved.')),
      http.patch(`/api/v1/platform/users/${USER_ID_2}`, async ({ request }) => {
        state.bodies.push(await request.json())
        return state.bodies.length <= failures
          ? fail('Something broke.', 500)
          : ok(state.served, 'User updated.')
      })
    )
    return state
  }

  /** Opens Edit name on the user page and returns the dialog. */
  async function openEditName() {
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit name' }))
    return { user, dialog: await screen.findByRole('dialog', { name: 'Edit name' }) }
  }

  it('saves an edited last name while a refused legacy first name stays as it is', async () => {
    const state = answerEditable({ ...DETAIL, firstName: 'Cl\u{200B}eo' })
    const { user, dialog } = await openEditName()
    const last = within(dialog).getByLabelText('Last name')
    await user.clear(last)
    await user.type(last, 'Smith')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(state.bodies).toEqual([{ lastName: 'Smith' }])
    })
    expect(
      screen.queryByText('This field contains characters that are not allowed')
    ).not.toBeInTheDocument()
  })

  it('sends only the edited name after a refetch brings a change made elsewhere', async () => {
    const state = answerEditable(DETAIL)
    const { user, dialog } = await openEditName()
    const last = within(dialog).getByLabelText('Last name')
    await user.clear(last)
    await user.type(last, 'Smith')
    state.served = { ...DETAIL, firstName: 'Cleopatra' }
    await act(() => queryClient.refetchQueries({ queryKey: userAdminKeys.detail(USER_ID_2) }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(state.bodies).toEqual([{ lastName: 'Smith' }])
    })
  })

  it('shows a refetch in a dialog nobody has touched, and still asks for a change', async () => {
    const state = answerEditable(DETAIL)
    const { user, dialog } = await openEditName()
    const first = within(dialog).getByLabelText('First name')
    expect(first).toHaveValue('Cleo')
    state.served = { ...DETAIL, firstName: 'Cleopatra' }
    await act(() => queryClient.refetchQueries({ queryKey: userAdminKeys.detail(USER_ID_2) }))

    await waitFor(() => {
      expect(first).toHaveValue('Cleopatra')
    })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Change a name before saving.'
    )
    expect(state.bodies).toEqual([])
  })

  it('sends the name again when Save is pressed after a failed save', async () => {
    const state = answerEditable(DETAIL, 1)
    const { user, dialog } = await openEditName()
    const first = within(dialog).getByLabelText('First name')
    await user.clear(first)
    await user.type(first, 'Cleopatra')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await within(dialog).findByText('Something broke.')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(state.bodies).toEqual([{ firstName: 'Cleopatra' }, { firstName: 'Cleopatra' }])
    })
  })

  /** An entry of the platform log about Cleo's account, filed under the platform tenant. */
  function historyEntry(id: string, action: string) {
    return {
      id,
      occurredAt: '2026-09-25T09:00:00.000Z',
      action,
      access: 'platform',
      actor: { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' },
      target: { type: 'user', id: USER_ID_2 },
      metadata: { reason: 'left the company' },
      tenant: { id: PLATFORM_TENANT_ID, name: 'Platform', slug: 'platform' },
    }
  }

  it('shows what was recorded on this account, filtered by target, without linking back to it', async () => {
    answer()
    let params: URLSearchParams | undefined
    server.use(
      http.get('/api/v1/platform/audit-log', ({ request }) => {
        params = new URL(request.url).searchParams
        return ok(listPage([historyEntry(AUDIT_ID_1, 'user.deactivated')]), 'Audit log retrieved.')
      })
    )
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Recorded actions on this account' })
    expect(await within(card).findByText(/deactivated a user/)).toBeInTheDocument()
    expect(
      within(card).getByRole('table', { name: 'Recorded actions on this account' })
    ).toBeVisible()
    expect(params?.get('target')).toBe(USER_ID_2)
    expect(params?.get('tenant')).toBeNull()
    expect(within(card).queryByRole('link', { name: 'View user' })).not.toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Staff team' })).toHaveAttribute(
      'href',
      '/settings/platform/staff'
    )
  })

  it('pages the history with Next page, keeping the card’s cursor in the URL', async () => {
    answer()
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/platform/audit-log', ({ request }) => {
        const params = new URL(request.url).searchParams
        seen.push(params)
        return params.get('cursor') === 'h2'
          ? ok(listPage([historyEntry(AUDIT_ID_2, 'user.reactivated')]), 'Audit log retrieved.')
          : ok(
              listPage([historyEntry(AUDIT_ID_1, 'user.deactivated')], {
                hasNext: true,
                nextCursor: 'h2',
              }),
              'Audit log retrieved.'
            )
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Recorded actions on this account' })
    await within(card).findByText(/deactivated a user/)

    await user.click(within(card).getByRole('button', { name: 'Next page' }))

    expect(await within(card).findByText(/reactivated a user/)).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ historyCursor: 'h2' })
    expect(seen.at(-1)?.get('target')).toBe(USER_ID_2)
  })

  it('says so when nothing was recorded on this account', async () => {
    answer()
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Recorded actions on this account' })
    expect(await within(card).findByText('Nothing recorded yet.')).toBeInTheDocument()
  })

  it('shows a viewer no History, since the platform log is admin-only', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    answer()
    renderAppAt(`/users/${USER_ID_2}`)
    await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
    expect(
      screen.queryByRole('heading', { name: 'Recorded actions on this account' })
    ).not.toBeInTheDocument()
  })
})
