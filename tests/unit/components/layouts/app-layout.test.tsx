import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const LOGOUT_FAILED = "Couldn't sign out. Check your connection and try again."

/** Every way POST /auth/logout can fail WITHOUT the server saying the session is over. */
const LOGOUT_FAILURES: [string, () => Response][] = [
  ['the API cannot be reached', () => HttpResponse.error()],
  ['a 503 from a restarting upstream', () => fail('Service Unavailable', 503)],
  [
    'a 429 from the logout rate limiter',
    () => fail('Too many attempts. Please try again later.', 429, 'RATE_LIMITED'),
  ],
]

/**
 * Driven through a real RouterProvider: the layout reads `useMatches()` for
 * its breadcrumbs and renders `<Link>` nav items, neither of which exists
 * outside a router.
 */
function renderAppAt(path: string): AnyRouter & { unmount: () => void } {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return Object.assign(router as AnyRouter, { unmount })
}

describe('AppLayout', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useSidebarStore.setState({ isCollapsed: false })
    // Already bootstrapped, so __root's beforeLoad returns immediately and _app's guard lets the layout render.
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  const realLocation = window.location

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  })

  it('renders exactly one main landmark', async () => {
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    // SidebarInset already IS a <main>. A second <main> around the Outlet would be an axe `landmark-no-duplicate-main` failure.
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('renders nav items as real anchors', async () => {
    renderAppAt('/overview')
    const nav = await screen.findByRole('navigation', { name: 'Main' })

    const link = within(nav).getByRole('link', { name: 'Overview' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/overview')
  })

  it('gives every icon-only control its own accessible name', async () => {
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account menu for A B' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Theme: system. Change theme' })).toBeInTheDocument()
  })

  it('shows a breadcrumb for the current route', async () => {
    renderAppAt('/profile')
    const breadcrumb = await screen.findByRole('navigation', { name: 'breadcrumb' })

    // The layout route itself contributes no crumb: `_app` is pathless.
    const trail = within(breadcrumb)
      .getAllByRole('listitem')
      .map((item) => item.textContent?.trim())
      .filter((text) => text !== '')
    expect(trail).toEqual(['Profile'])
  })

  it('does not put a Tenants crumb in front of the tenants list itself', async () => {
    renderAppAt('/tenants')
    const breadcrumb = await screen.findByRole('navigation', { name: 'breadcrumb' })

    const trail = within(breadcrumb)
      .getAllByRole('listitem')
      .map((item) => item.textContent?.trim())
      .filter((text) => text !== '')
    expect(trail).toEqual(['Tenants'])
  })

  it('navigates to the profile from the account menu', async () => {
    const user = userEvent.setup()
    const router = renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Profile' }))

    // A real router navigation, not a click handler that only closes the menu.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/profile')
    })
  })

  /**
   * `window.location.assign` is non-configurable in jsdom, so vi.spyOn on it
   * throws "Cannot redefine property". Replacing the whole `location` object
   * is the way in; `afterEach` puts the real one back.
   */
  it('signs out from the account menu', async () => {
    server.use(http.post('/api/v1/auth/logout', () => ok(null, 'Signed out.')))
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
    const user = userEvent.setup()
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })
    expect(assign).toHaveBeenCalledWith('/login')
  })

  function stubAssign() {
    // Same reason as the test above: jsdom's assign cannot be spied on.
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
    return assign
  }

  async function clickSignOut() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
  }

  // The server never revoked the session, so clearing it here would leave a live refresh cookie behind a UI that claims the user signed out.
  it.each(LOGOUT_FAILURES)(
    'keeps the session and says so when sign-out fails on %s',
    async (_label, respond) => {
      server.use(http.post('/api/v1/auth/logout', () => respond()))
      const assign = stubAssign()
      renderAppAt('/overview')
      await screen.findByRole('heading', { name: 'Overview', level: 1 })

      await clickSignOut()

      expect(await screen.findByText(LOGOUT_FAILED)).toBeInTheDocument()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
      expect(assign).not.toHaveBeenCalled()
    }
  )

  // A 401 means the server already considers the session over.
  it('signs out when the logout itself answers 401, redirecting exactly once', async () => {
    server.use(http.post('/api/v1/auth/logout', () => fail('Unauthorized', 401)))
    const assign = stubAssign()
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    await clickSignOut()

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })
    expect(assign).toHaveBeenCalledWith('/login')
    // skipAuthRetry keeps the interceptor's own 401 verdict from redirecting first.
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('tells other tabs when signing out succeeds', async () => {
    server.use(http.post('/api/v1/auth/logout', () => ok(undefined, 'Logged out.')))
    stubAssign()
    const otherTab = new BroadcastChannel('auth')
    const received: unknown[] = []
    otherTab.addEventListener('message', (event: MessageEvent<unknown>) => {
      received.push(event.data)
    })
    try {
      renderAppAt('/overview')
      await screen.findByRole('heading', { name: 'Overview', level: 1 })

      await clickSignOut()

      await vi.waitFor(() => expect(received).toEqual([{ type: 'logout' }]))
    } finally {
      otherTab.close()
    }
  })

  it('takes its open state from the sidebar store', async () => {
    useSidebarStore.setState({ isCollapsed: true })
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    // The provider is controlled by the store, so a collapsed store means a collapsed sidebar on first paint rather than after a click.
    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull()
  })
})

/**
 * `theme: 'system'` following a LIVE OS change.
 *
 * The listener sits in AppLayout rather than in ThemeToggle, and the mobile
 * case below is the whole reason: under `md` the sidebar renders into a Sheet
 * (a Base UI Dialog.Popup with no `keepMounted`), so ThemeToggle does not
 * exist while the drawer is closed. An effect inside it would be desktop-only.
 */
describe('AppLayout system theme', () => {
  const DARK_QUERY = '(prefers-color-scheme: dark)'
  const realInnerWidth = window.innerWidth

  let darkListeners = new Set<(event: MediaQueryListEvent) => void>()
  let prefersDark = false
  let originalMatchMedia: typeof window.matchMedia

  /**
   * A `matchMedia` stub whose listeners actually fire, unlike
   * `tests/setup.ts`'s. It also answers the `(max-width: …)` query that
   * `useIsMobile` asks, so setting `innerWidth` is enough to pick a viewport.
   */
  function installMatchMedia() {
    window.matchMedia = ((query: string) => ({
      get matches() {
        if (query === DARK_QUERY) return prefersDark
        const maxWidth = /max-width:\s*(\d+)px/.exec(query)
        return maxWidth ? window.innerWidth <= Number(maxWidth[1]) : false
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (query === DARK_QUERY) darkListeners.add(listener)
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        darkListeners.delete(listener)
      },
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  /** The OS colour scheme changes while the tab is open. */
  function osSwitchesTo(dark: boolean) {
    prefersDark = dark
    act(() => {
      for (const listener of darkListeners) listener({ matches: dark } as MediaQueryListEvent)
    })
  }

  function setViewportWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  }

  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useSidebarStore.setState({ isCollapsed: false })
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    useThemeStore.setState({ theme: 'system' })
    darkListeners = new Set()
    prefersDark = false
    // Bound, because `@typescript-eslint/unbound-method` rightly objects to lifting a method off its object — and restoring it is all it is for.
    originalMatchMedia = window.matchMedia.bind(window)
    installMatchMedia()
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    setViewportWidth(realInnerWidth)
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    useThemeStore.setState({ theme: 'system' })
  })

  it('follows a live OS change on a desktop viewport', async () => {
    setViewportWidth(1280)
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    osSwitchesTo(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('follows a live OS change on a phone, where the sidebar is unmounted', async () => {
    setViewportWidth(500)
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    // The premise, asserted rather than assumed: below `md` the closed drawer means no ThemeToggle in the document at all. If this ever starts failing, the listener could go back down into the control.
    expect(screen.queryByRole('button', { name: /Change theme/ })).not.toBeInTheDocument()

    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('ignores an OS change once the user has chosen a theme explicitly', async () => {
    useThemeStore.setState({ theme: 'light' })
    renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })

    osSwitchesTo(true)
    // The user asked for light. The OS does not get a vote.
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('stops listening once the layout unmounts', async () => {
    const { unmount } = renderAppAt('/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })
    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    unmount()
    document.documentElement.classList.remove('dark')
    // Asserted by behaviour rather than by counting listeners: sonner's <Toaster> registers on the same query, so the count is never just ours.
    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
