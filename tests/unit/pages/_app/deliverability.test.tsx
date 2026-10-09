import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { navItemsFor } from '@/constants/navigation'
import { useAuthStore } from '@/states/auth.store'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testEmailHealth, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { EmailHealth, EmailRate } from '@/types/api.types'

/** A known rate: `value` is set the way the API sets it, and the page reads only its null-ness. */
function rate(numerator: number, denominator: number): EmailRate {
  return { value: denominator === 0 ? null : numerator / denominator, numerator, denominator }
}

/** No provider has sent an event: only the undelivered rate is known. */
const UNKNOWN: EmailRate = { value: null, numerator: 0, denominator: 0 }

/** Every tile's label, then its value, then its note, in page order. */
async function tiles(): Promise<[string, string, string][]> {
  const region = await screen.findByRole('region', { name: 'Deliverability figures' })
  const text = (card: Element, slot: string) =>
    card.querySelector(`[data-slot="${slot}"]`)?.textContent ?? ''
  return [...region.querySelectorAll('[data-slot="card"]')].map((card) => [
    text(card, 'card-description'),
    text(card, 'card-title'),
    text(card, 'card-content'),
  ])
}

function serve(health: EmailHealth) {
  server.use(
    http.get('/api/v1/platform/emails/health', () => ok(health, 'Email health retrieved.'))
  )
}

describe('/deliverability', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('shows every figure with its denominator, opens and clicks marked approximate', async () => {
    serve({
      ...testEmailHealth,
      totals: {
        messages: 1000,
        delivered: 950,
        sent: 30,
        undelivered: 15,
        complained: 5,
        suppressed: 2,
        providerEvents: 1200,
      },
      rates: {
        undeliveredRate: rate(15, 1000),
        deliveredRate: rate(950, 1000),
        bounceRate: rate(10, 1000),
        complaintRate: rate(5, 1000),
        openRate: rate(40, 200),
        clickRate: rate(1, 200_000),
      },
    })
    renderAppAt('/deliverability')
    const shown = await tiles()
    expect(shown.map(([label, value]) => [label, value])).toEqual([
      ['Emails sent (7 days)', '1,000'],
      ['Undelivered rate', '1.50%'],
      ['Delivered rate', '95.00%'],
      ['Hard bounce rate', '1.00%'],
      ['Complaint rate', '0.50%'],
      ['Open rate (approximate)', '20.00%'],
      ['Click rate (approximate)', '<0.01%'],
    ])
    expect(shown[0]![2]).toBe('2 more suppressed, never sent')
    expect(shown[1]![2]).toBe('15 of 1,000 emails sent')
    expect(shown[5]![2]).toMatch(/^40 of 200 general-sender emails\. Approximate/)
    expect(shown[6]![2]).toMatch(/^1 of 200,000 general-sender emails\. Approximate/)
    expect(screen.queryByText(/No provider events yet/)).not.toBeInTheDocument()
  })

  it('reads "No provider data" on every provider rate without a webhook, and still shows the undelivered rate and the chart', async () => {
    serve({
      ...testEmailHealth,
      totals: {
        messages: 400,
        delivered: 0,
        sent: 396,
        undelivered: 4,
        complained: 0,
        suppressed: 1,
        providerEvents: 0,
      },
      rates: {
        undeliveredRate: rate(4, 400),
        deliveredRate: UNKNOWN,
        bounceRate: UNKNOWN,
        complaintRate: UNKNOWN,
        openRate: UNKNOWN,
        clickRate: UNKNOWN,
      },
    })
    renderAppAt('/deliverability')
    const shown = await tiles()
    expect(shown[1]).toEqual(['Undelivered rate', '1.00%', '4 of 400 emails sent'])
    for (const tile of shown.slice(2)) {
      expect(tile.slice(1)).toEqual(['—', 'No provider data'])
    }

    const banner = screen.getByRole('note')
    expect(banner).toHaveTextContent(
      'No provider events yet — delivery, bounce and complaint data appear once a provider webhook is configured.'
    )
    const docs = within(banner).getByRole('link', { name: /How to configure one/ })
    expect(docs).toHaveAttribute('href', expect.stringMatching(/#email-tracking$/))
    expect(docs).toHaveAttribute('rel', 'noreferrer')
    // A banner, not an empty state: the chart still draws the window's sent emails.
    const chart = screen.getByRole('figure', { name: 'Emails per day' })
    expect(within(chart).getByRole('table')).toBeInTheDocument()
  })

  it('says there is nothing to measure, not 0%, when no email left in the window', async () => {
    serve({
      ...testEmailHealth,
      totals: {
        messages: 0,
        delivered: 0,
        sent: 0,
        undelivered: 0,
        complained: 0,
        suppressed: 0,
        providerEvents: 3,
      },
      rates: {
        undeliveredRate: UNKNOWN,
        deliveredRate: UNKNOWN,
        bounceRate: UNKNOWN,
        complaintRate: UNKNOWN,
        openRate: UNKNOWN,
        clickRate: UNKNOWN,
      },
      days: testEmailHealth.days.map((day) => ({
        ...day,
        delivered: 0,
        sent: 0,
        undelivered: 0,
        complained: 0,
        suppressed: 0,
      })),
      byTemplate: [],
      byDomain: [],
    })
    renderAppAt('/deliverability')
    const shown = await tiles()
    for (const tile of shown.slice(1)) {
      expect(tile.slice(1)).toEqual(['—', 'No emails to measure in this window'])
    }
    const chart = screen.getByRole('figure', { name: 'Emails per day' })
    expect(within(chart).getByText('No emails in the last 7 days')).toBeInTheDocument()
    const byTemplate = screen.getByRole('region', { name: 'By template' })
    expect(within(byTemplate).getByText('No emails in this window.')).toBeInTheDocument()
  })

  it('lists the window by template label and by recipient domain', async () => {
    serve({
      ...testEmailHealth,
      byTemplate: [
        { key: 'password_reset', messages: 600, undelivered: 10, complained: 3 },
        { key: 'retired_template', messages: 4, undelivered: 0, complained: 0 },
      ],
      byDomain: [{ key: 'example-corp.co.uk', messages: 1200, undelivered: 5, complained: 2 }],
    })
    renderAppAt('/deliverability')
    const byTemplate = await screen.findByRole('table', { name: 'By template' })
    expect(
      within(byTemplate)
        .getAllByRole('row')
        .map((row) => row.textContent)
    ).toEqual([
      'TemplateEmailsUndeliveredComplained',
      'Password reset600103',
      'retired_template400',
    ])
    const byDomain = screen.getByRole('table', { name: 'Top recipient domains' })
    expect(within(byDomain).getByRole('cell', { name: 'example-corp.co.uk' })).toBeInTheDocument()
    expect(within(byDomain).getByRole('cell', { name: '1,200' })).toBeInTheDocument()
  })

  it('asks for 30 days when the toggle is switched, and keeps it in the URL', async () => {
    const ranges: string[] = []
    server.use(
      http.get('/api/v1/platform/emails/health', ({ request }) => {
        const range = new URL(request.url).searchParams.get('range') ?? ''
        ranges.push(range)
        return ok({ ...testEmailHealth, range: range === '30d' ? '30d' : '7d' }, 'ok')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/deliverability')
    await screen.findByRole('region', { name: 'Deliverability figures' })

    await user.click(screen.getByRole('button', { name: '30 days' }))

    await waitFor(() => expect(ranges).toContain('30d'))
    expect(router.state.location.search).toEqual({ range: '30d' })
    expect(await screen.findByText('Emails sent (30 days)')).toBeInTheDocument()
  })

  it('falls back to 7 days for a range it does not offer', async () => {
    const router = renderAppAt('/deliverability?range=1y')
    await screen.findByRole('region', { name: 'Deliverability figures' })
    expect(router.state.location.search).toEqual({ range: '7d' })
  })

  it('shows one retryable error when the figures fail', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/emails/health', () => {
        calls += 1
        return calls <= 2 ? fail('Boom', 500) : ok(testEmailHealth, 'ok')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/deliverability')
    expect(
      await screen.findByText('We could not load the deliverability figures.')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('region', { name: 'Deliverability figures' })
    ).toBeInTheDocument()
  })

  it('says the role cannot see this, and does not sign out, on a 404', async () => {
    server.use(http.get('/api/v1/platform/emails/health', () => fail('Not found', 404)))
    renderAppAt('/deliverability')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('is in the Operations nav for every staff role, after Emails', () => {
    const operations = navItemsFor('viewer').filter((item) => item.group === 'Operations')
    expect(operations.map((item) => item.label).slice(0, 2)).toEqual(['Emails', 'Deliverability'])
  })
})
