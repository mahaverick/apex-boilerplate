import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SettingsRouteError } from '@/components/features/route-error'
import { Route as AccountProfile } from '@/pages/_app/settings/account.profile'
import { Route as AccountSecurity } from '@/pages/_app/settings/account.security'
import { Route as SettingsIndex } from '@/pages/_app/settings/index'
import { Route as PlatformFlags } from '@/pages/_app/settings/platform.flags'
import { Route as PlatformMaintenance } from '@/pages/_app/settings/platform.maintenance'
import { Route as PlatformStaff } from '@/pages/_app/settings/platform.staff'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'

vi.mock('@/observability/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/errors')>()),
  noteError: vi.fn(),
}))

/** Throws while rendering, standing in for a settings page that breaks. */
function Broken(): never {
  throw new Error('settings page exploded')
}

vi.mock('@/components/features/profile/security-section', () => ({
  SecuritySection: Broken,
}))
vi.mock('@/components/features/tenant/members-card', () => ({
  MembersCard: Broken,
}))

describe('a settings page that fails to render', () => {
  beforeEach(() => {
    signIn()
    // React logs the caught render error; the boundary catching it is what is under test.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['an account page', '/settings/account/security', 'Security'],
    ['a platform page', '/settings/platform/staff', 'Staff'],
  ])(
    'keeps %s to one h1, the layout heading, with the error titled h2',
    async (_kind, path, h1) => {
      renderAppAt(path)

      await screen.findByText('This page didn’t load')
      const headings = screen.getAllByRole('heading', { level: 1 })
      expect(headings.map((heading) => heading.textContent)).toEqual([h1])
      expect(
        screen.getByRole('heading', { level: 2, name: 'This page didn’t load' })
      ).toBeInTheDocument()
    }
  )

  it('gives every settings leaf the h2 error screen', () => {
    expect(SettingsRouteError).toBeTypeOf('function')
    for (const route of [
      SettingsIndex,
      AccountProfile,
      AccountSecurity,
      PlatformStaff,
      PlatformFlags,
      PlatformMaintenance,
    ]) {
      expect(route.options.errorComponent, route.id).toBe(SettingsRouteError)
      // In the route's own module, not a lazy chunk: a chunk that failed to load could not fetch it, and a split one pulls the error listener out of the entry chunk (pnpm check:bundle).
      expect(route.options.codeSplitGroupings, route.id).toEqual([['component']])
    }
  })
})
