import { screen, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { flagsEvaluation } from '@/tests/fixtures/flags'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformUserDetail } from '@/types/api.types'

/** The signed-in user as the platform user read answers it, so a bookmarked evaluation has someone to show. */
const ME: PlatformUserDetail = {
  id: testUser.id,
  email: testUser.email,
  firstName: testUser.firstName,
  lastName: testUser.lastName,
  active: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lastLoggedInAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  platformRole: 'admin',
  membershipCount: 0,
  authProviders: ['email'],
  memberships: [],
  pendingInvitations: [],
}

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
    server.use(
      http.get('/api/v1/platform/flags/evaluate', () => ok(flagsEvaluation(), 'Flags evaluated.')),
      http.get(`/api/v1/platform/users/${testUser.id}`, () => ok(ME, 'User retrieved.'))
    )
    const router = renderAppAt(`/flags?userId=${testUser.id}&app=apex#evaluate`)
    await screen.findByRole('heading', { name: 'Feature flags', level: 1 })
    expect(router.state.location.pathname).toBe('/settings/platform/flags')
    expect(router.state.location.search).toMatchObject({ userId: testUser.id, app: 'apex' })
    expect(router.state.location.hash).toBe('evaluate')
    const evaluate = await screen.findByRole('region', { name: 'Evaluate' })
    expect(await within(evaluate).findByRole('button', { name: 'Change user' })).toBeVisible()
    expect(within(evaluate).getByText(testUser.email)).toBeInTheDocument()
  })

  // Named, so a 404 page's own single h1 cannot satisfy the count.
  it.each([
    ['/settings/platform/staff', 'Staff'],
    ['/settings/platform/flags', 'Feature flags'],
    ['/settings/platform/maintenance', 'Maintenance'],
  ])('%s has exactly one h1', async (path, h1) => {
    signIn(testUser)
    renderAppAt(path)
    await screen.findByRole('heading', { name: h1, level: 1 })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
