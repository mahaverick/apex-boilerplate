import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MembershipRole } from '@/constants/roles'
import { toast } from '@/lib/toast'
import { testPlans } from '@/tests/fixtures/billing'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp } from '@/tests/mocks/step-up'
import { REAUTH_REQUIRED } from '@/types/api.types'
import type { PlanChangePreview, StaffPlan, StaffPlans } from '@/types/billing.types'

const FREE = testPlans.plans[0]!
const PAID = testPlans.plans[1]!

/**
 * Serves the staff plans: `plans` for every read, or each read in turn.
 * @param plans - The answers, in order; the last repeats.
 */
function servePlans(...plans: StaffPlans[]) {
  let reads = 0
  server.use(
    http.get('/api/v1/platform/plans', () => {
      const answer = plans[Math.min(reads, plans.length - 1)] ?? testPlans
      reads += 1
      return ok(answer, 'Plans retrieved.')
    })
  )
}

/**
 * Records each preview body for `plan` and answers `preview`.
 * @param plan - The plan previewed.
 * @param preview - The answer.
 */
function recordPreview(plan: StaffPlan, preview: PlanChangePreview): unknown[] {
  const bodies: unknown[] = []
  server.use(
    http.post(`/api/v1/platform/plans/${plan.id}/preview`, async ({ request }) => {
      bodies.push(await request.json())
      return ok(preview, 'Preview ready.')
    })
  )
  return bodies
}

/**
 * Records each PATCH body for `plan`; the first is refused for a stale
 * sign-in, so the save runs through step-up, and the retry answers `answer`.
 * @param plan - The plan saved.
 * @param answer - The plan the retry answers.
 */
function recordSave(plan: StaffPlan, answer: StaffPlan): unknown[] {
  const bodies: unknown[] = []
  server.use(
    http.patch(`/api/v1/platform/plans/${plan.id}`, async ({ request }) => {
      bodies.push(await request.json())
      return bodies.length === 1
        ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        : ok(answer, 'Plan updated.')
    })
  )
  return bodies
}

/** Free's four tenants, with `changes`. */
function freePreview(changes: PlanChangePreview['changes']): PlanChangePreview {
  return { changes, affected: { trialing: 0, active: 0, past_due: 0, free: 4 } }
}

/**
 * The card for one plan, found by its heading.
 * @param name - The plan's name.
 */
async function card(name: string) {
  return screen.findByRole('region', { name })
}

/**
 * Signs in at `role` and opens the Plans page.
 * @param role - The platform role.
 */
function openPlans(role: MembershipRole = 'admin') {
  signIn({ ...testUser, platformRole: role })
  renderAppAt('/plans')
}

describe('Plans page', () => {
  let success: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    servePlans(testPlans)
    success = vi.spyOn(toast, 'success')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('who sees what', () => {
    it.each(['viewer', 'manager'] as const)(
      'shows a %s both plans read-only, with no edit controls',
      async (role) => {
        openPlans(role)
        expect(await screen.findByRole('heading', { level: 1, name: 'Plans' })).toBeInTheDocument()
        const free = await card('Free')
        expect(free).toHaveTextContent('For small teams getting started.')
        expect(free).toHaveTextContent('Members3')
        expect(free).toHaveTextContent('Workspace insightsOff')
        const paid = await card('Paid')
        expect(paid).toHaveTextContent('MembersNo limit')
        expect(paid).toHaveTextContent('Workspace insightsOn')
        expect(screen.queryByRole('textbox')).toBeNull()
        expect(screen.queryByRole('switch')).toBeNull()
        expect(screen.queryByRole('checkbox')).toBeNull()
        expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
        expect(screen.queryByRole('button', { name: 'New price' })).toBeNull()
        expect(await screen.findByRole('table', { name: 'Prices' })).toBeInTheDocument()
      }
    )

    it.each(['admin', 'owner'] as const)('gives an %s every edit control', async (role) => {
      openPlans(role)
      const free = await card('Free')
      expect(within(free).getByRole('textbox', { name: 'Name' })).toHaveValue('Free')
      expect(within(free).getByRole('textbox', { name: 'Description' })).toHaveValue(
        'For small teams getting started.'
      )
      expect(within(free).getByRole('textbox', { name: 'Members' })).toHaveValue('3')
      expect(within(free).getByRole('checkbox', { name: 'No limit' })).not.toBeChecked()
      expect(within(free).getByRole('switch', { name: 'Workspace insights' })).not.toBeChecked()
      expect(within(free).getByRole('button', { name: 'Save Free' })).toBeInTheDocument()
      const paid = await card('Paid')
      expect(within(paid).getByRole('textbox', { name: 'Members' })).toBeDisabled()
      expect(within(paid).getByRole('checkbox', { name: 'No limit' })).toBeChecked()
      expect(within(paid).getByRole('switch', { name: 'Workspace insights' })).toBeChecked()
      expect(screen.getByRole('button', { name: 'New price' })).toBeInTheDocument()
    })

    it('says the role cannot see this on a 404', async () => {
      server.use(http.get('/api/v1/platform/plans', () => fail('Not found', 404)))
      openPlans('viewer')
      expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    })

    it('counts the tenants each plan serves', async () => {
      openPlans('viewer')
      expect(await card('Free')).toHaveTextContent('4 on Free')
      expect(await card('Paid')).toHaveTextContent(
        '3 paying · 2 in trial · 1 with a failed payment'
      )
    })
  })

  describe('saving a plan', () => {
    it('saves a raised limit after one reason dialog, sending only the changed entitlement', async () => {
      const previews = recordPreview(
        FREE,
        freePreview([{ key: 'members', from: 3, to: 5, direction: 'increase' }])
      )
      const saves = recordSave(FREE, {
        ...FREE,
        version: 2,
        entitlements: { ...FREE.entitlements, members: 5 },
      })
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const members = within(free).getByRole('textbox', { name: 'Members' })
      await user.clear(members)
      await user.type(members, '5')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))

      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      expect(dialog).toHaveTextContent('4 tenants are on Free. They get these limits now.')
      await user.type(within(dialog).getByLabelText('Reason'), 'More room for small teams')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await confirmStepUp(user)
      await waitFor(() => expect(success).toHaveBeenCalledWith('Free saved.'))
      expect(previews).toEqual([{ entitlements: { members: 5 } }])
      expect(saves).toEqual([
        { version: 1, entitlements: { members: 5 }, reason: 'More room for small teams' },
        { version: 1, entitlements: { members: 5 }, reason: 'More room for small teams' },
      ])
    })

    it('saves a name change without a preview, and says where the name shows', async () => {
      const previews = recordPreview(FREE, freePreview([]))
      const saves = recordSave(FREE, { ...FREE, version: 2, name: 'Starter' })
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const name = within(free).getByRole('textbox', { name: 'Name' })
      await user.clear(name)
      await user.type(name, '  Starter ')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))

      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      expect(dialog).toHaveTextContent(
        'The new name and description show on the pricing page and in every workspace on Free now.'
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Rename')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await confirmStepUp(user)
      await waitFor(() => expect(success).toHaveBeenCalledWith('Starter saved.'))
      expect(previews).toEqual([])
      expect(saves[1]).toEqual({ version: 1, name: 'Starter', reason: 'Rename' })
    })

    it('sends No limit as null', async () => {
      recordPreview(
        FREE,
        freePreview([{ key: 'members', from: 3, to: null, direction: 'increase' }])
      )
      const saves = recordSave(FREE, { ...FREE, version: 2 })
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      await user.click(within(free).getByRole('checkbox', { name: 'No limit' }))
      expect(within(free).getByRole('textbox', { name: 'Members' })).toBeDisabled()
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'Unlimited')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await confirmStepUp(user)
      await waitFor(() => expect(saves).toHaveLength(2))
      expect(saves[1]).toEqual({ version: 1, entitlements: { members: null }, reason: 'Unlimited' })
    })

    it('asks before lowering Members from 3 to 2, names 4 tenants, and needs the second confirm', async () => {
      recordPreview(FREE, freePreview([{ key: 'members', from: 3, to: 2, direction: 'decrease' }]))
      const saves = recordSave(FREE, {
        ...FREE,
        version: 2,
        entitlements: { ...FREE.entitlements, members: 2 },
      })
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const members = within(free).getByRole('textbox', { name: 'Members' })
      await user.clear(members)
      await user.type(members, '2')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))

      const dialog = await screen.findByRole('alertdialog', { name: 'Lower limits on Free?' })
      expect(screen.queryByRole('alertdialog', { name: 'Save Free?' })).toBeNull()
      expect(dialog).toHaveTextContent('Members: 3 → 2')
      expect(dialog).toHaveTextContent(
        '4 tenants are on Free. They get the lower limits now and keep their data. A tenant over a limit can’t add more.'
      )
      expect(dialog).toHaveTextContent('Recorded in the audit log with your name.')
      await user.type(within(dialog).getByLabelText('Reason'), 'Tighter Free plan')
      await user.click(within(dialog).getByRole('button', { name: 'Lower limits' }))
      expect(
        await within(dialog).findByText('Confirm you checked the tenants this affects.')
      ).toBeInTheDocument()
      expect(saves).toEqual([])

      await user.click(
        within(dialog).getByRole('checkbox', { name: 'I checked the tenants this affects' })
      )
      await user.click(within(dialog).getByRole('button', { name: 'Lower limits' }))
      await confirmStepUp(user)
      await waitFor(() => expect(success).toHaveBeenCalledWith('Free saved.'))
      expect(saves[1]).toEqual({
        version: 1,
        entitlements: { members: 2 },
        reason: 'Tighter Free plan',
      })
    })

    it('lists a feature turned off as a decrease, worded On → Off', async () => {
      recordPreview(PAID, {
        changes: [{ key: 'advanced_example', from: true, to: false, direction: 'decrease' }],
        affected: { trialing: 2, active: 3, past_due: 1, free: 0 },
      })
      const user = userEvent.setup()
      openPlans()
      const paid = await card('Paid')
      await user.click(within(paid).getByRole('switch', { name: 'Workspace insights' }))
      await user.click(within(paid).getByRole('button', { name: 'Save Paid' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Lower limits on Paid?' })
      expect(dialog).toHaveTextContent('Workspace insights: On → Off')
      expect(dialog).toHaveTextContent('6 tenants are on Paid.')
    })

    it('says 1 tenant, not 1 tenants', async () => {
      recordPreview(FREE, {
        changes: [{ key: 'members', from: 3, to: 4, direction: 'increase' }],
        affected: { trialing: 0, active: 0, past_due: 0, free: 1 },
      })
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const members = within(free).getByRole('textbox', { name: 'Members' })
      await user.clear(members)
      await user.type(members, '4')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      expect(dialog).toHaveTextContent('1 tenant is on Free. They get these limits now.')
    })

    it('asks for a change when nothing changed, and posts nothing', async () => {
      const previews = recordPreview(FREE, freePreview([]))
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      expect(await within(free).findByText('Change a field before saving.')).toBeInTheDocument()
      expect(previews).toEqual([])
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    it('refuses a limit of 0 before the preview', async () => {
      const previews = recordPreview(FREE, freePreview([]))
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const members = within(free).getByRole('textbox', { name: 'Members' })
      await user.clear(members)
      await user.type(members, '0')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      expect(
        await within(free).findByText(
          'Members: enter a whole number from 1 to 1,000,000, or choose No limit.'
        )
      ).toBeInTheDocument()
      expect(previews).toEqual([])
    })

    it('stops when the preview fails, and opens no dialog', async () => {
      server.use(
        http.post(`/api/v1/platform/plans/${FREE.id}/preview`, () =>
          fail('Something went wrong on our side.', 500)
        )
      )
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const members = within(free).getByRole('textbox', { name: 'Members' })
      await user.clear(members)
      await user.type(members, '2')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      expect(await within(free).findByText('Something went wrong on our side.')).toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    it('puts the API’s entitlement error under its switch, and clears it when the switch changes', async () => {
      server.use(
        http.post(`/api/v1/platform/plans/${FREE.id}/preview`, () =>
          HttpResponse.json(
            {
              success: false,
              message: 'Check the highlighted fields, then try again.',
              statusCode: 400,
              errors: {
                entitlements: ['Workspace insights: send true to include the feature or false.'],
              },
              requestId: 'test-request-id',
            },
            { status: 400 }
          )
        )
      )
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const insights = within(free).getByRole('switch', { name: 'Workspace insights' })
      await user.click(insights)
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const message = 'Workspace insights: send true to include the feature or false.'
      expect(await within(free).findByText(message)).toBeInTheDocument()
      await waitFor(() => expect(insights).toHaveAttribute('aria-invalid', 'true'))
      await user.click(insights)
      await waitFor(() => expect(within(free).queryByText(message)).toBeNull())
    })

    it('keeps typed values after another staff member saves first, and loads theirs elsewhere', async () => {
      const theirs: StaffPlan = {
        ...FREE,
        version: 2,
        description: 'Their new description.',
        entitlements: { ...FREE.entitlements, members: 5 },
      }
      servePlans(testPlans, { ...testPlans, plans: [theirs, PAID] })
      const saves: unknown[] = []
      server.use(
        http.patch(`/api/v1/platform/plans/${FREE.id}`, async ({ request }) => {
          saves.push(await request.json())
          return saves.length === 1
            ? fail(
                'Someone changed the plan after you opened this page. Reload it, then try again.',
                409,
                'PLAN_VERSION_CONFLICT'
              )
            : ok({ ...theirs, version: 3, name: 'Starter' }, 'Plan updated.')
        })
      )
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const name = within(free).getByRole('textbox', { name: 'Name' })
      await user.clear(name)
      await user.type(name, 'Starter')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      let dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'Rename')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      expect(
        await within(free).findByText(
          'Another staff member changed this plan. Review the latest values and save again.'
        )
      ).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(name).toHaveValue('Starter')
      await waitFor(() =>
        expect(within(free).getByRole('textbox', { name: 'Members' })).toHaveValue('5')
      )
      expect(within(free).getByRole('textbox', { name: 'Description' })).toHaveValue(
        'Their new description.'
      )

      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'Rename')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(success).toHaveBeenCalledWith('Starter saved.'))
      expect(saves[1]).toEqual({ version: 2, name: 'Starter', reason: 'Rename' })
    })
  })

  describe('prices', () => {
    it('lists Paid’s prices, and no prices card for Free', async () => {
      openPlans('viewer')
      const table = await screen.findByRole('table', { name: 'Prices' })
      expect(within(table).getByRole('row', { name: /Monthly ₹999 Active 2/ })).toBeInTheDocument()
      expect(within(table).getByRole('row', { name: /Yearly ₹9,990 Active 1/ })).toBeInTheDocument()
      expect(screen.getAllByRole('table', { name: 'Prices' })).toHaveLength(1)
    })

    /** Opens the New price dialog as an admin. */
    async function openNewPrice(user: ReturnType<typeof userEvent.setup>) {
      openPlans()
      await user.click(await screen.findByRole('button', { name: 'New price' }))
      return screen.findByRole('dialog', { name: 'New price for Paid' })
    }

    it('warns above the API’s price threshold, and not at it', async () => {
      const user = userEvent.setup()
      const dialog = await openNewPrice(user)
      const amount = within(dialog).getByRole('textbox', { name: 'Amount in rupees' })
      await user.type(amount, '15000')
      expect(dialog).toHaveTextContent('New subscribers pay ₹15,000.')
      expect(within(dialog).queryByText(/need the customer to approve/)).toBeNull()
      await user.clear(amount)
      await user.type(amount, '15001')
      expect(
        await within(dialog).findByText(
          'Charges above ₹15,000 need the customer to approve each payment. Keep yearly prices at ₹15,000 or less.'
        )
      ).toBeInTheDocument()
    })

    it('sends amountMinor in paise for the chosen interval, says who pays what, and confirms', async () => {
      const bodies: unknown[] = []
      server.use(
        http.post(`/api/v1/platform/plans/${PAID.id}/prices`, async ({ request }) => {
          bodies.push(await request.json())
          return bodies.length === 1
            ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
            : ok(PAID, 'Price created.')
        })
      )
      const user = userEvent.setup()
      const dialog = await openNewPrice(user)
      await user.click(within(dialog).getByRole('combobox', { name: 'Interval' }))
      await user.click(await screen.findByRole('option', { name: 'Yearly' }))
      await user.type(within(dialog).getByRole('textbox', { name: 'Amount in rupees' }), '12000')
      expect(dialog).toHaveTextContent(
        'Existing subscribers keep ₹9,990. New subscribers pay ₹12,000.'
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Yearly repricing')
      await user.click(within(dialog).getByRole('button', { name: 'Add price' }))
      await confirmStepUp(user)
      await waitFor(() => expect(success).toHaveBeenCalledWith('New yearly price: ₹12,000.'))
      expect(bodies[1]).toEqual({
        interval: 'year',
        amountMinor: 1_200_000,
        reason: 'Yearly repricing',
      })
    })

    it('says only what new subscribers pay when the interval has no active price', async () => {
      servePlans({
        ...testPlans,
        plans: [
          FREE,
          { ...PAID, prices: PAID.prices.filter((price) => price.interval === 'month') },
        ],
      })
      const user = userEvent.setup()
      const dialog = await openNewPrice(user)
      await user.click(within(dialog).getByRole('combobox', { name: 'Interval' }))
      await user.click(await screen.findByRole('option', { name: 'Yearly' }))
      await user.type(within(dialog).getByRole('textbox', { name: 'Amount in rupees' }), '9000')
      expect(dialog).toHaveTextContent('New subscribers pay ₹9,000.')
      expect(dialog).not.toHaveTextContent('Existing subscribers')
    })

    it('refuses ₹0 and a fraction of a rupee before posting', async () => {
      let posts = 0
      server.use(
        http.post(`/api/v1/platform/plans/${PAID.id}/prices`, () => {
          posts += 1
          return ok(PAID, 'Price created.')
        })
      )
      const user = userEvent.setup()
      const dialog = await openNewPrice(user)
      const amount = within(dialog).getByRole('textbox', { name: 'Amount in rupees' })
      await user.type(amount, '0')
      await user.type(within(dialog).getByLabelText('Reason'), 'Test')
      await user.click(within(dialog).getByRole('button', { name: 'Add price' }))
      expect(
        await within(dialog).findByText('Enter a whole number of rupees from ₹1 to ₹1,00,000.')
      ).toBeInTheDocument()
      await user.clear(amount)
      await user.type(amount, '99.5')
      await user.click(within(dialog).getByRole('button', { name: 'Add price' }))
      expect(
        await within(dialog).findByText('Enter a whole number of rupees from ₹1 to ₹1,00,000.')
      ).toBeInTheDocument()
      expect(posts).toBe(0)
    })

    it('clears the API’s interval error when another interval is chosen', async () => {
      server.use(
        http.post(`/api/v1/platform/plans/${PAID.id}/prices`, () =>
          HttpResponse.json(
            {
              success: false,
              message: 'Check the highlighted fields, then try again.',
              statusCode: 400,
              errors: { interval: ['Choose month or year.'] },
              requestId: 'test-request-id',
            },
            { status: 400 }
          )
        )
      )
      const user = userEvent.setup()
      const dialog = await openNewPrice(user)
      await user.type(within(dialog).getByRole('textbox', { name: 'Amount in rupees' }), '999')
      await user.type(within(dialog).getByLabelText('Reason'), 'Test')
      await user.click(within(dialog).getByRole('button', { name: 'Add price' }))
      expect(await within(dialog).findByText('Choose month or year.')).toBeInTheDocument()
      await user.click(within(dialog).getByRole('combobox', { name: 'Interval' }))
      await user.click(await screen.findByRole('option', { name: 'Yearly' }))
      await waitFor(() => expect(within(dialog).queryByText('Choose month or year.')).toBeNull())
    })

    it('shows the API sentence when another price change won', async () => {
      server.use(
        http.post(`/api/v1/platform/plans/${PAID.id}/prices`, () =>
          fail('Another price change is in progress. Try again.', 409)
        )
      )
      const user = userEvent.setup()
      const dialog = await openNewPrice(user)
      await user.type(within(dialog).getByRole('textbox', { name: 'Amount in rupees' }), '999')
      await user.type(within(dialog).getByLabelText('Reason'), 'Test')
      await user.click(within(dialog).getByRole('button', { name: 'Add price' }))
      expect(
        await within(dialog).findByText('Another price change is in progress. Try again.')
      ).toBeInTheDocument()
    })
  })
})
