import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient } from '@/router'
import {
  INVITATION_ID,
  INVITATION_ID_2,
  INVITATION_ID_3,
  INVITATION_ID_9,
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  MEMBERSHIP_ID_3,
  MEMBERSHIP_ID_4,
  MEMBERSHIP_ID_5,
  TENANT_ID,
  USER_ID,
  USER_ID_2,
  USER_ID_3,
  USER_ID_4,
  USER_ID_5,
} from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import {
  fail,
  INVITATION_SENT_MESSAGE,
  ok,
  tenantDetail,
  testInvitation,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import {
  REAUTH_REQUIRED,
  type PlatformTenantDetail,
  type TenantInvitation,
} from '@/types/api.types'

afterEach(() => {
  vi.restoreAllMocks()
})

const TENANT = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: 'Anvils',
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** What `GET /platform/tenants/:id` answers for `TENANT`: the tenant page's header and tabs read it. */
const PLATFORM_DETAIL: PlatformTenantDetail = {
  ...TENANT,
  lifecycleState: 'active',
  settings: { timezone: 'UTC', locale: 'en' },
  memberCount: 0,
  owners: [],
  pendingInvitationCount: 0,
  pendingOwnerInvitation: null,
}

/**
 * The tenant page's own read, which every test here needs whatever else it
 * mocks, and an empty pending list, which apex has no default handler for; a
 * test about invitations overrides it.
 */
function mockPlatformDetail() {
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
      ok(PLATFORM_DETAIL, 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme/invitations', () => ok([], 'Invitations retrieved.'))
  )
}

/** Each fixture user's membership row. */
const MEMBERSHIP_OF: Readonly<Record<string, string>> = {
  [USER_ID]: MEMBERSHIP_ID,
  [USER_ID_2]: MEMBERSHIP_ID_2,
  [USER_ID_3]: MEMBERSHIP_ID_3,
  [USER_ID_4]: MEMBERSHIP_ID_4,
  [USER_ID_5]: MEMBERSHIP_ID_5,
}

/** One `{ membership, user }` row, as `listByTenant` returns it. */
function member(id: string, role: MembershipRole, firstName: string) {
  const membershipId = MEMBERSHIP_OF[id]
  if (membershipId === undefined) throw new Error(`no fixture membership for user ${id}`)
  return {
    membership: {
      id: membershipId,
      userId: id,
      tenantId: TENANT.id,
      role,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id, email: `${id}@b.com`, firstName, lastName: 'X' },
  }
}

/** `testUser.id` is `USER_ID`, so this is always "me". */
const ME = USER_ID

function mockTenant(myRole: MembershipRole, members: ReturnType<typeof member>[]) {
  mockPlatformDetail()
  server.use(
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(TENANT, myRole), 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme/members', () => ok(members, 'Members retrieved.'))
  )
}

/** What the Leave dialog says on a customer tenant: the caller is staff, so access stays. */
const LEAVE_CUSTOMER = 'You stop being a member of this tenant. You keep your staff access to it.'

/**
 * Me at `myRole` among `others` until `DELETE …/membership` lands; after it,
 * the tenant answers as express does once the membership is gone: Me reaches
 * it through platform access (`testUser` is a platform admin) and is no
 * longer listed. Returns how many leaves were sent.
 */
function serveLeaving(myRole: MembershipRole, others: ReturnType<typeof member>[]) {
  const state = { left: 0 }
  mockPlatformDetail()
  server.use(
    http.get('/api/v1/tenants/acme', () =>
      ok(
        state.left > 0 ? tenantDetail(TENANT, 'admin', 'platform') : tenantDetail(TENANT, myRole),
        'Tenant retrieved.'
      )
    ),
    http.get('/api/v1/tenants/acme/members', () =>
      ok(state.left > 0 ? others : [member(ME, myRole, 'Me'), ...others], 'Members retrieved.')
    ),
    http.delete('/api/v1/tenants/acme/membership', () => {
      state.left += 1
      return ok(null, 'You left the tenant.')
    })
  )
  return state
}

/** The member table's row for one person, once the table has rendered. */
async function rowFor(name: string) {
  const cell = await screen.findByRole('cell', { name: new RegExp(name) })
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${name}`)
  return within(row)
}

/**
 * `tests/setup.ts`'s `matchMedia` stub answers `useIsMobile`'s `max-width`
 * query from `window.innerWidth`, so setting the width is what decides.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}
const realInnerWidth = window.innerWidth

describe('members tab permissions', () => {
  afterEach(() => {
    setViewportWidth(realInnerWidth)
  })

  beforeEach(() => {
    signIn()
    mockPlatformDetail()
  })

  it('lets an owner change and remove a non-owner', async () => {
    mockTenant('owner', [
      member(ME, 'owner', 'Me'),
      member(USER_ID_2, 'admin', 'Ada'),
      member(USER_ID_3, 'viewer', 'Vic'),
    ])
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const ada = await rowFor('Ada')
    expect(ada.getByRole('combobox', { name: 'Role for Ada X' })).toBeEnabled()
    expect(ada.getByRole('button', { name: 'Remove' })).toBeEnabled()

    const vic = await rowFor('Vic')
    expect(vic.getByRole('combobox', { name: 'Role for Vic X' })).toBeEnabled()
  })

  it('does not let an owner touch ANOTHER owner', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const otto = await rowFor('Otto')
    // The matrix's one "self only" cell: an owner may act on an owner only when that owner is themselves.
    expect(otto.queryByRole('combobox')).not.toBeInTheDocument()
    expect(otto.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(otto.getByText('Owner')).toBeInTheDocument()
  })

  it('stops an ADMIN changing any role at all, a viewer’s included', async () => {
    mockTenant('admin', [
      member(ME, 'admin', 'Me'),
      member(USER_ID_3, 'viewer', 'Vic'),
      member(USER_ID_4, 'owner', 'Otto'),
      member(USER_ID_5, 'admin', 'Amy'),
    ])
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    // Role CHANGE is owner-only — the route is gated requireRole('owner') — even though the matrix lets this admin REMOVE the same viewer.
    expect(vic.queryByRole('combobox')).not.toBeInTheDocument()
    expect(vic.getByRole('button', { name: 'Remove' })).toBeEnabled()

    const otto = await rowFor('Otto')
    expect(otto.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    const amy = await rowFor('Amy')
    expect(amy.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    // Their own admin membership is never Remove, which the matrix refuses; it is Leave, which every role has.
    const me = await rowFor('Me')
    expect(me.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })

  it('offers an admin only the roles below admin when inviting someone', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me')])
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.click(await screen.findByRole('combobox', { name: 'Role' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    // canActorGrantRole: an admin may grant anything EXCEPT owner and admin.
    expect(options).toEqual(['Manager', 'Editor', 'Viewer'])
  })

  it('offers an owner every role when inviting someone', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.click(await screen.findByRole('combobox', { name: 'Role' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['Owner', 'Admin', 'Manager', 'Editor', 'Viewer'])
  })

  it('gives a viewer no controls but Leave, no invite form and no invitations request', async () => {
    let invitationCalls = 0
    mockTenant('viewer', [member(ME, 'viewer', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        invitationCalls += 1
        return ok([], 'Invitations retrieved.')
      })
    )
    const router = renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    const main = within(screen.getByRole('main'))
    expect(main.queryByRole('combobox')).not.toBeInTheDocument()
    expect(main.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(vic.queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument()
    // Only Leave, on their own row.
    expect((await rowFor('Me')).getByRole('button', { name: 'Leave' })).toBeEnabled()

    await act(() =>
      router.navigate({ to: '/tenants/$tenantId/invitations', params: { tenantId: TENANT_ID } })
    )
    await screen.findByText(/Invitations are managed by owners and admins/)
    expect(main.queryByRole('heading', { name: 'Invite a member' })).not.toBeInTheDocument()
    expect(main.queryByRole('heading', { name: 'Pending invitations' })).not.toBeInTheDocument()
    // The list route is owner/admin only, so a viewer's page never asks it.
    expect(invitationCalls).toBe(0)
  })

  it('disables the last owner’s own controls and says why', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const me = await rowFor('Me')
    // The backend answers 409 here. The UI must not invite that error.
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeDisabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeDisabled()
    // ONCE per row, not once per disabled control: the Leave button points at the role cell's copy through aria-describedby rather than repeating the same sentence underneath itself.
    expect(
      me.getAllByText('A tenant must always have an owner. Add another owner first.')
    ).toHaveLength(1)
    const reason = me.getByText('A tenant must always have an owner. Add another owner first.')
    expect(me.getByRole('button', { name: 'Leave' })).toHaveAttribute('aria-describedby', reason.id)
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toHaveAttribute(
      'aria-describedby',
      reason.id
    )
  })

  it('re-enables them once a second owner exists', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const me = await rowFor('Me')
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeEnabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })

  /**
   * At 390px the four-column table scrolls horizontally and puts both the
   * Actions column and the last-owner explanation past the right edge. The
   * card path is ONE render path chosen in JS, not a CSS `sm:hidden` pair:
   * two paths in the DOM would mean two role selects sharing one id.
   */
  it('stacks members as cards on a phone, so no control sits off-screen', async () => {
    setViewportWidth(390)
    mockTenant('owner', [member(ME, 'owner', 'A'), member(USER_ID_2, 'viewer', 'Cleo')])
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    expect(await screen.findByText('Cleo X')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // The controls that were off-screen are present and reachable.
    expect(screen.getByRole('combobox', { name: 'Role for Cleo X' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  /**
   * A header row over nothing is the "blank void for no data" tell. The
   * error branch above still runs FIRST: [] means "no members" only once
   * we know the request answered.
   */
  it('says the list is empty rather than showing a bare table header', async () => {
    mockTenant('owner', [])
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    expect(
      await screen.findByText(
        'No one has access to this tenant yet. An accepted invitation gives someone access.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  /**
   * The role's error state, reachable only through a failed refetch. A FIRST load
   * that fails is the layout's error boundary, so the tab never mounts. A
   * REFETCH that fails keeps the cached row, the layout keeps rendering, and
   * the tab has to say what it no longer knows instead of spinning a skeleton.
   */
  it('renders an error with a working retry when the role cannot be refreshed', async () => {
    let detailFails = false
    let detailCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme', () => {
        detailCalls += 1
        return detailFails
          ? fail('Something went wrong.', 500)
          : ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      }),
      http.get('/api/v1/tenants/acme/members', () =>
        ok([member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')], 'Members retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)
    await screen.findByRole('combobox', { name: 'Role for Me X' })

    detailFails = true
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: tenantKeys.detail('acme', TENANT_ID),
        exact: true,
      })
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load your role/i)
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()

    const before = detailCalls
    detailFails = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    // A NEW detail request, and the controls it gates come back with it.
    await waitFor(() => {
      expect(detailCalls).toBeGreaterThan(before)
    })
    expect(await screen.findByRole('combobox', { name: 'Role for Me X' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  /**
   * The retry has to reach THE QUERY THAT FAILED, and the only proof of that
   * is a new request on the wire, counted. The members failure's retry must
   * refetch the members and leave the tenant detail (the role's source)
   * untouched.
   */
  it('retries the MEMBER LIST, not the tenant detail, when the members are what failed', async () => {
    let memberCalls = 0
    let detailCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme', () => {
        detailCalls += 1
        return ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      }),
      http.get('/api/v1/tenants/acme/members', () => {
        memberCalls += 1
        return fail('Something went wrong.', 500)
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load this tenant’s members/i)
    expect(screen.queryByText(/could not load your role/i)).not.toBeInTheDocument()

    await waitFor(() => {
      expect(memberCalls).toBe(2)
    })
    const membersBefore = memberCalls
    const detailBefore = detailCalls

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(memberCalls).toBeGreaterThan(membersBefore)
    })
    expect(detailCalls).toBe(detailBefore)
  })

  it('shows BOTH failures when both queries fail, each with its own retry', async () => {
    let detailFails = false
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        detailFails
          ? fail('Something went wrong.', 500)
          : ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () => fail('Something went wrong.', 500))
    )
    renderAppAt(`/tenants/${TENANT_ID}/members`)
    await screen.findByRole('alert')

    detailFails = true
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: tenantKeys.detail('acme', TENANT_ID),
        exact: true,
      })
    })

    // Stacked rather than chained: picking one branch would mean picking a winner whose retry cannot fix the loser.
    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(2)
    })
    const text = screen
      .getAllByRole('alert')
      .map((alert) => alert.textContent)
      .join(' ')
    expect(text).toMatch(/could not load this tenant’s members/i)
    expect(text).toMatch(/could not load your role in this tenant/i)
    for (const alert of screen.getAllByRole('alert')) {
      expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    }
  })

  it('changes a role through the API and reports it', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    let patched: unknown = null
    server.use(
      http.patch(`/api/v1/tenants/acme/members/${USER_ID_3}`, async ({ request }) => {
        patched = await request.json()
        return ok(member(USER_ID_3, 'editor', 'Vic').membership, 'Member role updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('combobox', { name: 'Role for Vic X' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))

    await waitFor(() => {
      expect(patched).toEqual({ role: 'editor' })
    })
  })
})

describe('removing and leaving', () => {
  beforeEach(() => {
    signIn()
    mockPlatformDetail()
  })

  it('removes a member once confirmed, says so, and refreshes the list', async () => {
    let removed: unknown
    let body: string | undefined
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.delete('/api/v1/tenants/acme/members/:userId', async ({ params, request }) => {
        removed = params.userId
        body = await request.text()
        return ok(null, 'Member removed.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Vic X?' })
    expect(dialog).toHaveTextContent(
      'Vic X will lose access to this tenant immediately. Pending invitations they sent are revoked.'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Vic X removed.')).toBeInTheDocument()
    expect(removed).toBe(USER_ID_3)
    // A member gives no reason, so the DELETE carries no body.
    expect(body).toBe('')
  })

  it('moves focus to the Members heading once the removed member’s row is gone', async () => {
    let removed = false
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.get('/api/v1/tenants/acme/members', () =>
        ok(
          removed
            ? [member(ME, 'owner', 'Me')]
            : [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')],
          'Members retrieved.'
        )
      ),
      http.delete('/api/v1/tenants/acme/members/:userId', () => {
        removed = true
        return ok(null, 'Member removed.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Vic X?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(screen.queryByRole('cell', { name: /Vic/ })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Members' })).toHaveFocus())
  })

  it('returns focus to Remove when the removal fails', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.delete('/api/v1/tenants/acme/members/:userId', () =>
        fail('Server error', 500, 'internal_error')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    const button = vic.getByRole('button', { name: 'Remove' })
    await user.click(button)
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Vic X?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('Escape on the stacked step-up closes only the step-up; the Remove dialog stays open and removes no one', async () => {
    let calls = 0
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.delete('/api/v1/tenants/acme/members/:userId', () => {
        calls += 1
        return fail('Recent sign-in required', 401, REAUTH_REQUIRED)
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Vic X?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await screen.findByLabelText('Password')

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Confirm it’s you' })).not.toBeInTheDocument()
    )
    const still = screen.getByRole('alertdialog', { name: 'Remove Vic X?' })
    expect(await within(still).findByText('Confirm it’s you to continue.')).toBeInTheDocument()
    await waitFor(() => expect(still.contains(document.activeElement)).toBe(true))
    expect(calls).toBe(1)
    expect(screen.getByText('Vic X')).toBeInTheDocument()
  })

  it('says why a removal was refused, and closes the dialog', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.delete('/api/v1/tenants/acme/members/:userId', () =>
        fail('You cannot remove this member.', 403)
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Vic X?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('You cannot remove this member.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('leaves a customer tenant and stays on it, now through staff access', async () => {
    const state = serveLeaving('owner', [member(USER_ID_4, 'owner', 'Otto')])
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/members`)

    const me = await rowFor('Me')
    await user.click(me.getByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    expect(await screen.findByText('You left this tenant.')).toBeInTheDocument()
    expect(state.left).toBe(1)
    // The refetched list no longer has Me, and the card has switched to the staff controls.
    await waitFor(() =>
      expect(screen.queryByRole('cell', { name: /Me X/ })).not.toBeInTheDocument()
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Members' })).toHaveFocus())
    expect(router.state.location.pathname).toBe(`/tenants/${TENANT_ID}/members`)
    expect(queryClient.getQueryData(tenantKeys.detail('acme', TENANT_ID))).toMatchObject({
      access: 'platform',
    })
  })

  it('lets a viewer leave through the self-leave route, and says they keep staff access', async () => {
    const state = serveLeaving('viewer', [member(USER_ID_4, 'owner', 'Otto')])
    server.use(http.delete('/api/v1/tenants/acme/members/:userId', () => fail('Forbidden', 403)))
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/members`)

    const me = await rowFor('Me')
    await user.click(me.getByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    expect(dialog).toHaveAccessibleDescription(LEAVE_CUSTOMER)
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    expect(await screen.findByText('You left this tenant.')).toBeInTheDocument()
    expect(state.left).toBe(1)
    await waitFor(() =>
      expect(screen.queryByRole('cell', { name: /Me X/ })).not.toBeInTheDocument()
    )
    expect(router.state.location.pathname).toBe(`/tenants/${TENANT_ID}/members`)
  })

  it.each(['manager', 'editor'] as const)(
    'lets the %s leave too, without the invitations sentence',
    async (role) => {
      mockTenant(role, [member(ME, role, 'Me'), member(USER_ID_4, 'owner', 'Otto')])
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}/members`)

      await user.click((await rowFor('Me')).getByRole('button', { name: 'Leave' }))
      expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(LEAVE_CUSTOMER)
    }
  )

  it.each(['owner', 'admin'] as const)(
    'tells an %s leaving that the invitations they sent are revoked',
    async (role) => {
      mockTenant(role, [member(ME, role, 'Me'), member(USER_ID_4, 'owner', 'Otto')])
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}/members`)

      await user.click((await rowFor('Me')).getByRole('button', { name: 'Leave' }))
      expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
        `${LEAVE_CUSTOMER} Pending invitations you sent are revoked.`
      )
    }
  )

  it('switches Leave off while the leave is in flight, so a second click sends nothing', async () => {
    let left = 0
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    mockTenant('viewer', [member(ME, 'viewer', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    server.use(
      http.delete('/api/v1/tenants/acme/membership', async () => {
        left += 1
        await held
        return ok(null, 'You left the tenant.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const me = await rowFor('Me')
    await user.click(me.getByRole('button', { name: 'Leave' }))
    const confirm = within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Leave',
    })
    await user.click(confirm)
    await waitFor(() => expect(confirm).toBeDisabled())
    expect(me.getByRole('button', { name: 'Leave', hidden: true })).toBeDisabled()
    await user.click(confirm)
    release()

    expect(await screen.findByText('You left this tenant.')).toBeInTheDocument()
    expect(left).toBe(1)
  })

  it('keeps the tenant’s cache and refetches it, since staff access still reads it', async () => {
    const state = serveLeaving('viewer', [member(USER_ID_4, 'owner', 'Otto')])
    const afterLeaving: string[] = []
    const record = ({ request }: { request: Request }) => {
      if (state.left > 0) afterLeaving.push(`${request.method} ${new URL(request.url).pathname}`)
    }
    const dropped: string[] = []
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed' && event.query.queryHash.startsWith('["tenants","acme"')) {
        dropped.push(event.query.queryHash)
      }
    })
    server.events.on('request:start', record)
    try {
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}/members`)

      await user.click((await rowFor('Me')).getByRole('button', { name: 'Leave' }))
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
      )

      await waitFor(() => expect(afterLeaving).toContain('GET /api/v1/tenants/acme'))
      expect(afterLeaving).toContain('GET /api/v1/tenants/acme/members')
      expect(dropped).toEqual([])
    } finally {
      unsubscribe()
      server.events.removeListener('request:start', record)
    }
  })

  it('shows the refreshed member list after a refused leave', async () => {
    let memberCalls = 0
    mockTenant('owner', [])
    server.use(
      http.get('/api/v1/tenants/acme/members', () => {
        memberCalls += 1
        return ok(
          [
            member(ME, 'owner', 'Me'),
            member(USER_ID_4, memberCalls === 1 ? 'owner' : 'admin', 'Otto'),
          ],
          'Members retrieved.'
        )
      }),
      http.delete('/api/v1/tenants/acme/membership', () =>
        fail(
          'You are the last owner: make someone else an owner before you leave.',
          409,
          'LAST_OWNER'
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    await user.click((await rowFor('Me')).getByRole('button', { name: 'Leave' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
    )

    await waitFor(async () =>
      expect((await rowFor('Me')).getByRole('button', { name: 'Leave' })).toBeDisabled()
    )
    expect((await rowFor('Me')).getByRole('button', { name: 'Leave' })).toHaveAccessibleDescription(
      'A tenant must always have an owner. Add another owner first.'
    )
  })

  it('says why leaving was refused, closes the dialog and stays on the page', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    server.use(
      http.delete('/api/v1/tenants/acme/membership', () =>
        fail(
          'You are the last owner: make someone else an owner before you leave.',
          409,
          'LAST_OWNER'
        )
      )
    )
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/members`)
    const me = await rowFor('Me')
    await user.click(me.getByRole('button', { name: 'Leave' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave this tenant?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))
    expect(
      await screen.findByText(
        'You are the last owner: make someone else an owner before you leave.'
      )
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe(`/tenants/${TENANT_ID}/members`)
  })

  it('says so, and stays, when the membership was already gone', async () => {
    const state = serveLeaving('viewer', [member(USER_ID_4, 'owner', 'Otto')])
    server.use(
      http.delete('/api/v1/tenants/acme/membership', () => {
        state.left += 1
        return fail('Tenant not found', 404)
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/members`)

    await user.click((await rowFor('Me')).getByRole('button', { name: 'Leave' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
    )

    expect(
      await screen.findByText('You are no longer a member of this tenant.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Tenant not found')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('cell', { name: /Me X/ })).not.toBeInTheDocument()
    )
    expect(router.state.location.pathname).toBe(`/tenants/${TENANT_ID}/members`)
  })

  it('shows the server’s message, and stays, when removing someone else answers 404', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.delete('/api/v1/tenants/acme/members/:userId', () => fail('Member not found', 404))
    )
    const user = userEvent.setup()
    const router = renderAppAt(`/tenants/${TENANT_ID}/members`)

    await user.click((await rowFor('Vic')).getByRole('button', { name: 'Remove' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' })
    )

    expect(await screen.findByText('Member not found')).toBeInTheDocument()
    expect(screen.queryByText('You are no longer a member of this tenant.')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe(`/tenants/${TENANT_ID}/members`)
  })

  it('says why a role change was refused', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.patch(`/api/v1/tenants/acme/members/${USER_ID_3}`, () =>
        fail('You cannot grant that role.', 403)
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('combobox', { name: 'Role for Vic X' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))

    expect(await screen.findByText('You cannot grant that role.')).toBeInTheDocument()
  })
})

describe('the invite form role select', () => {
  beforeEach(() => {
    signIn()
    mockPlatformDetail()
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
  })

  it('points its label at the VISIBLE control, not at a hidden input', async () => {
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    const trigger = await screen.findByRole('combobox', { name: 'Role' })
    const label = screen.getByText('Role', { selector: 'label' })
    // `FormControl`'s id lands on the Select's trigger BUTTON, so the label points at a visible control.
    expect(label).toHaveAttribute('for', trigger.id)
    expect(trigger.tagName).toBe('BUTTON')
  })

  it('clears the server’s verdict on the role when the select changes', async () => {
    server.use(
      // A field-level verdict on `role`, which is what the clearing rule is about. `fail()` carries no `errors` map, so this one is built here.
      http.post('/api/v1/tenants/acme/invitations', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Validation failed.',
            statusCode: 400,
            errors: { role: ['That role is not yours to grant.'] },
            requestId: 'test-request-id',
          },
          { status: 400 }
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))
    await screen.findByText('That role is not yours to grant.')

    /**
     * Base UI's selection does NOT bubble a change event to the <form>, so
     * <Form>'s own clearing rule never fires for this control — the page
     * calls clearField by hand. Without that line this message would sit
     * there while the user changed the very field it is about.
     */
    await user.click(screen.getByRole('combobox', { name: 'Role' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))

    await waitFor(() => {
      expect(screen.queryByText('That role is not yours to grant.')).not.toBeInTheDocument()
    })
  })
})

/** A pending row with its own id and address; everything else from `testInvitation`. */
function invitation(
  id: string,
  email: string,
  overrides: Partial<TenantInvitation> = {}
): TenantInvitation {
  return { ...testInvitation, id, email, ...overrides }
}

describe('inviting, and the pending invitations', () => {
  beforeEach(() => {
    signIn()
    mockPlatformDetail()
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
  })

  it('sends an invitation, says so, and refreshes the pending list', async () => {
    let body: unknown
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(
          listCalls === 1 ? [] : [invitation(INVITATION_ID_2, 'new@b.com', { role: 'viewer' })],
          'Invitations retrieved.'
        )
      }),
      http.post('/api/v1/tenants/acme/invitations', async ({ request }) => {
        body = await request.json()
        return ok(null, INVITATION_SENT_MESSAGE, 202)
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.type(await screen.findByLabelText('Email'), 'New@B.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    // The 202 is the same for every address, so the toast names what was sent.
    expect(await screen.findByText('Invitation sent to new@b.com.')).toBeInTheDocument()
    expect(body).toEqual({ email: 'new@b.com', role: 'viewer' })
    expect(await screen.findByText('new@b.com')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('')
  })

  it('shows already_member on the email field, not in a toast', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('That person is already a member.', 409, 'already_member')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    const email = await screen.findByLabelText('Email')
    await user.type(email, 'u3@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    await waitFor(() => {
      expect(email).toHaveAccessibleDescription('That person is already a member.')
    })
    expect(email).toHaveAttribute('aria-invalid', 'true')
    // Once: inline. A toast as well would say the same thing twice.
    expect(screen.getAllByText('That person is already a member.')).toHaveLength(1)

    // Changing the address clears it, like any other server verdict.
    await user.type(email, 'x')
    await waitFor(() => {
      expect(screen.queryByText('That person is already a member.')).not.toBeInTheDocument()
    })
  })

  it('says a racing invite won, and shows it in the refreshed list', async () => {
    const toastError = vi.spyOn(toast, 'error')
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(
          listCalls === 1 ? [] : [invitation(INVITATION_ID_9, 'new@b.com')],
          'Invitations retrieved.'
        )
      }),
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('An invitation for this address was just created.', 409, 'invitation_conflict')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    const raced = await screen.findByText(
      'Someone just invited this address — refresh and try again.'
    )
    expect(raced.closest('form')).not.toBeNull()
    expect(toastError).not.toHaveBeenCalled()
    // The winning invitation arrives with the refetch.
    expect(await screen.findByText('new@b.com', { selector: 'span' })).toBeInTheDocument()
  })

  it('shows any other refusal in the form, once, and leaves the field alone', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('Too many attempts. Please try again later.', 429, 'RATE_LIMITED')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    const email = await screen.findByLabelText('Email')
    await user.type(email, 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    const message = await screen.findByText('Too many attempts. Please try again later.')
    expect(message.closest('form')).not.toBeNull()
    expect(screen.getAllByText('Too many attempts. Please try again later.')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
    expect(email).toHaveAttribute('aria-invalid', 'false')
  })

  it('lists each pending invitation with its role, inviter and expiry', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          [
            testInvitation,
            invitation(INVITATION_ID_2, 'old@b.com', { role: 'viewer', invitedBy: null }),
          ],
          'Invitations retrieved.'
        )
      )
    )
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    expect(await screen.findByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument()
    const first = within((await screen.findByText('invitee@b.com')).closest('li') as HTMLElement)
    expect(first.getByText('Editor · Invited by A B')).toBeInTheDocument()
    expect(first.getByText(/^Expires /)).toBeInTheDocument()
    // An inviter whose account is gone is `null`, not a crash.
    const second = within(screen.getByText('old@b.com').closest('li') as HTMLElement)
    expect(second.getByText('Viewer · Invited by A teammate')).toBeInTheDocument()
  })

  it('says when nothing is pending', async () => {
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
  })

  it('offers a retry when the pending list fails, and the retry refetches it', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        calls += 1
        // Two failures: the router's client retries once by itself.
        return calls <= 2
          ? fail('Something went wrong.', 500)
          : ok([testInvitation], 'Invitations retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load the pending invitations/i)
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('invitee@b.com')).toBeInTheDocument()
  })

  it('shows the section to an admin too', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me')])
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    expect(await screen.findByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument()
  })

  it('resends one invitation, says so, and refreshes the list', async () => {
    let resent: unknown
    let body: string | undefined
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok([testInvitation], 'Invitations retrieved.')
      }),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', async ({ params, request }) => {
        resent = params.id
        body = await request.text()
        return ok(null, INVITATION_SENT_MESSAGE, 202)
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.click(
      await screen.findByRole('button', { name: 'Resend invitation to invitee@b.com' })
    )

    expect(await screen.findByText('Invitation resent to invitee@b.com.')).toBeInTheDocument()
    expect(resent).toBe(INVITATION_ID)
    expect(body).toBe('')
    // The expiry moved, so the list is fetched again.
    await waitFor(() => {
      expect(listCalls).toBeGreaterThan(1)
    })
  })

  it('shows the server’s message when a resend is refused, e.g. a 403', async () => {
    // Offered to an owner, and refused anyway: the server has the last word.
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          [invitation(INVITATION_ID, 'invitee@b.com', { role: 'owner' })],
          'Invitations retrieved.'
        )
      ),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', () =>
        fail('You cannot manage an invitation for that role.', 403)
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.click(
      await screen.findByRole('button', { name: 'Resend invitation to invitee@b.com' })
    )

    expect(
      await screen.findByText('You cannot manage an invitation for that role.')
    ).toBeInTheDocument()
  })

  it('switches off Resend, with the reason, for a role an admin cannot grant', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          [
            invitation(INVITATION_ID, 'owner@example.com', { role: 'owner' }),
            invitation(INVITATION_ID_2, 'admin@example.com', { role: 'admin' }),
            invitation(INVITATION_ID_3, 'editor@example.com', { role: 'editor' }),
          ],
          'Invitations retrieved.'
        )
      )
    )
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    for (const email of ['owner@example.com', 'admin@example.com']) {
      const resend = await screen.findByRole('button', { name: `Resend invitation to ${email}` })
      expect(resend).toBeDisabled()
      expect(resend).toHaveAccessibleDescription(
        'Only an owner can resend or revoke an invitation for this role.'
      )
    }
    const editorResend = screen.getByRole('button', {
      name: 'Resend invitation to editor@example.com',
    })
    expect(editorResend).toBeEnabled()
    expect(editorResend).not.toHaveAttribute('aria-describedby')
  })

  it('switches off Revoke, with the reason, for a role an admin cannot grant', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          [
            invitation(INVITATION_ID, 'owner@example.com', { role: 'owner' }),
            invitation(INVITATION_ID_2, 'admin@example.com', { role: 'admin' }),
            invitation(INVITATION_ID_3, 'editor@example.com', { role: 'editor' }),
          ],
          'Invitations retrieved.'
        )
      )
    )
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    for (const email of ['owner@example.com', 'admin@example.com']) {
      const revoke = await screen.findByRole('button', { name: `Revoke invitation to ${email}` })
      expect(revoke).toBeDisabled()
      expect(revoke).toHaveAccessibleDescription(
        'Only an owner can resend or revoke an invitation for this role.'
      )
    }
    const editorRevoke = screen.getByRole('button', {
      name: 'Revoke invitation to editor@example.com',
    })
    expect(editorRevoke).toBeEnabled()
    expect(editorRevoke).not.toHaveAttribute('aria-describedby')
  })

  it('lets an owner resend and revoke an invitation for every role', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          [
            invitation(INVITATION_ID, 'owner@example.com', { role: 'owner' }),
            invitation(INVITATION_ID_2, 'admin@example.com', { role: 'admin' }),
            invitation(INVITATION_ID_3, 'editor@example.com', { role: 'editor' }),
          ],
          'Invitations retrieved.'
        )
      )
    )
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    for (const email of ['owner@example.com', 'admin@example.com', 'editor@example.com']) {
      expect(
        await screen.findByRole('button', { name: `Resend invitation to ${email}` })
      ).toBeEnabled()
      expect(screen.getByRole('button', { name: `Revoke invitation to ${email}` })).toBeEnabled()
    }
    expect(
      screen.queryByText('Only an owner can resend or revoke an invitation for this role.')
    ).not.toBeInTheDocument()
  })

  it('says a resend found the invitation no longer pending, and refreshes the list', async () => {
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(listCalls === 1 ? [testInvitation] : [], 'Invitations retrieved.')
      }),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', () =>
        fail('Invitation not found.', 404, 'invitation_not_found')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.click(
      await screen.findByRole('button', { name: 'Resend invitation to invitee@b.com' })
    )

    expect(await screen.findByText('That invitation is no longer pending.')).toBeInTheDocument()
    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
  })

  it('asks before revoking, and Cancel sends nothing', async () => {
    let deletes = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok([testInvitation], 'Invitations retrieved.')
      ),
      http.delete('/api/v1/tenants/acme/invitations/:id', () => {
        deletes += 1
        return ok(null, 'Invitation revoked.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    // The app's AlertDialog, not a browser confirm().
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Revoke the invitation to invitee@b.com?')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(deletes).toBe(0)
    expect(screen.getByText('invitee@b.com')).toBeInTheDocument()
  })

  it('revokes on confirm, says so, and drops the row', async () => {
    let revoked: unknown
    let body: string | undefined
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(revoked ? [] : [testInvitation], 'Invitations retrieved.')
      ),
      http.delete('/api/v1/tenants/acme/invitations/:id', async ({ params, request }) => {
        revoked = params.id
        body = await request.text()
        return ok(null, 'Invitation revoked.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    // The toast still arrives although the refetch unmounts the row first.
    expect(await screen.findByText('Invitation to invitee@b.com revoked.')).toBeInTheDocument()
    expect(revoked).toBe(INVITATION_ID)
    expect(body).toBe('')
    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Pending invitations' })).toHaveFocus()
    )
  })

  it('returns focus to Revoke when the revoke fails', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok([testInvitation], 'Invitations retrieved.')
      ),
      http.delete('/api/v1/tenants/acme/invitations/:id', () =>
        fail('Server error', 500, 'internal_error')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    const button = await screen.findByRole('button', {
      name: 'Revoke invitation to invitee@b.com',
    })
    await user.click(button)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('reports a revoke that lost the race, and refreshes the list', async () => {
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(listCalls === 1 ? [testInvitation] : [], 'Invitations retrieved.')
      }),
      http.delete('/api/v1/tenants/acme/invitations/:id', () =>
        fail('Invitation not found.', 404, 'invitation_not_found')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    expect(await screen.findByText('That invitation is no longer pending.')).toBeInTheDocument()
    // Someone else revoked or it was accepted: the row goes either way.
    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
    // A refusal is no success: the heading does not take focus.
    expect(screen.getByRole('heading', { name: 'Pending invitations' })).not.toHaveFocus()
  })
})

describe('staff acting through platform access', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'owner' })
    mockPlatformDetail()
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, 'owner', 'platform'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () =>
        ok(
          [member(USER_ID_4, 'owner', 'Otto'), member(USER_ID_3, 'viewer', 'Vic')],
          'Members retrieved.'
        )
      ),
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      )
    )
  })

  /** Confirms the step-up dialog the API's first REAUTH_REQUIRED opened. */
  async function confirmStepUp(user: ReturnType<typeof userEvent.setup>) {
    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(stepUp).getByLabelText('Password'), 'zqS7-step-up-pass')
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))
  }

  it('offers no Leave through platform access, which holds no membership to leave', async () => {
    // The API never lists the caller here; a listing that did must still not offer the members-only route.
    server.use(
      http.get('/api/v1/tenants/acme/members', () =>
        ok([member(ME, 'viewer', 'Me'), member(USER_ID_3, 'viewer', 'Vic')], 'Members retrieved.')
      )
    )
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const me = await rowFor('Me')
    expect(me.queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument()
    expect((await rowFor('Vic')).getByRole('button', { name: 'Remove' })).toBeEnabled()
  })

  it('asks for a reason before a role change, and sends it after the step-up', async () => {
    const bodies: unknown[] = []
    server.use(
      http.patch(`/api/v1/tenants/acme/members/${USER_ID_3}`, async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? fail('Confirm your identity to continue', 401, REAUTH_REQUIRED)
          : ok({ ...member(USER_ID_3, 'editor', 'Vic').membership }, 'Role updated.')
      })
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('combobox', { name: 'Role for Vic X' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Change this member’s role?' })
    expect(dialog).toHaveTextContent('Vic X becomes Editor in this customer tenant.')
    expect(bodies).toEqual([])
    await user.type(within(dialog).getByLabelText('Reason'), 'Ticket 4411: customer asked')
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }))
    await confirmStepUp(user)

    await waitFor(() => expect(success).toHaveBeenCalled())
    expect(bodies).toEqual([
      { role: 'editor', reason: 'Ticket 4411: customer asked' },
      { role: 'editor', reason: 'Ticket 4411: customer asked' },
    ])
  })

  it('sends nothing when the reason dialog is cancelled', async () => {
    let patches = 0
    server.use(
      http.patch(`/api/v1/tenants/acme/members/${USER_ID_3}`, () => {
        patches += 1
        return ok({ ...member(USER_ID_3, 'editor', 'Vic').membership }, 'Role updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)
    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('combobox', { name: 'Role for Vic X' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Change this member’s role?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(patches).toBe(0)
    expect(vic.getByRole('combobox', { name: 'Role for Vic X' })).toHaveTextContent('Viewer')
  })

  it('asks for a reason before a removal, and sends it in the body', async () => {
    let body: unknown
    server.use(
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, async ({ request }) => {
        body = await request.json()
        return ok(null, 'Member removed.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this member?' })
    expect(dialog).toHaveTextContent(
      'Vic X will lose access to this tenant immediately. Pending invitations they sent are revoked.'
    )
    await user.type(within(dialog).getByLabelText('Reason'), 'Offboarding request')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Vic X removed.')).toBeInTheDocument()
    expect(body).toEqual({ reason: 'Offboarding request' })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Members' })).toHaveFocus())
  })

  it('refuses an empty reason in the dialog and sends nothing', async () => {
    let deletes = 0
    server.use(
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () => {
        deletes += 1
        return ok(null, 'Member removed.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)
    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this member?' })
    await user.type(within(dialog).getByLabelText('Reason'), '   ')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(await within(dialog).findByText('Enter a reason.')).toBeInTheDocument()
    expect(deletes).toBe(0)
  })

  it('shows a refusal inside the reason dialog and keeps it open', async () => {
    server.use(
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () =>
        fail('Give a reason of 1 to 500 characters for this change.', 400, 'REASON_REQUIRED')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)
    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this member?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(
      await within(dialog).findByText('Give a reason of 1 to 500 characters for this change.')
    ).toBeInTheDocument()
    // On the Reason field, not at form level: it is that field the API refused.
    const reason = within(dialog).getByLabelText('Reason')
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(reason).toHaveAccessibleDescription(
      expect.stringContaining('Give a reason of 1 to 500 characters for this change.')
    )
  })

  it('asks for a reason after the invite form validates, and sends it with the invitation', async () => {
    let body: unknown
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => ok([], 'Invitations retrieved.')),
      http.post('/api/v1/tenants/acme/invitations', async ({ request }) => {
        body = await request.json()
        return ok(null, INVITATION_SENT_MESSAGE, 202)
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.type(await screen.findByLabelText('Email'), 'New@Example.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send this invitation?' })
    expect(dialog).toHaveTextContent(
      'new@example.com will be invited to this customer tenant as Viewer.'
    )
    expect(body).toBeUndefined()
    await user.type(within(dialog).getByLabelText('Reason'), 'Owner asked by email')
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))

    expect(await screen.findByText('Invitation sent to new@example.com.')).toBeInTheDocument()
    expect(body).toEqual({
      email: 'new@example.com',
      role: 'viewer',
      reason: 'Owner asked by email',
    })
    expect(screen.getByLabelText('Email')).toHaveValue('')
  })

  it('says a racing invite won inside the reason dialog', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => ok([], 'Invitations retrieved.')),
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('An invitation is already pending.', 409, 'invitation_conflict')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)
    await user.type(await screen.findByLabelText('Email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send this invitation?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
    expect(
      await within(dialog).findByText('Someone just invited this address — refresh and try again.')
    ).toBeInTheDocument()
  })

  it('asks for a reason before a resend and a revoke, and sends each', async () => {
    const bodies: Record<string, unknown> = {}
    let revoked = false
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          revoked ? [] : [invitation(INVITATION_ID, 'invitee@example.com')],
          'Invitations retrieved.'
        )
      ),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', async ({ request }) => {
        bodies.resend = await request.json()
        return ok(null, INVITATION_SENT_MESSAGE, 202)
      }),
      http.delete('/api/v1/tenants/acme/invitations/:id', async ({ request }) => {
        bodies.revoke = await request.json()
        revoked = true
        return ok(null, 'Invitation revoked.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)

    await user.click(
      await screen.findByRole('button', { name: 'Resend invitation to invitee@example.com' })
    )
    const resend = await screen.findByRole('alertdialog', { name: 'Resend this invitation?' })
    expect(resend).toHaveTextContent(
      'A new link goes to invitee@example.com; the old one stops working.'
    )
    await user.type(within(resend).getByLabelText('Reason'), 'Lost the first mail')
    await user.click(within(resend).getByRole('button', { name: 'Resend' }))
    expect(await screen.findByText('Invitation resent to invitee@example.com.')).toBeInTheDocument()
    expect(bodies.resend).toEqual({ reason: 'Lost the first mail' })

    await user.click(
      screen.getByRole('button', { name: 'Revoke invitation to invitee@example.com' })
    )
    const revoke = await screen.findByRole('alertdialog', { name: 'Revoke this invitation?' })
    await user.type(within(revoke).getByLabelText('Reason'), 'Sent to the wrong address')
    await user.click(within(revoke).getByRole('button', { name: 'Revoke' }))
    expect(
      await screen.findByText('Invitation to invitee@example.com revoked.')
    ).toBeInTheDocument()
    expect(bodies.revoke).toEqual({ reason: 'Sent to the wrong address' })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Pending invitations' })).toHaveFocus()
    )
  })

  /** One staff write: how to reach its reason dialog, and what it sends. */
  interface StaffWrite {
    route: string
    method: 'post' | 'delete'
    url: string
    page: 'members' | 'invitations'
    open: (user: ReturnType<typeof userEvent.setup>) => Promise<void>
    title: string
    confirm: string
    toast: string
    body: unknown
  }

  const STAFF_WRITES: StaffWrite[] = [
    {
      route: 'a removal',
      method: 'delete',
      url: `/api/v1/tenants/acme/members/${USER_ID_3}`,
      page: 'members',
      open: async (user) => {
        await user.click((await rowFor('Vic')).getByRole('button', { name: 'Remove' }))
      },
      title: 'Remove this member?',
      confirm: 'Remove',
      toast: 'Vic X removed.',
      body: { reason: 'Ticket 4411' },
    },
    {
      route: 'an invitation',
      method: 'post',
      url: '/api/v1/tenants/acme/invitations',
      page: 'invitations',
      open: async (user) => {
        await user.type(await screen.findByLabelText('Email'), 'new@example.com')
        await user.click(screen.getByRole('button', { name: 'Invite member' }))
      },
      title: 'Send this invitation?',
      confirm: 'Send invitation',
      toast: 'Invitation sent to new@example.com.',
      body: { email: 'new@example.com', role: 'viewer', reason: 'Ticket 4411' },
    },
    {
      route: 'a resend',
      method: 'post',
      url: `/api/v1/tenants/acme/invitations/${INVITATION_ID}/resend`,
      page: 'invitations',
      open: async (user) => {
        await user.click(
          await screen.findByRole('button', { name: 'Resend invitation to invitee@example.com' })
        )
      },
      title: 'Resend this invitation?',
      confirm: 'Resend',
      toast: 'Invitation resent to invitee@example.com.',
      body: { reason: 'Ticket 4411' },
    },
    {
      route: 'a revoke',
      method: 'delete',
      url: `/api/v1/tenants/acme/invitations/${INVITATION_ID}`,
      page: 'invitations',
      open: async (user) => {
        await user.click(
          await screen.findByRole('button', { name: 'Revoke invitation to invitee@example.com' })
        )
      },
      title: 'Revoke this invitation?',
      confirm: 'Revoke',
      toast: 'Invitation to invitee@example.com revoked.',
      body: { reason: 'Ticket 4411' },
    },
  ]

  it.each(STAFF_WRITES)(
    'confirms a stale sign-in for $route, then sends the reason again',
    async ({ method, url, page, open, title, confirm, toast: said, body }) => {
      const bodies: unknown[] = []
      server.use(
        http.get('/api/v1/tenants/acme/invitations', () =>
          ok([invitation(INVITATION_ID, 'invitee@example.com')], 'Invitations retrieved.')
        ),
        http[method](url, async ({ request }) => {
          bodies.push(await request.json())
          return bodies.length === 1
            ? fail('Confirm your identity to continue', 401, REAUTH_REQUIRED)
            : ok(null, 'Done.', method === 'post' ? 202 : 200)
        })
      )
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}/${page}`)

      await open(user)
      const dialog = await screen.findByRole('alertdialog', { name: title })
      await user.type(within(dialog).getByLabelText('Reason'), 'Ticket 4411')
      await user.click(within(dialog).getByRole('button', { name: confirm }))
      await confirmStepUp(user)

      expect(await screen.findByText(said)).toBeInTheDocument()
      expect(bodies).toEqual([body, body])
    }
  )

  it('names the address in the revoke dialog without a possessive', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok([invitation(INVITATION_ID, 'invitee@example.com')], 'Invitations retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)
    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@example.com' })
    )
    expect(
      await screen.findByRole('alertdialog', { name: 'Revoke this invitation?' })
    ).toHaveTextContent(
      'The link sent to invitee@example.com stops working immediately. You can invite them again later.'
    )
  })

  it.each([
    {
      action: 'resend',
      method: 'post',
      url: '/api/v1/tenants/acme/invitations/:id/resend',
      label: 'Resend',
      title: 'Resend this invitation?',
    },
    {
      action: 'revoke',
      method: 'delete',
      url: '/api/v1/tenants/acme/invitations/:id',
      label: 'Revoke',
      title: 'Revoke this invitation?',
    },
  ] as const)(
    'says a staff $action found the invitation no longer pending, though the refetch took its row',
    async ({ method, url, label, title }) => {
      let listCalls = 0
      server.use(
        http.get('/api/v1/tenants/acme/invitations', () => {
          listCalls += 1
          return ok(
            listCalls === 1 ? [invitation(INVITATION_ID, 'invitee@example.com')] : [],
            'Invitations retrieved.'
          )
        }),
        http[method](url, () => fail('Invitation not found', 404, 'invitation_not_found'))
      )
      const error = vi.spyOn(toast, 'error')
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}/invitations`)

      await user.click(
        await screen.findByRole('button', { name: `${label} invitation to invitee@example.com` })
      )
      const dialog = await screen.findByRole('alertdialog', { name: title })
      await user.type(within(dialog).getByLabelText('Reason'), 'Ticket 4411')
      await user.click(within(dialog).getByRole('button', { name: label }))

      expect(await screen.findByText('That invitation is no longer pending.')).toBeInTheDocument()
      expect(error).toHaveBeenCalledTimes(1)
      expect(
        await screen.findByText('No invitations are waiting to be accepted.')
      ).toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      // A refusal is no success: the heading does not take focus.
      expect(screen.getByRole('heading', { name: 'Pending invitations' })).not.toHaveFocus()
    }
  )

  it('says a staff removal found the member already gone, in the member path’s words', async () => {
    server.use(
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () => fail('Member not found', 404))
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    await user.click((await rowFor('Vic')).getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this member?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Ticket 4411')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Member not found')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.queryByText(/Your role can’t do this any more/)).not.toBeInTheDocument()
  })

  it('says a staff role change found the member already gone, in the member path’s words', async () => {
    server.use(
      http.patch(`/api/v1/tenants/acme/members/${USER_ID_3}`, () => fail('Member not found', 404))
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    await user.click((await rowFor('Vic')).getByRole('combobox', { name: 'Role for Vic X' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Change this member’s role?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Ticket 4411')
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }))

    expect(await screen.findByText('Member not found')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.queryByText(/Your role can’t do this any more/)).not.toBeInTheDocument()
  })

  it('keeps the role gate’s sentence for a 404 that is not the member’s', async () => {
    server.use(
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () => fail('Tenant not found', 404))
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    await user.click((await rowFor('Vic')).getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this member?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Ticket 4411')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(await within(dialog).findByText(/Your role can’t do this any more/)).toBeInTheDocument()
  })

  /** Opens the invite reason dialog for `email` and confirms it with a reason. */
  async function inviteAsStaff(user: ReturnType<typeof userEvent.setup>, email: string) {
    await user.type(await screen.findByLabelText('Email'), email)
    await user.click(screen.getByRole('button', { name: 'Invite member' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Send this invitation?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Owner asked by email')
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
  }

  it('closes the dialog and puts an address the API refused on the Email field', async () => {
    server.use(
      // Express's parseBody envelope for its stricter invite domain rule, which apex's form does not check.
      http.post('/api/v1/tenants/acme/invitations', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Validation failed',
            statusCode: 400,
            errors: { email: ['Email must have a valid domain.'] },
            requestId: 'test-request-id',
          },
          { status: 400 }
        )
      )
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)
    await inviteAsStaff(user, 'x@foo-.example.com')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const email = screen.getByLabelText('Email')
    expect(email).toHaveValue('x@foo-.example.com')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(
      expect.stringContaining('Email must have a valid domain.')
    )
    await waitFor(() => expect(email).toHaveFocus())
    expect(success).not.toHaveBeenCalled()
  })

  it('closes the dialog and puts already_member on the Email field', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('That person is already a member.', 409, 'already_member')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)
    await inviteAsStaff(user, 'vic@example.com')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const email = screen.getByLabelText('Email')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(
      expect.stringContaining('That person is already a member.')
    )
    await waitFor(() => expect(email).toHaveFocus())
  })

  it('returns focus to Invite member when the dialog reopened after a field refusal is cancelled', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('That person is already a member.', 409, 'already_member')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)
    await inviteAsStaff(user, 'vic@example.com')
    const email = screen.getByLabelText('Email')
    await waitFor(() => expect(email).toHaveFocus())

    const invite = screen.getByRole('button', { name: 'Invite member' })
    await user.click(invite)
    const dialog = await screen.findByRole('alertdialog', { name: 'Send this invitation?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(invite).toHaveFocus())
  })

  it('closes the dialog and puts a refused role on the Role field', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Validation failed',
            statusCode: 400,
            errors: { role: ['Invalid option: expected one of "owner"|"admin"|"editor"|"viewer"'] },
            requestId: 'test-request-id',
          },
          { status: 400 }
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/invitations`)
    await inviteAsStaff(user, 'new@example.com')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const role = screen.getByRole('combobox', { name: 'Role' })
    expect(role).toHaveAttribute('aria-invalid', 'true')
    expect(role).toHaveAccessibleDescription(
      expect.stringContaining('Invalid option: expected one of')
    )
  })

  it('switches to the staff controls when a member write finds the membership gone', async () => {
    let detailCalls = 0
    server.use(
      // The first read is from before the caller's membership went; express now answers through platform access.
      http.get('/api/v1/tenants/acme', () => {
        detailCalls += 1
        return ok(
          tenantDetail(TENANT, 'owner', detailCalls === 1 ? 'member' : 'platform'),
          'Tenant retrieved.'
        )
      }),
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () =>
        fail('Give a reason of 1 to 500 characters for this change.', 400, 'REASON_REQUIRED')
      )
    )
    const user = userEvent.setup()
    renderAppAt(`/tenants/${TENANT_ID}/members`)

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    const member = await screen.findByRole('alertdialog', { name: 'Remove Vic X?' })
    await user.click(within(member).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(detailCalls).toBe(2))

    await user.click((await rowFor('Vic')).getByRole('button', { name: 'Remove' }))
    expect(
      await screen.findByRole('alertdialog', { name: 'Remove this member?' })
    ).toBeInTheDocument()
  })

  it('says why a member write was refused without waiting for the access refresh', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let detailCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme', async () => {
        detailCalls += 1
        if (detailCalls > 1) await held
        return ok(
          tenantDetail(TENANT, 'owner', detailCalls === 1 ? 'member' : 'platform'),
          'Tenant retrieved.'
        )
      }),
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () =>
        fail('Give a reason of 1 to 500 characters for this change.', 400, 'REASON_REQUIRED')
      )
    )
    try {
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}/members`)

      await user.click((await rowFor('Vic')).getByRole('button', { name: 'Remove' }))
      const member = await screen.findByRole('alertdialog', { name: 'Remove Vic X?' })
      await user.click(within(member).getByRole('button', { name: 'Remove' }))

      expect(
        await screen.findByText('Give a reason of 1 to 500 characters for this change.')
      ).toBeInTheDocument()
      // The refresh has started and is still held: the refusal did not wait for it.
      expect(detailCalls).toBe(2)
    } finally {
      release()
    }
  })
})
