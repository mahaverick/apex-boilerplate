import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { refuseShellUntilCreated } from '@/tests/mocks/setup-refusal'

const webauthn = vi.hoisted(() => ({ support: vi.fn(), create: vi.fn() }))

vi.mock('@/lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webauthn')>()),
  passkeySupport: webauthn.support,
  createPasskeyCredential: webauthn.create,
  signalPasskeyUser: vi.fn(),
}))

const PASSKEY = {
  id: 'pk-1',
  name: 'Passkey 1',
  provider: { name: 'iCloud Keychain', iconLight: null, iconDark: null },
  synced: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  lastUsedAt: null,
  credentialId: 'cred-1',
}

/** Mounts the real route tree at `path`, as the app shell sees it. */
function renderAppAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

describe('AppShell in required mode (apex)', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    usePasskeySetupStore.setState({ required: false, message: null })
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    webauthn.support.mockReset().mockResolvedValue({ create: true, autofill: true })
    webauthn.create.mockReset().mockResolvedValue({ id: 'new-cred' })
  })

  afterEach(() => {
    usePasskeySetupStore.setState({ required: false, message: null })
  })

  it('renders Create your passkey when the _app flags read answers 403 PASSKEY_SETUP_REQUIRED, and never RoleDenied', async () => {
    refuseShellUntilCreated({ created: false })
    renderAppAt('/tenants')

    expect(
      await screen.findByRole('heading', { name: 'Create your passkey', level: 1 })
    ).toBeVisible()
    // RoleDenied's real title, so this fails if the setup refusal ever renders it.
    expect(screen.queryByText(/Your role can.t see this any more/)).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(usePasskeySetupStore.getState().required).toBe(true)
  })

  it('returns to the page after create: same pathname, its h1 rendered, no location change', async () => {
    const user = userEvent.setup()
    const state = { created: false }
    refuseShellUntilCreated(state)
    server.use(
      http.post('/api/v1/auth/passkeys/registration/options', () =>
        ok({ challengeId: 'c1', options: { challenge: 'x' } }, 'Options.')
      ),
      http.post('/api/v1/auth/passkeys/registration/verify', () => {
        state.created = true
        return ok({ passkey: PASSKEY }, 'Passkey created.')
      })
    )
    const router = renderAppAt('/tenants')
    await screen.findByRole('heading', { name: 'Create your passkey', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Create a passkey' }))

    expect(await screen.findByRole('heading', { name: 'Tenants', level: 1 })).toBeVisible()
    expect(router.state.location.pathname).toBe('/tenants')
    expect(usePasskeySetupStore.getState().required).toBe(false)
    expect(screen.queryByRole('heading', { name: 'Create your passkey' })).not.toBeInTheDocument()
  })

  it('a 403 that is not the setup refusal leaves the layout in place', async () => {
    server.use(http.get('/api/v1/platform/me/flags', () => fail('Nope.', 403, 'FORBIDDEN')))
    renderAppAt('/tenants')
    expect(await screen.findByRole('heading', { name: 'Tenants', level: 1 })).toBeVisible()
    expect(usePasskeySetupStore.getState().required).toBe(false)
  })
})
