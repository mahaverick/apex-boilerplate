import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pii } from '@/components/shared/pii'
import type { MembershipRole } from '@/constants/roles'
import {
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  PLATFORM_TENANT_ID,
  USER_ID,
  USER_ID_2,
} from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

afterEach(() => {
  vi.restoreAllMocks()
})

const PLATFORM = {
  id: PLATFORM_TENANT_ID,
  name: 'Platform',
  slug: 'platform',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function staff(id: string, membershipId: string, role: MembershipRole, firstName: string) {
  return {
    membership: {
      id: membershipId,
      userId: id,
      tenantId: PLATFORM_TENANT_ID,
      role,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id, email: `${firstName.toLowerCase()}@platform.test`, firstName, lastName: 'Staff' },
  }
}

/** Me (`USER_ID`, `testUser`) at `myRole`, and Otto (`USER_ID_2`) at `ottoRole`. */
function serveStaff(myRole: MembershipRole, ottoRole: MembershipRole) {
  signIn({ ...testUser, platformRole: myRole })
  server.use(
    http.get('/api/v1/tenants/platform', () =>
      ok({ ...PLATFORM, isPlatform: true, role: myRole, access: 'member' }, 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/platform/members', () =>
      ok(
        [
          staff(USER_ID, MEMBERSHIP_ID, myRole, 'Me'),
          staff(USER_ID_2, MEMBERSHIP_ID_2, ottoRole, 'Otto'),
        ],
        'Members retrieved.'
      )
    ),
    http.get('/api/v1/tenants/platform/invitations', () => ok([], 'Invitations retrieved.'))
  )
}

describe('/staff with the real sections', () => {
  it('lets an owner change another owner’s role', async () => {
    serveStaff('owner', 'owner')
    renderAppAt('/staff')
    expect(await screen.findByRole('combobox', { name: 'Role for Otto Staff' })).toBeInTheDocument()
  })

  it('lets an owner remove another owner', async () => {
    serveStaff('owner', 'owner')
    renderAppAt('/staff')
    await screen.findByText('Otto Staff')
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('gives an admin no control over another admin', async () => {
    serveStaff('admin', 'admin')
    renderAppAt('/staff')
    await screen.findByText('Otto Staff')
    expect(screen.queryByRole('combobox', { name: 'Role for Otto Staff' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('warns, when removing staff, that domain auto-join can bring them back', async () => {
    serveStaff('owner', 'viewer')
    const user = userEvent.setup()
    renderAppAt('/staff')
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Otto Staff?' })
    expect(dialog).toHaveTextContent(/auto-join domain/)
    expect(dialog).toHaveTextContent(/deactivate their account from Users/)
    expect(within(dialog).getByRole('link', { name: 'Open Otto Staff in Users' })).toHaveAttribute(
      'href',
      `/users/${USER_ID_2}`
    )
  })

  it('asks who you are before a stale role change, then applies it', async () => {
    serveStaff('owner', 'viewer')
    const bodies: unknown[] = []
    server.use(
      http.patch(`/api/v1/tenants/platform/members/${USER_ID_2}`, async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? fail('Recent sign-in required', 401, 'REAUTH_REQUIRED')
          : ok(
              { ...staff(USER_ID_2, MEMBERSHIP_ID_2, 'admin', 'Otto').membership },
              'Role updated.'
            )
      }),
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      )
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt('/staff')
    await user.click(await screen.findByRole('combobox', { name: 'Role for Otto Staff' }))
    await user.click(await screen.findByRole('option', { name: 'Admin' }))

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(stepUp).getByLabelText('Password'), 'hunter22')
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(<Pii>{'Otto Staff is now Admin.'}</Pii>)
    )
    expect(bodies).toEqual([{ role: 'admin' }, { role: 'admin' }])
  })

  it('asks who you are before a stale removal, then removes', async () => {
    serveStaff('owner', 'viewer')
    let calls = 0
    server.use(
      http.delete(`/api/v1/tenants/platform/members/${USER_ID_2}`, () => {
        calls += 1
        return calls === 1
          ? fail('Recent sign-in required', 401, 'REAUTH_REQUIRED')
          : ok(null, 'Member removed.')
      }),
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      )
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt('/staff')
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Otto Staff?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(stepUp).getByLabelText('Password'), 'hunter22')
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(success).toHaveBeenCalledWith(<Pii>{'Otto Staff removed.'}</Pii>))
    expect(calls).toBe(2)
  })

  it('goes to the overview after leaving the platform tenant', async () => {
    serveStaff('owner', 'owner')
    server.use(
      http.delete(`/api/v1/tenants/platform/members/${USER_ID}`, () => ok(null, 'Member removed.'))
    )
    const user = userEvent.setup()
    const router = renderAppAt('/staff')
    await user.click(await screen.findByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/overview'))
  })
})
