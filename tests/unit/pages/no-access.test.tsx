import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/states/auth.store'
import { byContent } from '@/tests/fixtures/content'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('/no-access', () => {
  const realLocation = window.location

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  })

  it('names the invitation and the admin as the ways in, and no email domain', async () => {
    signIn({ ...testUser, platformRole: null })
    renderAppAt('/no-access')
    const ways = await screen.findByRole('list')
    expect(
      within(ways)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([
      'If you were invited, open the invitation email and select Join.',
      'Otherwise, ask a platform admin to invite you.',
    ])
    expect(document.body).not.toHaveTextContent(/domain/i)
  })

  it('says the account has no access, names it, explains the ways in, and signs out', async () => {
    signIn({ ...testUser, platformRole: null })
    let loggedOut = false
    server.use(
      http.post('/api/v1/auth/logout', () => {
        loggedOut = true
        return ok(null, 'Logged out.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/no-access')

    expect(
      await screen.findByRole('heading', { name: 'This account has no platform access', level: 1 })
    ).toBeInTheDocument()
    expect(screen.getByText(byContent('Signed in as a.b@example.com.'))).toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()

    // Sign-out leaves by a full page load (`useLogout`), and jsdom's `assign` cannot be spied on, so the whole `location` is replaced.
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'))
    expect(loggedOut).toBe(true)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
