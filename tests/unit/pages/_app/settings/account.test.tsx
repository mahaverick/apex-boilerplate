import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { testUser } from '@/tests/mocks/handlers'

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
})
