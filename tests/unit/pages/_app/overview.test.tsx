import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/states/auth.store'
import { testFlagsStatus } from '@/tests/fixtures/flags'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testStats, testSystemStatus, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { FlagsStatus, SystemStatus } from '@/types/api.types'

describe('/overview', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the five KPIs from the stats, an undelivered rate over emails that left among them', async () => {
    renderAppAt('/overview')
    const kpis = await screen.findByRole('region', { name: 'Key figures' })
    expect(within(kpis).getByText('1,284')).toBeInTheDocument()
    expect(within(kpis).getByText('9,730')).toBeInTheDocument()
    expect(within(kpis).getByText('18')).toBeInTheDocument()
    expect(within(kpis).getByText('Undelivered rate (7 days)')).toBeInTheDocument()
    const undelivered = testStats.emailMessages.reduce((sum, day) => sum + day.undelivered, 0)
    const left = testStats.emailMessages.reduce(
      (sum, day) => sum + day.sent + day.delivered + day.undelivered + day.complained,
      0
    )
    expect(within(kpis).getByText(/^0\.0\d%$/)).toBeInTheDocument()
    expect(
      within(kpis).getByText(
        `${undelivered.toLocaleString('en-US')} of ${left.toLocaleString('en-US')} emails that left our server`
      )
    ).toBeInTheDocument()
    expect(kpis.querySelectorAll('[data-slot="card"]')).toHaveLength(5)
  })

  it('counts stuck tenants in the fifth tile, linking to the onboarding list’s stuck tab', async () => {
    renderAppAt('/overview')
    const kpis = await screen.findByRole('region', { name: 'Key figures' })
    const tile = within(kpis).getByText('Stuck tenants').closest('[data-slot="card"]')!
    expect(within(tile as HTMLElement).getByText('6')).toBeInTheDocument()
    expect(
      within(tile as HTMLElement).getByRole('link', { name: 'View stuck tenants' })
    ).toHaveAttribute('href', '/onboarding?state=stuck')
  })

  it('leaves suppressed emails out of the rate: they never left our server', async () => {
    server.use(
      http.get('/api/v1/platform/stats', () =>
        ok(
          {
            ...testStats,
            emailMessages: testStats.emailMessages.map((day, index) => ({
              ...day,
              delivered: 20,
              sent: 10,
              undelivered: index === 0 ? 7 : 0,
              complained: index === 0 ? 3 : 0,
              suppressed: 50,
            })),
          },
          'Platform stats retrieved.'
        )
      )
    )
    renderAppAt('/overview')
    const kpis = await screen.findByRole('region', { name: 'Key figures' })
    // 7 undelivered of 7 × 30 + 7 + 3 = 220 that left; the 350 suppressed are not in the denominator.
    expect(within(kpis).getByText('3.18%')).toBeInTheDocument()
    expect(within(kpis).getByText('7 of 220 emails that left our server')).toBeInTheDocument()
  })

  it('says so, rather than dividing by zero, when no email left in the window', async () => {
    server.use(
      http.get('/api/v1/platform/stats', () =>
        ok(
          {
            ...testStats,
            emailMessages: testStats.emailMessages.map((day) => ({
              ...day,
              delivered: 0,
              sent: 0,
              undelivered: 0,
              complained: 0,
              suppressed: 4,
            })),
          },
          'Platform stats retrieved.'
        )
      )
    )
    renderAppAt('/overview')
    const kpis = await screen.findByRole('region', { name: 'Key figures' })
    expect(within(kpis).getByText('—')).toBeInTheDocument()
    expect(within(kpis).getByText('No emails sent')).toBeInTheDocument()
  })

  it('never rounds a real undelivered email down to 0.00%', async () => {
    server.use(
      http.get('/api/v1/platform/stats', () =>
        ok(
          {
            ...testStats,
            emailMessages: testStats.emailMessages.map((day, index) => ({
              ...day,
              sent: 5000,
              undelivered: index === 0 ? 1 : 0,
            })),
          },
          'Platform stats retrieved.'
        )
      )
    )
    renderAppAt('/overview')
    const kpis = await screen.findByRole('region', { name: 'Key figures' })
    expect(within(kpis).getByText('<0.01%')).toBeInTheDocument()
  })

  it('keeps each chart named, and says the window was empty, on a fresh install', async () => {
    server.use(
      http.get('/api/v1/platform/stats', ({ request }) => {
        const range = new URL(request.url).searchParams.get('range') ?? '7d'
        return ok(
          {
            range,
            totals: { tenants: 0, users: 0, staff: 1, stuckTenants: 0 },
            signups: testStats.signups.map((day) => ({ ...day, users: 0, tenants: 0 })),
            emails: testStats.emails.map((day) => ({ ...day, sent: 0, failed: 0 })),
            emailMessages: testStats.emailMessages.map((day) => ({
              ...day,
              delivered: 0,
              sent: 0,
              undelivered: 0,
              complained: 0,
              suppressed: 0,
            })),
          },
          'Platform stats retrieved.'
        )
      })
    )
    const user = userEvent.setup()
    renderAppAt('/overview')
    const signups = await screen.findByRole('figure', { name: 'Sign-ups per day' })
    const emails = screen.getByRole('figure', { name: 'Emails per day' })
    expect(within(signups).getByText('No sign-ups in the last 7 days')).toBeInTheDocument()
    expect(within(emails).getByText('No emails in the last 7 days')).toBeInTheDocument()
    expect(within(signups).queryByRole('table')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '30 days' }))
    expect(await within(signups).findByText('No sign-ups in the last 30 days')).toBeInTheDocument()
    expect(within(emails).getByText('No emails in the last 30 days')).toBeInTheDocument()
  })

  it('names both charts and gives each a data table for screen readers', async () => {
    renderAppAt('/overview')
    const signups = await screen.findByRole('figure', { name: 'Sign-ups per day' })
    const emails = screen.getByRole('figure', { name: 'Emails per day' })
    // recharts mounts under jsdom without a ResizeObserver: the SVG is there, and no WidgetBoundary caught a throw.
    expect(screen.queryByText(/could not be shown/)).not.toBeInTheDocument()
    expect(signups.querySelector('svg.recharts-surface')).not.toBeNull()
    expect(emails.querySelector('svg.recharts-surface')).not.toBeNull()
    const signupTable = within(signups).getByRole('table')
    const emailTable = within(emails).getByRole('table')
    expect(
      within(signupTable)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Day', 'Users', 'Tenants'])
    // Five disjoint groups by current status: each email is in exactly one column.
    expect(
      within(emailTable)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Day', 'Delivered', 'Sent', 'Undelivered', 'Complained', 'Suppressed'])
    expect(within(emailTable).getByRole('rowheader', { name: 'Sep 26' })).toBeInTheDocument()
  })

  it('asks for 30 days when the toggle is switched, and keeps it in the URL', async () => {
    const ranges: string[] = []
    server.use(
      http.get('/api/v1/platform/stats', ({ request }) => {
        const range = new URL(request.url).searchParams.get('range') ?? ''
        ranges.push(range)
        return ok({ ...testStats, range }, 'Platform stats retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/overview')
    await screen.findByRole('region', { name: 'Key figures' })

    await user.click(screen.getByRole('button', { name: '30 days' }))

    await waitFor(() => expect(ranges).toContain('30d'))
    expect(router.state.location.search).toEqual({ range: '30d' })
    expect(await screen.findByText('Undelivered rate (30 days)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the current figures up, not skeletons, while the next window loads', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/v1/platform/stats', async ({ request }) => {
        const range = new URL(request.url).searchParams.get('range') ?? ''
        if (range === '30d') await gate
        return ok({ ...testStats, range }, 'Platform stats retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/overview')
    await screen.findByRole('region', { name: 'Key figures' })

    await user.click(screen.getByRole('button', { name: '30 days' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ range: '30d' }))

    // The 30-day request is held open, so this is the in-between state.
    const kpis = screen.getByRole('region', { name: 'Key figures' })
    expect(kpis).toBeInTheDocument()
    expect(screen.getByText('Undelivered rate (7 days)')).toBeInTheDocument()
    expect(kpis.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true')
    release()
    expect(await screen.findByText('Undelivered rate (30 days)')).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Key figures' }).closest('[aria-busy]')
    ).toHaveAttribute('aria-busy', 'false')
  })

  it('keeps the current range when the pressed toggle is pressed again', async () => {
    const user = userEvent.setup()
    const router = renderAppAt('/overview')
    await screen.findByRole('region', { name: 'Key figures' })

    await user.click(screen.getByRole('button', { name: '7 days' }))

    expect(router.state.location.search).toEqual({ range: '7d' })
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('falls back to 7 days for a range it does not offer', async () => {
    const router = renderAppAt('/overview?range=1y')
    await screen.findByRole('region', { name: 'Key figures' })
    expect(router.state.location.search).toEqual({ range: '7d' })
  })

  it('shows one retryable error, not a blank page, when the stats fail', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/stats', () => {
        calls += 1
        return calls <= 2 ? fail('Boom', 500) : ok(testStats, 'Platform stats retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/overview')
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Key figures' })).toBeInTheDocument()
  })

  it('says the role cannot see this, and does not sign out, when the API answers 404', async () => {
    server.use(http.get('/api/v1/platform/stats', () => fail('Not found', 404)))
    renderAppAt('/overview')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    // Reloading re-runs the guards, which is what moves a demoted user on; stubbed only now, so the router mounted on the real location.
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})

describe('the Overview’s system status card', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  /** Answers the status with `status`; records each request. */
  function serveStatus(answer: () => Response = () => ok(testSystemStatus, 'OK')) {
    const seen: string[] = []
    server.use(
      http.get('/api/v1/platform/system/status', () => {
        seen.push('status')
        return answer()
      })
    )
    return seen
  }

  function withTracking(tracking: Partial<SystemStatus['errorTracking']>): SystemStatus {
    return {
      ...testSystemStatus,
      errorTracking: { ...testSystemStatus.errorTracking, ...tracking },
    }
  }

  it('shows an admin the release, error tracking on, and the window’s sent and dropped counts', async () => {
    serveStatus()
    renderAppAt('/overview')
    const card = await screen.findByRole('region', { name: 'System status' })
    expect(await within(card).findByText(testSystemStatus.release)).toBeInTheDocument()
    expect(within(card).getByText('Enabled')).toHaveAttribute('data-tone', 'success')
    expect(within(card).getByText('42')).toBeInTheDocument()
    expect(within(card).getByText('0')).toBeInTheDocument()
    expect(within(card).getByText('The API over the last 15 minutes')).toBeInTheDocument()
    expect(card.querySelector('time')).toHaveAttribute('dateTime', '2026-10-04T10:00:00.000Z')
    expect(within(card).queryByText('Needs attention')).not.toBeInTheDocument()
    expect(within(card).queryByText('Last failed send')).not.toBeInTheDocument()
  })

  it('warns, naming each reason, when events were dropped', async () => {
    serveStatus(() =>
      ok(
        withTracking({
          dropped: { throttled: 3, buffer_full: 0, rejected: 1, retry_exhausted: 0 },
        }),
        'OK'
      )
    )
    renderAppAt('/overview')
    const card = await screen.findByRole('region', { name: 'System status' })
    expect(await within(card).findByText('Needs attention')).toHaveAttribute('data-tone', 'warning')
    expect(within(card).getByText('Dropped').nextElementSibling).toHaveTextContent(
      '4 (Throttled 3, Refused by PostHog 1)'
    )
  })

  it('warns, with the status, when the last send failed, and says when nothing was sent', async () => {
    serveStatus(() => ok(withTracking({ lastSendError: 401, lastSendOkAt: null }), 'OK'))
    renderAppAt('/overview')
    const card = await screen.findByRole('region', { name: 'System status' })
    expect(await within(card).findByText('Needs attention')).toBeInTheDocument()
    expect(within(card).getByText('PostHog answered HTTP 401')).toBeInTheDocument()
    expect(within(card).getByText('None in the last 24 hours')).toBeInTheDocument()
  })

  it('says when error tracking is off', async () => {
    serveStatus(() => ok(withTracking({ enabled: false, sent: 0, lastSendOkAt: null }), 'OK'))
    renderAppAt('/overview')
    const card = await screen.findByRole('region', { name: 'System status' })
    expect(await within(card).findByText('Disabled')).toHaveAttribute('data-tone', 'muted')
  })

  it('shows a retryable error in the card alone when the status fails', async () => {
    let calls = 0
    serveStatus(() => {
      calls += 1
      return calls <= 2 ? fail('Boom', 500) : ok(testSystemStatus, 'OK')
    })
    const user = userEvent.setup()
    renderAppAt('/overview')
    const card = await screen.findByRole('region', { name: 'System status' })
    expect(
      await within(card).findByText('We could not load the system status.')
    ).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Key figures' })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Try again' }))
    expect(await within(card).findByText(testSystemStatus.release)).toBeInTheDocument()
  })

  it('keeps the last status up, with a note, when a refresh fails', async () => {
    // Only the interval is faked, so the next minute's refresh can be run now.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      let calls = 0
      serveStatus(() => {
        calls += 1
        return calls === 1 ? ok(testSystemStatus, 'OK') : fail('Boom', 500)
      })
      renderAppAt('/overview')
      const card = await screen.findByRole('region', { name: 'System status' })
      expect(await within(card).findByText(testSystemStatus.release)).toBeInTheDocument()
      vi.advanceTimersByTime(60_000)
      // The failed refresh retries once, a second later, before it counts as failed.
      await vi.waitFor(
        () => expect(within(card).getByText(/Could not refresh/)).toBeInTheDocument(),
        { timeout: 4000 }
      )
      expect(calls).toBe(3)
      expect(within(card).getByText(testSystemStatus.release)).toBeInTheDocument()
      expect(
        within(card).queryByText('We could not load the system status.')
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides the card, not the Overview, when the status answers 404', async () => {
    const seen = serveStatus(() => fail('Not found', 404))
    renderAppAt('/overview')
    await screen.findByRole('region', { name: 'Key figures' })
    await waitFor(() => expect(seen).toHaveLength(1))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'System status' })).not.toBeInTheDocument()
    )
    expect(screen.queryByText(/Your role can’t see this any more/)).not.toBeInTheDocument()
  })

  it('is not shown to a viewer, who never asks for it', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    const seen = serveStatus()
    renderAppAt('/overview')
    await screen.findByRole('region', { name: 'Key figures' })
    expect(screen.queryByRole('region', { name: 'System status' })).not.toBeInTheDocument()
    expect(seen).toHaveLength(0)
  })
})

describe('the system status card’s feature flags', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  /** Answers the status with flags as given. */
  function serveFlags(flags: Partial<FlagsStatus> | undefined) {
    const status: SystemStatus =
      flags === undefined
        ? testSystemStatus
        : { ...testSystemStatus, flags: { ...testFlagsStatus, ...flags } }
    server.use(http.get('/api/v1/platform/system/status', () => ok(status, 'OK')))
  }

  /** The card's Feature flags section, once loaded. */
  async function flagsSection() {
    const card = await screen.findByRole('region', { name: 'System status' })
    const heading = await within(card).findByRole('heading', { name: 'Feature flags', level: 3 })
    return within(heading.parentElement!)
  }

  it('shows healthy flags: enabled, the snapshot’s age and the counts, with no warning', async () => {
    serveFlags({})
    renderAppAt('/overview')
    const section = await flagsSection()
    expect(section.getByText('Enabled')).toHaveAttribute('data-tone', 'success')
    expect(section.getByText('Checked').nextElementSibling?.querySelector('time')).toHaveAttribute(
      'dateTime',
      testFlagsStatus.checkedAt
    )
    expect(
      section.getByText('Last changed').nextElementSibling?.querySelector('time')
    ).toHaveAttribute('dateTime', testFlagsStatus.snapshotAt)
    expect(
      section.getByText(
        '2 registered: 1 active, 1 inactive, 0 missing, 0 unsupported, 3 unregistered in PostHog'
      )
    ).toBeInTheDocument()
    expect(section.queryByText('Needs attention')).not.toBeInTheDocument()
    expect(section.queryByText('Last failed fetch')).not.toBeInTheDocument()
    expect(section.queryByText('Matching')).not.toBeInTheDocument()
  })

  it('says flags are not set up, without warning or listing counts', async () => {
    serveFlags({ enabled: false, snapshotAt: null, checkedAt: null, propertyMatchingVersion: null })
    renderAppAt('/overview')
    const section = await flagsSection()
    expect(section.getByText('Not set up')).toHaveAttribute('data-tone', 'muted')
    expect(section.queryByText('Needs attention')).not.toBeInTheDocument()
    expect(section.queryByText(/registered:/)).not.toBeInTheDocument()
  })

  it.each([
    ['no snapshot yet', { snapshotAt: null, propertyMatchingVersion: null }],
    ['a stale snapshot', { stale: true }],
    ['a failed last fetch', { lastFetchError: 'timeout' }],
    ['an unvalidated matching version', { propertyMatchingVersion: 2 }],
    ['a matching version PostHog did not report', { propertyMatchingVersion: null }],
    ['a missing flag', { counts: { ...testFlagsStatus.counts, missing: 1 } }],
    ['an unsupported flag', { counts: { ...testFlagsStatus.counts, unsupported: 1 } }],
    ['an unknown variant', { counts: { ...testFlagsStatus.counts, unknownVariant15m: 4 } }],
  ] as const)('warns on %s', async (_name, flags) => {
    serveFlags(flags)
    renderAppAt('/overview')
    const section = await flagsSection()
    expect(section.getByText('Needs attention')).toHaveAttribute('data-tone', 'warning')
  })

  it('names the failed fetch, the stale snapshot, the matching version and unknown variants', async () => {
    serveFlags({
      stale: true,
      lastFetchError: 'unauthorized',
      propertyMatchingVersion: 2,
      counts: { ...testFlagsStatus.counts, unknownVariant15m: 4 },
    })
    renderAppAt('/overview')
    const section = await flagsSection()
    expect(section.getByText('unauthorized')).toBeInTheDocument()
    expect(section.getByText('(stale)')).toBeInTheDocument()
    expect(
      section.getByText('PostHog property matching version 2; express is validated for version 1')
    ).toBeInTheDocument()
    expect(section.getByText('(4 unknown variants in 15 minutes)')).toBeInTheDocument()
  })

  it('explains the warning when PostHog reported no matching version for a snapshot', async () => {
    serveFlags({ propertyMatchingVersion: null })
    renderAppAt('/overview')
    const section = await flagsSection()
    expect(section.getByText('Matching')).toBeInTheDocument()
    expect(
      section.getByText(
        'PostHog did not report a property matching version; express is validated for version 1'
      )
    ).toBeInTheDocument()
  })

  it('says when there is no snapshot yet', async () => {
    serveFlags({ snapshotAt: null, propertyMatchingVersion: null })
    renderAppAt('/overview')
    const section = await flagsSection()
    expect(section.getByText('None yet')).toBeInTheDocument()
  })

  it('shows no flags section for an API older than 1.8.0', async () => {
    serveFlags(undefined)
    renderAppAt('/overview')
    const card = await screen.findByRole('region', { name: 'System status' })
    expect(await within(card).findByText(testSystemStatus.release)).toBeInTheDocument()
    expect(within(card).queryByRole('heading', { name: 'Feature flags' })).not.toBeInTheDocument()
  })
})
