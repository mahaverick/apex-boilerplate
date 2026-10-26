import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePaletteRegistry } from '@/components/shared/command-palette/palette-registry'
import { billingDate } from '@/constants/billing-labels'
import type { MembershipRole } from '@/constants/roles'
import { toast } from '@/lib/toast'
import * as analytics from '@/observability/telemetry'
import { endOfDay, localDate } from '@/schemas/billing.schemas'
import { testFreeTenantBilling, testPlans, testTenantBilling } from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp } from '@/tests/mocks/step-up'
import { REAUTH_REQUIRED, type PlatformTenantDetail } from '@/types/api.types'
import type { StaffTenantBilling } from '@/types/billing.types'

const BILLING = `/tenants/${TENANT_ID}/billing`
const BASE = `/api/v1/platform/tenants/${TENANT_ID}/billing`
const DAY_MS = 24 * 60 * 60 * 1000
/** A paid period that ended yesterday: inside express's 3-day buffer, so the tenant is still served as `active`. */
const ENDED_IN_BUFFER = new Date(Date.now() - DAY_MS).toISOString()
/** A paid period that ended 5 days ago: past the buffer, where express serves the tenant as `free`. */
const ENDED_PAST_BUFFER = new Date(Date.now() - 5 * DAY_MS).toISOString()
const GRANT_ID = testTenantBilling.grants[0]!.id

/**
 * Acme's platform detail.
 * @param overrides - What the test is about.
 */
function detail(overrides: Partial<PlatformTenantDetail> = {}): PlatformTenantDetail {
  return {
    id: TENANT_ID,
    name: 'Acme Corp',
    slug: 'acme',
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
    ...overrides,
  }
}

/**
 * Acme's detail and billing, the plans, and empty billing lists.
 * @param billing - The billing view to serve.
 * @param tenant - Acme's detail.
 */
function serve(
  billing: StaffTenantBilling = testTenantBilling,
  tenant: PlatformTenantDetail = detail()
) {
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(tenant, 'Tenant retrieved.')),
    http.get(BASE, () => ok(billing, 'Billing retrieved.')),
    http.get('/api/v1/platform/plans', () => ok(testPlans, 'Plans retrieved.')),
    ...['history', 'events', 'subscriptions', 'invoices'].map((name) =>
      http.get(`${BASE}/${name}`, () => ok(listPage([]), 'ok'))
    )
  )
}

/**
 * Records each body posted to `path`; the first is refused for a stale
 * sign-in, so the write runs through step-up, and the retry answers `view`.
 * @param path - The route under the tenant's billing.
 * @param view - The billing view the retry answers.
 */
function recordWrite(path: string, view: StaffTenantBilling): unknown[] {
  const bodies: unknown[] = []
  server.use(
    http.post(`${BASE}/${path}`, async ({ request }) => {
      bodies.push(await request.json())
      return bodies.length === 1
        ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        : ok(view, 'Done.')
    })
  )
  return bodies
}

/** Opens the Billing card's actions menu and returns its item names. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Billing actions' }))
  const menu = await screen.findByRole('menu')
  return {
    menu,
    names: within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  }
}

/**
 * Opens one action's dialog from the menu.
 * @param user - The test's user-event instance.
 * @param item - The menu item.
 */
async function openAction(user: ReturnType<typeof userEvent.setup>, item: string) {
  const { menu } = await openMenu(user)
  await user.click(within(menu).getByRole('menuitem', { name: item }))
}

/** A trialing tenant whose trial runs to 15 Jan 2099. */
const TRIALING: StaffTenantBilling = {
  ...testTenantBilling,
  state: 'trialing',
  price: null,
  interval: null,
  trialEndsAt: '2099-01-15T00:00:00.000Z',
  currentPeriodEnd: null,
  providerSubscriptionId: null,
}

describe('billing actions', () => {
  let success: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
    success = vi.spyOn(toast, 'success')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('who sees what', () => {
    it('shows a viewer no billing actions', async () => {
      signIn({ ...testUser, platformRole: 'viewer' })
      serve()
      renderAppAt(BILLING)
      await screen.findByRole('table', { name: 'Grants' })
      expect(screen.queryByRole('button', { name: 'Billing actions' })).toBeNull()
      expect(screen.queryByRole('button', { name: /revoke/i })).toBeNull()
    })

    it.each<[MembershipRole, string[]]>([
      ['manager', ['Resync billing', 'Add grant']],
      ['admin', ['Resync billing', 'Add grant', 'Cancel subscription']],
      ['owner', ['Resync billing', 'Add grant', 'Cancel subscription']],
    ])('gives a %s on a paying tenant %j', async (role, names) => {
      signIn({ ...testUser, platformRole: role })
      serve()
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).toEqual(names)
      expect(screen.getByRole('button', { name: 'Revoke the Members grant' })).toBeInTheDocument()
    })

    it('hides Cancel subscription from a manager', async () => {
      signIn({ ...testUser, platformRole: 'manager' })
      serve()
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).not.toContain('Cancel subscription')
    })

    it('offers Extend trial on a trialing tenant, and no Cancel for a checkout that is only pending', async () => {
      serve({ ...TRIALING, pendingSubscriptionId: 'sub_TestPending0001' })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).toEqual(['Resync billing', 'Extend trial', 'Add grant'])
    })

    it('offers Cancel on a trialing tenant that holds a next subscription', async () => {
      serve({ ...TRIALING, nextSubscriptionId: 'sub_TestNext0001' })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).toContain('Cancel subscription')
    })

    it('hides Cancel on a Free tenant that once paid, though it keeps the old subscription id', async () => {
      serve({
        ...testFreeTenantBilling,
        providerSubscriptionId: 'sub_TestActive0001',
        currentPeriodEnd: '2026-01-10T00:00:00.000Z',
        cancelAtPeriodEnd: true,
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).toEqual(['Resync billing', 'Extend trial', 'Add grant'])
    })

    it('hides Cancel on a stale trialing row that still holds a subscription id', async () => {
      serve({ ...TRIALING, providerSubscriptionId: 'sub_TestActive0001' })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).not.toContain('Cancel subscription')
    })

    it('hides Cancel and Resync while payments are off, even on a paying tenant', async () => {
      serve({ ...testTenantBilling, paymentsEnabled: false })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).toEqual(['Add grant'])
    })

    it('offers Extend trial on a Free tenant', async () => {
      serve(testFreeTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).toEqual(['Resync billing', 'Extend trial', 'Add grant'])
    })

    it('hides Resync while payments are off, and Cancel with no subscription', async () => {
      serve({ ...testFreeTenantBilling, paymentsEnabled: false })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).toEqual(['Extend trial', 'Add grant'])
    })

    it('offers an archived tenant Resync, Cancel and Revoke, not Extend trial or Add grant', async () => {
      serve(testTenantBilling, detail({ lifecycleState: 'archived' }))
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).toEqual(['Resync billing', 'Cancel subscription'])
      expect(screen.getByRole('button', { name: 'Revoke the Members grant' })).toBeInTheDocument()
    })

    it('offers Revoke only on an active grant', async () => {
      serve({
        ...testTenantBilling,
        grants: [
          { ...testTenantBilling.grants[0]!, status: 'revoked', revokedAt: '2026-10-11T00:00:00Z' },
        ],
      })
      renderAppAt(BILLING)
      await screen.findByRole('table', { name: 'Grants' })
      expect(screen.queryByRole('button', { name: /revoke/i })).toBeNull()
    })

    it('offers Add grant only once the catalog has loaded', async () => {
      serve()
      server.use(
        http.get('/api/v1/platform/plans', () => fail('Internal server error', 500, 'internal'))
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await screen.findByRole('table', { name: 'Grants' })
      expect((await openMenu(user)).names).toEqual(['Resync billing', 'Cancel subscription'])
    })
  })

  describe('the palette', () => {
    /** Each command the billing actions registered, as `[label, action, timing]`. */
    function triples(): [string, string, string][] {
      return Object.entries(usePaletteRegistry.getState().sources)
        .filter(([slot]) => slot.startsWith('billing-actions#'))
        .flatMap(([, commands]) =>
          commands.map((command): [string, string, string] => [
            command.label,
            command.action,
            command.timing,
          ])
        )
    }

    it.each<[MembershipRole, StaffTenantBilling, [string, string, string][]]>([
      ['viewer', testTenantBilling, []],
      [
        'manager',
        testTenantBilling,
        [
          ['Resync billing', 'page_action_resync_billing', 'afterClose'],
          ['Add grant', 'page_action_add_grant', 'afterClose'],
        ],
      ],
      [
        'admin',
        { ...TRIALING, nextSubscriptionId: 'sub_TestNext0001' },
        [
          ['Resync billing', 'page_action_resync_billing', 'afterClose'],
          ['Extend trial', 'page_action_extend_trial', 'afterClose'],
          ['Add grant', 'page_action_add_grant', 'afterClose'],
          ['Cancel subscription', 'page_action_cancel_billing', 'afterClose'],
        ],
      ],
    ])('registers exactly the menu’s actions for a %s', async (role, billing, expected) => {
      signIn({ ...testUser, platformRole: role })
      serve(billing)
      renderAppAt(BILLING)
      await screen.findByRole('table', { name: 'Grants' })
      await waitFor(() => expect(triples()).toEqual(expected))
    })

    it('opens Extend trial from the palette, and closing it returns focus to the Billing heading', async () => {
      const track = vi.spyOn(analytics, 'track')
      serve(TRIALING)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const heading = await screen.findByRole('heading', { name: 'Billing', level: 2 })
      await user.click(await screen.findByRole('button', { name: /Search…/ }))
      const palette = await screen.findByRole('dialog', { name: 'Command palette' })
      const page = await within(palette).findByRole('group', { name: 'This page' })
      await user.click(within(page).getByRole('option', { name: 'Extend trial' }))
      const dialog = await screen.findByRole('dialog', { name: 'Extend the trial for Acme Corp' })
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
      expect(track).toHaveBeenCalledWith('command_palette_action_run', {
        action: 'page_action_extend_trial',
      })
      await user.keyboard('{Escape}')
      await waitFor(() => expect(heading).toHaveFocus())
    })
  })

  describe('resync', () => {
    it('posts the reason after the identity check', async () => {
      serve()
      const bodies = recordWrite('resync', testTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Resync billing')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Resync billing for Acme Corp?',
      })
      expect(dialog).toHaveTextContent(
        'We read this tenant’s subscriptions from Razorpay and update the plan and dates. Nothing is charged.'
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Owner says they paid')
      await user.click(within(dialog).getByRole('button', { name: 'Resync' }))
      await confirmStepUp(user)
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith('Billing for Acme Corp matches Razorpay.')
      )
      expect(bodies).toEqual([
        { reason: 'Owner says they paid' },
        { reason: 'Owner says they paid' },
      ])
    })

    it('names the payment provider, not Razorpay, for another provider', async () => {
      serve({ ...testTenantBilling, provider: 'fake' })
      recordWrite('resync', { ...testTenantBilling, provider: 'fake' })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Resync billing')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Resync billing for Acme Corp?',
      })
      expect(dialog).toHaveTextContent(
        'We read this tenant’s subscriptions from the payment provider and update the plan and dates.'
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Check')
      await user.click(within(dialog).getByRole('button', { name: 'Resync' }))
      await confirmStepUp(user)
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith('Billing for Acme Corp matches the payment provider.')
      )
    })
  })

  describe('extend trial', () => {
    it('posts the days and reason after the identity check, and says when the trial ends', async () => {
      serve(TRIALING)
      const bodies = recordWrite('extend-trial', {
        ...TRIALING,
        trialEndsAt: '2099-01-25T00:00:00.000Z',
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Extend trial')
      const dialog = await screen.findByRole('dialog', { name: 'Extend the trial for Acme Corp' })
      const days = within(dialog).getByLabelText('Days to add')
      expect(days).toHaveValue('7')
      expect(days).toHaveAttribute('inputmode', 'numeric')
      expect(dialog).toHaveTextContent(
        `Trial now ends on ${billingDate('2099-01-15T00:00:00.000Z')}. After this it ends on ${billingDate('2099-01-22T00:00:00.000Z')}.`
      )
      expect(dialog).toHaveTextContent('Recorded in the audit log with your name.')
      await user.clear(days)
      expect(dialog).toHaveTextContent(
        `Trial now ends on ${billingDate('2099-01-15T00:00:00.000Z')}.`
      )
      expect(dialog).not.toHaveTextContent('After this')
      await user.type(days, '10')
      expect(dialog).toHaveTextContent(
        `After this it ends on ${billingDate('2099-01-25T00:00:00.000Z')}.`
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Pilot runs long')
      await user.click(within(dialog).getByRole('button', { name: 'Extend trial' }))
      await confirmStepUp(user)
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith(
          `Trial for Acme Corp ends on ${billingDate('2099-01-25T00:00:00.000Z')}.`
        )
      )
      expect(bodies).toEqual([
        { days: 10, reason: 'Pilot runs long' },
        { days: 10, reason: 'Pilot runs long' },
      ])
    })

    /**
     * Whether the dialog shows `line(at)` for a clock read near now: the
     * shared clock may lag the test's by up to a tick.
     */
    function showsNear(dialog: HTMLElement, line: (at: number) => string): boolean {
      const before = Date.now()
      const text = dialog.textContent ?? ''
      return [before - 60_000, before, before + 60_000].some((at) => text.includes(line(at)))
    }

    /** The day a 7-day trial started at `at` ends. */
    const weekFrom = (at: number) => billingDate(new Date(at + 7 * DAY_MS).toISOString())

    it('says a Free tenant starts a trial now', async () => {
      serve(testFreeTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Extend trial')
      const dialog = await screen.findByRole('dialog', { name: 'Extend the trial for Acme Corp' })
      expect(
        showsNear(
          dialog,
          (at) => `Acme Corp is on Free. This starts a Paid trial that ends on ${weekFrom(at)}.`
        )
      ).toBe(true)
      expect(dialog).not.toHaveTextContent('After this')
      await user.clear(within(dialog).getByLabelText('Days to add'))
      expect(within(dialog).getByText('Acme Corp is on Free.')).toBeInTheDocument()
    })

    it('says when a lapsed trial ended, and that a new one starts now', async () => {
      serve({ ...TRIALING, trialEndsAt: '2026-01-15T00:00:00.000Z' })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Extend trial')
      const dialog = await screen.findByRole('dialog', { name: 'Extend the trial for Acme Corp' })
      const ended = `Acme Corp’s trial ended on ${billingDate('2026-01-15T00:00:00.000Z')}.`
      expect(
        showsNear(
          dialog,
          (at) => `${ended} This starts a new Paid trial that ends on ${weekFrom(at)}.`
        )
      ).toBe(true)
      expect(dialog).not.toHaveTextContent('is on Free')
      await user.clear(within(dialog).getByLabelText('Days to add'))
      expect(within(dialog).getByText(ended)).toBeInTheDocument()
    })

    it('refuses days outside 1–90 before posting', async () => {
      serve(TRIALING)
      const bodies = recordWrite('extend-trial', TRIALING)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Extend trial')
      const dialog = await screen.findByRole('dialog', { name: 'Extend the trial for Acme Corp' })
      const days = within(dialog).getByLabelText('Days to add')
      await user.clear(days)
      await user.type(days, '91')
      await user.type(within(dialog).getByLabelText('Reason'), 'Too long')
      await user.click(within(dialog).getByRole('button', { name: 'Extend trial' }))
      expect(
        await within(dialog).findByText('Enter a whole number of days from 1 to 90.')
      ).toBeInTheDocument()
      expect(bodies).toEqual([])
    })

    it('shows the API sentence when the trial can’t be extended', async () => {
      serve(TRIALING)
      server.use(
        http.post(`${BASE}/extend-trial`, () =>
          fail(
            'This tenant pays for Paid, so it has no trial to extend. Add a grant to give it more.',
            409,
            'TRIAL_NOT_EXTENDABLE'
          )
        )
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Extend trial')
      const dialog = await screen.findByRole('dialog', { name: 'Extend the trial for Acme Corp' })
      await user.type(within(dialog).getByLabelText('Reason'), 'Pilot')
      await user.click(within(dialog).getByRole('button', { name: 'Extend trial' }))
      expect(
        await within(dialog).findByText(
          'This tenant pays for Paid, so it has no trial to extend. Add a grant to give it more.'
        )
      ).toBeInTheDocument()
      expect(success).not.toHaveBeenCalled()
    })
  })

  describe('add grant', () => {
    /** Opens Add grant and picks `label` from the select. */
    async function openGrant(user: ReturnType<typeof userEvent.setup>, label: string) {
      await openAction(user, 'Add grant')
      const dialog = await screen.findByRole('dialog', { name: 'Add a grant for Acme Corp' })
      await user.click(within(dialog).getByRole('combobox', { name: 'Limit or feature' }))
      await user.click(await screen.findByRole('option', { name: label }))
      return dialog
    }

    it('posts the limit, its end and the reason after the identity check', async () => {
      serve()
      const bodies = recordWrite('grants', testTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const dialog = await openGrant(user, 'Members')
      const endsOn = within(dialog).getByLabelText('Ends on (optional)')
      expect(endsOn).toHaveAttribute('type', 'date')
      expect(endsOn).toHaveAttribute('min', localDate(new Date()))
      expect(endsOn).toHaveAttribute('max', '2099-12-31')
      expect(dialog).toHaveTextContent(
        'Empty means no end date. A date ends the grant at the end of that day, your time.'
      )
      expect(dialog).toHaveTextContent('Recorded in the audit log with your name.')
      await user.type(within(dialog).getByLabelText('New limit'), '25')
      await user.type(endsOn, '2099-06-30')
      await user.type(within(dialog).getByLabelText('Reason'), 'Pilot with a large team')
      await user.click(within(dialog).getByRole('button', { name: 'Add grant' }))
      await confirmStepUp(user)
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith('Members grant added for Acme Corp.')
      )
      const body = {
        key: 'members',
        value: 25,
        expiresAt: endOfDay('2099-06-30').toISOString(),
        reason: 'Pilot with a large team',
      }
      expect(bodies).toEqual([body, body])
    })

    it('sends expiresAt as the end of the chosen day, and No limit as null', async () => {
      serve()
      const bodies = recordWrite('grants', testTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const dialog = await openGrant(user, 'Members')
      await user.click(within(dialog).getByRole('checkbox', { name: 'No limit' }))
      expect(within(dialog).getByLabelText('New limit')).toBeDisabled()
      await user.type(within(dialog).getByLabelText('Ends on (optional)'), '2099-03-01')
      await user.type(within(dialog).getByLabelText('Reason'), 'Unlimited pilot')
      await user.click(within(dialog).getByRole('button', { name: 'Add grant' }))
      await confirmStepUp(user)
      await waitFor(() => expect(bodies).toHaveLength(2))
      expect(bodies[1]).toEqual({
        key: 'members',
        value: null,
        expiresAt: new Date(2099, 2, 1, 23, 59, 59, 999).toISOString(),
        reason: 'Unlimited pilot',
      })
    })

    it('turns a feature on, with no value to enter', async () => {
      serve()
      const bodies = recordWrite('grants', testTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const dialog = await openGrant(user, 'Workspace insights')
      expect(dialog).toHaveTextContent('Turns Workspace insights on.')
      expect(within(dialog).queryByLabelText('New limit')).toBeNull()
      await user.type(within(dialog).getByLabelText('Reason'), 'Trial of insights')
      await user.click(within(dialog).getByRole('button', { name: 'Add grant' }))
      await confirmStepUp(user)
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith('Workspace insights grant added for Acme Corp.')
      )
      expect(bodies[1]).toEqual({
        key: 'advanced_example',
        value: true,
        expiresAt: null,
        reason: 'Trial of insights',
      })
    })

    it('refuses an end date before today', async () => {
      serve()
      const bodies = recordWrite('grants', testTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const dialog = await openGrant(user, 'Members')
      const now = new Date()
      const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
      await user.type(within(dialog).getByLabelText('New limit'), '10')
      await user.type(within(dialog).getByLabelText('Ends on (optional)'), yesterday)
      await user.type(within(dialog).getByLabelText('Reason'), 'Backdated')
      await user.click(within(dialog).getByRole('button', { name: 'Add grant' }))
      expect(
        await within(dialog).findByText(
          'Choose today or a date after it, or leave it empty for no end date.'
        )
      ).toBeInTheDocument()
      expect(bodies).toEqual([])
    })

    it('refuses a limit of 0 before posting', async () => {
      serve()
      const bodies = recordWrite('grants', testTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const dialog = await openGrant(user, 'Members')
      await user.type(within(dialog).getByLabelText('New limit'), '0')
      await user.type(within(dialog).getByLabelText('Reason'), 'Zero')
      await user.click(within(dialog).getByRole('button', { name: 'Add grant' }))
      expect(
        await within(dialog).findByText(
          'Enter a whole number from 1 to 1,000,000, or choose No limit.'
        )
      ).toBeInTheDocument()
      expect(bodies).toEqual([])
    })

    it('puts the API’s value error on the value field, and its expiry error on Ends on', async () => {
      serve()
      server.use(
        http.post(`${BASE}/grants`, () =>
          HttpResponse.json(
            {
              success: false,
              message: 'Check the highlighted fields, then try again.',
              statusCode: 400,
              errors: {
                value: ['Enter a whole number from 1 to 1,000,000, or choose No limit.'],
                expiresAt: ['Choose an expiry in the future, or null for none.'],
              },
              requestId: 'test-request-id',
            },
            { status: 400 }
          )
        )
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const dialog = await openGrant(user, 'Members')
      await user.type(within(dialog).getByLabelText('New limit'), '5')
      await user.type(within(dialog).getByLabelText('Reason'), 'Pilot')
      await user.click(within(dialog).getByRole('button', { name: 'Add grant' }))
      const limit = within(dialog).getByLabelText('New limit')
      await waitFor(() => expect(limit).toHaveAttribute('aria-invalid', 'true'))
      expect(limit).toHaveAccessibleDescription(
        'Enter a whole number from 1 to 1,000,000, or choose No limit.'
      )
      expect(within(dialog).getByLabelText('Ends on (optional)')).toHaveAttribute(
        'aria-invalid',
        'true'
      )
      expect(
        within(dialog).getByText('Choose an expiry in the future, or null for none.')
      ).toBeInTheDocument()

      await user.click(within(dialog).getByRole('checkbox', { name: 'No limit' }))
      expect(
        within(dialog).queryByText('Enter a whole number from 1 to 1,000,000, or choose No limit.')
      ).toBeNull()
    })

    it('clears the API’s key and value errors when another entry is chosen', async () => {
      serve()
      server.use(
        http.post(`${BASE}/grants`, () =>
          HttpResponse.json(
            {
              success: false,
              message: 'Check the highlighted fields, then try again.',
              statusCode: 400,
              errors: {
                key: ['Choose a limit or feature this product has.'],
                value: ['Enter a whole number from 1 to 1,000,000, or choose No limit.'],
              },
              requestId: 'test-request-id',
            },
            { status: 400 }
          )
        )
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const dialog = await openGrant(user, 'Members')
      await user.type(within(dialog).getByLabelText('New limit'), '5')
      await user.type(within(dialog).getByLabelText('Reason'), 'Pilot')
      await user.click(within(dialog).getByRole('button', { name: 'Add grant' }))
      expect(
        await within(dialog).findByText('Choose a limit or feature this product has.')
      ).toBeInTheDocument()
      await user.click(within(dialog).getByRole('combobox', { name: 'Limit or feature' }))
      await user.click(await screen.findByRole('option', { name: 'Workspace insights' }))
      await user.click(within(dialog).getByRole('combobox', { name: 'Limit or feature' }))
      await user.click(await screen.findByRole('option', { name: 'Members' }))
      expect(within(dialog).queryByText('Choose a limit or feature this product has.')).toBeNull()
      expect(
        within(dialog).queryByText('Enter a whole number from 1 to 1,000,000, or choose No limit.')
      ).toBeNull()
    })
  })

  describe('revoke grant', () => {
    it('posts the reason after the identity check', async () => {
      serve()
      const bodies = recordWrite(`grants/${GRANT_ID}/revoke`, testTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await user.click(await screen.findByRole('button', { name: 'Revoke the Members grant' }))
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Revoke the Members grant for Acme Corp?',
      })
      expect(dialog).toHaveTextContent(
        'Acme Corp loses this grant at once. Its Members goes back to the plan’s value, or to another active grant’s.'
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Pilot ended')
      await user.click(within(dialog).getByRole('button', { name: 'Revoke grant' }))
      await confirmStepUp(user)
      await waitFor(() => expect(success).toHaveBeenCalledWith('Members grant revoked.'))
      expect(bodies).toEqual([{ reason: 'Pilot ended' }, { reason: 'Pilot ended' }])
    })

    it('says a feature grant’s tenant loses the feature unless its plan has it', async () => {
      serve({
        ...testTenantBilling,
        grants: [{ ...testTenantBilling.grants[0]!, key: 'advanced_example', value: true }],
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await user.click(
        await screen.findByRole('button', { name: 'Revoke the Workspace insights grant' })
      )
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Revoke the Workspace insights grant for Acme Corp?',
      })
      expect(dialog).toHaveTextContent(
        'Acme Corp loses this grant at once. It keeps Workspace insights only if its plan or another active grant turns it on.'
      )
    })

    it('shows the API sentence when the grant isn’t on this tenant any more', async () => {
      serve()
      server.use(
        http.post(`${BASE}/grants/${GRANT_ID}/revoke`, () =>
          fail(
            'We couldn’t find this grant on this tenant. Refresh the tenant’s Billing tab to see its grants.',
            404,
            'grant_not_found'
          )
        )
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await user.click(await screen.findByRole('button', { name: 'Revoke the Members grant' }))
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Revoke the Members grant for Acme Corp?',
      })
      await user.type(within(dialog).getByLabelText('Reason'), 'Pilot ended')
      await user.click(within(dialog).getByRole('button', { name: 'Revoke grant' }))
      expect(
        await within(dialog).findByText(
          'We couldn’t find this grant on this tenant. Refresh the tenant’s Billing tab to see its grants.'
        )
      ).toBeInTheDocument()
      expect(success).not.toHaveBeenCalled()
    })
  })

  describe('cancel subscription', () => {
    it('posts a cycle-end cancel after the identity check, and says when Paid ends', async () => {
      serve()
      const bodies = recordWrite('cancel', {
        ...testTenantBilling,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-12-20T00:00:00.000Z',
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      const end = billingDate('2026-11-20T00:00:00.000Z')
      expect(
        within(dialog).getByRole('radio', { name: `At the end of the paid period (${end})` })
      ).toBeChecked()
      expect(dialog).toHaveTextContent(
        `Acme Corp keeps Paid until ${end}, then moves to Free. Nothing more is charged.`
      )
      expect(within(dialog).queryByLabelText(/to confirm/)).toBeNull()
      expect(dialog).toHaveTextContent('Recorded in the audit log with your name.')
      await user.type(within(dialog).getByLabelText('Reason'), 'Customer asked')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
      await confirmStepUp(user)
      // From the answered view, not the cached period end.
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith(
          `Paid for Acme Corp ends on ${billingDate('2026-12-20T00:00:00.000Z')}.`
        )
      )
      expect(bodies).toEqual([
        { when: 'cycle_end', reason: 'Customer asked' },
        { when: 'cycle_end', reason: 'Customer asked' },
      ])
    })

    it('asks for the slug before cancelling now', async () => {
      serve()
      const bodies = recordWrite('cancel', testFreeTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      await user.click(within(dialog).getByRole('radio', { name: 'Now' }))
      expect(dialog).toHaveTextContent(
        'Acme Corp moves to Free now. Razorpay charges nothing more. Refund any unused period in the Razorpay dashboard.'
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Fraud')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
      expect(await within(dialog).findByText('Type acme exactly to confirm.')).toBeInTheDocument()
      expect(bodies).toEqual([])

      await user.type(within(dialog).getByLabelText('Type acme to confirm'), 'acme')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
      await confirmStepUp(user)
      await waitFor(() => expect(success).toHaveBeenCalledWith('Acme Corp moved to Free.'))
      expect(bodies).toEqual([
        { when: 'now', reason: 'Fraud' },
        { when: 'now', reason: 'Fraud' },
      ])
    })

    it('offers only Now when the subscription already ends at its period end', async () => {
      serve({ ...testTenantBilling, cancelAtPeriodEnd: true })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      expect(within(dialog).queryAllByRole('radio')).toHaveLength(0)
      expect(dialog).toHaveTextContent(
        `Paid already ends on ${billingDate('2026-11-20T00:00:00.000Z')}. Acme Corp moves to Free now.`
      )
      expect(within(dialog).getByLabelText('Type acme to confirm')).toBeInTheDocument()
    })

    it('names no past end date for a subscription whose period already ended', async () => {
      serve({
        ...testTenantBilling,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: ENDED_IN_BUFFER,
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      expect(dialog).not.toHaveTextContent('already ends')
      expect(dialog).toHaveTextContent('Acme Corp moves to Free now.')
    })

    it('cancels a subscription not charged yet now, and says the tenant is back on its trial', async () => {
      const deferred: StaffTenantBilling = {
        ...testTenantBilling,
        trialEndsAt: '2099-01-15T00:00:00.000Z',
        currentPeriodEnd: '2099-01-15T00:00:00.000Z',
      }
      serve(deferred)
      const bodies = recordWrite('cancel', {
        ...deferred,
        state: 'trialing',
        currentPeriodEnd: null,
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      const trialEnd = billingDate('2099-01-15T00:00:00.000Z')
      expect(within(dialog).queryAllByRole('radio')).toHaveLength(0)
      expect(dialog).toHaveTextContent(
        `Acme Corp hasn’t been charged yet. This cancels Paid now, and Acme Corp goes back to its trial, which ends on ${trialEnd}. Nothing is charged.`
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Asked to stay on trial')
      await user.type(within(dialog).getByLabelText('Type acme to confirm'), 'acme')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
      await confirmStepUp(user)
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith(
          `Acme Corp is back on its trial, which ends on ${trialEnd}.`
        )
      )
      expect(bodies[1]).toEqual({ when: 'now', reason: 'Asked to stay on trial' })
    })

    it('offers a past-due tenant only Now, with no refund line', async () => {
      serve({
        ...testTenantBilling,
        state: 'past_due',
        pastDue: { since: '2026-10-20T00:00:00.000Z', graceEndsAt: null, paused: false },
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      expect(within(dialog).queryAllByRole('radio')).toHaveLength(0)
      expect(dialog).toHaveTextContent(
        'Acme Corp moves to Free now. Razorpay charges nothing more.'
      )
      expect(dialog).not.toHaveTextContent('Refund')
    })

    it('offers to cancel only the next subscription while the current one is ending', async () => {
      const ending: StaffTenantBilling = {
        ...testTenantBilling,
        cancelAtPeriodEnd: true,
        nextSubscriptionId: 'sub_TestNext0001',
        nextSwitch: { interval: 'year', startsAt: '2026-11-20T00:00:00.000Z' },
      }
      serve(ending)
      const bodies = recordWrite('cancel', {
        ...ending,
        nextSubscriptionId: null,
        nextSwitch: null,
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      const end = billingDate('2026-11-20T00:00:00.000Z')
      expect(
        within(dialog).getByRole('radio', { name: 'Only the next subscription' })
      ).toBeChecked()
      expect(within(dialog).getByRole('radio', { name: 'Now' })).toBeInTheDocument()
      expect(dialog).toHaveTextContent(
        `Acme Corp keeps Paid until ${end}, then moves to Free. This cancels its next subscription, booked from ${end}.`
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Customer changed their mind')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
      await confirmStepUp(user)
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith('Acme Corp’s next subscription is cancelled.')
      )
      expect(bodies[1]).toEqual({ when: 'cycle_end', reason: 'Customer changed their mind' })
    })

    it('names no past end and offers no refund when the ending period is over and a next subscription is held', async () => {
      // express books the next subscription from the period's end.
      serve({
        ...testTenantBilling,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: ENDED_IN_BUFFER,
        nextSubscriptionId: 'sub_TestNext0001',
        nextSwitch: { interval: 'year', startsAt: ENDED_IN_BUFFER },
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      const ended = billingDate(ENDED_IN_BUFFER)
      expect(dialog).not.toHaveTextContent('keeps Paid until')
      const free = billingDate(new Date(Date.parse(ENDED_IN_BUFFER) + 3 * DAY_MS).toISOString())
      expect(dialog).toHaveTextContent(
        `This cancels only Acme Corp’s next subscription, booked from ${ended}. Acme Corp’s paid period ended on ${ended}, and it moves to Free on ${free}.`
      )
      await user.click(within(dialog).getByRole('radio', { name: 'Now' }))
      expect(dialog).toHaveTextContent(
        'Acme Corp moves to Free now. Razorpay charges nothing more.'
      )
      expect(dialog).not.toHaveTextContent('Refund')
    })

    it('says the tenant moves to Free three days after its period ended', async () => {
      const endedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const freeAt = new Date(Date.parse(endedAt) + 3 * 24 * 60 * 60 * 1000).toISOString()
      serve({
        ...testTenantBilling,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: endedAt,
        nextSubscriptionId: 'sub_TestNext0001',
        nextSwitch: null,
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      expect(dialog).toHaveTextContent(
        `This cancels only Acme Corp’s next subscription. Acme Corp’s paid period ended on ${billingDate(endedAt)}, and it moves to Free on ${billingDate(freeAt)}.`
      )
    })

    it('offers no refund on Now when the ending period is over', async () => {
      serve({
        ...testTenantBilling,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: ENDED_IN_BUFFER,
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      expect(dialog).toHaveTextContent('Acme Corp moves to Free now.')
      expect(dialog).not.toHaveTextContent('Refund')
    })

    it('reads a page left open past the 3-day buffer as Free, as express serves it: only the next subscription to cancel', async () => {
      serve({
        ...testTenantBilling,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: ENDED_PAST_BUFFER,
        nextSubscriptionId: 'sub_TestNext0001',
        nextSwitch: null,
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      expect(within(dialog).queryAllByRole('radio')).toHaveLength(0)
      expect(dialog).toHaveTextContent(
        'This cancels Acme Corp’s next subscription. Nothing is charged.'
      )
      expect(dialog).not.toHaveTextContent('moves to Free')
    })

    it('hides Cancel on a page left open past the 3-day buffer with no next subscription', async () => {
      serve({
        ...testTenantBilling,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: ENDED_PAST_BUFFER,
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      expect((await openMenu(user)).names).not.toContain('Cancel subscription')
    })

    it('offers only the next subscription’s cancel on a tenant express serves as Free past the buffer', async () => {
      serve({
        ...testFreeTenantBilling,
        providerSubscriptionId: 'sub_TestActive0001',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: ENDED_PAST_BUFFER,
        nextSubscriptionId: 'sub_TestNext0001',
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      expect(within(dialog).queryAllByRole('radio')).toHaveLength(0)
      expect(dialog).toHaveTextContent(
        'This cancels Acme Corp’s next subscription. Nothing is charged.'
      )
    })

    it('cancels only the next subscription when no current one is held, and says so', async () => {
      const nextOnly: StaffTenantBilling = {
        ...TRIALING,
        nextSubscriptionId: 'sub_TestNext0001',
        nextSwitch: { interval: 'year', startsAt: '2099-01-15T00:00:00.000Z' },
      }
      serve(nextOnly)
      const bodies = recordWrite('cancel', {
        ...nextOnly,
        nextSubscriptionId: null,
        nextSwitch: null,
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      expect(within(dialog).queryAllByRole('radio')).toHaveLength(0)
      expect(dialog).toHaveTextContent(
        `This cancels Acme Corp’s next subscription, booked from ${billingDate('2099-01-15T00:00:00.000Z')}. Nothing is charged.`
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Booked by mistake')
      await user.type(within(dialog).getByLabelText('Type acme to confirm'), 'acme')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
      await confirmStepUp(user)
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith('Acme Corp’s next subscription is cancelled.')
      )
      expect(bodies[1]).toEqual({ when: 'now', reason: 'Booked by mistake' })
    })

    it('says a held next subscription is cancelled too, on either choice', async () => {
      serve({
        ...testTenantBilling,
        nextSubscriptionId: 'sub_TestNext0001',
        nextSwitch: { interval: 'year', startsAt: '2026-11-20T00:00:00.000Z' },
      })
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      expect(dialog).toHaveTextContent(
        'then moves to Free. Nothing more is charged. Its next subscription is cancelled too.'
      )
      await user.click(within(dialog).getByRole('radio', { name: 'Now' }))
      expect(dialog).toHaveTextContent(
        'Refund any unused period in the Razorpay dashboard. Its next subscription is cancelled too.'
      )
    })

    it('falls back to a plain toast when the answered view shows no change it can name', async () => {
      serve()
      recordWrite('cancel', testTenantBilling)
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      await user.type(within(dialog).getByLabelText('Reason'), 'Customer asked')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
      await confirmStepUp(user)
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith('The subscription for Acme Corp is cancelled.')
      )
    })

    it('shows the API sentence when the provider refuses', async () => {
      serve()
      server.use(
        http.post(`${BASE}/cancel`, () =>
          fail(
            'This subscription already ends at its period end. Cancel it now to end it sooner.',
            409,
            'NO_SUBSCRIPTION'
          )
        )
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      await openAction(user, 'Cancel subscription')
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Cancel the subscription for Acme Corp?',
      })
      await user.type(within(dialog).getByLabelText('Reason'), 'Customer asked')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }))
      expect(
        await within(dialog).findByText(
          'This subscription already ends at its period end. Cancel it now to end it sooner.'
        )
      ).toBeInTheDocument()
    })
  })
})
