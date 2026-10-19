import type { RouterHistory } from '@tanstack/react-router'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderAppAt, signOut } from '@/tests/fixtures/render-app'

/**
 * The old password paths, still reached from mailed links and bookmarks. Run
 * signed out: a signed-in visitor goes on from /login to Overview, which
 * `guards.test.tsx` covers.
 */
describe('retired password paths', () => {
  beforeEach(signOut)

  it.each([
    '/register?invitation=ttt',
    '/forgot-password',
    '/reset-password?token=ttt',
    '/verify-email?token=ttt',
  ])('redirects %s to /login with the note and no token', async (path) => {
    const router = renderAppAt(path)

    await waitFor(() => {
      expect(router.state.location.href).toBe('/login?notice=sign-in-link')
    })
    expect(await screen.findByText('Sign-in now uses email links.')).toBeInTheDocument()
    expect(router.state.location.href).not.toContain('ttt')
    // replace: Back does not return to the dead path.
    expect((router.history as RouterHistory).length).toBe(1)
  })
})
