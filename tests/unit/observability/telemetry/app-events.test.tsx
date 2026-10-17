import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPage } from '@/tests/fixtures/list-page'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const CLEO = {
  id: '22222222-2222-4222-8222-222222222222',
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

/** The setup file loads telemetry before this file's mock exists, so the app loads again after a reset to pick it up. */
vi.resetModules()
const { useCommandPaletteStore } = await import('@/states/command-palette.store')
const { renderAppAt, signIn } = await import('@/tests/fixtures/render-app')

const tracked = vi.hoisted(() => ({ events: [] as [string, unknown][] }))

vi.mock('@/observability/telemetry/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry/telemetry')>()),
  track: (event: string, props: unknown) => tracked.events.push([event, props]),
}))

/** The properties of each tracked event called `name`; `undefined` for an event sent with none. */
function eventsNamed(name: string): unknown[] {
  return tracked.events.filter(([event]) => event === name).map(([, props]) => props)
}

beforeEach(() => {
  tracked.events = []
  useCommandPaletteStore.setState({ open: false })
  signIn({ ...testUser, platformRole: 'viewer' })
  server.use(
    http.get('/api/v1/platform/users', () =>
      ok(listPage([CLEO], { nextCursor: 'c2', hasNext: true }), 'Users retrieved.')
    ),
    http.get('/api/v1/platform/tenants', () => ok(listPage([]), 'Tenants retrieved.')),
    http.get('/api/v1/platform/audit-log', () =>
      ok({ entries: [], nextCursor: null }, 'Audit log retrieved.')
    ),
    http.get('/api/v1/tenants/platform/members', () => ok([], 'Members retrieved.'))
  )
})

describe('the command palette', () => {
  it('reports each opening and the kind of item chosen, never the search term', async () => {
    const user = userEvent.setup()
    const router = renderAppAt('/users')
    await screen.findByRole('searchbox', { name: 'Search users' })
    expect(eventsNamed('command_palette_opened')).toEqual([])

    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('dialog', { name: 'Command palette' })
    await user.keyboard('tena')
    await user.click(await screen.findByRole('option', { name: 'Tenants' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
    // An event with no properties is sent with none.
    expect(eventsNamed('command_palette_opened')).toEqual([undefined])
    expect(eventsNamed('command_palette_action_run')).toEqual([{ action: 'open_page' }])
    expect(JSON.stringify(tracked.events)).not.toContain('tena')
  })
})

describe('table_filtered', () => {
  it('fires once per filter or search change on a list, and not for paging', async () => {
    const user = userEvent.setup()
    const router = renderAppAt('/users')
    await screen.findByText('cleo@example.com')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c2' }))
    expect(eventsNamed('table_filtered')).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Filter by status, Users' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Users' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Active' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'active' }))
    expect(eventsNamed('table_filtered')).toEqual([{ table: 'users' }])

    await user.type(screen.getByRole('searchbox', { name: 'Search users' }), 'pii-probe')
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ status: 'active', search: 'pii-probe' })
    )
    expect(eventsNamed('table_filtered')).toEqual([{ table: 'users' }, { table: 'users' }])
    expect(JSON.stringify(tracked.events)).not.toContain('pii-probe')
  })

  it('names the onboarding list when its state tab changes', async () => {
    const user = userEvent.setup()
    renderAppAt('/onboarding')
    await user.click(await screen.findByRole('tab', { name: 'In progress' }))
    await waitFor(() =>
      expect(eventsNamed('table_filtered')).toEqual([{ table: 'onboarding_tenants' }])
    )
  })

  it('names the activity log when a filter changes', async () => {
    signIn(testUser)
    const user = userEvent.setup()
    renderAppAt('/activity')
    await user.click(await screen.findByRole('switch', { name: 'Staff only' }))
    expect(eventsNamed('table_filtered')).toEqual([{ table: 'activity' }])
  })
})
