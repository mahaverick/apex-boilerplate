import { screen, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** Counts each `GET /platform/me/flags`, answering with `answer`. */
function serveFlags(
  answer: () => Response = () => ok({ flags: {}, evaluatedAt: '2026-10-05T10:00:00.000Z' })
) {
  const seen: string[] = []
  server.use(
    http.get('/api/v1/platform/me/flags', () => {
      seen.push('flags')
      return answer()
    })
  )
  return seen
}

describe('the staff shell’s flags', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('reads Apex’s flags once when the shell loads', async () => {
    const seen = serveFlags()
    renderAppAt('/overview')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Overview' })).toBeInTheDocument()
    expect(seen).toEqual(['flags'])
  })

  it('still renders the page, without signing out, when the flags read fails', async () => {
    const seen = serveFlags(() => fail('Internal server error', 500))
    renderAppAt('/overview')
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument()
    expect(seen.length).toBeGreaterThan(0)
  })

  it('never asks for flags for a signed-in user who is not staff', async () => {
    signIn({ ...testUser, platformRole: null })
    const seen = serveFlags()
    renderAppAt('/overview')
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(seen).toEqual([])
  })
})
