import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/states/auth.store'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testStats, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('/overview', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the four KPIs from the stats', async () => {
    renderAppAt('/overview')
    const kpis = await screen.findByRole('region', { name: 'Key figures' })
    expect(within(kpis).getByText('1,284')).toBeInTheDocument()
    expect(within(kpis).getByText('9,730')).toBeInTheDocument()
    expect(within(kpis).getByText('18')).toBeInTheDocument()
    const attempts = testStats.emails.reduce((sum, day) => sum + day.sent + day.failed, 0)
    expect(within(kpis).getByText(attempts.toLocaleString('en-US'))).toBeInTheDocument()
    expect(within(kpis).getByText(/0\.0\d% of send attempts failed/)).toBeInTheDocument()
  })

  it('says so, rather than dividing by zero, when the window has no send attempts', async () => {
    server.use(
      http.get('/api/v1/platform/stats', () =>
        ok(
          { ...testStats, emails: testStats.emails.map((day) => ({ ...day, sent: 0, failed: 0 })) },
          'Platform stats retrieved.'
        )
      )
    )
    renderAppAt('/overview')
    const kpis = await screen.findByRole('region', { name: 'Key figures' })
    expect(within(kpis).getByText('No send attempts')).toBeInTheDocument()
  })

  it('never rounds a real failure down to 0.00%', async () => {
    server.use(
      http.get('/api/v1/platform/stats', () =>
        ok(
          {
            ...testStats,
            emails: testStats.emails.map((day, index) => ({
              ...day,
              sent: 5000,
              failed: index === 0 ? 1 : 0,
            })),
          },
          'Platform stats retrieved.'
        )
      )
    )
    renderAppAt('/overview')
    const kpis = await screen.findByRole('region', { name: 'Key figures' })
    expect(within(kpis).getByText('<0.01% of send attempts failed')).toBeInTheDocument()
  })

  it('keeps each chart named, and says the window was empty, on a fresh install', async () => {
    server.use(
      http.get('/api/v1/platform/stats', ({ request }) => {
        const range = new URL(request.url).searchParams.get('range') ?? '7d'
        return ok(
          {
            range,
            totals: { tenants: 0, users: 0, staff: 1 },
            signups: testStats.signups.map((day) => ({ ...day, users: 0, tenants: 0 })),
            emails: testStats.emails.map((day) => ({ ...day, sent: 0, failed: 0 })),
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
    expect(within(emails).getByText('No send attempts in the last 7 days')).toBeInTheDocument()
    expect(within(signups).queryByRole('table')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '30 days' }))
    expect(await within(signups).findByText('No sign-ups in the last 30 days')).toBeInTheDocument()
    expect(within(emails).getByText('No send attempts in the last 30 days')).toBeInTheDocument()
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
    // A failed attempt may be retried and then sent, so the column never claims failed emails.
    expect(
      within(emailTable)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Day', 'Sent', 'Failed attempts'])
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
    expect(await screen.findByText('Send attempts (30 days)')).toBeInTheDocument()
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
    expect(screen.getByText('Send attempts (7 days)')).toBeInTheDocument()
    expect(kpis.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true')
    release()
    expect(await screen.findByText('Send attempts (30 days)')).toBeInTheDocument()
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
