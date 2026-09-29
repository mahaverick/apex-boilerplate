import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { useAuthStore } from '@/states/auth.store'
import { MEMBERSHIP_ID_2, TENANT_ID, TENANT_ID_2, USER_ID_2 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import {
  REAUTH_REQUIRED,
  type PlatformTenantDetail,
  type TenantLifecycleState,
} from '@/types/api.types'

function detail(overrides: Partial<PlatformTenantDetail> = {}): PlatformTenantDetail {
  return {
    id: TENANT_ID,
    name: 'Acme Corp',
    slug: 'acme',
    description: 'Widgets',
    website: 'https://acme.test',
    logo: null,
    lifecycleState: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: null,
    settings: { timezone: 'UTC', locale: 'en' },
    memberCount: 2,
    owners: [
      {
        userId: USER_ID_2,
        email: 'olive@acme.test',
        firstName: 'Olive',
        lastName: 'Owner',
        active: true,
      },
    ],
    pendingInvitationCount: 0,
    pendingOwnerInvitation: null,
    ...overrides,
  }
}

const MEMBERS = [
  {
    membership: {
      id: MEMBERSHIP_ID_2,
      userId: USER_ID_2,
      tenantId: TENANT_ID,
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID_2, email: 'olive@acme.test', firstName: 'Olive', lastName: 'Owner' },
  },
]

/** Serves the platform detail and the tenant's own routes; records every /tenants/acme* request. */
function serve(tenant: PlatformTenantDetail, effectiveRole: MembershipRole = 'admin') {
  const internal: string[] = []
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(tenant, 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme', ({ request }) => {
      internal.push(new URL(request.url).pathname)
      return ok({ ...tenant, isPlatform: false, role: effectiveRole, access: 'platform' }, 'ok')
    }),
    http.get('/api/v1/tenants/acme/*', ({ request }) => {
      const path = new URL(request.url).pathname
      internal.push(path)
      if (path.endsWith('/members')) return ok(MEMBERS, 'ok')
      if (path.endsWith('/invitations')) return ok([], 'ok')
      return ok({ entries: [], nextCursor: null }, 'ok')
    })
  )
  return internal
}

describe('/tenants/$tenantId', () => {
  beforeEach(() => signIn({ ...testUser, platformRole: 'admin' }))

  it('shows the tenant’s header and overview from the platform detail alone', async () => {
    const internal = serve(detail())
    renderAppAt(`/tenants/${TENANT_ID}`)
    expect(await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('olive@acme.test')).toBeInTheDocument()
    expect(screen.getByText('Widgets')).toBeInTheDocument()
    expect(internal).toEqual([])
  })

  it('lists members on the Members tab through the tenant’s own routes', async () => {
    serve(detail())
    renderAppAt(`/tenants/${TENANT_ID}/members`)
    const card = await screen.findByRole('heading', { name: 'Members', level: 2 })
    expect(card).toBeInTheDocument()
    expect(await screen.findByText('Olive Owner')).toBeInTheDocument()
  })

  it.each<[TenantLifecycleState, string]>([
    ['suspended', 'members'],
    ['suspended', 'invitations'],
    ['suspended', 'activity'],
    ['archived', 'members'],
  ])('a %s tenant’s %s tab is frozen and asks the tenant routes nothing', async (state, tab) => {
    const internal = serve(detail({ lifecycleState: state }))
    renderAppAt(`/tenants/${TENANT_ID}/${tab}`)
    expect(await screen.findByText(new RegExp(`This tenant is ${state}`))).toBeInTheDocument()
    expect(internal).toEqual([])
  })

  it('shows a not-found panel for an unknown tenant', async () => {
    server.use(http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => fail('Not found', 404)))
    renderAppAt(`/tenants/${TENANT_ID}`)
    expect(
      await screen.findByRole('heading', { name: 'Tenant not found', level: 1 })
    ).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  describe('actions', () => {
    async function openMenu() {
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Actions' }))
      const menu = await screen.findByRole('menu')
      return { user, menu }
    }

    it('shows a viewer no actions at all', async () => {
      signIn({ ...testUser, platformRole: 'viewer' })
      serve(detail())
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument()
    })

    it('gives an admin Edit, Suspend and Archive on an active tenant with an owner', async () => {
      serve(detail())
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { menu } = await openMenu()
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent)
      ).toEqual(['Edit details', 'Suspend', 'Archive'])
    })

    it('gives a suspended tenant Reactivate and Archive, nothing else', async () => {
      serve(detail({ lifecycleState: 'suspended' }))
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { menu } = await openMenu()
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent)
      ).toEqual(['Reactivate', 'Archive'])
    })

    it('offers an archived tenant only Delete permanently, and only to an owner', async () => {
      signIn({ ...testUser, platformRole: 'owner' })
      serve(detail({ lifecycleState: 'archived', deletedAt: '2026-09-01T00:00:00.000Z' }))
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { menu } = await openMenu()
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent)
      ).toEqual(['Delete permanently'])
    })

    it('shows an admin no actions on an archived tenant', async () => {
      serve(detail({ lifecycleState: 'archived', deletedAt: '2026-09-01T00:00:00.000Z' }))
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument()
    })

    it('offers the owner invitation when the only owner is deactivated, and marks them inactive', async () => {
      serve(
        detail({
          owners: [
            {
              userId: USER_ID_2,
              email: 'olive@acme.test',
              firstName: 'Olive',
              lastName: 'Owner',
              active: false,
            },
          ],
        })
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      expect(await screen.findByText('Inactive')).toBeInTheDocument()
      const { menu } = await openMenu()
      expect(
        within(menu).getByRole('menuitem', { name: 'Resend owner invitation' })
      ).toBeInTheDocument()
    })

    it('suspends with a reason, confirming identity first when the sign-in is stale', async () => {
      serve(detail())
      const bodies: unknown[] = []
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/suspend`, async ({ request }) => {
          bodies.push(await request.json())
          return bodies.length === 1
            ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
            : ok(detail({ lifecycleState: 'suspended' }), 'Tenant suspended.')
        }),
        http.post('/api/v1/auth/reauthenticate', () =>
          ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
        )
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Suspend' }))

      const reasonDialog = await screen.findByRole('alertdialog', { name: 'Suspend Acme Corp?' })
      await user.type(within(reasonDialog).getByLabelText('Reason'), 'unpaid invoices')
      await user.click(within(reasonDialog).getByRole('button', { name: 'Suspend' }))

      const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
      await user.type(within(stepUp).getByLabelText('Password'), 'hunter22')
      await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))

      expect(await screen.findByText('Acme Corp suspended.')).toBeInTheDocument()
      expect(bodies).toEqual([{ reason: 'unpaid invoices' }, { reason: 'unpaid invoices' }])
      expect(await screen.findByText('Suspended')).toBeInTheDocument()
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: true,
        accessToken: 'stepped-up-token',
      })
    })

    it('shows a 409 inside the dialog', async () => {
      serve(detail())
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/suspend`, () =>
          fail('Tenant is already suspended', 409)
        )
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Suspend' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Suspend Acme Corp?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'x')
      await user.click(within(dialog).getByRole('button', { name: 'Suspend' }))
      expect(await within(dialog).findByText('Tenant is already suspended')).toBeInTheDocument()
    })

    it('lets an admin archive, only after the slug is typed', async () => {
      serve(detail())
      let archived = false
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/archive`, () => {
          archived = true
          return ok(detail({ lifecycleState: 'archived', deletedAt: '2026-09-29T00:00:00.000Z' }))
        })
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Archive' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Archive Acme Corp?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'closed down')
      await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
      expect(await within(dialog).findByText('Type acme exactly to confirm.')).toBeInTheDocument()
      expect(archived).toBe(false)

      await user.type(within(dialog).getByLabelText('Type acme to confirm'), 'acme')
      await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
      await waitFor(() => expect(archived).toBe(true))
      // The header badge and the Overview's "Archived" date row both say it.
      expect((await screen.findAllByText('Archived')).length).toBeGreaterThan(0)
    })

    it('re-sends the owner invitation for a tenant with no owner, prefilled, with a reason', async () => {
      serve(
        detail({
          owners: [],
          pendingOwnerInvitation: {
            id: '40000000-0000-4000-8000-000000000001',
            email: 'olive@acme.test',
            expiresAt: '2026-10-06T00:00:00.000Z',
          },
        })
      )
      let body: unknown
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/owner-invitation`, async ({ request }) => {
          body = await request.json()
          return ok({ emailSent: true }, 'Invitation sent.')
        })
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Resend owner invitation' }))
      const dialog = await screen.findByRole('dialog', { name: 'Owner invitation' })
      expect(within(dialog).getByLabelText('Owner email')).toHaveValue('olive@acme.test')
      await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
      expect(await within(dialog).findByText('Enter a reason.')).toBeInTheDocument()

      await user.type(within(dialog).getByLabelText('Reason'), 'first link expired')
      await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
      expect(
        await screen.findByText('Owner invitation sent to olive@acme.test.')
      ).toBeInTheDocument()
      expect(body).toEqual({ email: 'olive@acme.test', reason: 'first link expired' })
    })

    it('shows a deactivated invitee’s 409 inside the owner-invitation dialog', async () => {
      serve(detail({ owners: [] }))
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/owner-invitation`, () =>
          fail('That account is deactivated', 409)
        )
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Resend owner invitation' }))
      const dialog = await screen.findByRole('dialog', { name: 'Owner invitation' })
      await user.type(within(dialog).getByLabelText('Owner email'), 'gone@acme.test')
      await user.type(within(dialog).getByLabelText('Reason'), 'new owner')
      await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
      expect(await within(dialog).findByText('That account is deactivated')).toBeInTheDocument()
    })

    it('purges an archived tenant after the slug is typed, behind step-up, then lists archived tenants', async () => {
      signIn({ ...testUser, platformRole: 'owner' })
      serve(detail({ lifecycleState: 'archived', deletedAt: '2026-09-01T00:00:00.000Z' }))
      const bodies: unknown[] = []
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/purge`, async ({ request }) => {
          bodies.push(await request.json())
          return bodies.length === 1
            ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
            : ok(null, 'Tenant permanently deleted.')
        }),
        http.post('/api/v1/auth/reauthenticate', () =>
          ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
        ),
        http.get('/api/v1/platform/tenants', () =>
          ok({ tenants: [], nextCursor: null, prevCursor: null }, 'Tenants retrieved.')
        )
      )
      const router = renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Delete permanently' }))
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Permanently delete Acme Corp?',
      })
      await user.type(within(dialog).getByLabelText('Reason'), 'contract ended')
      await user.type(within(dialog).getByLabelText('Type acme to confirm'), 'acme')
      await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }))

      const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
      await user.type(within(stepUp).getByLabelText('Password'), 'hunter22')
      await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))

      await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
      expect(router.state.location.search).toEqual({ state: 'archived' })
      expect(bodies).toEqual([{ reason: 'contract ended' }, { reason: 'contract ended' }])
    })

    it('never shows an archived tenant’s cached members under a new tenant that reuses its slug', async () => {
      const seen: string[] = []
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(detail(), 'ok')),
        http.get(`/api/v1/platform/tenants/${TENANT_ID_2}`, () =>
          ok(detail({ id: TENANT_ID_2, name: 'Acme Again' }), 'ok')
        ),
        http.get('/api/v1/tenants/acme', () =>
          ok({ ...detail(), isPlatform: false, role: 'admin', access: 'platform' }, 'ok')
        ),
        http.get('/api/v1/tenants/acme/members', () => {
          seen.push('members')
          return ok(seen.length === 1 ? MEMBERS : [], 'ok')
        })
      )
      const router = renderAppAt(`/tenants/${TENANT_ID}/members`)
      expect(await screen.findByText('Olive Owner')).toBeInTheDocument()

      await router.navigate({ to: '/tenants/$tenantId/members', params: { tenantId: TENANT_ID_2 } })
      await waitFor(() => expect(seen).toHaveLength(2))
      expect(screen.queryByText('Olive Owner')).not.toBeInTheDocument()
    })

    it('edits the details through the tenant route and refreshes the header', async () => {
      let tenant = detail()
      serve(tenant)
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(tenant, 'ok')),
        http.patch('/api/v1/tenants/acme', async ({ request }) => {
          const patch = (await request.json()) as { name: string }
          tenant = { ...tenant, name: patch.name }
          return ok(tenant, 'Tenant updated.')
        })
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Edit details' }))
      const dialog = await screen.findByRole('dialog', { name: 'Edit details' })
      const name = within(dialog).getByLabelText('Name')
      await user.clear(name)
      await user.type(name, 'Acme Holdings')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      expect(
        await screen.findByRole('heading', { name: 'Acme Holdings', level: 1 })
      ).toBeInTheDocument()
    })

    it('shows an edit the tenant route refuses inside the dialog', async () => {
      serve(detail())
      server.use(
        http.patch('/api/v1/tenants/acme', () => fail('You cannot change this tenant', 403))
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Edit details' }))
      const dialog = await screen.findByRole('dialog', { name: 'Edit details' })
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      expect(await within(dialog).findByText('You cannot change this tenant')).toBeInTheDocument()
    })

    it('reactivates a suspended tenant with a reason and no step-up', async () => {
      serve(detail({ lifecycleState: 'suspended' }))
      let body: unknown
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/reactivate`, async ({ request }) => {
          body = await request.json()
          return ok(detail(), 'Tenant reactivated.')
        })
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Reactivate' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Reactivate Acme Corp?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'paid up')
      await user.click(within(dialog).getByRole('button', { name: 'Reactivate' }))
      expect(await screen.findByText('Acme Corp reactivated.')).toBeInTheDocument()
      expect(body).toEqual({ reason: 'paid up' })
      expect(await screen.findByText('Active')).toBeInTheDocument()
    })

    it('puts a deactivated invitee on the Owner email field', async () => {
      serve(detail({ owners: [] }))
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/owner-invitation`, () =>
          fail('That account is deactivated', 409, 'invitee_deactivated')
        )
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Resend owner invitation' }))
      const dialog = await screen.findByRole('dialog', { name: 'Owner invitation' })
      await user.type(within(dialog).getByLabelText('Owner email'), 'gone@acme.test')
      await user.type(within(dialog).getByLabelText('Reason'), 'new owner')
      await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
      expect(await within(dialog).findByText('That account is deactivated')).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Owner email')).toHaveAttribute('aria-invalid', 'true')
    })

    it('says a role that changed meanwhile can’t send the owner invitation', async () => {
      serve(detail({ owners: [] }))
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/owner-invitation`, () =>
          fail('Not found', 404)
        )
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Resend owner invitation' }))
      const dialog = await screen.findByRole('dialog', { name: 'Owner invitation' })
      await user.type(within(dialog).getByLabelText('Owner email'), 'new@acme.test')
      await user.type(within(dialog).getByLabelText('Reason'), 'new owner')
      await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
      expect(
        await within(dialog).findByText(/Your role can’t do this any more/)
      ).toBeInTheDocument()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })

    it('warns when the owner invitation exists but its email failed', async () => {
      serve(detail({ owners: [] }))
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/owner-invitation`, () =>
          ok({ emailSent: false }, 'Invitation created.')
        )
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      const { user, menu } = await openMenu()
      await user.click(within(menu).getByRole('menuitem', { name: 'Resend owner invitation' }))
      const dialog = await screen.findByRole('dialog', { name: 'Owner invitation' })
      await user.type(within(dialog).getByLabelText('Owner email'), 'new@acme.test')
      await user.type(within(dialog).getByLabelText('Reason'), 'new owner')
      await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }))
      expect(await screen.findByText(/its email could not be sent/)).toBeInTheDocument()
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
    })
  })

  describe('overview', () => {
    it('says an ownerless tenant’s invitation is pending, and when it expires', async () => {
      serve(
        detail({
          owners: [],
          pendingOwnerInvitation: {
            id: '40000000-0000-4000-8000-000000000001',
            email: 'olive@acme.test',
            expiresAt: '2026-10-06T00:00:00.000Z',
          },
        })
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      expect(
        await screen.findByText(/No owner yet\. An invitation to olive@acme\.test expires/)
      ).toBeInTheDocument()
    })

    it('points at the Actions menu when no active owner and no invitation remain', async () => {
      serve(
        detail({
          owners: [
            {
              userId: USER_ID_2,
              email: 'olive@acme.test',
              firstName: null,
              lastName: null,
              active: false,
            },
          ],
        })
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      expect(
        await screen.findByText('No active owner. Send an owner invitation from the Actions menu.')
      ).toBeInTheDocument()
    })

    it('offers a retry when the tenant fails to load for another reason', async () => {
      let calls = 0
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => {
          calls += 1
          return calls <= 2 ? fail('Something went wrong.', 500) : ok(detail(), 'ok')
        })
      )
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}`)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('We could not load this tenant.')
      await user.click(within(alert).getByRole('button', { name: 'Try again' }))
      expect(
        await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      ).toBeInTheDocument()
    })

    it('marks the open section in the section nav', async () => {
      serve(detail())
      renderAppAt(`/tenants/${TENANT_ID}/members`)
      const nav = await screen.findByRole('navigation', { name: 'Tenant sections' })
      expect(within(nav).getByRole('link', { name: 'Members' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
        'aria-current'
      )
    })
  })

  describe('tabs', () => {
    it('lists the tenant’s activity for an effective admin', async () => {
      serve(detail())
      server.use(
        http.get('/api/v1/tenants/acme/audit-log', () =>
          ok(
            {
              entries: [
                {
                  id: '60000000-0000-4000-8000-000000000001',
                  action: 'tenant.created',
                  access: 'member',
                  actor: { id: USER_ID_2, email: 'olive@acme.test', name: 'Olive Owner' },
                  target: { type: 'tenant', id: TENANT_ID },
                  metadata: { name: 'Acme Corp', slug: 'acme' },
                  occurredAt: '2026-09-28T00:00:00.000Z',
                },
              ],
              nextCursor: null,
            },
            'ok'
          )
        )
      )
      renderAppAt(`/tenants/${TENANT_ID}/activity`)
      expect(await screen.findByText('Olive Owner')).toBeInTheDocument()
    })

    it('tells an effective viewer the activity is not theirs to see, and asks nothing', async () => {
      signIn({ ...testUser, platformRole: 'viewer' })
      const internal = serve(detail(), 'viewer')
      renderAppAt(`/tenants/${TENANT_ID}/activity`)
      expect(
        await screen.findByText(
          'A tenant’s activity is for owners and admins. Your role here can’t see it.'
        )
      ).toBeInTheDocument()
      expect(internal).toEqual(['/api/v1/tenants/acme'])
    })

    it('tells an effective viewer invitations are managed by owners and admins', async () => {
      signIn({ ...testUser, platformRole: 'viewer' })
      const internal = serve(detail(), 'viewer')
      renderAppAt(`/tenants/${TENANT_ID}/invitations`)
      expect(
        await screen.findByText(/Invitations are managed by owners and admins/)
      ).toBeInTheDocument()
      expect(internal).toEqual(['/api/v1/tenants/acme'])
    })
  })
})
