import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarStore } from '@/states/sidebar.store'
import { flagsList } from '@/tests/fixtures/flags'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

// The Staff page's sections read the platform tenant, which no default handler serves; platform.staff-members.test.tsx covers them.
vi.mock('@/components/features/tenant/members-card', () => ({
  MembersCard: () => <p>members section</p>,
}))
vi.mock('@/components/features/tenant/invitations-section', () => ({
  InvitationsSection: () => <p>invitations section</p>,
}))

describe('the settings sidebar', () => {
  beforeEach(() => {
    signIn()
    useSidebarStore.setState({ isCollapsed: false })
    server.use(http.get('/api/v1/platform/flags', () => ok(flagsList(), 'Flags retrieved.')))
  })

  it('swaps the main nav for Back to console and the labelled settings groups', async () => {
    renderAppAt('/settings/platform/flags')

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Back to console',
      'Profile',
      'Security',
      'Staff',
      'Feature flags',
      'Maintenance',
    ])
    expect(within(nav).getByRole('link', { name: 'Back to console' })).toHaveAttribute(
      'href',
      '/overview'
    )
    expect(within(nav).getByRole('link', { name: 'Feature flags' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(links.filter((link) => link.hasAttribute('aria-current'))).toHaveLength(1)
    expect(within(nav).getByText('Account')).toBeVisible()
    expect(within(nav).getByText('Platform')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('keeps the main nav elsewhere, with Settings in the bottom group', async () => {
    renderAppAt('/overview')

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Settings' })).not.toBeInTheDocument()
    const secondary = screen.getByRole('navigation', { name: 'Secondary' })
    expect(within(secondary).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings'
    )
  })

  it('marks no settings item current on the landing page', async () => {
    renderAppAt('/settings')

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    for (const link of within(nav).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current')
    }
  })

  describe('in the phone drawer', () => {
    const realInnerWidth = window.innerWidth

    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    })

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: realInnerWidth })
    })

    /** Opens the drawer from the header and returns it. */
    async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
      return screen.findByRole('dialog')
    }

    it('closes the drawer after Settings, a section, and Back to console', async () => {
      const user = userEvent.setup()
      const router = renderAppAt('/overview')
      await screen.findByRole('heading', { name: 'Overview', level: 1 })

      let drawer = await openDrawer(user)
      const secondary = within(drawer).getByRole('navigation', { name: 'Secondary' })
      await user.click(within(secondary).getByRole('link', { name: 'Settings' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))

      drawer = await openDrawer(user)
      await user.click(within(drawer).getByRole('link', { name: 'Staff' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/settings/platform/staff')
      })

      drawer = await openDrawer(user)
      await user.click(within(drawer).getByRole('link', { name: 'Back to console' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(router.state.location.pathname).toBe('/overview'))
    })
  })
})
