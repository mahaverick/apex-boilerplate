import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaletteRegistry } from '@/components/shared/command-palette/palette-registry'
import { recordRecent } from '@/components/shared/command-palette/recent-items'
import { RECENT_KEY_PREFIX } from '@/components/shared/command-palette/recent-keys'
import type { MembershipRole } from '@/constants/roles'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { EMAIL_ID, TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { emailDetail, fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type {
  PlatformTenantDetail,
  PlatformUserDetail,
  TenantLifecycleState,
} from '@/types/api.types'

/** Acme's platform detail, active, with one active owner; `overrides` change what a test is about. */
function tenant(overrides: Partial<PlatformTenantDetail> = {}): PlatformTenantDetail {
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

/** Cleo's account, active, no password set. */
const CLEO: PlatformUserDetail = {
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
  membershipCount: 0,
  hasPassword: false,
  authProviders: ['email'],
  memberships: [],
  pendingInvitations: [],
}

/** Serves Acme's platform detail and empty answers for everything its tabs read. */
function serveTenant(detail: PlatformTenantDetail) {
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(detail, 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme', () =>
      ok({ ...detail, isPlatform: false, role: 'admin', access: 'platform' }, 'ok')
    ),
    http.get('/api/v1/tenants/acme/*', () => ok(listPage([]), 'ok'))
  )
}

/**
 * The labels a mounted source registered under This page, in order. The
 * registry keys each mount as `<source>#<mount id>`, so this reads every
 * mount of `source`.
 */
function registered(source: string): string[] {
  return Object.entries(usePaletteRegistry.getState().sources)
    .filter(([slot]) => slot.startsWith(`${source}#`))
    .flatMap(([, commands]) => commands.map((command) => command.label))
}

/** The Actions menu's items, or none when the page shows no menu. */
async function menuItems(name: string): Promise<string[]> {
  const trigger = screen.queryByRole('button', { name })
  if (trigger === null) return []
  const user = userEvent.setup()
  await user.click(trigger)
  const menu = await screen.findByRole('menu')
  const items = within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent)
  await user.keyboard('{Escape}')
  return items
}

describe('the This page sources', () => {
  beforeEach(() => {
    localStorage.clear()
    useCommandPaletteStore.setState({ open: false, query: '' })
    signIn({ ...testUser, platformRole: 'admin' })
  })

  afterEach(() => {
    useCommandPaletteStore.setState({ open: false, query: '' })
    vi.restoreAllMocks()
  })

  describe('a tenant page', () => {
    it.each<[MembershipRole, TenantLifecycleState, Partial<PlatformTenantDetail>, string[]]>([
      ['viewer', 'active', {}, []],
      ['admin', 'active', {}, ['Edit details', 'Suspend', 'Archive']],
      [
        'admin',
        'active',
        { owners: [] },
        ['Edit details', 'Resend owner invitation', 'Suspend', 'Archive'],
      ],
      ['admin', 'suspended', {}, ['Reactivate', 'Archive']],
      ['admin', 'archived', {}, []],
      ['owner', 'archived', {}, ['Delete permanently']],
    ])(
      'registers exactly the menu’s actions for a %s on a %s tenant',
      async (role, lifecycleState, overrides, actions) => {
        signIn({ ...testUser, platformRole: role })
        serveTenant(tenant({ lifecycleState, ...overrides }))
        renderAppAt(`/tenants/${TENANT_ID}`)
        await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
        await waitFor(() => expect(registered('tenant-actions')).toEqual(actions))
        expect(await menuItems('Actions')).toEqual(actions)
      }
    )

    it('registers the visible tabs and Copy tenant ID, Flags only from admin up', async () => {
      serveTenant(tenant())
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      await waitFor(() =>
        expect(registered('tenant-page')).toEqual([
          'Go to Overview',
          'Go to Members',
          'Go to Invitations',
          'Go to Activity',
          'Go to Emails',
          'Go to Onboarding',
          'Go to Flags',
          'Copy tenant ID',
        ])
      )
    })

    it('leaves Flags out for a viewer', async () => {
      signIn({ ...testUser, platformRole: 'viewer' })
      serveTenant(tenant())
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      await waitFor(() => expect(registered('tenant-page')).toContain('Copy tenant ID'))
      expect(registered('tenant-page')).not.toContain('Go to Flags')
    })

    it.todo(
      'runs Suspend from the palette: the reason dialog opens with focus, and closing it returns focus to the heading'
    )

    it.todo('copies the tenant’s ID')

    it('records the tenant in Recent once it loads, with its slug', async () => {
      serveTenant(tenant())
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      await waitFor(() =>
        expect(
          JSON.parse(localStorage.getItem(`${RECENT_KEY_PREFIX}${testUser.id}`) ?? '[]')
        ).toEqual([
          expect.objectContaining({
            kind: 'tenant',
            id: TENANT_ID,
            label: 'Acme Corp',
            detail: 'acme',
          }),
        ])
      )
    })

    it('forgets the tenant when its page answers 404', async () => {
      recordRecent(testUser.id, {
        kind: 'tenant',
        id: TENANT_ID,
        label: 'Acme Corp',
        detail: 'acme',
      })
      server.use(http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => fail('Not found', 404)))
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Tenant not found' })
      await waitFor(() =>
        expect(localStorage.getItem(`${RECENT_KEY_PREFIX}${testUser.id}`)).toBe('[]')
      )
    })
  })

  describe('a user page', () => {
    /** Answers the detail read for Cleo. */
    const serveUser = (detail: PlatformUserDetail = CLEO) =>
      server.use(
        http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(detail, 'User retrieved.'))
      )

    it.each<[MembershipRole, Partial<PlatformUserDetail>]>([
      ['viewer', {}],
      ['admin', {}],
      ['admin', { hasPassword: true }],
      ['admin', { active: false }],
      ['owner', { deletedAt: '2026-05-01T00:00:00.000Z' }],
    ])('registers exactly the menu’s actions for a %s (%j)', async (role, overrides) => {
      signIn({ ...testUser, platformRole: role })
      serveUser({ ...CLEO, ...overrides })
      renderAppAt(`/users/${USER_ID_2}`)
      await screen.findByRole('heading', { level: 1 })
      const items = await menuItems('Actions for cleo@example.com')
      await waitFor(() => expect(registered('user-actions')).toEqual(items))
    })

    it.todo('sends the set-password email from the palette as the menu does')

    it.todo('copies the user’s ID and records them in Recent under their email')

    it('forgets the user when their page answers 404', async () => {
      recordRecent(testUser.id, { kind: 'user', id: USER_ID_2, label: 'cleo@example.com' })
      server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)))
      renderAppAt(`/users/${USER_ID_2}`)
      await waitFor(() =>
        expect(localStorage.getItem(`${RECENT_KEY_PREFIX}${testUser.id}`)).toBe('[]')
      )
    })
  })

  describe('an email page', () => {
    it.each([
      [true, ['Resend email']],
      [false, []],
    ])(
      'registers Resend only when the API allows it (canResend %s)',
      async (canResend, actions) => {
        server.use(
          http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () =>
            ok(emailDetail({ canResend }), 'Email retrieved.')
          )
        )
        renderAppAt(`/emails/${EMAIL_ID}`)
        await screen.findByRole('heading', { level: 1 })
        await waitFor(() => expect(registered('email-page')).toEqual(['Copy email ID']))
        expect(registered('email-actions')).toEqual(actions)
      }
    )
  })
})
