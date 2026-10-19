import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateTenantDialog } from '@/components/features/tenants/create-tenant-dialog'
import { usePaletteRegistry } from '@/components/shared/command-palette/palette-registry'
import type { PaletteCommand } from '@/components/shared/command-palette/palette-types'
import { recordRecent } from '@/components/shared/command-palette/recent-items'
import { RECENT_KEY_PREFIX } from '@/components/shared/command-palette/recent-keys'
import type { MembershipRole } from '@/constants/roles'
import * as analytics from '@/observability/telemetry'
import { platformTenantQueryOptions } from '@/queries/tenant-admin.queries'
import { queryClient } from '@/router'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { EMAIL_ID, TENANT_ID, TENANT_ID_2, USER_ID_2 } from '@/tests/fixtures/ids'
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

/** Every registered command's label, source by source in registration order, as This page lists them. */
function pageLabels(): string[] {
  return Object.values(usePaletteRegistry.getState().sources).flatMap((commands) =>
    commands.map((command) => command.label)
  )
}

/** Each command a source registered, as `[label, action, timing]`. */
function triples(source: string): [string, string, string][] {
  return Object.entries(usePaletteRegistry.getState().sources)
    .filter(([slot]) => slot.startsWith(`${source}#`))
    .flatMap(([, commands]) =>
      commands.map((command): [string, string, string] => [
        command.label,
        command.action,
        command.timing,
      ])
    )
}

/** The registered command with `label` in `source`; fails the test when it is missing. */
function command(source: string, label: string): PaletteCommand {
  const found = Object.entries(usePaletteRegistry.getState().sources)
    .filter(([slot]) => slot.startsWith(`${source}#`))
    .flatMap(([, commands]) => commands)
    .find((entry) => entry.label === label)
  if (found === undefined) throw new Error(`${source} has no ${label}`)
  return found
}

/**
 * Runs a registered command as the palette does once it has closed: focus is
 * off the page's controls (on `<body>`), then the command runs.
 */
function runFromPalette(source: string, label: string) {
  const entry = command(source, label)
  act(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    entry.run()
  })
}

/** A promise a handler awaits, and the call that settles it, so a test can act while a read is in flight. */
function hold(): { held: Promise<void>; release: () => void } {
  const settle: { release?: () => void } = {}
  const held = new Promise<void>((resolve) => {
    settle.release = resolve
  })
  return { held, release: () => settle.release?.() }
}

/** The tenant tabs' commands for an admin, then Copy, as `tenant-page` registers them. */
const ADMIN_TENANT_PAGE = [
  'Go to Overview',
  'Go to Members',
  'Go to Invitations',
  'Go to Activity',
  'Go to Emails',
  'Go to Onboarding',
  'Go to Flags',
  'Copy tenant ID',
]

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

/** Opens the palette from the header's Search… button. */
async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Search…/ }))
  return screen.findByRole('dialog', { name: 'Command palette' })
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

    it.each([
      [
        'admin on an active tenant with no owner',
        'admin' as const,
        tenant({ owners: [] }),
        [
          ['Edit details', 'page_action_edit', 'afterClose'],
          ['Resend owner invitation', 'page_action_owner', 'afterClose'],
          ['Suspend', 'page_action_suspend', 'afterClose'],
          ['Archive', 'page_action_archive', 'afterClose'],
        ],
      ],
      [
        'admin on a suspended tenant',
        'admin' as const,
        tenant({ lifecycleState: 'suspended' }),
        [
          ['Reactivate', 'page_action_reactivate', 'afterClose'],
          ['Archive', 'page_action_archive', 'afterClose'],
        ],
      ],
      [
        'owner on an archived tenant',
        'owner' as const,
        tenant({ lifecycleState: 'archived' }),
        [['Delete permanently', 'page_action_purge', 'afterClose']],
      ],
    ])(
      'sends fixed keys and opens dialogs after the close for an %s',
      async (_, role, detail, expected) => {
        signIn({ ...testUser, platformRole: role })
        serveTenant(detail)
        renderAppAt(`/tenants/${TENANT_ID}`)
        await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
        await waitFor(() => expect(triples('tenant-actions')).toEqual(expected))
        expect(triples('tenant-page')).toEqual([
          ...ADMIN_TENANT_PAGE.slice(0, -1).map((label) => [label, 'open_tab', 'immediate']),
          ['Copy tenant ID', 'copy_id', 'immediate'],
        ])
      }
    )

    it('lists the actions first, then the tabs, then Copy, for a cached tenant', async () => {
      serveTenant(tenant())
      queryClient.setQueryData(platformTenantQueryOptions(TENANT_ID).queryKey, tenant())
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      await waitFor(() =>
        expect(pageLabels()).toEqual(['Edit details', 'Suspend', 'Archive', ...ADMIN_TENANT_PAGE])
      )
    })

    it('lists the actions first, then the tabs, then Copy, when the tenant loads after the page', async () => {
      const { held, release } = hold()
      serveTenant(tenant())
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}`, async () => {
          await held
          return ok(tenant(), 'Tenant retrieved.')
        })
      )
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Tenant', level: 1 })
      expect(pageLabels()).toEqual([])
      release()
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      await waitFor(() =>
        expect(pageLabels()).toEqual(['Edit details', 'Suspend', 'Archive', ...ADMIN_TENANT_PAGE])
      )
    })

    it.each<[string, 'dialog' | 'alertdialog', string, Partial<PlatformTenantDetail>]>([
      ['Edit details', 'dialog', 'Edit details', {}],
      ['Resend owner invitation', 'dialog', 'Owner invitation', { owners: [] }],
      ['Suspend', 'alertdialog', 'Suspend Acme Corp?', {}],
    ])(
      'returns focus to the heading when %s, run from the palette, closes',
      async (label, role, name, overrides) => {
        serveTenant(tenant(overrides))
        const user = userEvent.setup()
        renderAppAt(`/tenants/${TENANT_ID}`)
        const heading = await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
        await waitFor(() => expect(registered('tenant-actions')).toContain(label))
        runFromPalette('tenant-actions', label)
        const dialog = await screen.findByRole(role, { name })
        await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
        await user.keyboard('{Escape}')
        await waitFor(() => expect(heading).toHaveFocus())
      }
    )

    it('leaves Flags out for a viewer', async () => {
      signIn({ ...testUser, platformRole: 'viewer' })
      serveTenant(tenant())
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      await waitFor(() => expect(registered('tenant-page')).toContain('Copy tenant ID'))
      expect(registered('tenant-page')).not.toContain('Go to Flags')
    })

    it('runs Suspend from the palette: the reason dialog opens with focus, and closing it returns focus to the heading', async () => {
      const track = vi.spyOn(analytics, 'track')
      serveTenant(tenant())
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}`)
      const heading = await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      const palette = await openPalette(user)
      const page = await within(palette).findByRole('group', { name: 'This page' })
      await user.click(within(page).getByRole('option', { name: 'Suspend' }))

      const dialog = await screen.findByRole('alertdialog', { name: 'Suspend Acme Corp?' })
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
      expect(track).toHaveBeenCalledWith('command_palette_action_run', {
        action: 'page_action_suspend',
      })

      await user.keyboard('{Escape}')
      await waitFor(() => expect(heading).toHaveFocus())
    })

    it('copies the tenant’s ID', async () => {
      serveTenant(tenant())
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      const palette = await openPalette(user)
      await user.click(await within(palette).findByRole('option', { name: 'Copy tenant ID' }))
      await expect(navigator.clipboard.readText()).resolves.toBe(TENANT_ID)
      expect(await screen.findByText('Tenant ID copied.')).toBeInTheDocument()
    })

    it('returns focus to the heading when the palette’s New tenant dialog closes on a tenant page', async () => {
      serveTenant(tenant())
      const user = userEvent.setup()
      renderAppAt(`/tenants/${TENANT_ID}`)
      const heading = await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      const palette = await openPalette(user)
      await user.keyboard('new tenant')
      await user.click(await within(palette).findByRole('option', { name: 'New tenant' }))
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
      await user.keyboard('{Escape}')
      await waitFor(() => expect(heading).toHaveFocus())
    })

    it.each([
      ['the overview', '/overview', 'Overview', 'main'],
      ['another tenant’s page', `/tenants/${TENANT_ID}`, 'Acme Corp', 'heading'],
    ] as const)(
      'opens the created tenant from the palette on %s, with focus on its %s, never on the body',
      async (_from, path, startHeading, landing) => {
        const created = tenant({ id: TENANT_ID_2, name: 'Beta Inc', slug: 'beta', owners: [] })
        serveTenant(tenant())
        server.use(
          http.post('/api/v1/platform/tenants', () =>
            ok({ tenant: created, emailSent: true }, 'Tenant created.', 201)
          ),
          http.get(`/api/v1/platform/tenants/${TENANT_ID_2}`, () =>
            ok(created, 'Tenant retrieved.')
          ),
          http.get('/api/v1/tenants/beta', () =>
            ok({ ...created, isPlatform: false, role: 'admin', access: 'platform' }, 'ok')
          ),
          http.get('/api/v1/tenants/beta/*', () => ok(listPage([]), 'ok'))
        )
        const user = userEvent.setup()
        const router = renderAppAt(path)
        await screen.findByRole('heading', { name: startHeading, level: 1 })
        const palette = await openPalette(user)
        await user.keyboard('new tenant')
        await user.click(await within(palette).findByRole('option', { name: 'New tenant' }))
        const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
        await user.type(within(dialog).getByLabelText('Name'), 'Beta Inc')
        await user.type(within(dialog).getByLabelText('Slug'), 'beta')
        await user.type(within(dialog).getByLabelText('Owner email'), 'owner@beta.test')
        await user.click(within(dialog).getByRole('button', { name: 'Create tenant' }))

        await waitFor(() => expect(router.state.location.pathname).toBe(`/tenants/${TENANT_ID_2}`))
        await waitFor(() =>
          expect(screen.queryByRole('dialog', { name: 'New tenant' })).not.toBeInTheDocument()
        )
        const heading = await screen.findByRole('heading', { name: 'Beta Inc', level: 1 })
        await waitFor(() =>
          expect(document.activeElement).toBe(
            landing === 'main' ? screen.getByRole('main') : heading
          )
        )
        expect(document.activeElement).not.toBe(document.body)
      }
    )

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
      expect(pageLabels()).toEqual([])
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
      ['admin', { platformRole: 'admin' }],
      ['admin', { active: false }],
      ['owner', { deletedAt: '2026-05-01T00:00:00.000Z' }],
    ])('registers exactly the menu’s actions for a %s (%j)', async (role, overrides) => {
      signIn({ ...testUser, platformRole: role })
      serveUser({ ...CLEO, ...overrides })
      renderAppAt(`/users/${USER_ID_2}`)
      await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
      const items = await menuItems('Actions for cleo@example.com')
      await waitFor(() => expect(registered('user-actions')).toEqual(items))
    })

    it('sends fixed keys and opens every action’s dialog after the close, actions before Copy', async () => {
      serveUser()
      renderAppAt(`/users/${USER_ID_2}`)
      await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
      await waitFor(() =>
        expect(triples('user-actions')).toEqual([
          ['Edit name', 'page_action_edit', 'afterClose'],
          ['Send sign-in link', 'page_action_send_sign_in_link', 'afterClose'],
          ['Sign out everywhere', 'page_action_sign_out', 'afterClose'],
          ['Deactivate', 'page_action_deactivate', 'afterClose'],
          ['Delete', 'page_action_delete', 'afterClose'],
        ])
      )
      // Only the page's own Copy user ID runs at once; no user action does.
      expect(triples('user-actions').filter(([, , timing]) => timing === 'immediate')).toEqual([])
      expect(triples('user-page')).toEqual([['Copy user ID', 'copy_id', 'immediate']])
      expect(pageLabels()).toEqual([
        'Edit name',
        'Send sign-in link',
        'Sign out everywhere',
        'Deactivate',
        'Delete',
        'Copy user ID',
      ])
    })

    it('returns focus to the heading when Edit name, run from the palette, closes', async () => {
      serveUser()
      const user = userEvent.setup()
      renderAppAt(`/users/${USER_ID_2}`)
      const heading = await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
      await waitFor(() => expect(registered('user-actions')).toContain('Edit name'))
      runFromPalette('user-actions', 'Edit name')
      const dialog = await screen.findByRole('dialog', { name: 'Edit name' })
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
      await user.keyboard('{Escape}')
      await waitFor(() => expect(heading).toHaveFocus())
    })

    it('returns focus to the heading when Deactivate, run from the palette, is cancelled', async () => {
      serveUser()
      const user = userEvent.setup()
      renderAppAt(`/users/${USER_ID_2}`)
      const heading = await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
      await waitFor(() => expect(registered('user-actions')).toContain('Deactivate'))
      runFromPalette('user-actions', 'Deactivate')
      const dialog = await screen.findByRole('alertdialog', { name: 'Deactivate account' })
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
      await user.keyboard('{Escape}')
      await waitFor(() => expect(heading).toHaveFocus())
    })

    it('records the user in Recent once they load, under their email, and registers Copy user ID', async () => {
      serveUser()
      renderAppAt(`/users/${USER_ID_2}`)
      await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
      await waitFor(() =>
        expect(
          JSON.parse(localStorage.getItem(`${RECENT_KEY_PREFIX}${testUser.id}`) ?? '[]')
        ).toEqual([
          expect.objectContaining({ kind: 'user', id: USER_ID_2, label: 'cleo@example.com' }),
        ])
      )
      expect(registered('user-page')).toEqual(['Copy user ID'])
    })

    it('lists the user’s actions before Copy user ID when the user loads after the page', async () => {
      const { held, release } = hold()
      server.use(
        http.get(`/api/v1/platform/users/${USER_ID_2}`, async () => {
          await held
          return ok(CLEO, 'User retrieved.')
        })
      )
      renderAppAt(`/users/${USER_ID_2}`)
      await screen.findByRole('heading', { name: 'User', level: 1 })
      release()
      await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
      await waitFor(() => expect(pageLabels().at(-1)).toBe('Copy user ID'))
      expect(pageLabels()[0]).toBe('Edit name')
    })

    it('opens the Send sign-in link dialog from the palette, which sends one link on confirm', async () => {
      let sent = 0
      serveUser()
      server.use(
        http.post(`/api/v1/platform/users/${USER_ID_2}/sign-in-link`, () => {
          sent += 1
          return ok({ emailSent: true }, 'Sign-in link sent.')
        })
      )
      const user = userEvent.setup()
      renderAppAt(`/users/${USER_ID_2}`)
      await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
      const palette = await openPalette(user)
      await user.click(await within(palette).findByRole('option', { name: 'Send sign-in link' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Send a sign-in link?' })
      expect(sent).toBe(0)
      await user.click(within(dialog).getByRole('button', { name: 'Send link' }))
      expect(await screen.findByText(/^Sign-in link sent to/)).toBeInTheDocument()
      expect(sent).toBe(1)
    })

    it('returns focus to the heading when Send sign-in link, run from the palette, is cancelled', async () => {
      serveUser()
      const user = userEvent.setup()
      renderAppAt(`/users/${USER_ID_2}`)
      const heading = await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
      await waitFor(() => expect(registered('user-actions')).toContain('Send sign-in link'))
      runFromPalette('user-actions', 'Send sign-in link')
      const dialog = await screen.findByRole('alertdialog', { name: 'Send a sign-in link?' })
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
      await user.keyboard('{Escape}')
      await waitFor(() => expect(heading).toHaveFocus())
    })

    it('copies the user’s ID and records them in Recent under their email', async () => {
      serveUser()
      const user = userEvent.setup()
      renderAppAt(`/users/${USER_ID_2}`)
      await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
      await waitFor(() =>
        expect(
          JSON.parse(localStorage.getItem(`${RECENT_KEY_PREFIX}${testUser.id}`) ?? '[]')
        ).toEqual([
          expect.objectContaining({ kind: 'user', id: USER_ID_2, label: 'cleo@example.com' }),
        ])
      )
      const palette = await openPalette(user)
      await user.click(await within(palette).findByRole('option', { name: 'Copy user ID' }))
      await expect(navigator.clipboard.readText()).resolves.toBe(USER_ID_2)
    })

    it('forgets the user when their page answers 404', async () => {
      recordRecent(testUser.id, { kind: 'user', id: USER_ID_2, label: 'cleo@example.com' })
      server.use(http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)))
      renderAppAt(`/users/${USER_ID_2}`)
      await waitFor(() =>
        expect(localStorage.getItem(`${RECENT_KEY_PREFIX}${testUser.id}`)).toBe('[]')
      )
      expect(pageLabels()).toEqual([])
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
        expect(pageLabels()).toEqual([...actions, 'Copy email ID'])
      }
    )

    it('sends fixed keys for Resend and Copy', async () => {
      server.use(
        http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () =>
          ok(emailDetail({ canResend: true }), 'Email retrieved.')
        )
      )
      renderAppAt(`/emails/${EMAIL_ID}`)
      await waitFor(() =>
        expect(triples('email-page')).toEqual([['Copy email ID', 'copy_id', 'immediate']])
      )
      expect(triples('email-actions')).toEqual([
        ['Resend email', 'page_action_resend', 'afterClose'],
      ])
    })

    it('returns focus to the Resend button when Resend, run from the palette, is cancelled', async () => {
      server.use(
        http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () =>
          ok(emailDetail({ canResend: true }), 'Email retrieved.')
        )
      )
      const user = userEvent.setup()
      renderAppAt(`/emails/${EMAIL_ID}`)
      const button = await screen.findByRole('button', { name: 'Resend' })
      await waitFor(() => expect(registered('email-actions')).toEqual(['Resend email']))
      runFromPalette('email-actions', 'Resend email')
      const dialog = await screen.findByRole('alertdialog', { name: 'Resend this email?' })
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
      await user.keyboard('{Escape}')
      await waitFor(() => expect(button).toHaveFocus())
    })

    it('lists Resend before Copy email ID when the email loads after the page', async () => {
      const { held, release } = hold()
      server.use(
        http.get(`/api/v1/platform/emails/${EMAIL_ID}`, async () => {
          await held
          return ok(emailDetail({ canResend: true }), 'Email retrieved.')
        })
      )
      renderAppAt(`/emails/${EMAIL_ID}`)
      await screen.findByRole('heading', { name: 'Email', level: 1 })
      release()
      await waitFor(() => expect(pageLabels()).toEqual(['Resend email', 'Copy email ID']))
    })

    it('registers nothing when the email answers 404', async () => {
      server.use(http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () => fail('Not found', 404)))
      renderAppAt(`/emails/${EMAIL_ID}`)
      await screen.findByRole('heading', { name: 'Email not found' })
      expect(registered('email-page')).toEqual([])
      expect(registered('email-actions')).toEqual([])
    })
  })

  describe('the New tenant dialog under outside control', () => {
    /** Opens and closes the dialog from outside, as the palette does, with no New tenant button. */
    function Controller() {
      const [open, setOpen] = useState(false)
      return (
        <QueryClientProvider client={queryClient}>
          <button type="button" onClick={() => setOpen(true)}>
            Open from outside
          </button>
          <CreateTenantDialog open={open} onOpenChange={setOpen} trigger={false} />
        </QueryClientProvider>
      )
    }

    it('renders no button, opens from outside and starts blank each time', async () => {
      const user = userEvent.setup()
      render(<Controller />)
      expect(screen.queryByRole('button', { name: 'New tenant' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Open from outside' }))
      const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
      await user.type(within(dialog).getByLabelText('Name'), 'Draft')
      await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'New tenant' })).not.toBeInTheDocument()
      )

      await user.click(screen.getByRole('button', { name: 'Open from outside' }))
      const reopened = await screen.findByRole('dialog', { name: 'New tenant' })
      expect(within(reopened).getByLabelText('Name')).toHaveValue('')
    })
  })
})
