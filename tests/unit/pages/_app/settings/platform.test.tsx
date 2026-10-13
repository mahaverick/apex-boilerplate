import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { testUser } from '@/tests/mocks/handlers'

describe('settings: platform', () => {
  it.each([
    ['/staff?x=1#y', '/settings/platform/staff', 'Staff'],
    ['/maintenance?x=1#y', '/settings/platform/maintenance', 'Maintenance'],
    ['/settings/platform?x=1#y', '/settings/platform/staff', 'Staff'],
  ])('%s redirects to %s, keeping the query and hash', async (from, to, h1) => {
    signIn(testUser)
    const router = renderAppAt(from)
    await screen.findByRole('heading', { name: h1, level: 1 })
    expect(router.state.location.pathname).toBe(to)
    expect(router.state.location.searchStr).toBe('?x=1')
    expect(router.state.location.hash).toBe('y')
  })

  // A bookmarked evaluation must still open filled in.
  it('keeps a flags bookmark’s evaluation search', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    const router = renderAppAt(`/flags?userId=${testUser.id}&app=apex#evaluate`)
    await screen.findByRole('heading', { name: 'Feature flags', level: 1 })
    expect(router.state.location.pathname).toBe('/settings/platform/flags')
    expect(router.state.location.search).toMatchObject({ userId: testUser.id, app: 'apex' })
    expect(router.state.location.hash).toBe('evaluate')
  })

  it.each([
    '/settings/platform/staff',
    '/settings/platform/flags',
    '/settings/platform/maintenance',
  ])('%s has exactly one h1', async (path) => {
    signIn(testUser)
    renderAppAt(path)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
