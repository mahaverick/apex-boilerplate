import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INVITATION_ID, TENANT_ID, TENANT_ID_2, USER_ID_2 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
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
  hasPassword: false,
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
    },
  ],
}

function answer(detail: PlatformUserDetail = DETAIL) {
  server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(detail, 'User retrieved.')))
}

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
    expect(screen.getByText('Unverified')).toBeInTheDocument()
    const tenants = screen.getByRole('region', { name: 'Tenants' })
    expect(within(tenants).getByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
      'href',
      `/tenants/${TENANT_ID}`
    )
    expect(within(tenants).getByText('Editor')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Sign-in methods' })).toHaveTextContent(
      'No password set'
    )
    expect(screen.getByRole('region', { name: 'Pending invitations' })).toHaveTextContent(
      'Beta Ltd'
    )
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

  it('offers an admin soft delete, and no resend-verification to an account without a password', async () => {
    answer()
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    expect(items).toEqual([
      'Edit name',
      'Send set-password link',
      'Sign out everywhere',
      'Deactivate',
      'Delete',
    ])
  })

  it('offers resend-verification to an unverified account that has a password', async () => {
    answer({ ...DETAIL, hasPassword: true })
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    expect(
      within(menu).getByRole('menuitem', { name: 'Resend verification email' })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Send password reset link' })
    ).toBeInTheDocument()
  })

  it('hides the mail actions and sign-out on an inactive account (spec R7)', async () => {
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

  it('lets an owner act on another staff owner (spec R4)', async () => {
    signIn({ ...testUser, platformRole: 'owner' })
    answer({ ...DETAIL, platformRole: 'owner', hasPassword: true })
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
      }),
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'fresh-token' }, 'Reauthenticated.')
      )
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Deactivate account' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Chargeback fraud')
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(stepUp).getByLabelText('Password'), 'my password')
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(success).toHaveBeenCalledWith('Account deactivated.'))
    expect(calls).toBe(2)
    expect(body).toEqual({ reason: 'Chargeback fraud' })
    // Not signed out: the stale step-up was not a verdict.
    expect(screen.getByRole('heading', { name: 'Cleo Doe', level: 1 })).toBeInTheDocument()
  })

  it('keeps the reason dialog open with a 409 in it', async () => {
    answer()
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/sign-out`, () =>
        fail('You cannot sign yourself out here; use your profile.', 409)
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out everywhere' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sign out everywhere' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Lost laptop')
    await user.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You cannot sign yourself out here; use your profile.'
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
    // An admin can't purge, so a deleted account offers them nothing.
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
  })

  it('lets an owner permanently delete a deleted account, behind step-up, then lists deleted users', async () => {
    signIn({ ...testUser, platformRole: 'owner' })
    answer({ ...DETAIL, deletedAt: '2026-09-29T00:00:00.000Z', active: false })
    const bodies: unknown[] = []
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/purge`, async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? fail('Recent sign-in required', 401, 'REAUTH_REQUIRED')
          : ok(null, 'User permanently deleted.')
      }),
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      ),
      http.get('/api/v1/platform/users', () =>
        ok({ users: [], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      )
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
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(stepUp).getByLabelText('Password'), 'hunter22')
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/users'))
    expect(router.state.location.search).toEqual({ status: 'deleted' })
    expect(bodies).toEqual([{ reason: 'Erasure request' }, { reason: 'Erasure request' }])
  })

  it('sends the set-password link from the menu and says whether it went', async () => {
    answer()
    server.use(
      http.post(`/api/v1/platform/users/${USER_ID_2}/password-setup`, () =>
        ok({ emailSent: false }, 'Email queued.')
      )
    )
    const warning = vi.spyOn(toast, 'warning')
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const menu = await openActions(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Send set-password link' }))
    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith('The email could not be sent. Try again shortly.')
    )
  })

  it('edits the name', async () => {
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
    await waitFor(() => expect(body).toEqual({ firstName: 'Cleopatra', lastName: 'Doe' }))
  })

  it('shows staff actions on this user from the platform log, filtered by target', async () => {
    answer()
    let targetId: string | null = null
    server.use(
      http.get('/api/v1/platform/audit-log', ({ request }) => {
        targetId = new URL(request.url).searchParams.get('targetId')
        return ok({ entries: [], nextCursor: null }, 'Audit log retrieved.')
      })
    )
    renderAppAt(`/users/${USER_ID_2}`)
    expect(await screen.findByRole('heading', { name: 'History', level: 2 })).toBeInTheDocument()
    await waitFor(() => expect(targetId).toBe(USER_ID_2))
  })

  it('shows a viewer no History, since the platform log is admin-only', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    answer()
    renderAppAt(`/users/${USER_ID_2}`)
    await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
    expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument()
  })
})
