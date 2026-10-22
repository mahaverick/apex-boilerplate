import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { prefetchPalette } from '@/components/shared/command-palette/palette-loader'
import { recordRecent } from '@/components/shared/command-palette/recent-items'
import type { MembershipRole } from '@/constants/roles'
import * as shortcut from '@/lib/shortcut'
import * as analytics from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { useThemeStore } from '@/states/theme.store'
import { TENANT_ID, TENANT_ID_2, USER_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { settle } from '@/tests/fixtures/timing'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { LIST_SEARCH_DEBOUNCE_MS } from '@/types/list.types'

vi.mock('@/components/shared/command-palette/palette-loader', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/components/shared/command-palette/palette-loader')>()
  return { ...original, prefetchPalette: vi.fn(original.prefetchPalette) }
})

const ACME = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  lifecycleState: 'active',
  memberCount: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const ACME_TWO = { ...ACME, id: TENANT_ID_2, slug: 'acme-two', lifecycleState: 'suspended' }

const CLEO = {
  id: USER_ID_2,
  email: 'cleo@example.com',
  firstName: 'Cleo',
  lastName: 'Doe',
  active: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lastLoggedInAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  platformRole: null,
  membershipCount: 1,
}

/** Opens the palette with the shortcut once the overview has rendered. */
async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Overview', level: 1 })
  await user.keyboard('{Control>}k{/Control}')
  return screen.findByRole('dialog', { name: 'Command palette' })
}

/** Opens the palette from the header's Search… button. */
async function openFromHeader(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Search…/ }))
  return screen.findByRole('dialog', { name: 'Command palette' })
}

/** Signs in as a staff member with `role`, or as a non-staff user for `null`. */
function signInAs(platformRole: MembershipRole | null) {
  signIn({ ...testUser, platformRole })
}

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear()
    useCommandPaletteStore.setState({ open: false, query: '' })
    signInAs('viewer')
    server.use(
      http.get('/api/v1/platform/tenants', () => ok(listPage([]), 'Tenants retrieved.')),
      http.get('/api/v1/platform/users', () => ok(listPage([]), 'Users retrieved.'))
    )
  })

  afterEach(() => {
    useCommandPaletteStore.setState({ open: false, query: '' })
    vi.restoreAllMocks()
  })

  it('describes itself as reaching pages, tenants, users and actions', async () => {
    const user = userEvent.setup()
    renderAppAt('/overview')
    const palette = await openPalette(user)
    expect(palette).toHaveAccessibleDescription(
      'Go to a page, a tenant or a user, or run an action.'
    )
    expect(screen.getByRole('combobox', { name: 'Search pages, tenants and users' })).toHaveFocus()
  })

  it("lists only the viewer's pages, and Enter goes to the highlighted one", async () => {
    const user = userEvent.setup()
    const router = renderAppAt('/overview')
    await openPalette(user)
    await user.keyboard('ten')
    expect(await screen.findByRole('option', { name: 'Tenants' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Activity log' })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it.each([
    ['settings', 'Settings', '/settings'],
    ['maint', 'Maintenance', '/settings/platform/maintenance'],
    ['staff', 'Staff', '/settings/platform/staff'],
    ['flags', 'Feature flags', '/settings/platform/flags'],
    ['secur', 'Security', '/settings/account/security'],
  ])('offers a viewer the settings page for "%s" and opens it', async (term, label, path) => {
    const user = userEvent.setup()
    const router = renderAppAt('/overview')
    await openPalette(user)
    await user.keyboard(term)
    await user.click(await screen.findByRole('option', { name: label }))
    await waitFor(() => expect(router.state.location.pathname).toBe(path))
  })

  // A session whose platform role dropped to null mid-visit sees no pages and searches nothing, as the nav does.
  it('lists no pages or recents and searches nothing once the platform role is gone, but keeps Theme and Sign out', async () => {
    recordRecent(testUser.id, { kind: 'tenant', id: TENANT_ID, label: 'Acme Corp', detail: 'acme' })
    let calls = 0
    server.use(
      http.get('/api/v1/platform/tenants', () => {
        calls += 1
        return ok(listPage([ACME]), 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })
    act(() => useAuthStore.setState({ user: { ...testUser, platformRole: null } }))
    await user.keyboard('{Control>}k{/Control}')
    const palette = await screen.findByRole('dialog', { name: 'Command palette' })
    expect(within(palette).queryByRole('group', { name: 'Go to' })).toBeNull()
    expect(within(palette).queryByRole('group', { name: 'Recent' })).toBeNull()
    expect(within(palette).getByRole('option', { name: 'Sign out' })).toBeInTheDocument()
    await user.keyboard('acme')
    await settle(
      LIST_SEARCH_DEBOUNCE_MS * 2,
      'absence has no event: a request would follow the debounce'
    )
    expect(calls).toBe(0)
  })

  it('finds tenants by name with their slug, and the state when not active, asking for no total', async () => {
    const totals: (string | null)[] = []
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) => {
        const params = new URL(request.url).searchParams
        totals.push(params.get('total'))
        return ok(
          listPage(params.get('search') === 'acme' ? [ACME, ACME_TWO] : []),
          'Tenants retrieved.'
        )
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/overview')
    const palette = await openPalette(user)
    await user.keyboard('acme')
    const group = await within(palette).findByRole('group', { name: 'Tenants' })
    expect(
      within(group)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Acme Corp, acme', 'Acme Corp, acme-two · Suspended'])
    expect(totals).toEqual([null])
    await user.click(within(group).getAllByRole('option')[0]!)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/tenants/${TENANT_ID}`))
  })

  it('finds a user by email, first 8 only, inside Pii, and Enter opens their page', async () => {
    let limit: string | null = null
    server.use(
      http.get('/api/v1/platform/users', ({ request }) => {
        const params = new URL(request.url).searchParams
        limit = params.get('limit')
        return ok(listPage(params.get('search') === 'cleo' ? [CLEO] : []), 'Users retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/overview')
    await openPalette(user)
    await user.keyboard('cleo')
    const option = await screen.findByRole('option', { name: /cleo@example\.com/ })
    expect(within(option).getByText('cleo@example.com')).toHaveClass('ph-sensitive')
    expect(within(option).getByText('Cleo Doe')).toHaveClass('ph-sensitive')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe(`/users/${USER_ID_2}`))
    expect(limit).toBe('8')
  })

  it.each<[MembershipRole, boolean]>([
    ['viewer', false],
    ['admin', true],
    ['owner', true],
  ])('offers New tenant to a %s: %s', async (role, offered) => {
    signInAs(role)
    const user = userEvent.setup()
    renderAppAt('/overview')
    const palette = await openPalette(user)
    const account = within(palette).getByRole('group', { name: 'Account' })
    expect(within(account).queryByRole('option', { name: 'New tenant' }) !== null).toBe(offered)
  })

  it('opens the New tenant dialog after the palette closes, with focus in it', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    renderAppAt('/overview')
    await openPalette(user)
    await user.keyboard('new tenant')
    await user.click(await screen.findByRole('option', { name: 'New tenant' }))
    const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
  })

  it('returns focus to the main landmark when the New tenant dialog closes on a page whose heading takes no focus', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    renderAppAt('/overview')
    await openPalette(user)
    await user.keyboard('new tenant')
    await user.click(await screen.findByRole('option', { name: 'New tenant' }))
    const dialog = await screen.findByRole('dialog', { name: 'New tenant' })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
  })

  it('sets the theme, marking the current one', async () => {
    useThemeStore.getState().setTheme('light')
    const user = userEvent.setup()
    renderAppAt('/overview')
    const palette = await openPalette(user)
    const theme = within(palette).getByRole('group', { name: 'Theme' })
    expect(within(theme).getByRole('option', { name: /^Light/ })).toHaveTextContent(
      'Light, Current'
    )
    await user.click(within(theme).getByRole('option', { name: /^Dark/ }))
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('lists recent tenants and users, newest first, a user inside Pii', async () => {
    recordRecent(testUser.id, { kind: 'user', id: USER_ID_2, label: 'cleo@example.com' })
    recordRecent(testUser.id, { kind: 'tenant', id: TENANT_ID, label: 'Acme Corp', detail: 'acme' })
    const user = userEvent.setup()
    const router = renderAppAt('/overview')
    const palette = await openPalette(user)
    const recent = within(palette).getByRole('group', { name: 'Recent' })
    const rows = within(recent).getAllByRole('option')
    expect(rows.map((row) => row.textContent)).toEqual(['Acme Corp, acme', 'cleo@example.com'])
    expect(within(rows[0]!).getByText('Acme Corp')).not.toHaveClass('ph-sensitive')
    expect(within(rows[1]!).getByText('cleo@example.com')).toHaveClass('ph-sensitive')
    await user.click(rows[1]!)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/users/${USER_ID_2}`))
  })

  it('opens from the header’s Search… button, which shows the shortcut', async () => {
    vi.spyOn(shortcut, 'paletteShortcutHint').mockReturnValue('Ctrl K')
    const user = userEvent.setup()
    renderAppAt('/overview')
    const button = await screen.findByRole('button', { name: /Search…/ })
    expect(within(button).getByText('Ctrl K')).toHaveAttribute('data-slot', 'kbd')
    await openFromHeader(user)
    expect(screen.getByRole('combobox', { name: 'Search pages, tenants and users' })).toHaveFocus()
  })

  it.each([
    [true, 'Meta+K'],
    [false, 'Control+K'],
  ])(
    'names the header button Search… and exposes the shortcut (Apple: %s) as %s',
    async (apple, keys) => {
      vi.spyOn(shortcut, 'isApplePlatform').mockReturnValue(apple)
      renderAppAt('/overview')
      const button = await screen.findByRole('button', { name: 'Search…' })
      expect(button).toHaveAttribute('aria-keyshortcuts', keys)
      expect(within(button).getByText(/K$/)).toHaveAttribute('aria-hidden', 'true')
    }
  )

  it('fetches the palette’s code when the Search… button is hovered or focused', async () => {
    const user = userEvent.setup()
    renderAppAt('/overview')
    const button = await screen.findByRole('button', { name: /Search…/ })
    vi.mocked(prefetchPalette).mockClear()
    await user.hover(button)
    expect(prefetchPalette).toHaveBeenCalledTimes(1)
    vi.mocked(prefetchPalette).mockClear()
    button.focus()
    expect(prefetchPalette).toHaveBeenCalledTimes(1)
  })

  it('signs out, and is disabled while the sign-out is pending', async () => {
    // The request never answers, so the sign-out stays pending.
    server.use(http.post('/api/v1/auth/logout', () => new Promise<Response>(() => {})))
    const user = userEvent.setup()
    renderAppAt('/overview')
    const palette = await openFromHeader(user)
    const account = within(palette).getByRole('group', { name: 'Account' })
    await user.click(within(account).getByRole('option', { name: 'Sign out' }))
    await openFromHeader(user)
    expect(
      within(await screen.findByRole('group', { name: 'Account' })).getByRole('option', {
        name: 'Sign out',
      })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables Sign out in the palette while the account menu’s sign-out is pending', async () => {
    server.use(http.post('/api/v1/auth/logout', () => new Promise<Response>(() => {})))
    const user = userEvent.setup()
    renderAppAt('/overview')
    await user.click(await screen.findByRole('button', { name: /^Account menu for/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    const palette = await openFromHeader(user)
    await waitFor(() =>
      expect(within(palette).getByRole('option', { name: 'Sign out' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
  })

  it.each([
    ['Go to', '', 'Tenants', 'open_page'],
    ['Go to', 'settings', 'Settings', 'open_page'],
    ['Go to', 'secur', 'Security', 'open_page'],
    ['Recent', '', 'Acme Corp', 'open_recent'],
    ['Tenants', 'acme', 'Acme Corp', 'open_tenant'],
    ['Users', 'cleo', 'cleo@example.com', 'open_user'],
    ['Theme', '', 'Dark', 'set_theme'],
    ['Account', '', 'New tenant', 'create_tenant'],
    ['Account', '', 'Sign out', 'sign_out'],
  ])('sends only the fixed key for %s › %s (%s)', async (group, term, label, action) => {
    signInAs('admin')
    if (group === 'Recent') {
      recordRecent(testUser.id, {
        kind: 'tenant',
        id: TENANT_ID,
        label: 'Acme Corp',
        detail: 'acme',
      })
    }
    server.use(
      http.get('/api/v1/platform/tenants', () => ok(listPage([ACME]), 'Tenants retrieved.')),
      http.get('/api/v1/platform/users', () => ok(listPage([CLEO]), 'Users retrieved.')),
      http.post('/api/v1/auth/logout', () => new Promise<Response>(() => {}))
    )
    const track = vi.spyOn(analytics, 'track')
    const user = userEvent.setup()
    renderAppAt('/overview')
    const palette = await openPalette(user)
    if (term) await user.keyboard(term)
    const list = await within(palette).findByRole('group', { name: group })
    await user.click(await within(list).findByRole('option', { name: new RegExp(`^${label}\\b`) }))
    await waitFor(() =>
      expect(track.mock.calls.filter(([event]) => event === 'command_palette_action_run')).toEqual([
        ['command_palette_action_run', { action }],
      ])
    )
  })
})
