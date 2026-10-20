import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { toast } from '@/lib/toast'
import { queryClient } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import {
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  PLATFORM_TENANT_ID,
  USER_ID,
  USER_ID_2,
} from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp, dismissStepUp } from '@/tests/mocks/step-up'

/**
 * A gate the members card's `navigate` waits on before navigating, so a test can hold a navigation
 * between its call and its resolution. It is open (null) by default, so every other test navigates as
 * the real router does.
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

/** Every error the members card reports, in order. */
const reported = vi.hoisted(() => ({ errors: [] as unknown[] }))

vi.mock('@/observability/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/observability/errors')>()
  return {
    ...actual,
    noteError: (error: unknown) => {
      reported.errors.push(error)
    },
  }
})

afterEach(() => {
  navigation.gate = null
  reported.errors = []
  vi.restoreAllMocks()
})

/** What the Leave dialog says on the Staff page: leaving the platform tenant ends staff access. */
const LEAVE_PLATFORM = 'You lose staff access immediately. An owner or admin must invite you back.'

/** What the Leave dialog adds about invitations for a platform owner or admin. */
const PLATFORM_INVITATIONS_REVOKED =
  'Pending invitations you sent here are revoked, and so are any you sent in other tenants for a role you can no longer grant there.'

/** The reason the last owner's own controls are off. */
const LAST_OWNER = 'A tenant must always have an owner. Add another owner first.'

/** Leave, once enabled: an owner's own waits for the owners read, and is a different element after it. */
function enabledLeave() {
  return waitFor(() => {
    const leave = screen.getByRole('button', { name: 'Leave' })
    expect(leave).toBeEnabled()
    return leave
  })
}

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

/**
 * One platform member row. `active` is express 2.1.0's flag, false for a deactivated account; left out,
 * the row is as an older API lists it.
 */
function staff(
  id: string,
  membershipId: string,
  role: MembershipRole,
  firstName: string,
  active?: boolean
) {
  return {
    membership: {
      id: membershipId,
      userId: id,
      tenantId: PLATFORM_TENANT_ID,
      role,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: {
      id,
      email: `${firstName.toLowerCase()}@platform.test`,
      firstName,
      lastName: 'Staff',
      ...(active === undefined ? {} : { active }),
    },
  }
}

/**
 * Signs in and serves the platform tenant with Me (`USER_ID`, `testUser`) at `myRole` and Otto
 * (`USER_ID_2`) at `ottoRole`, each with the `active` flag given, or none.
 */
function serveStaff(
  myRole: MembershipRole,
  ottoRole: MembershipRole,
  active: { me?: boolean; otto?: boolean } = {}
) {
  signIn({ ...testUser, platformRole: myRole })
  server.use(
    http.get('/api/v1/tenants/platform', () =>
      ok({ ...PLATFORM, isPlatform: true, role: myRole, access: 'member' }, 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/platform/members', () =>
      ok(
        listPage([
          staff(USER_ID, MEMBERSHIP_ID, myRole, 'Me', active.me),
          staff(USER_ID_2, MEMBERSHIP_ID_2, ottoRole, 'Otto', active.otto),
        ]),
        'Members retrieved.'
      )
    ),
    http.get('/api/v1/tenants/platform/invitations', () =>
      ok(listPage([]), 'Invitations retrieved.')
    )
  )
}

describe('/staff with the real sections', () => {
  it('lets an owner change another owner’s role', async () => {
    serveStaff('owner', 'owner')
    renderAppAt('/settings/platform/staff')
    expect(await screen.findByRole('combobox', { name: 'Role for Otto Staff' })).toBeInTheDocument()
  })

  it('lets an owner remove another owner', async () => {
    serveStaff('owner', 'owner')
    renderAppAt('/settings/platform/staff')
    await screen.findByText('Otto Staff')
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  /**
   * Me's own role select and Leave, once the list has rendered. Leave is a different element once the
   * owners read lands, so each is read fresh.
   */
  async function myControls() {
    await screen.findByRole('combobox', { name: 'Role for Me Staff' })
    return {
      role: () => screen.getByRole('combobox', { name: 'Role for Me Staff' }),
      leave: () => screen.getByRole('button', { name: 'Leave' }),
    }
  }

  it('treats a deactivated co-owner as no owner, as express counts the platform tenant', async () => {
    serveStaff('owner', 'owner', { me: true, otto: false })
    renderAppAt('/settings/platform/staff')
    const { role, leave } = await myControls()
    // The reason shows once the owners read has landed and found no other active owner.
    expect(await screen.findByText(LAST_OWNER)).toBeInTheDocument()
    expect(role()).toBeDisabled()
    expect(leave()).toBeDisabled()
  })

  it.each([
    { label: 'an active co-owner', otto: true },
    { label: 'a co-owner listed with no active flag (an API before 2.1.0)', otto: undefined },
  ])('leaves an owner free to step down beside $label', async ({ otto }) => {
    serveStaff('owner', 'owner', { me: true, otto })
    renderAppAt('/settings/platform/staff')
    const { role, leave } = await myControls()
    await waitFor(() => expect(leave()).toBeEnabled())
    expect(role()).toBeEnabled()
  })

  it('counts only the other owners, whatever the caller’s own flag says', async () => {
    serveStaff('owner', 'owner', { me: false, otto: true })
    renderAppAt('/settings/platform/staff')
    const { role, leave } = await myControls()
    await waitFor(() => expect(leave()).toBeEnabled())
    expect(role()).toBeEnabled()
  })

  it.each([
    { label: 'an active owner', active: true, enabled: true },
    {
      label: 'an owner with no active flag (an API before 2.1.0)',
      active: undefined,
      enabled: true,
    },
    { label: 'only a deactivated owner', active: false, enabled: false },
  ])(
    'counts $label who is not on this page toward the last-owner rule',
    async ({ active, enabled }) => {
      serveStaff('owner', 'owner', { me: true, otto: active })
      const mine = staff(USER_ID, MEMBERSHIP_ID, 'owner', 'Me', true)
      const other = staff(USER_ID_2, MEMBERSHIP_ID_2, 'owner', 'Otto', active)
      server.use(
        http.get('/api/v1/tenants/platform/members', ({ request }) => {
          // The page holds only the caller; the owners read answers both owners.
          return new URL(request.url).searchParams.get('role') === 'owner'
            ? ok(listPage([mine, other]), 'Members retrieved.')
            : ok(listPage([mine], { hasNext: true, nextCursor: 'c2' }), 'Members retrieved.')
        })
      )
      renderAppAt('/settings/platform/staff')
      const { role, leave } = await myControls()
      if (enabled) {
        await waitFor(() => expect(leave()).toBeEnabled())
        expect(role()).toBeEnabled()
        expect(screen.queryByText(LAST_OWNER)).not.toBeInTheDocument()
      } else {
        expect(await screen.findByText(LAST_OWNER)).toBeInTheDocument()
        expect(leave()).toBeDisabled()
      }
    }
  )

  it('shows the role failure once on the Staff page, with a Try again that retries it', async () => {
    serveStaff('owner', 'viewer')
    let roleFails = true
    server.use(
      http.get('/api/v1/tenants/platform', () => {
        return roleFails
          ? fail('Server error', 500)
          : ok(
              { ...PLATFORM, isPlatform: true, role: 'owner', access: 'member' },
              'Tenant retrieved.'
            )
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/platform/staff')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load your role in this tenant/i)
    // The invitations section waits silently: no second alert, no invite form.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Invite staff' })).not.toBeInTheDocument()
    roleFails = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Invite staff' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the staff search and the invitations search apart', async () => {
    serveStaff('owner', 'viewer')
    const memberReads: URLSearchParams[] = []
    const invitationReads: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/tenants/platform/members', ({ request }) => {
        memberReads.push(new URL(request.url).searchParams)
        return ok(listPage([staff(USER_ID, MEMBERSHIP_ID, 'owner', 'Me')]), 'Members retrieved.')
      }),
      http.get('/api/v1/tenants/platform/invitations', ({ request }) => {
        invitationReads.push(new URL(request.url).searchParams)
        return ok(listPage([]), 'Invitations retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/settings/platform/staff')
    await screen.findByRole('table', { name: 'Staff members' })
    await user.type(screen.getByRole('searchbox', { name: 'Search staff members' }), 'otto')
    await user.type(screen.getByRole('searchbox', { name: 'Search invitations' }), 'inv')
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ search: 'otto', invitationsSearch: 'inv' })
    )
    // Each list asks the API in the API's own names, with only its own term.
    await waitFor(() => {
      expect(memberReads.some((p) => p.get('search') === 'otto')).toBe(true)
      expect(invitationReads.some((p) => p.get('search') === 'inv')).toBe(true)
    })
    expect(memberReads.some((p) => p.get('search') === 'inv')).toBe(false)
    expect(invitationReads.some((p) => p.get('search') === 'otto')).toBe(false)
  })

  it('keeps the invitations cursor when the staff list is paged', async () => {
    serveStaff('owner', 'viewer')
    server.use(
      http.get('/api/v1/tenants/platform/members', ({ request }) => {
        const second = new URL(request.url).searchParams.get('cursor') === 'm2'
        return ok(
          listPage(
            [staff(USER_ID, MEMBERSHIP_ID, 'owner', 'Me')],
            second ? { hasPrev: true, prevCursor: 'm1' } : { hasNext: true, nextCursor: 'm2' }
          ),
          'Members retrieved.'
        )
      }),
      http.get('/api/v1/tenants/platform/invitations', () =>
        ok(listPage([], { hasPrev: true, prevCursor: 'i0' }), 'Invitations retrieved.')
      )
    )
    const user = userEvent.setup()
    const router = renderAppAt('/settings/platform/staff?invitationsCursor=i1')
    const staffRegion = await screen.findByRole('region', { name: 'Staff members' })
    await user.click(await within(staffRegion).findByRole('button', { name: 'Next page' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ cursor: 'm2', invitationsCursor: 'i1' })
    )
  })

  it('gives an admin no control over another admin', async () => {
    serveStaff('admin', 'admin')
    renderAppAt('/settings/platform/staff')
    await screen.findByText('Otto Staff')
    expect(screen.queryByRole('combobox', { name: 'Role for Otto Staff' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('shows a platform viewer the members with no role select and no Remove', async () => {
    serveStaff('viewer', 'viewer')
    renderAppAt('/settings/platform/staff')
    await screen.findByText('Otto Staff')
    expect(screen.getByText('Me Staff')).toBeInTheDocument()
    expect(screen.queryAllByRole('combobox', { name: /^Role for / })).toEqual([])
    expect(screen.queryAllByRole('button', { name: 'Remove' })).toEqual([])
  })

  it('says leaving staff needs a new invitation', async () => {
    serveStaff('viewer', 'owner')
    const user = userEvent.setup()
    renderAppAt('/settings/platform/staff')
    await user.click(await enabledLeave())
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    expect(dialog).toHaveTextContent('An owner or admin must invite you back.')
    expect(dialog).not.toHaveTextContent(/auto-join|domain/)
  })

  it('labels the Staff invite button Invite staff', async () => {
    serveStaff('owner', 'viewer')
    renderAppAt('/settings/platform/staff')
    expect(await screen.findByRole('button', { name: 'Invite staff' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument()
  })

  it('says removing staff needs a new invitation to return', async () => {
    serveStaff('owner', 'viewer')
    const user = userEvent.setup()
    renderAppAt('/settings/platform/staff')
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Otto Staff?' })
    expect(dialog).not.toHaveTextContent(/auto-join|PLATFORM_EMAIL_DOMAINS/)
    expect(dialog).toHaveTextContent(
      'A new invitation gives them staff access again. An operator can grant the role again on the server.'
    )
    expect(dialog).not.toHaveTextContent(/pnpm|platform:grant/)
    expect(dialog).toHaveTextContent(
      'Pending invitations they sent here are revoked. So are any they sent in other tenants for a role they can no longer grant there.'
    )
    expect(dialog).toHaveTextContent(
      /To block their sign-in too, deactivate their account in Users/
    )
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
      })
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt('/settings/platform/staff')
    await user.click(await screen.findByRole('combobox', { name: 'Role for Otto Staff' }))
    await user.click(await screen.findByRole('option', { name: 'Admin' }))

    await confirmStepUp(user)

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    const { container } = render(<>{success.mock.calls[0]![0]}</>)
    expect(container).toHaveTextContent('Otto Staff is now Admin.')
    expect(container.querySelector('.ph-sensitive.ph-mask')).toHaveTextContent(/^Otto Staff$/)
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
      })
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt('/settings/platform/staff')
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Otto Staff?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await confirmStepUp(user)

    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    const { container } = render(<>{success.mock.calls[0]![0]}</>)
    expect(container).toHaveTextContent('Otto Staff removed.')
    expect(container.querySelector('.ph-sensitive.ph-mask')).toHaveTextContent(/^Otto Staff$/)
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
    const router = renderAppAt('/settings/platform/staff')
    await user.click(await enabledLeave())
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    expect(dialog).toHaveAccessibleDescription(LEAVE_PLATFORM)
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/no-access'))
    expect(left).toBe(1)
  })

  it('tells a platform owner leaving which invitations are revoked, here and elsewhere', async () => {
    serveStaff('owner', 'owner')
    const user = userEvent.setup()
    renderAppAt('/settings/platform/staff')
    await user.click(await enabledLeave())
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
    const router = renderAppAt('/settings/platform/staff')
    await user.click(await enabledLeave())
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))
    await dismissStepUp(user)
    const still = screen.getByRole('alertdialog', { name: 'Leave this tenant?' })
    expect(await within(still).findByText('Confirm it’s you to continue.')).toBeInTheDocument()
    expect(calls).toBe(1)
    expect(router.state.location.pathname).toBe('/settings/platform/staff')
  })

  it('drops the platform tenant’s cache only once the navigation away has finished', async () => {
    serveStaff('owner', 'owner')
    serveFormerStaff()
    /** Opens the held navigation. */
    let release = () => {}
    navigation.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let hasLeft = false
    const afterLeaving: string[] = []
    /** Notes each request made once the leave has landed. */
    const record = ({ request }: { request: Request }) => {
      if (hasLeft) afterLeaving.push(`${request.method} ${new URL(request.url).pathname}`)
    }
    server.use(
      http.delete('/api/v1/tenants/platform/membership', () => {
        hasLeft = true
        return ok(null, 'You left the tenant.')
      })
    )
    const router = renderAppAt('/settings/platform/staff')
    const dropped: string[] = []
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed' && event.query.queryHash.startsWith('["tenants","platform"')) {
        dropped.push(router.state.resolvedLocation?.pathname ?? '')
      }
    })
    server.events.on('request:start', record)
    try {
      const user = userEvent.setup()
      await user.click(await enabledLeave())
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
      )
      await screen.findByText('You left this tenant.')
      // Absence has no event: the held navigation is what the drop must wait for.
      await act(() => settle(50, 'absence has no event: a drop while the navigation is held'))
      expect(dropped).toEqual([])
      expect(router.state.location.pathname).toBe('/settings/platform/staff')

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

  it('says so, and still drops the platform tenant’s cache, when the navigation away fails', async () => {
    serveStaff('owner', 'owner')
    serveFormerStaff()
    const failure = new Error('navigation failed')
    const failed = Promise.reject(failure)
    failed.catch(() => {})
    navigation.gate = failed
    server.use(
      http.delete('/api/v1/tenants/platform/membership', () => ok(null, 'You left the tenant.'))
    )
    const error = vi.spyOn(toast, 'error')
    const router = renderAppAt('/settings/platform/staff')
    let dropped = 0
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed' && event.query.queryHash.startsWith('["tenants","platform"')) {
        dropped += 1
      }
    })
    try {
      const user = userEvent.setup()
      await user.click(await enabledLeave())
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
      )
      await waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          'You left, but this page could not move on. Reload it to continue.'
        )
      )
      await waitFor(() => expect(dropped).toBeGreaterThan(0))
      expect(reported.errors).toEqual([failure])
      expect(router.state.location.pathname).toBe('/settings/platform/staff')
    } finally {
      unsubscribe()
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
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/settings/platform/staff')
    await user.click(await enabledLeave())
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    await confirmStepUp(user)

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
    const router = renderAppAt('/settings/platform/staff')
    await user.click(await enabledLeave())
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/no-access'))
    expect(useAuthStore.getState().user?.platformRole).toBeNull()
  })
})
