import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { billingDate } from '@/constants/billing-labels'
import {
  testBillingEvents,
  testBillingHistory,
  testBillingSubscriptions,
  testFreeTenantBilling,
  testInvoices,
  testPlans,
  testTenantBilling,
} from '@/tests/fixtures/billing'
import { PLATFORM_TENANT_ID, TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantDetail } from '@/types/api.types'
import type { StaffPlans, StaffTenantBilling } from '@/types/billing.types'
import type { ListPage } from '@/types/list.types'

const BILLING = `/tenants/${TENANT_ID}/billing`

/** Acme's platform detail, or the platform tenant's. */
function detail(platform = false): PlatformTenantDetail {
  return {
    id: platform ? PLATFORM_TENANT_ID : TENANT_ID,
    name: platform ? 'Platform' : 'Acme Corp',
    slug: platform ? 'platform' : 'acme',
    description: null,
    website: null,
    logo: null,
    lifecycleState: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: null,
    settings: { timezone: 'UTC', locale: 'en' },
    memberCount: 2,
    owners: [],
    pendingInvitationCount: 0,
    pendingOwnerInvitation: null,
  }
}

/** The requests each billing list received, by list. */
type Seen = Record<'history' | 'events' | 'subscriptions' | 'invoices', URLSearchParams[]>

/** Each list's answer for a request; the default is one page of the fixture rows. */
type Pages = Partial<Record<keyof Seen, (params: URLSearchParams) => ListPage<unknown>>>

/**
 * Acme's detail and billing, the plans, and the four lists, each request recorded.
 * @param billing - The billing view to serve.
 * @param pages - Per list, the page to answer.
 * @param plans - The plans to serve.
 */
function serve(
  billing: StaffTenantBilling = testTenantBilling,
  pages: Pages = {},
  plans: StaffPlans = testPlans
): Seen {
  const seen: Seen = { history: [], events: [], subscriptions: [], invoices: [] }
  const rows = {
    history: testBillingHistory,
    events: testBillingEvents,
    subscriptions: testBillingSubscriptions,
    invoices: testInvoices,
  }
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(detail(), 'Tenant retrieved.')),
    http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing`, () =>
      ok(billing, 'Billing retrieved.')
    ),
    http.get('/api/v1/platform/plans', () => ok(plans, 'Plans retrieved.')),
    ...(['history', 'events', 'subscriptions', 'invoices'] as const).map((name) =>
      http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing/${name}`, ({ request }) => {
        const params = new URL(request.url).searchParams
        seen[name].push(params)
        const page = pages[name]
        return ok(
          page ? page(params) : listPage<unknown>(rows[name], { nextCursor: 'c2', hasNext: true }),
          'ok'
        )
      })
    )
  )
  return seen
}

/** The summary card's definition list. */
async function summary() {
  const heading = await screen.findByRole('heading', { name: 'Billing', level: 2 })
  const card = heading.closest('[data-slot="card"]') as HTMLElement
  return card
}

/**
 * The value a summary row shows.
 * @param card - The summary card.
 * @param term - The row's name.
 */
function row(card: HTMLElement, term: string): string | null | undefined {
  const dt = within(card).getByText(term, { selector: 'dt' })
  return dt.nextElementSibling?.textContent
}

describe('/tenants/$tenantId/billing', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  describe('the tab', () => {
    it('sits after Onboarding, under a fixed title', async () => {
      serve()
      renderAppAt(BILLING)
      const nav = await screen.findByRole('navigation', { name: 'Tenant sections' })
      expect(
        within(nav)
          .getAllByRole('link')
          .map((link) => link.textContent)
      ).toEqual([
        'Overview',
        'Members',
        'Invitations',
        'Activity',
        'Emails',
        'Onboarding',
        'Billing',
      ])
      expect(within(nav).getByRole('link', { name: 'Billing' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await summary()
      await waitFor(() => expect(document.title).toBe('Tenant billing · Apex'))
    })

    it('preloads the plans but not the audited billing read on a hover', async () => {
      serve()
      const billingReads: string[] = []
      const planReads: string[] = []
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing`, ({ request }) => {
          billingReads.push(request.url)
          return ok(testTenantBilling, 'Billing retrieved.')
        }),
        http.get('/api/v1/platform/plans', ({ request }) => {
          planReads.push(request.url)
          return ok(testPlans, 'Plans retrieved.')
        })
      )
      const router = renderAppAt(`/tenants/${TENANT_ID}`)
      await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
      // A hover on a Billing link runs this preload ('intent'); express audits every billing read as `billing.viewed`.
      await router.preloadRoute({
        to: '/tenants/$tenantId/billing',
        params: { tenantId: TENANT_ID },
      })
      await waitFor(() => expect(planReads).toHaveLength(1))
      expect(billingReads).toEqual([])
    })

    it('hides the tab for the platform tenant', async () => {
      server.use(
        http.get(`/api/v1/platform/tenants/${PLATFORM_TENANT_ID}`, () =>
          ok(detail(true), 'Tenant retrieved.')
        )
      )
      renderAppAt(`/tenants/${PLATFORM_TENANT_ID}/members`)
      await screen.findByRole('heading', { name: 'Platform', level: 1 })
      const nav = screen.getByRole('navigation', { name: 'Tenant sections' })
      expect(within(nav).queryByRole('link', { name: 'Billing' })).toBeNull()
      expect(within(nav).getByRole('link', { name: 'Onboarding' })).toBeInTheDocument()
    })

    it('says the tenant has no billing, and asks for none of its lists', async () => {
      const seen = serve()
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing`, () =>
          fail('This tenant has no billing.', 404, 'tenant_billing_not_found')
        )
      )
      renderAppAt(BILLING)
      expect(
        await screen.findByRole('heading', { name: 'This tenant has no billing.' })
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to tenants' })).toHaveAttribute(
        'href',
        '/tenants'
      )
      expect(screen.queryByText(/Your role can’t see this any more/)).toBeNull()
      expect(seen).toEqual({ history: [], events: [], subscriptions: [], invoices: [] })
    })

    it('renders RoleDenied for a role 404', async () => {
      serve()
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing`, () =>
          fail('Route not found', 404, 'not_found')
        )
      )
      renderAppAt(BILLING)
      expect(await screen.findByText('Your role can’t see this any more.')).toBeInTheDocument()
      expect(screen.queryByText('This tenant has no billing.')).toBeNull()
    })

    it('shows a viewer no actions', async () => {
      serve()
      renderAppAt(BILLING)
      await screen.findByRole('table', { name: 'Invoices' })
      // The actions need the tenant's detail too; its heading is the layout's barrier for it.
      await screen.findByRole('heading', { level: 1, name: 'Acme Corp' })
      expect(
        screen.queryByRole('button', { name: /resync|extend|grant|revoke|cancel|actions/i })
      ).toBeNull()
      expect(
        within(screen.getByRole('table', { name: 'Grants' })).getAllByRole('columnheader')
      ).toHaveLength(6)
    })
  })

  describe('the summary', () => {
    it('shows the summary of a paying tenant', async () => {
      serve()
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Plan')).toBe('PaidPaid')
      expect(within(card).getByText('Paid', { selector: '[data-tone]' })).toHaveAttribute(
        'data-tone',
        'success'
      )
      expect(row(card, 'Price')).toBe('₹999 per month')
      expect(row(card, 'Paid until')).toBe('20 November 2026')
      expect(row(card, 'Payer')).toBe('A B')
      expect(row(card, 'Payment provider')).toBe('Razorpay (test)')
      expect(row(card, 'Subscription ID')).toBe('sub_TestActive0001')
      // A dl holds groups or bare pairs, never both: every child is a dt or a dd.
      for (const dl of document.querySelectorAll('dl')) {
        expect(new Set([...dl.children].map((child) => child.tagName))).toEqual(
          new Set(['DT', 'DD'])
        )
      }
      expect(within(card).getByRole('button', { name: 'Copy subscription ID' })).toBeInTheDocument()
      expect(within(card).queryByText('Pending subscription ID')).toBeNull()
      expect(within(card).queryByText('Dispute open')).toBeNull()
      expect(within(card).getByText('Last synced', { selector: 'dt' })).toBeInTheDocument()
      expect(within(card).queryByText(/billing email/i)).toBeNull()
    })

    it('dates the billing in the tenant’s time zone, as the customer reads it', async () => {
      serve()
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
          ok(
            { ...detail(), settings: { timezone: 'Pacific/Pago_Pago', locale: 'en' } },
            'Tenant retrieved.'
          )
        )
      )
      renderAppAt(BILLING)
      const card = await summary()
      // Midnight UTC on 20 November is still 19 November in Pago Pago (UTC−11), whatever zone the reader is in.
      await waitFor(() => expect(row(card, 'Paid until')).toBe('19 November 2026'))
    })

    it('shows the retired price label', async () => {
      const paid = testPlans.plans[1]!
      serve(
        testTenantBilling,
        {},
        {
          ...testPlans,
          plans: [
            testPlans.plans[0]!,
            {
              ...paid,
              prices: paid.prices.map((price) =>
                price.interval === 'month'
                  ? { ...price, active: false, retiredAt: '2026-10-15T00:00:00.000Z' }
                  : price
              ),
            },
          ],
        }
      )
      renderAppAt(BILLING)
      const card = await summary()
      await waitFor(() => expect(row(card, 'Price')).toBe('₹999 per month (retired price)'))
    })

    it('says the provider is still retrying while graceEndsAt is null', async () => {
      serve({
        ...testTenantBilling,
        state: 'past_due',
        pastDue: { since: '2026-10-21T00:00:00.000Z', graceEndsAt: null, paused: true },
        disputeOpen: true,
        cancelAtPeriodEnd: true,
        payer: { userId: 'u', name: 'A B', isMember: false },
      })
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Failed payment')).toMatch(
        /^Payment failed on .+\. Razorpay is still retrying the payment\. Razorpay paused the subscription\.$/
      )
      expect(within(card).getByText('Dispute open')).toHaveAttribute('data-tone', 'destructive')
      expect(within(card).queryByText('Cancels on', { selector: 'dt' })).toBeNull()
      expect(row(card, 'Payer')).toBe('A B (left the tenant)')
    })

    it('says when Paid ends after a failed payment with a grace end', async () => {
      serve({
        ...testTenantBilling,
        state: 'past_due',
        pastDue: {
          since: '2026-10-21T00:00:00.000Z',
          graceEndsAt: '2026-10-28T00:00:00.000Z',
          paused: false,
        },
      })
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Failed payment')).toMatch(/^Payment failed on .+\. Paid ends on .+2026\.$/)
      // Express ends a failed payment's Paid with its grace, so the period end (the failed renewal) is no row.
      expect(within(card).queryByText('Paid until', { selector: 'dt' })).toBeNull()
    })

    it('shows the state with no provider ids and no invoices while payments are off', async () => {
      const seen = serve({ ...testTenantBilling, paymentsEnabled: false })
      renderAppAt(BILLING)
      const card = await summary()
      expect(
        within(card).getByText(
          'Payments are off on this server, so it can’t charge, sync or cancel. A subscription made earlier still charges at Razorpay; cancel it in the Razorpay dashboard.'
        )
      ).toBeInTheDocument()
      expect(row(card, 'Plan')).toBe('PaidPaid')
      expect(within(card).queryByText('Subscription ID')).toBeNull()
      expect(within(card).queryByRole('button', { name: /^Copy/ })).toBeNull()
      expect(
        await screen.findByText(/we can’t read invoices from the payment provider/)
      ).toBeInTheDocument()
      expect(screen.queryByRole('table', { name: 'Invoices' })).toBeNull()
      await screen.findByRole('table', { name: 'Subscriptions' })
      expect(seen.invoices).toEqual([])
    })

    it('shows when a trial ends, and no paid period, while the tenant is trialing', async () => {
      serve({
        ...testTenantBilling,
        state: 'trialing',
        price: null,
        interval: null,
        trialEndsAt: '2099-01-15T00:00:00.000Z',
        currentPeriodEnd: null,
        providerSubscriptionId: null,
      })
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Trial ends')).toMatch(/2099/)
      expect(within(card).queryByText('Paid until', { selector: 'dt' })).toBeNull()
      expect(within(card).queryByText('First charge', { selector: 'dt' })).toBeNull()
    })

    it('reads a trial that lapsed while the page was open as Free: no past Trial ends date', async () => {
      serve({
        ...testTenantBilling,
        state: 'trialing',
        price: null,
        interval: null,
        trialEndsAt: new Date(Date.now() - 60 * 1000).toISOString(),
        currentPeriodEnd: null,
        providerSubscriptionId: null,
        payer: null,
      })
      renderAppAt(BILLING)
      const card = await summary()
      expect(within(card).queryByText('Trial ends', { selector: 'dt' })).toBeNull()
      expect(within(card).queryByText('Paid until', { selector: 'dt' })).toBeNull()
    })

    it('shows no paid period for a trialing tenant whose subscription is authenticated', async () => {
      serve({
        ...testTenantBilling,
        state: 'trialing',
        trialEndsAt: '2099-01-15T00:00:00.000Z',
        currentPeriodEnd: '2099-01-15T00:00:00.000Z',
      })
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Trial ends')).toMatch(/2099/)
      expect(within(card).queryByText('Paid until', { selector: 'dt' })).toBeNull()
    })

    it('shows the first charge, not a paid period, for a tenant that upgraded during its trial', async () => {
      serve({
        ...testTenantBilling,
        state: 'active',
        trialEndsAt: '2099-01-15T00:00:00.000Z',
        currentPeriodEnd: '2099-01-15T00:00:00.000Z',
      })
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'First charge')).toMatch(/^₹999 on .*2099$/)
      expect(within(card).queryByText('Paid until', { selector: 'dt' })).toBeNull()
      expect(within(card).queryByText('Trial ends', { selector: 'dt' })).toBeNull()
    })

    it('shows no past trial date once the tenant pays or moves to Free', async () => {
      serve({ ...testTenantBilling, trialEndsAt: '2026-01-15T00:00:00.000Z' })
      const view = renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Paid until')).toMatch(/2026/)
      expect(within(card).queryByText('Trial ends', { selector: 'dt' })).toBeNull()
      view.unmount()

      serve({ ...testFreeTenantBilling, trialEndsAt: '2026-01-15T00:00:00.000Z' })
      renderAppAt(BILLING)
      const free = await summary()
      expect(within(free).queryByText('Trial ends', { selector: 'dt' })).toBeNull()
    })

    it('shows no paid period for a Free tenant whose cancelled subscription ended', async () => {
      serve({
        ...testFreeTenantBilling,
        currentPeriodEnd: '2026-01-10T00:00:00.000Z',
        cancelAtPeriodEnd: true,
      })
      renderAppAt(BILLING)
      const card = await summary()
      expect(within(card).queryByText('Cancels on', { selector: 'dt' })).toBeNull()
      expect(within(card).queryByText('Paid until', { selector: 'dt' })).toBeNull()
      expect(within(card).queryByText('Period ended', { selector: 'dt' })).toBeNull()
    })

    it('says when a cancelled period ended and when the tenant moves to Free, inside the 3-day buffer', async () => {
      // Yesterday: inside express's buffer, so the tenant is still served as active.
      const endedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const freeAt = new Date(Date.parse(endedAt) + 3 * 24 * 60 * 60 * 1000).toISOString()
      serve({ ...testTenantBilling, currentPeriodEnd: endedAt, cancelAtPeriodEnd: true })
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Period ended')).toBe(billingDate(endedAt, 'UTC'))
      expect(row(card, 'Moves to Free on')).toBe(billingDate(freeAt, 'UTC'))
      expect(within(card).queryByText('Cancels on', { selector: 'dt' })).toBeNull()
    })

    it('reads a page left open past the 3-day buffer as Free: no past move-to-Free date', async () => {
      serve({
        ...testTenantBilling,
        currentPeriodEnd: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        cancelAtPeriodEnd: true,
        nextSubscriptionId: 'sub_TestNext0001',
        nextSwitch: { interval: 'year', startsAt: '2026-01-10T00:00:00.000Z' },
      })
      renderAppAt(BILLING)
      const card = await summary()
      for (const term of [
        'Period ended',
        'Moves to Free on',
        'Cancels on',
        'Paid until',
        'Next subscription',
      ]) {
        expect(within(card).queryByText(term, { selector: 'dt' })).toBeNull()
      }
    })

    it('shows the booked next subscription, not the ending one, while Paid continues', async () => {
      serve({
        ...testTenantBilling,
        cancelAtPeriodEnd: true,
        nextSubscriptionId: 'sub_TestNext0001',
        nextSwitch: { interval: 'year', startsAt: '2026-11-20T00:00:00.000Z' },
      })
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Next subscription')).toBe(
        `₹9,990 per year from ${billingDate('2026-11-20T00:00:00.000Z', 'UTC')}`
      )
      expect(within(card).queryByText('Cancels on', { selector: 'dt' })).toBeNull()
      expect(within(card).queryByText('Moves to Free on', { selector: 'dt' })).toBeNull()
    })

    it('names the next subscription’s interval when the plans can’t be read', async () => {
      serve({
        ...testTenantBilling,
        nextSubscriptionId: 'sub_TestNext0001',
        nextSwitch: { interval: 'year', startsAt: '2026-11-20T00:00:00.000Z' },
      })
      server.use(
        http.get('/api/v1/platform/plans', () => fail('Internal server error', 500, 'internal'))
      )
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Next subscription')).toBe(
        `Yearly from ${billingDate('2026-11-20T00:00:00.000Z', 'UTC')}`
      )
      expect(within(card).queryByText('Paid until', { selector: 'dt' })).toBeNull()
    })

    it('shows a Free tenant with no price, payer or subscription', async () => {
      serve(testFreeTenantBilling)
      renderAppAt(BILLING)
      const card = await summary()
      expect(row(card, 'Plan')).toBe('FreeFree')
      expect(row(card, 'Price')).toBe('None')
      expect(row(card, 'Payer')).toBe('None')
      expect(within(card).queryByText('Subscription ID')).toBeNull()
    })
  })

  describe('usage and grants', () => {
    it('labels each entitlement from the catalog with its source', async () => {
      serve(testFreeTenantBilling)
      renderAppAt(BILLING)
      const heading = await screen.findByRole('heading', { name: 'Usage and access' })
      const card = heading.closest('[data-slot="card"]') as HTMLElement
      await waitFor(() => expect(row(card, 'Members')).toBe('4 of 50 membersGrant'))
      expect(row(card, 'Workspace insights')).toBe('OffPlan')
    })

    it('flags a limit that is reached', async () => {
      serve({
        ...testFreeTenantBilling,
        entitlements: {
          ...testFreeTenantBilling.entitlements,
          limits: { members: { limit: 3, used: 3, approaching: false } },
        },
        sources: { members: 'plan', advanced_example: 'plan' },
      })
      renderAppAt(BILLING)
      const heading = await screen.findByRole('heading', { name: 'Usage and access' })
      const card = heading.closest('[data-slot="card"]') as HTMLElement
      await waitFor(() => expect(row(card, 'Members')).toBe('3 of 3 membersAt limitPlan'))
    })

    it.each([
      [{ limit: null, used: 1 }, '1 member · No limitPlan'],
      [{ limit: null, used: 0 }, '0 members · No limitPlan'],
      [{ limit: 1, used: 0 }, '0 of 1 memberPlan'],
      [{ limit: 1, used: 1 }, '1 of 1 memberAt limitPlan'],
      [{ limit: 1_000_000, used: 1_250 }, '1,250 of 1,000,000 membersPlan'],
    ])('counts members %o as %s', async (usage, text) => {
      serve({
        ...testFreeTenantBilling,
        entitlements: {
          ...testFreeTenantBilling.entitlements,
          limits: { members: { ...usage, approaching: false } },
        },
        sources: { members: 'plan', advanced_example: 'plan' },
      })
      renderAppAt(BILLING)
      const heading = await screen.findByRole('heading', { name: 'Usage and access' })
      const card = heading.closest('[data-slot="card"]') as HTMLElement
      await waitFor(() => expect(row(card, 'Members')).toBe(text))
    })

    it('keeps an acronym in a limit’s noun', async () => {
      serve(
        {
          ...testTenantBilling,
          entitlements: {
            ...testTenantBilling.entitlements,
            limits: {
              ...testTenantBilling.entitlements.limits,
              api_calls: { limit: 1000, used: 10, approaching: false },
            },
          },
          sources: { ...testTenantBilling.sources, api_calls: 'plan' },
        },
        {},
        {
          ...testPlans,
          catalog: [
            ...testPlans.catalog,
            { key: 'api_calls', kind: 'limit', label: 'API calls', description: 'Calls a month.' },
          ],
        }
      )
      renderAppAt(BILLING)
      const heading = await screen.findByRole('heading', { name: 'Usage and access' })
      const card = heading.closest('[data-slot="card"]') as HTMLElement
      await waitFor(() => expect(row(card, 'API calls')).toBe('10 of 1,000 API callsPlan'))
      expect(row(card, 'Members')).toBe('4 members · No limitPlan')
    })

    it('falls back to registry keys when the plans can’t be read', async () => {
      serve()
      server.use(http.get('/api/v1/platform/plans', () => fail('Not found', 404)))
      renderAppAt(BILLING)
      const heading = await screen.findByRole('heading', { name: 'Usage and access' })
      const card = heading.closest('[data-slot="card"]') as HTMLElement
      await waitFor(() => expect(row(card, 'members')).toBe('4 members · No limitPlan'))
      expect(row(card, 'advanced_example')).toBe('OnPlan')
      expect(row(await summary(), 'Price')).toBe('₹999 per month')
    })

    it('lists each grant with its value, end, status, author and reason', async () => {
      serve()
      renderAppAt(BILLING)
      const table = await screen.findByRole('table', { name: 'Grants' })
      const cells = within(within(table).getAllByRole('row')[1]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
      expect(cells).toEqual([
        'Members',
        '50',
        'No end date',
        'Active',
        'Staff Admin',
        'Pilot with a large team',
      ])
    })

    it('says a tenant has no grants', async () => {
      serve({ ...testTenantBilling, grants: [] })
      renderAppAt(BILLING)
      expect(await screen.findByText('No grants.')).toBeInTheDocument()
      expect(
        screen.getByText('A grant raises a limit or turns on a feature beyond the plan.')
      ).toBeInTheDocument()
    })
  })

  describe('the state history list', () => {
    it('lists each change with its cause, source and time', async () => {
      serve()
      renderAppAt(BILLING)
      const table = await screen.findByRole('table', { name: 'State history' })
      const rows = within(table).getAllByRole('row')
      expect(within(rows[1]!).getByText('Trial → Paid')).toBeInTheDocument()
      expect(within(rows[1]!).getByText('First payment taken')).toBeInTheDocument()
      expect(within(rows[1]!).getByText('Payment provider')).toBeInTheDocument()
      expect(within(rows[2]!).getByText('Created → Trial')).toBeInTheDocument()
    })

    it('sends its search, source filter and sort, and pages with the cursor', async () => {
      const seen = serve()
      const user = userEvent.setup()
      const router = renderAppAt(BILLING)
      const table = await screen.findByRole('table', { name: 'State history' })
      expect(seen.history.at(-1)?.get('total')).toBe('1')

      await user.type(screen.getByRole('searchbox', { name: 'Search state history' }), 'past_due')
      await waitFor(() => expect(seen.history.at(-1)?.get('search')).toBe('past_due'))
      expect(router.state.location.search).toEqual({ historySearch: 'past_due' })

      await user.click(screen.getByRole('button', { name: 'Filter by source, State history' }))
      const popup = await screen.findByRole('dialog', { name: 'Filter by source, State history' })
      await user.click(within(popup).getByRole('checkbox', { name: 'Staff' }))
      await waitFor(() => expect(seen.history.at(-1)?.get('source')).toBe('staff'))
      await user.keyboard('{Escape}')

      await user.click(within(table).getByRole('button', { name: /^When/ }))
      await waitFor(() => expect(seen.history.at(-1)?.get('sort')).toBe('at'))

      const nav = screen.getByRole('navigation', { name: 'State history pagination' })
      await user.click(within(nav).getByRole('button', { name: 'Next page' }))
      await waitFor(() => expect(seen.history.at(-1)?.get('cursor')).toBe('c2'))
      expect(router.state.location.search).toMatchObject({
        historyCursor: 'c2',
        historySource: 'staff',
        historySort: 'at',
      })
      expect(seen.events.every((params) => !params.has('search'))).toBe(true)
    })

    it('sends the stored code for a search that names a state or cause label', async () => {
      const seen = serve()
      const user = userEvent.setup()
      const router = renderAppAt(BILLING)
      await screen.findByRole('table', { name: 'State history' })
      const box = screen.getByRole('searchbox', { name: 'Search state history' })
      await user.type(box, 'payment failed')
      await waitFor(() => expect(seen.history.at(-1)?.get('search')).toBe('past_due'))
      expect(router.state.location.search).toEqual({ historySearch: 'payment failed' })

      await user.clear(box)
      await user.type(box, 'first payment taken')
      await waitFor(() => expect(seen.history.at(-1)?.get('search')).toBe('subscription_activated'))

      await user.clear(box)
      await user.type(box, 'halt')
      await waitFor(() => expect(seen.history.at(-1)?.get('search')).toBe('halt'))
    })

    it('says so when no state changes are recorded', async () => {
      serve(testTenantBilling, { history: () => listPage([]) })
      renderAppAt(BILLING)
      expect(await screen.findByText('No state changes recorded.')).toBeInTheDocument()
    })
  })

  describe('the provider events list', () => {
    it('lists each event with its status and error', async () => {
      serve()
      renderAppAt(BILLING)
      const table = await screen.findByRole('table', { name: 'Provider events' })
      const failed = within(table).getByText('subscription.activated').closest('tr')!
      expect(within(failed).getByText('Failed')).toHaveAttribute('data-tone', 'destructive')
      expect(within(failed).getByText('Provider timed out on every retry')).toHaveClass(
        'text-destructive'
      )
      expect(within(failed).getByText('Gave up')).toBeInTheDocument()
      expect(within(failed).queryByText('Not yet')).toBeNull()
      // A processed event has no error: a dash on screen, "None" for a screen reader.
      const processed = within(table).getByText('subscription.charged').closest('tr')!
      expect(within(processed).getByText('None')).toHaveClass('sr-only')
      expect(within(processed).getByText('—')).toHaveAttribute('aria-hidden', 'true')
    })

    it('says a pending event is not handled yet, and an unused event’s reason is not an error', async () => {
      serve(testTenantBilling, {
        events: () =>
          listPage([
            {
              ...testBillingEvents[0]!,
              id: 'e-pending',
              type: 'payment.captured',
              status: 'pending',
              processedAt: null,
              recordedOutcomes: 0,
            },
            {
              ...testBillingEvents[0]!,
              id: 'e-unused',
              type: 'subscription.updated',
              status: 'unused',
              error: 'payments_off',
            },
          ]),
      })
      renderAppAt(BILLING)
      const table = await screen.findByRole('table', { name: 'Provider events' })
      const pending = within(table).getByText('payment.captured').closest('tr')!
      expect(within(pending).getByText('Waiting')).toBeInTheDocument()
      expect(within(pending).getByText('Not yet')).toBeInTheDocument()
      const unused = within(table).getByText('subscription.updated').closest('tr')!
      expect(within(unused).getByText('payments_off')).not.toHaveClass('text-destructive')
      expect(within(unused).getByText('payments_off')).toHaveClass('text-muted-foreground')
    })

    it('sends its search, status filter and sort, and pages with the cursor', async () => {
      const seen = serve()
      const user = userEvent.setup()
      const router = renderAppAt(BILLING)
      const table = await screen.findByRole('table', { name: 'Provider events' })

      await user.type(screen.getByRole('searchbox', { name: 'Search provider events' }), 'charged')
      await waitFor(() => expect(seen.events.at(-1)?.get('search')).toBe('charged'))

      await user.click(screen.getByRole('button', { name: 'Filter by status, Provider events' }))
      const popup = await screen.findByRole('dialog', {
        name: 'Filter by status, Provider events',
      })
      await user.click(within(popup).getByRole('checkbox', { name: 'Failed' }))
      await user.click(within(popup).getByRole('checkbox', { name: 'Waiting' }))
      await waitFor(() => expect(seen.events.at(-1)?.get('status')).toBe('failed,pending'))
      await user.keyboard('{Escape}')

      await user.click(within(table).getByRole('button', { name: /^Received/ }))
      await waitFor(() => expect(seen.events.at(-1)?.get('sort')).toBe('at'))

      const nav = screen.getByRole('navigation', { name: 'Provider events pagination' })
      await user.click(within(nav).getByRole('button', { name: 'Next page' }))
      await waitFor(() => expect(seen.events.at(-1)?.get('cursor')).toBe('c2'))
      expect(router.state.location.search).toMatchObject({
        eventsSearch: 'charged',
        eventsStatus: 'failed,pending',
        eventsSort: 'at',
        eventsCursor: 'c2',
      })
    })

    it('says so when the provider sent no events for the tenant', async () => {
      serve(testTenantBilling, { events: () => listPage([]) })
      renderAppAt(BILLING)
      expect(
        await screen.findByText('No payment provider events for this tenant.')
      ).toBeInTheDocument()
    })
  })

  describe('the subscriptions list', () => {
    it('sends its search, provider and mode filters and sort, and pages with the cursor', async () => {
      const seen = serve()
      const user = userEvent.setup()
      const router = renderAppAt(BILLING)
      const table = await screen.findByRole('table', { name: 'Subscriptions' })
      expect(within(table).getByText('sub_TestActive0001')).toBeInTheDocument()
      expect(within(table).getByText('Current')).toHaveAttribute('data-tone', 'success')

      await user.type(screen.getByRole('searchbox', { name: 'Search subscriptions' }), 'sub_')
      await waitFor(() => expect(seen.subscriptions.at(-1)?.get('search')).toBe('sub_'))

      await user.click(screen.getByRole('button', { name: 'Filter by provider, Subscriptions' }))
      let popup = await screen.findByRole('dialog', { name: 'Filter by provider, Subscriptions' })
      await user.click(within(popup).getByRole('checkbox', { name: 'Razorpay' }))
      await waitFor(() => expect(seen.subscriptions.at(-1)?.get('provider')).toBe('razorpay'))
      await user.keyboard('{Escape}')

      await user.click(screen.getByRole('button', { name: 'Filter by mode, Subscriptions' }))
      popup = await screen.findByRole('dialog', { name: 'Filter by mode, Subscriptions' })
      await user.click(within(popup).getByRole('checkbox', { name: 'Live' }))
      await waitFor(() => expect(seen.subscriptions.at(-1)?.get('mode')).toBe('live'))
      await user.keyboard('{Escape}')

      await user.click(within(table).getByRole('button', { name: /^First seen/ }))
      await waitFor(() => expect(seen.subscriptions.at(-1)?.get('sort')).toBe('firstSeen'))

      const nav = screen.getByRole('navigation', { name: 'Subscriptions pagination' })
      await user.click(within(nav).getByRole('button', { name: 'Next page' }))
      await waitFor(() => expect(seen.subscriptions.at(-1)?.get('cursor')).toBe('c2'))
      expect(router.state.location.search).toMatchObject({
        subscriptionsProvider: 'razorpay',
        subscriptionsMode: 'live',
        subscriptionsSort: 'firstSeen',
        subscriptionsCursor: 'c2',
      })
    })

    it('says so when the tenant held no subscription', async () => {
      serve(testTenantBilling, { subscriptions: () => listPage([]) })
      renderAppAt(BILLING)
      expect(await screen.findByText('No subscriptions recorded.')).toBeInTheDocument()
    })
  })

  describe('the invoices list', () => {
    it('lists each invoice, and loads more with only the cursor and status', async () => {
      const seen = serve(testTenantBilling, {
        invoices: (params) =>
          params.has('cursor')
            ? listPage([{ ...testInvoices[0]!, id: 'inv_TestPaid0000' }], { hasPrev: true })
            : listPage(testInvoices, { nextCursor: 'c2', hasNext: true }),
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const table = await screen.findByRole('table', { name: 'Invoices' })
      const cells = within(within(table).getAllByRole('row')[1]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
      expect(cells.slice(0, 4)).toEqual(['inv_TestPaid0001', 'sub_TestActive0001', '₹999', 'Paid'])
      expect([...(seen.invoices[0]?.keys() ?? [])]).toEqual([])

      await user.click(screen.getByRole('button', { name: 'Filter by status, Invoices' }))
      const popup = await screen.findByRole('dialog', { name: 'Filter by status, Invoices' })
      await user.click(within(popup).getByRole('checkbox', { name: 'Paid' }))
      await waitFor(() => expect(seen.invoices.at(-1)?.get('status')).toBe('paid'))
      await user.keyboard('{Escape}')

      await user.click(await screen.findByRole('button', { name: 'Load more invoices' }))
      expect(await screen.findByText('inv_TestPaid0000')).toBeInTheDocument()
      expect(Object.fromEntries(seen.invoices.at(-1) ?? [])).toEqual({
        cursor: 'c2',
        status: 'paid',
      })
      expect(
        within(screen.getByRole('table', { name: 'Invoices' })).getByText('inv_TestPaid0001')
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Load more invoices' })).toBeNull()
      // The button went with the last page while it held focus: focus is on the card's heading, not <body>.
      expect(screen.getByRole('heading', { name: 'Invoices', level: 2 })).toHaveFocus()
      expect(screen.queryByRole('searchbox', { name: /invoices/i })).toBeNull()
    })

    it('keeps Load more focusable and marked busy while the next page loads', async () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      serve(testTenantBilling)
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing/invoices`, async ({ request }) => {
          if (!new URL(request.url).searchParams.has('cursor')) {
            return ok(listPage(testInvoices, { nextCursor: 'c2', hasNext: true }), 'ok')
          }
          await gate
          return ok(listPage([], { hasPrev: true }), 'ok')
        })
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await user.click(await screen.findByRole('button', { name: 'Load more invoices' }))
      const busy = await screen.findByRole('button', { name: 'Loading invoices…' })
      expect(busy).toHaveAttribute('aria-disabled', 'true')
      expect(busy).not.toBeDisabled()
      expect(busy).toHaveFocus()
      release()
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Invoices', level: 2 })).toHaveFocus()
      )
    })

    it('offers more on an empty page while the provider has more, and never says none', async () => {
      serve(testTenantBilling, {
        invoices: (params) =>
          params.has('cursor')
            ? listPage(testInvoices, { hasPrev: true })
            : listPage([], { nextCursor: 'c2', hasNext: true }),
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect(
        await screen.findByText(
          'This page had no invoices, and more remain. Select Load more invoices to read the next page.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByText('No invoices for this tenant.')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Load more invoices' }))
      expect(await screen.findByRole('table', { name: 'Invoices' })).toBeInTheDocument()
    })

    it('shows the provider’s refusal with a retry when the first page fails', async () => {
      const seen = serve()
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing/invoices`, ({ request }) => {
          seen.invoices.push(new URL(request.url).searchParams)
          return seen.invoices.length <= 2
            ? fail(
                'Razorpay didn’t answer. Try again in a minute.',
                503,
                'PAYMENT_PROVIDER_UNAVAILABLE'
              )
            : ok(listPage(testInvoices), 'ok')
        })
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect(
        await screen.findByText('Razorpay didn’t answer. Try again in a minute.')
      ).toBeInTheDocument()
      expect(screen.getByRole('table', { name: 'Subscriptions' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('table', { name: 'Invoices' })).toBeInTheDocument()
    })

    it('keeps the loaded invoices and offers a retry when Load more fails', async () => {
      const seen = serve()
      // Two failures: a list read is tried once more before it fails.
      let failures = 2
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing/invoices`, ({ request }) => {
          const params = new URL(request.url).searchParams
          seen.invoices.push(params)
          if (!params.has('cursor')) {
            return ok(listPage(testInvoices, { nextCursor: 'c2', hasNext: true }), 'ok')
          }
          if (failures > 0) {
            failures -= 1
            return fail(
              'Razorpay didn’t answer. Try again in a minute.',
              503,
              'PAYMENT_PROVIDER_UNAVAILABLE'
            )
          }
          return ok(
            listPage([{ ...testInvoices[0]!, id: 'inv_TestPaid0000' }], { hasPrev: true }),
            'ok'
          )
        })
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await user.click(await screen.findByRole('button', { name: 'Load more invoices' }))
      expect(
        await screen.findByText('Razorpay didn’t answer. Try again in a minute.')
      ).toBeInTheDocument()
      expect(
        within(screen.getByRole('table', { name: 'Invoices' })).getByText('inv_TestPaid0001')
      ).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('inv_TestPaid0000')).toBeInTheDocument()
      expect(seen.invoices.at(-1)?.get('cursor')).toBe('c2')
    })

    it('says the tenant has no invoices once the provider has no more', async () => {
      serve(testTenantBilling, { invoices: () => listPage([]) })
      renderAppAt(BILLING)
      expect(await screen.findByText('No invoices for this tenant.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Load more invoices' })).toBeNull()
    })

    it('starts again from the newest when the provider refuses the cursor', async () => {
      const seen = serve(testTenantBilling, {
        invoices: () => listPage(testInvoices, { nextCursor: 'c2', hasNext: true }),
      })
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing/invoices`, ({ request }) => {
          const params = new URL(request.url).searchParams
          seen.invoices.push(params)
          return params.has('cursor')
            ? fail('Cursor is invalid.', 400, 'CURSOR_INVALID')
            : ok(listPage(testInvoices, { nextCursor: 'c2', hasNext: true }), 'ok')
        })
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await user.click(await screen.findByRole('button', { name: 'Load more invoices' }))
      expect(
        await screen.findByText(
          /^These invoices are out of date\. The tenant’s subscriptions changed, or payments were turned off on this server\./
        )
      ).toBeInTheDocument()
      const before = seen.invoices.length
      await user.click(screen.getByRole('button', { name: 'Start again from the newest' }))
      await waitFor(() => expect(seen.invoices.length).toBeGreaterThan(before))
      expect(seen.invoices.at(-1)?.has('cursor')).toBe(false)
      expect(screen.getByRole('heading', { name: 'Invoices', level: 2 })).toHaveFocus()
      expect(await screen.findByRole('button', { name: 'Load more invoices' })).toBeInTheDocument()
    })

    it('reads the billing again on Start again, so payments turned off show as off', async () => {
      const seen = serve()
      let billingReads = 0
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing`, () => {
          billingReads += 1
          return ok(
            { ...testTenantBilling, paymentsEnabled: billingReads === 1 },
            'Billing retrieved.'
          )
        }),
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/billing/invoices`, ({ request }) => {
          const params = new URL(request.url).searchParams
          seen.invoices.push(params)
          return params.has('cursor')
            ? fail('Cursor is invalid.', 400, 'CURSOR_INVALID')
            : ok(listPage(testInvoices, { nextCursor: 'c2', hasNext: true }), 'ok')
        })
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await user.click(await screen.findByRole('button', { name: 'Load more invoices' }))
      await user.click(await screen.findByRole('button', { name: 'Start again from the newest' }))
      expect(
        await screen.findByText(
          'Payments are off on this server, so we can’t read invoices from the payment provider.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByText('No invoices for this tenant.')).toBeNull()
    })
  })
})
