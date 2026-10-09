import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pii } from '@/components/shared/pii'
import type { MembershipRole } from '@/constants/roles'
import { queryClient } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import {
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  PLATFORM_TENANT_ID,
  USER_ID,
  USER_ID_2,
} from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/**
 * A gate the members card's `navigate` waits on before navigating, so a test
 * can hold a navigation between its call and its resolution. Open by default:
 * every other test navigates as the real router does.
 */
const navigation = vi.hoisted(() => ({ gate: null as Promise<void> | null }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate()
      return ((options: Parameters<typeof navigate>[0]) =>
        navigation.gate === null
          ? navigate(options)
          : navigation.gate.then(() => navigate(options))) as typeof navigate
    },
  }
})

afterEach(() => {
  navigation.gate = null
  vi.restoreAllMocks()
})

/** What the Leave dialog says on the Staff page: leaving the platform tenant ends staff access. */
const LEAVE_PLATFORM =
  'You lose staff access immediately. An owner or admin will have to invite you back, unless your address is on an auto-join domain: then you rejoin as a viewer at your next sign-in.'

/** Added for a platform owner or admin. */
const PLATFORM_INVITATIONS_REVOKED =
  'Pending invitations you sent here are revoked, and so are any you sent in other tenants for a role you can no longer grant there.'

/** The profile as express answers it once the platform membership is gone: no platform role. */
function serveFormerStaff() {
  server.use(
    http.get('/api/v1/profile', () => ok({ ...testUser, platformRole: null }, 'Profile retrieved.'))
  )
}

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
    expect(dialog).toHaveTextContent(
      'Pending invitations they sent here are revoked, and so are any they sent in other tenants for a role their membership there cannot grant.'
    )
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

  it('lets a staff viewer leave the platform tenant, which ends staff access: /no-access', async () => {
    serveStaff('viewer', 'owner')
    serveFormerStaff()
    let left = 0
    server.use(
      http.delete('/api/v1/tenants/platform/membership', () => {
        left += 1
        return ok(null, 'You left the tenant.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/staff')
    await user.click(await screen.findByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    expect(dialog).toHaveAccessibleDescription(LEAVE_PLATFORM)
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/no-access'))
    expect(left).toBe(1)
  })

  it('tells a platform owner leaving which invitations are revoked, here and elsewhere', async () => {
    serveStaff('owner', 'owner')
    const user = userEvent.setup()
    renderAppAt('/staff')
    await user.click(await screen.findByRole('button', { name: 'Leave' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    ).toHaveAccessibleDescription(`${LEAVE_PLATFORM} ${PLATFORM_INVITATIONS_REVOKED}`)
  })

  it('keeps the dialog open, and says why, when the step-up for a stale leave is dismissed', async () => {
    serveStaff('owner', 'owner')
    let calls = 0
    server.use(
      http.delete('/api/v1/tenants/platform/membership', () => {
        calls += 1
        return fail('Recent sign-in required', 401, 'REAUTH_REQUIRED')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/staff')
    await user.click(await screen.findByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))
    await screen.findByRole('dialog', { name: 'Confirm it’s you' })

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Confirm it’s you' })).not.toBeInTheDocument()
    )
    const still = screen.getByRole('alertdialog', { name: 'Leave this tenant?' })
    expect(await within(still).findByText('Confirm it’s you to continue.')).toBeInTheDocument()
    expect(calls).toBe(1)
    expect(router.state.location.pathname).toBe('/staff')
  })

  it('drops the platform tenant’s cache only once the navigation away has finished', async () => {
    serveStaff('owner', 'owner')
    serveFormerStaff()
    let release = () => {}
    navigation.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let hasLeft = false
    const afterLeaving: string[] = []
    const record = ({ request }: { request: Request }) => {
      if (hasLeft) afterLeaving.push(`${request.method} ${new URL(request.url).pathname}`)
    }
    server.use(
      http.delete('/api/v1/tenants/platform/membership', () => {
        hasLeft = true
        return ok(null, 'You left the tenant.')
      })
    )
    const router = renderAppAt('/staff')
    const dropped: string[] = []
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed' && event.query.queryHash.startsWith('["tenants","platform"')) {
        dropped.push(router.state.resolvedLocation?.pathname ?? '')
      }
    })
    server.events.on('request:start', record)
    try {
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Leave' }))
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
      )
      await screen.findByText('You left this tenant.')
      // Absence has no event: the held navigation is what the drop must wait for.
      await act(() => settle(50, 'absence has no event: a drop while the navigation is held'))
      expect(dropped).toEqual([])
      expect(router.state.location.pathname).toBe('/staff')

      release()

      await waitFor(() => expect(router.state.location.pathname).toBe('/no-access'))
      await waitFor(() => expect(dropped.length).toBeGreaterThan(0))
      expect(new Set(dropped)).toEqual(new Set(['/no-access']))
      expect(afterLeaving.filter((entry) => entry.includes('/tenants/platform'))).toEqual([])
    } finally {
      unsubscribe()
      server.events.removeListener('request:start', record)
    }
  })

  it('asks who you are before a stale leave of the platform tenant, then leaves', async () => {
    serveStaff('owner', 'owner')
    let calls = 0
    server.use(
      http.delete('/api/v1/tenants/platform/membership', () => {
        calls += 1
        return calls === 1
          ? fail('Recent sign-in required', 401, 'REAUTH_REQUIRED')
          : ok(null, 'You left the tenant.')
      }),
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      )
    )
    const user = userEvent.setup()
    const router = renderAppAt('/staff')
    await user.click(await screen.findByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(stepUp).getByLabelText('Password'), 'zqS7-leave-staff')
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/overview'))
    expect(calls).toBe(2)
  })

  it('after leaving the platform tenant, the refreshed profile has no platform role: /no-access', async () => {
    serveStaff('owner', 'owner')
    serveFormerStaff()
    server.use(
      http.delete('/api/v1/tenants/platform/membership', () => ok(null, 'You left the tenant.'))
    )
    const user = userEvent.setup()
    const router = renderAppAt('/staff')
    await user.click(await screen.findByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/no-access'))
    expect(useAuthStore.getState().user?.platformRole).toBeNull()
  })
})
