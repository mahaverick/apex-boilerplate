import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { USER_EMAILS_SHOWN } from '@/components/features/emails/user-emails-card'
import { useAuthStore } from '@/states/auth.store'
import { EMAIL_ID, EMAIL_ID_2, USER_ID_2 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { emailSummary, fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformUserDetail } from '@/types/api.types'

const CLEO: PlatformUserDetail = {
  id: USER_ID_2,
  email: 'cleo@example.com',
  firstName: 'Cleo',
  lastName: 'Doe',
  active: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lastLoggedInAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  platformRole: null,
  membershipCount: 0,
  hasPassword: true,
  authProviders: ['email'],
  memberships: [],
  pendingInvitations: [],
}

/** Cleo's page, and her emails from `emails`; records every emails query. */
function serve(seen: URLSearchParams[], emails = [emailSummary()]) {
  server.use(
    http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(CLEO, 'User retrieved.')),
    http.get('/api/v1/platform/emails', ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return ok({ messages: emails, nextCursor: 'more', prevCursor: null }, 'Emails retrieved.')
    })
  )
}

describe('the Emails card on a user’s page', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('shows a viewer the account’s newest emails, each linking to its page', async () => {
    const seen: URLSearchParams[] = []
    serve(seen, [
      emailSummary({ id: EMAIL_ID, templateKey: 'password_reset', status: 'delivered' }),
      emailSummary({ id: EMAIL_ID_2, templateKey: 'email_verification', status: 'bounced' }),
    ])
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Emails' })

    const items = await within(card).findAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByRole('link', { name: /^Password reset · / })).toHaveAttribute(
      'href',
      `/emails/${EMAIL_ID}`
    )
    expect(within(items[0]!).getByText('Delivered')).toBeInTheDocument()
    expect(within(items[1]!).getByRole('link', { name: /^Email verification · / })).toHaveAttribute(
      'href',
      `/emails/${EMAIL_ID_2}`
    )
    expect(within(items[1]!).getByText('Bounced')).toBeInTheDocument()

    expect(seen.at(-1)?.get('userId')).toBe(USER_ID_2)
    expect(seen.at(-1)?.get('limit')).toBe(String(USER_EMAILS_SHOWN))
    expect(USER_EMAILS_SHOWN).toBe(10)
  })

  it('links to every email for the account in the Emails list', async () => {
    serve([])
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Emails' })
    expect(within(card).getByRole('link', { name: 'View all emails' })).toHaveAttribute(
      'href',
      `/emails?userId=${USER_ID_2}`
    )
  })

  it('says so when nothing was sent to the account', async () => {
    serve([], [])
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Emails' })
    expect(await within(card).findByText('No emails sent to this account yet.')).toBeInTheDocument()
  })

  it('shows a retryable error inside the card, leaving the rest of the page up', async () => {
    let calls = 0
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(CLEO, 'User retrieved.')),
      http.get('/api/v1/platform/emails', () => {
        calls += 1
        return calls <= 2
          ? fail('Boom', 500)
          : ok({ messages: [emailSummary()], nextCursor: null, prevCursor: null }, 'ok')
      })
    )
    const user = userEvent.setup()
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Emails' })
    expect(
      await within(card).findByText('We could not load this account’s emails.')
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cleo Doe', level: 1 })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(card).getAllByRole('listitem')).toHaveLength(1))
  })

  it('says the role cannot see it, without signing out, on a 404', async () => {
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(CLEO, 'User retrieved.')),
      http.get('/api/v1/platform/emails', () => fail('Not found', 404))
    )
    renderAppAt(`/users/${USER_ID_2}`)
    const card = await screen.findByRole('region', { name: 'Emails' })
    expect(await within(card).findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})
