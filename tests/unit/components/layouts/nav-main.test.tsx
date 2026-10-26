import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { NavMain } from '@/components/layouts/nav-main'
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { navGroupsFor } from '@/constants/navigation'

/** Every section an admin sees: all five, Activity log included. */
const SECTIONS = navGroupsFor('admin')

/** A button that collapses or expands the sidebar, as the header's trigger does. */
function ToggleSidebar() {
  const { toggleSidebar, state } = useSidebar()
  return (
    <button type="button" onClick={toggleSidebar}>
      Sidebar is {state}
    </button>
  )
}

/** Renders NavMain under a one-route router at `path`, so its `Link`s resolve. */
function renderNavAt(path: string, defaultOpen = true) {
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider defaultOpen={defaultOpen}>
        <NavMain sections={SECTIONS} pathname={path} />
        <ToggleSidebar />
      </SidebarProvider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
}

describe('NavMain', () => {
  it('keeps the five labelled sections, in order, each a disclosure button', async () => {
    renderNavAt('/overview')

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const toggles = within(nav).getAllByRole('button')
    expect(toggles.map((toggle) => toggle.textContent)).toEqual([
      'General',
      'Directory',
      'Operations',
      'Growth',
      'Security',
    ])
  })

  it('opens every section by default and lights the current item', async () => {
    renderNavAt('/overview')

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    for (const toggle of within(nav).getAllByRole('button')) {
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual([
      'Overview',
      'Tenants',
      'Users',
      'Emails',
      'Deliverability',
      'Suppressions',
      'Billing alerts',
      'Onboarding',
      'Plans',
      'Activity log',
    ])
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('data-active')
    expect(within(nav).getByRole('link', { name: 'Users' })).not.toHaveAttribute('data-active')
  })

  it('folds a section when its label is pressed, and unfolds it again', async () => {
    const user = userEvent.setup()
    renderNavAt('/overview')

    const operations = await screen.findByRole('button', { name: 'Operations' })
    await user.click(operations)
    expect(operations).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Emails' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Suppressions' })).not.toBeInTheDocument()
    // The other sections are untouched.
    expect(screen.getByRole('link', { name: 'Tenants' })).toBeInTheDocument()

    await user.click(operations)
    expect(operations).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('link', { name: 'Emails' })).toHaveAttribute('href', '/emails')
  })

  it('keeps the section holding the current page open, its toggle aria-disabled', async () => {
    const user = userEvent.setup()
    renderNavAt('/users/u-1')

    const directory = await screen.findByRole('button', { name: 'Directory' })
    expect(directory).toHaveAttribute('aria-expanded', 'true')
    expect(directory).toHaveAttribute('aria-disabled', 'true')

    await user.click(directory)
    expect(directory).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('data-active')
  })

  it('shows every item when collapsed to icons, whatever was folded', async () => {
    const user = userEvent.setup()
    renderNavAt('/overview')

    await user.click(await screen.findByRole('button', { name: 'Operations' }))
    expect(screen.queryByRole('link', { name: 'Emails' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sidebar is expanded' }))
    expect(await screen.findByRole('link', { name: 'Emails' })).toBeInTheDocument()
    // The sidebar hides the labels in icon mode, so they are plain text, not buttons.
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).queryByRole('button')).not.toBeInTheDocument()

    // Expanded again, the section is folded as the user left it.
    await user.click(screen.getByRole('button', { name: 'Sidebar is collapsed' }))
    expect(screen.getByRole('button', { name: 'Operations' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByRole('link', { name: 'Emails' })).not.toBeInTheDocument()
  })

  it('starts with every item shown when the sidebar opens collapsed to icons', async () => {
    renderNavAt('/overview', false)

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link')).toHaveLength(10)
  })

  describe('in the phone drawer', () => {
    const realInnerWidth = window.innerWidth

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: realInnerWidth })
    })

    /** Renders NavMain inside the real Sidebar, which is a drawer below `md`, with a trigger to open it. */
    function renderDrawerAt(path: string) {
      const rootRoute = createRootRoute({
        component: () => (
          <SidebarProvider>
            <Sidebar collapsible="icon">
              <SidebarContent>
                <NavMain sections={SECTIONS} pathname={path} />
              </SidebarContent>
            </Sidebar>
            <SidebarTrigger aria-label="Toggle sidebar" />
          </SidebarProvider>
        ),
      })
      const router = createRouter({
        routeTree: rootRoute,
        history: createMemoryHistory({ initialEntries: [path] }),
      })
      render(<RouterProvider router={router} />)
      return router
    }

    it('closes the drawer when an item is chosen', async () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
      const user = userEvent.setup()
      const router = renderDrawerAt('/overview')

      await user.click(await screen.findByRole('button', { name: 'Toggle sidebar' }))
      const drawer = await screen.findByRole('dialog')
      await user.click(within(drawer).getByRole('link', { name: 'Tenants' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(router.state.location.pathname).toBe('/tenants')
    })
  })
})
