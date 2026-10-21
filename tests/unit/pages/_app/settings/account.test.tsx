import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const webauthn = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@/lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webauthn')>()),
  passkeySupport: vi.fn().mockResolvedValue({ create: true, autofill: true }),
  createPasskeyCredential: webauthn.create,
  signalAcceptedPasskeys: vi.fn(),
  signalPasskeyUser: vi.fn(),
}))

/** One passkey row as the API lists it. */
const PASSKEY = {
  id: 'pk-1',
  name: 'Passkey 1',
  provider: { name: 'iCloud Keychain', iconLight: null, iconDark: null },
  synced: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  lastUsedAt: null,
  credentialId: 'cred-1',
}

describe('settings: account', () => {
  it.each([
    ['/profile?x=1#y', '/settings/account/profile'],
    ['/settings/account?x=1#y', '/settings/account/profile'],
  ])('%s redirects to %s, keeping the query and hash', async (from, to) => {
    signIn(testUser)
    const router = renderAppAt(from)
    await screen.findByRole('heading', { name: 'Profile', level: 1 })
    expect(router.state.location.pathname).toBe(to)
    expect(router.state.location.searchStr).toBe('?x=1')
    expect(router.state.location.hash).toBe('y')
  })

  it('titles the page from the active section, with one h1', async () => {
    signIn(testUser)
    renderAppAt('/settings/account/security')
    expect(await screen.findByRole('heading', { name: 'Security', level: 1 })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Your sign-in methods and other sessions.')).toBeInTheDocument()
  })

  it('lists every section on the landing page, as links', async () => {
    signIn(testUser)
    renderAppAt('/settings')
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
    const account = screen.getByRole('region', { name: 'Account' })
    const platform = screen.getByRole('region', { name: 'Platform' })
    expect(within(account).getByRole('link', { name: /Profile/ })).toHaveAttribute(
      'href',
      '/settings/account/profile'
    )
    expect(within(account).getByRole('link', { name: /Security/ })).toHaveAttribute(
      'href',
      '/settings/account/security'
    )
    expect(
      within(platform)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
    ).toEqual([
      '/settings/platform/staff',
      '/settings/platform/flags',
      '/settings/platform/maintenance',
    ])
  })

  it('Security lists passkeys between Sign-in methods and Other sessions, creates with app apex on both registration calls, and deletes with ?app=apex', async () => {
    const user = userEvent.setup()
    webauthn.create.mockResolvedValue({ id: 'new-cred' })
    const bodies: unknown[] = []
    let deleteQuery = ''
    server.use(
      http.get('/api/v1/auth/passkeys/config', () =>
        ok({ mode: 'optional', rpId: 'localhost' }, 'Passkey settings retrieved.')
      ),
      http.get('/api/v1/auth/passkeys', () =>
        ok({ passkeys: [PASSKEY], userHandle: 'HANDLE' }, 'Passkeys retrieved.')
      ),
      http.post('/api/v1/auth/passkeys/registration/options', async ({ request }) => {
        bodies.push(await request.json())
        return ok({ challengeId: 'c1', options: { challenge: 'x' } }, 'Options.')
      }),
      http.post('/api/v1/auth/passkeys/registration/verify', async ({ request }) => {
        bodies.push(await request.json())
        return ok({ passkey: { ...PASSKEY, id: 'pk-2', name: 'Passkey 2' } }, 'Created.')
      }),
      http.delete('/api/v1/auth/passkeys/pk-1', ({ request }) => {
        deleteQuery = new URL(request.url).search
        return ok(null, 'Deleted.')
      })
    )
    signIn(testUser)
    renderAppAt('/settings/account/security')

    await screen.findByText('Passkey 1')
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(headings.indexOf('Passkeys')).toBe(headings.indexOf('Sign-in methods') + 1)
    expect(headings.indexOf('Other sessions')).toBe(headings.indexOf('Passkeys') + 1)

    await user.click(screen.getByRole('button', { name: 'Create a passkey' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[0]).toEqual({ app: 'apex' })
    expect(bodies[1]).toEqual({ challengeId: 'c1', response: { id: 'new-cred' }, app: 'apex' })

    await user.click(await screen.findByRole('button', { name: 'Delete Passkey 1' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    await user.click(dialog.getByRole('button', { name: 'Delete passkey' }))
    await waitFor(() => expect(deleteQuery).toBe('?app=apex'))
  })
})
