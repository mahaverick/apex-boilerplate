import type { InfiniteData } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { timelineKeys } from '@/queries/timeline.queries'
import { queryClient } from '@/router'
import { USER_ID_2 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import {
  at,
  eventId,
  SESSION_ID,
  SESSION_ID_2,
  timelinePage,
  timelineRow,
  TRACE_ID,
  USER_LINKS,
} from '@/tests/fixtures/timeline'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformUserDetail, TimelinePage, TimelineRow } from '@/types/api.types'

const TIMELINE = `/users/${USER_ID_2}/timeline`
const API = `/api/v1/platform/users/${USER_ID_2}/timeline`

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

/**
 * One session (a click, then a sign-in request of two server events, then
 * a pageview), a staff action outside any session, and an older session.
 */
const ROWS: TimelineRow[] = [
  timelineRow({
    uuid: eventId(1),
    event: '$autocapture',
    timestamp: at(50),
    elementText: 'Save changes',
    path: '/settings',
  }),
  timelineRow({
    uuid: eventId(2),
    event: 'user_signed_in',
    timestamp: at(40),
    verified: true,
    source: 'product',
    access: 'member',
    app: 'api',
    traceId: TRACE_ID,
    path: null,
    props: { method: 'google' },
  }),
  timelineRow({
    uuid: eventId(3),
    event: 'auth_reauthenticated',
    timestamp: at(39),
    verified: true,
    source: 'audit',
    access: 'member',
    app: 'api',
    traceId: TRACE_ID,
    path: null,
  }),
  timelineRow({ uuid: eventId(4), timestamp: at(30), path: '/settings' }),
  timelineRow({
    uuid: eventId(5),
    event: 'user_deactivated',
    timestamp: at(20),
    distinctId: 'staff',
    verified: true,
    source: 'audit',
    access: 'platform',
    app: 'api',
    sessionId: null,
    path: null,
    props: { target_type: 'user', target_id: USER_ID_2, has_reason: true },
  }),
  timelineRow({
    uuid: eventId(6),
    event: '$pageview',
    timestamp: at(10),
    sessionId: SESSION_ID_2,
    app: 'apex',
    path: '/overview',
  }),
]

/** Answers the detail and the timeline; records each timeline request's query. */
function serve(
  answer: (params: URLSearchParams) => Response | Promise<Response> = () =>
    ok(timelinePage(ROWS), 'Timeline retrieved.')
) {
  const seen: URLSearchParams[] = []
  server.use(
    http.get(`/api/v1/platform/users/${USER_ID_2}`, () => ok(DETAIL, 'User retrieved.')),
    http.get(API, ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      return answer(params)
    })
  )
  return seen
}

function page(rows: TimelineRow[], nextCursor: string | null = null): TimelinePage {
  return timelinePage(rows, nextCursor)
}

describe('/users/$userId/timeline', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('shows sessions, the request inside one and the staff action between them', async () => {
    const seen = serve()
    renderAppAt(TIMELINE)

    expect(await screen.findByRole('heading', { name: 'Timeline', level: 1 })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Timeline' })
    const sessions = within(list).getAllByRole('list', { name: 'Session events' })
    expect(sessions).toHaveLength(2)
    expect(within(sessions[0]!).getByText("Clicked 'Save changes'")).toBeInTheDocument()
    expect(within(sessions[0]!).getByText('Signed in with Google')).toBeInTheDocument()
    expect(within(sessions[0]!).getByRole('button', { name: '+1 related' })).toBeInTheDocument()
    expect(within(list).getByText('Deactivated a user')).toBeInTheDocument()
    expect(within(list).getByText('Staff')).toBeInTheDocument()
    expect(within(sessions[1]!).getByText('Viewed /overview')).toBeInTheDocument()
    expect(screen.getByText(/Customer app · 4 events/)).toBeInTheDocument()
    expect(screen.getByText(/Apex · 1 event$/)).toBeInTheDocument()
    expect(screen.getByText('Events can take a few minutes to appear.')).toBeInTheDocument()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.get('range')).toBe('7d')
    expect(seen[0]?.get('view')).toBe('all')
    expect(seen[0]?.has('before')).toBe(false)
  })

  it('never badges an unverified row Server, Email or Staff, and says the server did not confirm it', async () => {
    const user = userEvent.setup()
    const forged = [
      timelineRow({
        uuid: eventId(1),
        event: 'user_deactivated',
        source: 'audit',
        access: 'platform',
        verified: false,
        sessionId: null,
        path: null,
        props: { target_type: 'user', target_id: USER_ID_2, has_reason: true },
      }),
      timelineRow({
        uuid: eventId(2),
        event: 'email_delivered',
        source: 'email',
        verified: false,
        sessionId: null,
        path: null,
      }),
    ]
    serve(() => ok(page(forged), 'Timeline retrieved.'))
    renderAppAt(TIMELINE)
    const list = await screen.findByRole('list', { name: 'Timeline' })
    expect(within(list).getByText('Unverified event "user_deactivated"')).toBeInTheDocument()
    expect(within(list).getByText('Unverified event "email_delivered"')).toBeInTheDocument()
    expect(within(list).queryByText(/Deactivated a user|Email delivered/)).not.toBeInTheDocument()
    expect(within(list).getAllByText('Browser')).toHaveLength(2)
    expect(within(list).queryByText('Server')).not.toBeInTheDocument()
    expect(within(list).queryByText('Email')).not.toBeInTheDocument()
    expect(within(list).queryByText('Staff')).not.toBeInTheDocument()

    const trigger = within(list)
      .getAllByText('Browser')[0]!
      .closest('[data-slot="tooltip-trigger"]')!
    expect(trigger).toHaveTextContent(
      'Browser, Reported by the browser, not confirmed by the server.'
    )
    await user.hover(trigger)
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Reported by the browser, not confirmed by the server.'
      )
    )
  })

  it('links each session to its own replay, and the toolbar to the person', async () => {
    serve()
    renderAppAt(TIMELINE)
    const replays = await screen.findAllByRole('link', { name: /Watch replay/ })
    expect(replays.map((link) => link.getAttribute('href'))).toEqual([
      `https://us.posthog.com/project/1/replay/${SESSION_ID}`,
      `https://us.posthog.com/project/1/replay/${SESSION_ID_2}`,
    ])
    expect(replays[0]).toHaveAttribute('target', '_blank')
    expect(replays[0]).toHaveAttribute('rel', 'noreferrer')
    expect(screen.getByRole('link', { name: /Open in PostHog/ })).toHaveAttribute(
      'href',
      USER_LINKS.person
    )
  })

  it('hides Open in PostHog when the API gives no link', async () => {
    serve(() =>
      ok({ ...timelinePage(ROWS), links: { ...USER_LINKS, person: null } }, 'Timeline retrieved.')
    )
    renderAppAt(TIMELINE)
    await screen.findByRole('list', { name: 'Timeline' })
    expect(screen.queryByText(/Open in PostHog/)).not.toBeInTheDocument()
  })

  it('names the trail Users, the user, then Timeline', async () => {
    serve()
    renderAppAt(TIMELINE)
    const trail = await screen.findByRole('navigation', { name: 'breadcrumb' })
    await waitFor(() =>
      expect(within(trail).getByRole('link', { name: 'Cleo Doe' })).toHaveAttribute(
        'href',
        `/users/${USER_ID_2}`
      )
    )
    expect(within(trail).getByRole('link', { name: 'Users' })).toBeInTheDocument()
    expect(within(trail).getByText('Timeline')).toHaveAttribute('aria-current', 'page')
  })

  it('expands a request in place', async () => {
    const user = userEvent.setup()
    serve()
    renderAppAt(TIMELINE)
    const toggle = await screen.findByRole('button', { name: '+1 related' })
    const related = document.getElementById(toggle.getAttribute('aria-controls') ?? '')!
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(related).not.toBeVisible()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(related).toBeVisible()
    expect(within(related).getByText('Identity check (step-up)')).toBeInTheDocument()
  })

  it('puts the clicked text and the path inside Pii', async () => {
    serve()
    renderAppAt(TIMELINE)
    const click = await screen.findByText("Clicked 'Save changes'")
    expect(click).toHaveClass('ph-sensitive', 'ph-mask')
    for (const path of screen.getAllByText('/settings')) {
      expect(path.closest('.ph-sensitive.ph-mask')).not.toBeNull()
    }
    expect(screen.getByText('Cleo Doe', { selector: 'p' })).toHaveClass('ph-sensitive', 'ph-mask')
  })

  it('changes the window and the view in the URL and in the request', async () => {
    const user = userEvent.setup()
    const seen = serve()
    const router = renderAppAt(TIMELINE)
    await screen.findByRole('list', { name: 'Timeline' })

    await user.click(screen.getByRole('button', { name: 'Key events' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ range: '7d', view: 'key' }))
    await waitFor(() => expect(seen.at(-1)?.get('view')).toBe('key'))

    await user.click(screen.getByRole('combobox', { name: 'Time range' }))
    await user.click(await screen.findByRole('option', { name: 'Last 90 days' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ range: '90d', view: 'key' }))
    await waitFor(() => expect(seen.at(-1)?.get('range')).toBe('90d'))
    expect(seen.every((params) => !params.has('before'))).toBe(true)
  })

  it('falls back to the defaults for an invalid window or view in the URL', async () => {
    const seen = serve()
    const router = renderAppAt(`${TIMELINE}?range=1y&view=raw`)
    await screen.findByRole('list', { name: 'Timeline' })
    expect(router.state.location.search).toEqual({ range: '7d', view: 'all' })
    expect(seen[0]?.get('range')).toBe('7d')
    expect(seen[0]?.get('view')).toBe('all')
  })

  it('loads more with the cursor, and joins a session the page boundary cut', async () => {
    const user = userEvent.setup()
    const seen = serve((params) =>
      params.get('before') === 'cursor-2'
        ? ok(page([timelineRow({ uuid: eventId(8), timestamp: at(1) })]), 'Timeline retrieved.')
        : ok(page([timelineRow({ uuid: eventId(7), timestamp: at(2) })], 'cursor-2'), 'OK')
    )
    renderAppAt(TIMELINE)
    await user.click(await screen.findByRole('button', { name: 'Load more events' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more events' })).not.toBeInTheDocument()
    )
    expect(seen[1]?.get('before')).toBe('cursor-2')
    expect(screen.getAllByRole('list', { name: 'Session events' })).toHaveLength(1)
    expect(screen.getByText(/· 2 events$/)).toBeInTheDocument()
  })

  it('starts the new view from its own first page when the toggle moves during Load more', async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const seen = serve(async (params) => {
      if (params.has('before')) {
        await held
        return ok(page([timelineRow({ uuid: eventId(8), path: '/older' })]), 'OK')
      }
      return params.get('view') === 'key'
        ? ok(
            page([
              timelineRow({
                uuid: eventId(9),
                event: 'user_signed_out',
                verified: true,
                source: 'product',
              }),
            ]),
            'OK'
          )
        : ok(page([timelineRow({ uuid: eventId(7) })], 'cursor-2'), 'OK')
    })
    renderAppAt(TIMELINE)
    await user.click(await screen.findByRole('button', { name: 'Load more events' }))
    await waitFor(() => expect(seen.some((params) => params.has('before'))).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Key events' }))
    expect(await screen.findByText('Signed out')).toBeInTheDocument()
    release()

    const keyPages = seen.filter((params) => params.get('view') === 'key')
    expect(keyPages.map((params) => params.has('before'))).toEqual([false])
    // The held page lands in the Everything view's cache: that is the barrier for the absence below.
    await waitFor(() =>
      expect(
        queryClient.getQueryData<InfiniteData<TimelinePage>>(
          timelineKeys.page('user', USER_ID_2, '7d', 'all')
        )?.pages
      ).toHaveLength(2)
    )
    expect(screen.queryByText('Viewed /older')).not.toBeInTheDocument()
    expect(screen.getByText('Signed out')).toBeInTheDocument()
  })

  it('renders two blocks of one session, split by a sessionless row, without a duplicate key', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      serve(() =>
        ok(
          page([
            timelineRow({ uuid: eventId(1), timestamp: at(30), path: '/a' }),
            timelineRow({
              uuid: eventId(2),
              event: 'user_deactivated',
              timestamp: at(20),
              verified: true,
              source: 'audit',
              access: 'platform',
              app: 'api',
              sessionId: null,
              path: null,
            }),
            timelineRow({ uuid: eventId(3), timestamp: at(10), path: '/b' }),
          ]),
          'Timeline retrieved.'
        )
      )
      renderAppAt(TIMELINE)
      const list = await screen.findByRole('list', { name: 'Timeline' })
      expect(within(list).getAllByRole('list', { name: 'Session events' })).toHaveLength(2)
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/)
    } finally {
      errors.mockRestore()
    }
  })

  it('refreshes the first page alone', async () => {
    const user = userEvent.setup()
    const seen = serve((params) =>
      params.get('before') === 'cursor-2'
        ? ok(page([timelineRow({ uuid: eventId(8), timestamp: at(1) })]), 'OK')
        : ok(page([timelineRow({ uuid: eventId(7), timestamp: at(2) })], 'cursor-2'), 'OK')
    )
    renderAppAt(TIMELINE)
    await user.click(await screen.findByRole('button', { name: 'Load more events' }))
    await waitFor(() => expect(seen).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(seen).toHaveLength(3))
    expect(seen[2]?.has('before')).toBe(false)
    expect(await screen.findByRole('button', { name: 'Load more events' })).toBeInTheDocument()
  })

  it('says when timelines are not set up, with no toolbar', async () => {
    serve(() => ok({ configured: false }, 'Timeline retrieved.'))
    renderAppAt(TIMELINE)
    expect(
      await screen.findByText('PostHog timelines are not set up for this environment.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
  })

  it('shows skeleton rows while the first page loads', async () => {
    serve(async () => {
      await delay('infinite')
      return ok(page([]), 'Timeline retrieved.')
    })
    renderAppAt(TIMELINE)
    await screen.findByRole('heading', { name: 'Timeline', level: 1 })
    await waitFor(() =>
      expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    )
  })

  it.each([
    ['all', 'No events in the last 7 days.'],
    ['key', 'No key events in the last 7 days. Switch to Everything to see pageviews and clicks.'],
  ])('says an empty %s view is empty for this window', async (view, text) => {
    serve(() => ok(page([]), 'Timeline retrieved.'))
    renderAppAt(`${TIMELINE}?view=${view}`)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('says PostHog could not be reached, never that nothing happened, and retries', async () => {
    const user = userEvent.setup()
    let isUp = false
    const seen = serve(() =>
      isUp
        ? ok(page(ROWS), 'Timeline retrieved.')
        : fail('PostHog unavailable', 502, 'TIMELINE_UNAVAILABLE')
    )
    renderAppAt(TIMELINE)
    expect(
      await screen.findByText(
        'We could not reach PostHog, so nothing is listed. This is not a sign of no activity.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/No events/)).not.toBeInTheDocument()
    expect(seen).toHaveLength(1)

    isUp = true
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Timeline' })).toBeInTheDocument()
  })

  it.each([
    [
      'a masked 502 TIMELINE_UNAVAILABLE',
      () => fail('Internal server error', 502, 'TIMELINE_UNAVAILABLE'),
    ],
    ['a 500 with no code', () => fail('Internal server error', 500)],
    ['a 429', () => fail('Too many requests', 429)],
  ])('gives %s the same first-page copy', async (_name, answer) => {
    serve(answer)
    renderAppAt(TIMELINE)
    expect(
      await screen.findByText(
        'We could not reach PostHog, so nothing is listed. This is not a sign of no activity.'
      )
    ).toBeInTheDocument()
  })

  it('offers Load more after an empty first page that has a next one, never the empty state', async () => {
    const user = userEvent.setup()
    const seen = serve((params) =>
      params.get('before') === 'cursor-2'
        ? ok(page([timelineRow({ uuid: eventId(8), path: '/later' })]), 'OK')
        : ok(page([], 'cursor-2'), 'OK')
    )
    renderAppAt(TIMELINE)
    const more = await screen.findByRole('button', { name: 'Load more events' })
    expect(screen.queryByText(/No events in the last/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Timeline' })).not.toBeInTheDocument()

    await user.click(more)

    expect(await screen.findByText('Viewed /later')).toBeInTheDocument()
    expect(seen[1]?.get('before')).toBe('cursor-2')
    expect(screen.queryByRole('button', { name: 'Load more events' })).not.toBeInTheDocument()
  })

  it('keeps Load more after a short page that still has a next one', async () => {
    serve(() => ok(page([timelineRow({ uuid: eventId(1) })], 'cursor-2'), 'OK'))
    renderAppAt(TIMELINE)
    expect(await screen.findByRole('button', { name: 'Load more events' })).toBeInTheDocument()
  })

  it('keeps what is listed when Load more fails, and says so', async () => {
    const user = userEvent.setup()
    serve((params) =>
      params.has('before')
        ? fail('PostHog unavailable', 502, 'TIMELINE_UNAVAILABLE')
        : ok(page(ROWS, 'cursor-2'), 'Timeline retrieved.')
    )
    renderAppAt(TIMELINE)
    await user.click(await screen.findByRole('button', { name: 'Load more events' }))
    expect(
      await screen.findByText(
        'We could not load more events. What is listed above is correct, but it may not be all of it.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText("Clicked 'Save changes'")).toBeInTheDocument()
  })

  it('keeps what is listed when a refresh fails, and says it may be out of date', async () => {
    const user = userEvent.setup()
    let calls = 0
    serve(() => {
      calls += 1
      return calls === 1
        ? ok(page(ROWS), 'Timeline retrieved.')
        : fail('PostHog unavailable', 502, 'TIMELINE_UNAVAILABLE')
    })
    renderAppAt(TIMELINE)
    await user.click(await screen.findByRole('button', { name: 'Refresh' }))
    expect(
      await screen.findByText(
        'We could not refresh the timeline. What is listed above may be out of date.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText("Clicked 'Save changes'")).toBeInTheDocument()
  })

  it('reads a 404 from the timeline as a role refusal', async () => {
    serve(() => fail('Not found', 404))
    renderAppAt(TIMELINE)
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
  })

  it('asks for no timeline and never says the role is refused while the user is unresolved', async () => {
    const seen: string[] = []
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, async () => {
        await delay(300)
        return fail('Not found', 404)
      }),
      http.get(API, () => {
        seen.push('timeline')
        return fail('Not found', 404)
      })
    )
    renderAppAt(TIMELINE)
    await screen.findByRole('heading', { name: 'Timeline', level: 1 })
    expect(screen.queryByText(/Your role can’t see this any more/)).not.toBeInTheDocument()
    expect(seen).toHaveLength(0)
    expect(
      await screen.findByRole('heading', { name: 'User not found', level: 1 })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Your role can’t see this any more/)).not.toBeInTheDocument()
    expect(seen).toHaveLength(0)
  })

  it('says nothing is listed, not that what is listed is correct, when Load more fails after an empty page', async () => {
    const user = userEvent.setup()
    serve((params) =>
      params.has('before')
        ? fail('PostHog unavailable', 502, 'TIMELINE_UNAVAILABLE')
        : ok(page([], 'cursor-2'), 'OK')
    )
    renderAppAt(TIMELINE)
    await user.click(await screen.findByRole('button', { name: 'Load more events' }))
    expect(
      await screen.findByText(
        'We could not reach PostHog, so nothing is listed. This is not a sign of no activity.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/What is listed above/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('says an unknown user is not found', async () => {
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)),
      http.get(API, () => fail('Not found', 404))
    )
    renderAppAt(TIMELINE)
    expect(
      await screen.findByRole('heading', { name: 'User not found', level: 1 })
    ).toBeInTheDocument()
  })

  it('refuses a viewer without asking the API', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    const seen = serve()
    renderAppAt(TIMELINE)
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Timeline', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Watch replay|Open in PostHog/ })).toBeNull()
    expect(seen).toHaveLength(0)
  })
})

describe('the user detail page’s Timeline link', () => {
  it('is in the header for an admin', async () => {
    signIn({ ...testUser, platformRole: 'admin' })
    serve()
    renderAppAt(`/users/${USER_ID_2}`)
    expect(await screen.findByRole('link', { name: 'Timeline' })).toHaveAttribute('href', TIMELINE)
  })

  it('is not offered to a viewer', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    serve()
    renderAppAt(`/users/${USER_ID_2}`)
    await screen.findByRole('heading', { name: 'Cleo Doe', level: 1 })
    expect(screen.queryByRole('link', { name: 'Timeline' })).not.toBeInTheDocument()
  })
})
