import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { errorIssue, errorsPage, issueId } from '@/tests/fixtures/errors'
import { USER_ID_2 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { ErrorIssue, PlatformUserDetail } from '@/types/api.types'

const ERRORS = `/users/${USER_ID_2}/errors`
const API = `/api/v1/platform/users/${USER_ID_2}/errors`

const DETAIL: PlatformUserDetail = {
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

/** A browser crash in the customer app, and a signed server 5xx. */
const ISSUES: ErrorIssue[] = [
  errorIssue(),
  errorIssue({
    issueId: issueId(2),
    type: 'Error',
    value: 'connect ECONNREFUSED [secret]',
    count: 1284,
    source: 'server',
    app: 'api',
    verified: true,
    lastSeen: '2026-10-03T09:00:00.000Z',
  }),
]

/** Answers the detail and the errors; records each errors request. */
function serve(answer: () => Response | Promise<Response> = () => ok(errorsPage(ISSUES), 'OK')) {
  const seen: string[] = []
  server.use(
    http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(DETAIL, 'User retrieved.')),
    http.get(API, ({ request }) => {
      seen.push(new URL(request.url).search)
      return answer()
    })
  )
  return seen
}

describe('/users/$userId/errors', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('lists each issue with its type, message, source, count, last seen and PostHog link', async () => {
    const seen = serve()
    renderAppAt(ERRORS)

    expect(await screen.findByRole('heading', { name: 'Errors', level: 1 })).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Errors' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)

    const browser = within(rows[0]!)
    expect(browser.getByText('TypeError')).toBeInTheDocument()
    expect(
      browser.getByText("Cannot read properties of undefined (reading 'id')")
    ).toBeInTheDocument()
    expect(browser.getByText('Browser')).toBeInTheDocument()
    expect(browser.getByText('Customer app')).toBeInTheDocument()
    expect(browser.getByText('3')).toBeInTheDocument()
    expect(browser.getByRole('link', { name: /Open in PostHog/ })).toHaveAttribute(
      'href',
      `https://us.posthog.com/project/1/error_tracking/${issueId(1)}`
    )
    expect(browser.getByRole('link', { name: /Open in PostHog/ })).toHaveAttribute(
      'target',
      '_blank'
    )
    expect(browser.getByRole('link', { name: /Open in PostHog/ })).toHaveAttribute(
      'rel',
      'noreferrer'
    )
    expect(rows[0]!.querySelector('time')).toHaveAttribute('dateTime', '2026-10-04T09:58:00.000Z')

    const api = within(rows[1]!)
    expect(api.getByText('Server')).toBeInTheDocument()
    expect(api.getByText('API')).toBeInTheDocument()
    expect(api.getByText('1,284')).toBeInTheDocument()
    expect(api.queryByText('Unverified')).not.toBeInTheDocument()

    expect(screen.getByText('Errors can take a minute to appear.')).toBeInTheDocument()
    expect(seen).toEqual([''])
  })

  it('renders a message as text, never as markup, inside Pii', async () => {
    serve(() =>
      ok(errorsPage([errorIssue({ value: '<img src=x onerror="alert(1)"> Cleo Doe' })]), 'OK')
    )
    renderAppAt(ERRORS)
    const value = await screen.findByText('<img src=x onerror="alert(1)"> Cleo Doe')
    expect(value).toHaveClass('ph-sensitive', 'ph-mask')
    expect(document.querySelector('table img')).toBeNull()
  })

  it('badges a server row express did not sign as unverified, and says why', async () => {
    const user = userEvent.setup()
    serve(() =>
      ok(
        errorsPage([
          errorIssue({ source: 'server', app: 'api', verified: false }),
          errorIssue({ issueId: issueId(2), source: 'browser', app: 'apex', verified: false }),
        ]),
        'OK'
      )
    )
    renderAppAt(ERRORS)
    const table = await screen.findByRole('table', { name: 'Errors' })
    expect(within(table).getAllByText('Unverified')).toHaveLength(1)
    const badge = within(table).getByText('Unverified')
    expect(badge).toHaveAttribute('data-tone', 'warning')
    const trigger = badge.closest('[data-slot="tooltip-trigger"]')!
    expect(trigger).toHaveTextContent(
      'Unverified, Claims to come from the server, but express did not sign it.'
    )
    await user.hover(trigger)
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Claims to come from the server, but express did not sign it.'
      )
    )
    expect(within(table).getByText('Apex')).toBeInTheDocument()
  })

  it('names an app it does not know as sent, and shows no app badge when there is none', async () => {
    serve(() =>
      ok(
        errorsPage([
          errorIssue({ app: 'mobile' }),
          errorIssue({ issueId: issueId(2), type: 'RangeError', app: null }),
        ]),
        'OK'
      )
    )
    renderAppAt(ERRORS)
    const table = await screen.findByRole('table', { name: 'Errors' })
    expect(within(table).getByText('mobile')).toBeInTheDocument()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[1]!.querySelectorAll('[data-slot="badge"]')).toHaveLength(1)
  })

  it('says when error tracking is not set up, with no table', async () => {
    serve(() => ok({ configured: false }, 'OK'))
    renderAppAt(ERRORS)
    expect(
      await screen.findByText('PostHog error tracking is not set up for this environment.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open in PostHog/ })).not.toBeInTheDocument()
  })

  it('says an empty list is empty for the last 30 days', async () => {
    serve(() => ok(errorsPage([]), 'OK'))
    renderAppAt(ERRORS)
    expect(await screen.findByText('No errors in the last 30 days.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows skeleton rows while the list loads', async () => {
    serve(async () => {
      await delay('infinite')
      return ok(errorsPage([]), 'OK')
    })
    renderAppAt(ERRORS)
    await screen.findByRole('heading', { name: 'Errors', level: 1 })
    await waitFor(() =>
      expect(document.querySelectorAll('[aria-busy="true"] [data-slot="skeleton"]')).toHaveLength(3)
    )
  })

  it.each([
    [
      'a masked 502 TIMELINE_UNAVAILABLE',
      () => fail('Internal server error', 502, 'TIMELINE_UNAVAILABLE'),
    ],
    ['a 500 with no code', () => fail('Internal server error', 500)],
    ['a 429', () => fail('Too many requests', 429)],
  ])(
    'says PostHog could not be reached on %s, never that there are no errors, and retries',
    async (_name, answer) => {
      const user = userEvent.setup()
      let isUp = false
      const seen = serve(() => (isUp ? ok(errorsPage(ISSUES), 'OK') : answer()))
      renderAppAt(ERRORS)
      expect(
        await screen.findByText(
          'We could not reach PostHog, so nothing is listed. This is not a sign of no errors.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByText(/No errors/)).not.toBeInTheDocument()
      expect(seen).toHaveLength(1)

      isUp = true
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('table', { name: 'Errors' })).toBeInTheDocument()
    }
  )

  it('reads a 404 from the errors route as a role refusal', async () => {
    serve(() => fail('Not found', 404))
    renderAppAt(ERRORS)
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
  })

  it('names the trail Users, the user, then Errors', async () => {
    serve()
    renderAppAt(ERRORS)
    const trail = await screen.findByRole('navigation', { name: 'breadcrumb' })
    await waitFor(() =>
      expect(within(trail).getByRole('link', { name: 'Cleo Doe' })).toHaveAttribute(
        'href',
        `/users/${USER_ID_2}`
      )
    )
    expect(within(trail).getByText('Errors')).toHaveAttribute('aria-current', 'page')
  })

  it('asks for no errors while the user is unresolved, and says an unknown user is not found', async () => {
    const seen: string[] = []
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, async () => {
        await delay(300)
        return fail('Not found', 404)
      }),
      http.get(API, () => {
        seen.push('errors')
        return fail('Not found', 404)
      })
    )
    renderAppAt(ERRORS)
    await screen.findByRole('heading', { name: 'Errors', level: 1 })
    expect(screen.queryByText(/Your role can’t see this any more/)).not.toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'User not found', level: 1 })
    ).toBeInTheDocument()
    expect(seen).toHaveLength(0)
  })

  it('says so when the user cannot be loaded, and retries', async () => {
    const user = userEvent.setup()
    let isUp = false
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () =>
        isUp ? ok(DETAIL, 'User retrieved.') : fail('Internal server error', 500)
      ),
      http.get(API, () => ok(errorsPage(ISSUES), 'OK'))
    )
    renderAppAt(ERRORS)
    expect(await screen.findByText('We could not load this user.')).toBeInTheDocument()
    isUp = true
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Errors' })).toBeInTheDocument()
  })

  it('refuses a viewer without asking the API', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    const seen = serve()
    renderAppAt(ERRORS)
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Errors', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open in PostHog/ })).toBeNull()
    expect(seen).toHaveLength(0)
  })
})

describe('the user detail page’s Errors link', () => {
  it('is in the header for an admin, beside Timeline', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    renderAppAt(`/users/${USER_ID_2}`)
    expect(await screen.findByRole('link', { name: 'Errors' })).toHaveAttribute('href', ERRORS)
    expect(screen.getByRole('link', { name: 'Timeline' })).toBeInTheDocument()
  })

  it('is not offered to a viewer', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    serve()
    renderAppAt(`/users/${USER_ID_2}`)
    await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
    expect(screen.queryByRole('link', { name: 'Errors' })).not.toBeInTheDocument()
  })
})
