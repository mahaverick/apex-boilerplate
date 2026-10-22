import { describe, expect, it } from 'vite-plus/test'
import { safeLanding } from '@/lib/landing'

describe('safeLanding', () => {
  it('keeps a safe same-origin path with its query', () => {
    expect(safeLanding('/activity?range=7d')).toBe('/activity?range=7d')
  })

  it.each([
    '/auth/link?token=ttt',
    '/auth/link',
    '/Auth/Link/?token=ttt',
    '/invitations/accept?token=ttt',
    '/invitations/accept/',
    '/auth/confirm?token=ttt',
    '/AUTH/CONFIRM//',
    '/invitations/confirm?token=ttt&email=a%40b.test',
    '/Invitations/Confirm/',
    // The router decodes the path before it matches, so an escaped letter is still the token page.
    '/auth/%6Cink?token=ttt',
    '/invitations/%61ccept?token=ttt',
    '/invitations/confirm%2F?token=ttt',
    '/auth/%63onfirm?token=ttt',
  ])('refuses the token page %s', (value) => {
    expect(safeLanding(value)).toBeNull()
  })

  it('refuses a path whose escapes do not decode', () => {
    expect(safeLanding('/activity/%E0%A4%A')).toBeNull()
  })

  it('keeps an escaped path that is not a token page', () => {
    expect(safeLanding('/tenants/a%20b')).toBe('/tenants/a%20b')
  })

  it.each(['//evil.test', 'https://evil.test', undefined, null, ''])(
    'refuses what safeRedirect refuses (%s)',
    (value) => {
      expect(safeLanding(value)).toBeNull()
    }
  )
})
