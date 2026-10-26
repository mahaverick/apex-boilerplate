import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MembershipRole } from '@/constants/roles'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { queryClient } from '@/router'
import { testBillingSettings, testPlans } from '@/tests/fixtures/billing'
import { STAFF_USER_ID } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp } from '@/tests/mocks/step-up'
import { REAUTH_REQUIRED } from '@/types/api.types'
import type {
  BillingSettings,
  PlanChangePreview,
  StaffPlan,
  StaffPlans,
} from '@/types/billing.types'

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
      expect(dialog).toHaveTextContent('4 tenants are on Free. The changes apply to them now.')
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
        'The new name shows on the pricing page and on the Billing and Members pages of every workspace on Free.'
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Rename')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await confirmStepUp(user)
      await waitFor(() => expect(success).toHaveBeenCalledWith('Starter saved.'))
      expect(previews).toEqual([])
      expect(saves[1]).toEqual({ version: 1, name: 'Starter', reason: 'Rename' })
    })

    it('says only the description changed when only it did', async () => {
      recordSave(FREE, { ...FREE, version: 2, description: 'For two.' })
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const description = within(free).getByRole('textbox', { name: 'Description' })
      await user.clear(description)
      await user.type(description, 'For two.')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      expect(dialog).toHaveTextContent('The new description shows on the pricing page.')
      expect(dialog).not.toHaveTextContent('new name')
    })

    it('saves a name and a limit in one PATCH, and says both apply', async () => {
      const previews = recordPreview(
        FREE,
        freePreview([{ key: 'members', from: 3, to: 5, direction: 'increase' }])
      )
      const saves = recordSave(FREE, {
        ...FREE,
        version: 2,
        name: 'Starter',
        entitlements: { ...FREE.entitlements, members: 5 },
      })
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const name = within(free).getByRole('textbox', { name: 'Name' })
      await user.clear(name)
      await user.type(name, 'Starter')
      const members = within(free).getByRole('textbox', { name: 'Members' })
      await user.clear(members)
      await user.type(members, '5')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      expect(dialog).toHaveTextContent(
        '4 tenants are on Free. The changes apply to them now. The new name shows on the pricing page and on the Billing and Members pages of every workspace on Free.'
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Rename and grow')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await confirmStepUp(user)
      await waitFor(() => expect(success).toHaveBeenCalledWith('Starter saved.'))
      expect(previews).toEqual([{ entitlements: { members: 5 } }])
      expect(saves[1]).toEqual({
        version: 1,
        name: 'Starter',
        entitlements: { members: 5 },
        reason: 'Rename and grow',
      })
    })

    it('lists a raise and a cut together in the lower-limits dialog, with the rename', async () => {
      recordPreview(
        FREE,
        freePreview([
          { key: 'members', from: 3, to: 2, direction: 'decrease' },
          { key: 'advanced_example', from: false, to: true, direction: 'increase' },
        ])
      )
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const name = within(free).getByRole('textbox', { name: 'Name' })
      await user.clear(name)
      await user.type(name, 'Starter')
      const members = within(free).getByRole('textbox', { name: 'Members' })
      await user.clear(members)
      await user.type(members, '2')
      await user.click(within(free).getByRole('switch', { name: 'Workspace insights' }))
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Lower limits on Free?' })
      const changes = within(dialog).getByRole('list', { name: 'Changes' })
      expect(changes).toHaveTextContent('Members: 3 → 2')
      expect(changes).toHaveTextContent('Workspace insights: Off → On')
      expect(dialog).toHaveTextContent(
        'The new name shows on the pricing page and on the Billing and Members pages of every workspace on Free.'
      )
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
      expect(dialog).toHaveTextContent('1 tenant is on Free. The changes apply to them now.')
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
                entitlements: [
                  'Workspace insights: choose whether the plan includes this feature.',
                ],
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
      const message = 'Workspace insights: choose whether the plan includes this feature.'
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
          'Another staff member changed this plan. We loaded their values and kept what you typed. Review and save again.'
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

  describe('the version a save sends', () => {
    it('stays the one read at the first edit when a refetch brings a newer one', async () => {
      const theirs: StaffPlan = { ...FREE, version: 2 }
      servePlans(testPlans, { ...testPlans, plans: [theirs, PAID] })
      recordPreview(FREE, freePreview([{ key: 'members', from: 3, to: 5, direction: 'increase' }]))
      const saves: unknown[] = []
      server.use(
        http.patch(`/api/v1/platform/plans/${FREE.id}`, async ({ request }) => {
          saves.push(await request.json())
          return fail('Someone changed the plan.', 409, 'PLAN_VERSION_CONFLICT')
        })
      )
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const members = within(free).getByRole('textbox', { name: 'Members' })
      await user.clear(members)
      await user.type(members, '5')
      await queryClient.refetchQueries({ queryKey: ['platform', 'plans'] })
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'Room for five')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      expect(
        await within(free).findByText(
          'Another staff member changed this plan. We loaded their values and kept what you typed. Review and save again.'
        )
      ).toBeInTheDocument()
      expect(saves[0]).toEqual({
        version: 1,
        entitlements: { members: 5 },
        reason: 'Room for five',
      })
    })
  })

  describe('a save the API refuses field by field', () => {
    it('puts the errors on the card and closes the dialog', async () => {
      const message = 'Keep the plan name to 64 characters.'
      server.use(
        http.patch(`/api/v1/platform/plans/${FREE.id}`, () =>
          HttpResponse.json(
            {
              success: false,
              message: 'Check the highlighted fields, then try again.',
              statusCode: 400,
              errors: { name: [message] },
              requestId: 'test-request-id',
            },
            { status: 400 }
          )
        )
      )
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const name = within(free).getByRole('textbox', { name: 'Name' })
      await user.clear(name)
      await user.type(name, 'Starter')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'Rename')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      expect(await within(free).findByText(message)).toBeInTheDocument()
      await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    })
  })

  describe('a conflict whose reload fails', () => {
    it('says their values didn’t load, saves nothing, and loads them once the reload works', async () => {
      const theirs: StaffPlan = { ...FREE, version: 2, description: 'Their new description.' }
      let reads = 0
      let failReads = true
      server.use(
        http.get('/api/v1/platform/plans', () => {
          reads += 1
          if (reads === 1) return ok(testPlans, 'Plans retrieved.')
          return failReads
            ? fail('Boom', 500)
            : ok({ ...testPlans, plans: [theirs, PAID] }, 'Plans retrieved.')
        })
      )
      const previews = recordPreview(FREE, freePreview([]))
      const saves: unknown[] = []
      server.use(
        http.patch(`/api/v1/platform/plans/${FREE.id}`, async ({ request }) => {
          saves.push(await request.json())
          return fail('Someone changed the plan.', 409, 'PLAN_VERSION_CONFLICT')
        })
      )
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const name = within(free).getByRole('textbox', { name: 'Name' })
      await user.clear(name)
      await user.type(name, 'Starter')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'Rename')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      const unloaded =
        'Another staff member changed this plan, and their values didn’t load. Select Try again, then save again.'
      expect(await within(free).findByText(unloaded)).toBeInTheDocument()
      expect(
        await screen.findByText('We couldn’t load the plans. Select Try again.')
      ).toBeInTheDocument()
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(saves).toHaveLength(1)

      failReads = false
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull())
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      expect(
        await within(free).findByText(
          'Another staff member changed this plan. We loaded their values and kept what you typed. Review and save again.'
        )
      ).toBeInTheDocument()
      expect(name).toHaveValue('Starter')
      expect(within(free).getByRole('textbox', { name: 'Description' })).toHaveValue(
        'Their new description.'
      )
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(saves).toHaveLength(1)
      expect(previews).toEqual([])
    })
  })

  describe('a limit typed before another staff member saved No limit', () => {
    it('keeps the typed number, and the next save sends it', async () => {
      const theirs: StaffPlan = {
        ...FREE,
        version: 2,
        entitlements: { ...FREE.entitlements, members: null },
      }
      servePlans(testPlans, { ...testPlans, plans: [theirs, PAID] })
      const previews = recordPreview(
        FREE,
        freePreview([{ key: 'members', from: 3, to: 5, direction: 'increase' }])
      )
      const saves: unknown[] = []
      server.use(
        http.patch(`/api/v1/platform/plans/${FREE.id}`, async ({ request }) => {
          saves.push(await request.json())
          return saves.length === 1
            ? fail('Someone changed the plan.', 409, 'PLAN_VERSION_CONFLICT')
            : ok(
                { ...theirs, version: 3, entitlements: { ...theirs.entitlements, members: 5 } },
                'Plan updated.'
              )
        })
      )
      const user = userEvent.setup()
      openPlans()
      const free = await card('Free')
      const members = within(free).getByRole('textbox', { name: 'Members' })
      await user.clear(members)
      await user.type(members, '5')
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Save Free?' })
      await user.type(within(dialog).getByLabelText('Reason'), 'Room for five')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      await waitFor(() => expect(saves).toHaveLength(1))

      expect(members).toHaveValue('5')
      expect(members).toBeEnabled()
      expect(within(free).getByRole('checkbox', { name: 'No limit' })).not.toBeChecked()
      await user.click(within(free).getByRole('button', { name: 'Save Free' }))
      expect(await screen.findByRole('alertdialog', { name: /Free\?$/ })).toBeInTheDocument()
      await waitFor(() => expect(previews).toHaveLength(2))
      expect(previews[1]).toEqual({ entitlements: { members: 5 } })
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
          'Charges above ₹15,000 need the customer to approve each payment. Keep monthly prices at ₹15,000 or less.'
        )
      ).toBeInTheDocument()
    })

    it('takes the threshold from the API, and names the chosen interval', async () => {
      // The type pins express's constant today; the page must still read whatever the API sends.
      servePlans({ ...testPlans, priceWarningAboveMinor: 1_000_000 } as unknown as StaffPlans)
      const user = userEvent.setup()
      const dialog = await openNewPrice(user)
      await user.click(within(dialog).getByRole('combobox', { name: 'Interval' }))
      await user.click(await screen.findByRole('option', { name: 'Yearly' }))
      const amount = within(dialog).getByRole('textbox', { name: 'Amount in rupees' })
      await user.type(amount, '10000')
      expect(within(dialog).queryByText(/need the customer to approve/)).toBeNull()
      await user.clear(amount)
      await user.type(amount, '10001')
      expect(
        await within(dialog).findByText(
          'Charges above ₹10,000 need the customer to approve each payment. Keep yearly prices at ₹10,000 or less.'
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
        'Current subscribers keep the price they signed up at. New subscribers pay ₹12,000.'
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
      expect(dialog).not.toHaveTextContent('Current subscribers')
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

    it('puts the API’s amountMinor error on the rupees field', async () => {
      const message = 'Enter a whole number of rupees from ₹1 to ₹1,00,000.'
      server.use(
        http.post(`/api/v1/platform/plans/${PAID.id}/prices`, () =>
          HttpResponse.json(
            {
              success: false,
              message: 'Check the highlighted fields, then try again.',
              statusCode: 400,
              errors: { amountMinor: [message] },
              requestId: 'test-request-id',
            },
            { status: 400 }
          )
        )
      )
      const user = userEvent.setup()
      const dialog = await openNewPrice(user)
      const amount = within(dialog).getByRole('textbox', { name: 'Amount in rupees' })
      await user.type(amount, '999')
      await user.type(within(dialog).getByLabelText('Reason'), 'Test')
      await user.click(within(dialog).getByRole('button', { name: 'Add price' }))
      expect(await within(dialog).findByText(message)).toBeInTheDocument()
      await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'))
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

/**
 * Records each settings PATCH body; the first is refused for a stale
 * sign-in, so the save runs through step-up, and the retry answers `answer`.
 * @param answer - The settings the retry answers.
 */
function recordSettingsSave(answer: BillingSettings): unknown[] {
  const bodies: unknown[] = []
  server.use(
    http.patch('/api/v1/platform/billing-settings', async ({ request }) => {
      bodies.push(await request.json())
      return bodies.length === 1
        ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        : ok(answer, 'Billing settings saved.')
    })
  )
  return bodies
}

/**
 * Serves the billing settings: `settings` for every read, or each read in turn.
 * @param settings - The answers, in order; the last repeats.
 */
function serveSettings(...settings: BillingSettings[]) {
  let reads = 0
  server.use(
    http.get('/api/v1/platform/billing-settings', () => {
      const answer = settings[Math.min(reads, settings.length - 1)] ?? testBillingSettings
      reads += 1
      return ok(answer, 'Billing settings retrieved.')
    })
  )
}

/** The Trials and grace card, found by its heading. */
async function settingsCard() {
  return screen.findByRole('region', { name: 'Trials and grace' })
}

/** The unchanged-save message, express's refine word for word. */
const NO_SETTING_CHANGED =
  'Change at least one setting: trials, the trial length or the grace period.'

describe('Plans page: trials and grace', () => {
  let success: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    servePlans(testPlans)
    serveSettings(testBillingSettings)
    success = vi.spyOn(toast, 'success')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['viewer', 'manager'] as const)(
    'shows a %s the settings as text, with no controls',
    async (role) => {
      openPlans(role)
      const settings = await settingsCard()
      expect(await within(settings).findByText('Never changed.')).toBeInTheDocument()
      expect(settings).toHaveTextContent('Paid trial for new workspacesOn')
      expect(settings).toHaveTextContent('Trial length14 days')
      expect(settings).toHaveTextContent('Days to keep Paid after the last failed payment7 days')
      expect(within(settings).queryByRole('switch')).toBeNull()
      expect(within(settings).queryByRole('textbox')).toBeNull()
      expect(within(settings).queryByRole('button')).toBeNull()
    }
  )

  it('names who changed the settings last, masked, and when', async () => {
    serveSettings({
      ...testBillingSettings,
      version: 3,
      updatedAt: '2026-10-20T10:00:00.000Z',
      updatedBy: { userId: STAFF_USER_ID, name: 'Staff Admin' },
    })
    openPlans('viewer')
    const settings = await settingsCard()
    const name = await within(settings).findByText('Staff Admin')
    expect(name).toHaveClass('ph-mask')
    expect(name.parentElement).toHaveTextContent(
      `Last changed by Staff Admin on ${formatDate('2026-10-20T10:00:00.000Z', 'medium') ?? ''}.`
    )
  })

  it('says only when they last changed once the editor’s account is gone', async () => {
    serveSettings({
      ...testBillingSettings,
      version: 3,
      updatedAt: '2026-10-20T10:00:00.000Z',
      updatedBy: null,
    })
    openPlans('viewer')
    const settings = await settingsCard()
    expect(
      await within(settings).findByText(
        `Last changed on ${formatDate('2026-10-20T10:00:00.000Z', 'medium') ?? ''}.`
      )
    ).toBeInTheDocument()
    expect(settings).not.toHaveTextContent('Never changed.')
  })

  it('leaves the date out rather than guess it when the API sends none it can read', async () => {
    serveSettings({
      ...testBillingSettings,
      version: 3,
      updatedAt: 'not a date',
      updatedBy: { userId: STAFF_USER_ID, name: 'Staff Admin' },
    })
    openPlans('viewer')
    const settings = await settingsCard()
    const name = await within(settings).findByText('Staff Admin')
    expect(name.parentElement).toHaveTextContent(/^Last changed by Staff Admin\.$/)
  })

  it('gives an admin the switch and both day fields, loaded', async () => {
    openPlans('admin')
    const settings = await settingsCard()
    expect(
      await within(settings).findByRole('switch', { name: 'Give new workspaces a Paid trial' })
    ).toBeChecked()
    expect(within(settings).getByRole('textbox', { name: 'Trial length (days)' })).toHaveValue('14')
    expect(
      within(settings).getByRole('textbox', {
        name: 'Days to keep Paid after the last failed payment',
      })
    ).toHaveValue('7')
    expect(
      within(settings).getByRole('button', { name: 'Save billing settings' })
    ).toBeInTheDocument()
  })

  it('posts only the changed setting with the version, after a reason and step-up', async () => {
    const saves = recordSettingsSave({ ...testBillingSettings, trialDays: 21, version: 2 })
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    const length = await within(settings).findByRole('textbox', { name: 'Trial length (days)' })
    await user.clear(length)
    await user.type(length, '21')
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Save billing settings?' })
    expect(dialog).toHaveTextContent(
      'New trials use these rules. Trials already running keep their end dates.'
    )
    expect(dialog).not.toHaveTextContent('grace')
    await user.type(within(dialog).getByLabelText('Reason'), 'Longer trials for the launch')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await confirmStepUp(user)
    await waitFor(() => expect(success).toHaveBeenCalledWith('Billing settings saved.'))
    expect(saves).toEqual([
      { version: 1, trialDays: 21, reason: 'Longer trials for the launch' },
      { version: 1, trialDays: 21, reason: 'Longer trials for the launch' },
    ])
    expect(length).toHaveValue('21')
  })

  it('sends the trial switch alone when only it changed', async () => {
    const saves = recordSettingsSave({ ...testBillingSettings, trialEnabled: false, version: 2 })
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    await user.click(
      await within(settings).findByRole('switch', { name: 'Give new workspaces a Paid trial' })
    )
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Save billing settings?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Pause trials')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await confirmStepUp(user)
    await waitFor(() => expect(saves).toHaveLength(2))
    expect(saves[1]).toEqual({ version: 1, trialEnabled: false, reason: 'Pause trials' })
  })

  it('asks for a change when nothing changed, in express’s words, and posts nothing', async () => {
    const saves = recordSettingsSave(testBillingSettings)
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    await user.click(await within(settings).findByRole('button', { name: 'Save billing settings' }))
    expect(await within(settings).findByText(NO_SETTING_CHANGED)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(saves).toEqual([])
  })

  it('refuses 31 grace days before asking for a reason', async () => {
    const saves = recordSettingsSave(testBillingSettings)
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    const grace = await within(settings).findByRole('textbox', {
      name: 'Days to keep Paid after the last failed payment',
    })
    await user.clear(grace)
    await user.type(grace, '31')
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    expect(
      await within(settings).findByText('Enter a whole number of days from 1 to 30.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(saves).toEqual([])
  })

  it('puts the API’s trial error under its switch, and clears it when the switch changes', async () => {
    const message = 'Choose whether new workspaces get a Paid trial.'
    server.use(
      http.patch('/api/v1/platform/billing-settings', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Check the highlighted fields, then try again.',
            statusCode: 400,
            errors: { trialEnabled: [message] },
            requestId: 'test-request-id',
          },
          { status: 400 }
        )
      )
    )
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    const trial = await within(settings).findByRole('switch', {
      name: 'Give new workspaces a Paid trial',
    })
    await user.click(trial)
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Save billing settings?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Test')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(settings).findByText(message)).toBeInTheDocument()
    await waitFor(() => expect(trial).toHaveAttribute('aria-invalid', 'true'))
    await user.click(trial)
    await waitFor(() => expect(within(settings).queryByText(message)).toBeNull())
  })

  it('says their settings didn’t load, and saves nothing, until the reload succeeds', async () => {
    const theirs: BillingSettings = { ...testBillingSettings, version: 2, pastDueGraceDays: 10 }
    let reads = 0
    let failReads = true
    server.use(
      http.get('/api/v1/platform/billing-settings', () => {
        reads += 1
        if (reads === 1) return ok(testBillingSettings, 'Billing settings retrieved.')
        return failReads ? fail('Boom', 500) : ok(theirs, 'Billing settings retrieved.')
      })
    )
    const saves: unknown[] = []
    server.use(
      http.patch('/api/v1/platform/billing-settings', async ({ request }) => {
        saves.push(await request.json())
        return fail('Someone changed the billing settings.', 409, 'PLAN_VERSION_CONFLICT')
      })
    )
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    const length = await within(settings).findByRole('textbox', { name: 'Trial length (days)' })
    await user.clear(length)
    await user.type(length, '30')
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Save billing settings?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Longer trials')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const unloaded =
      'Another staff member changed the billing settings, and their values didn’t load. Select Try again, then save again.'
    expect(await within(settings).findByText(unloaded)).toBeInTheDocument()
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(saves).toHaveLength(1)

    failReads = false
    await user.click(await within(settings).findByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(within(settings).queryByRole('button', { name: 'Try again' })).toBeNull()
    )
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    expect(
      await within(settings).findByText(
        'Another staff member changed the billing settings. We loaded their values and kept what you typed. Review and save again.'
      )
    ).toBeInTheDocument()
    expect(length).toHaveValue('30')
    expect(
      within(settings).getByRole('textbox', {
        name: 'Days to keep Paid after the last failed payment',
      })
    ).toHaveValue('10')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(saves).toHaveLength(1)
  })

  it('keeps typed values after another staff member saves first, and loads theirs elsewhere', async () => {
    const theirs: BillingSettings = {
      ...testBillingSettings,
      version: 2,
      pastDueGraceDays: 10,
      updatedBy: { userId: STAFF_USER_ID, name: 'Staff Admin' },
    }
    serveSettings(testBillingSettings, theirs)
    const saves: unknown[] = []
    server.use(
      http.patch('/api/v1/platform/billing-settings', async ({ request }) => {
        saves.push(await request.json())
        return saves.length === 1
          ? fail(
              'Someone changed the billing settings after you opened this page. Reload it, then try again.',
              409,
              'PLAN_VERSION_CONFLICT'
            )
          : ok({ ...theirs, version: 3, trialDays: 30 }, 'Billing settings saved.')
      })
    )
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    const length = await within(settings).findByRole('textbox', { name: 'Trial length (days)' })
    await user.clear(length)
    await user.type(length, '30')
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    let dialog = await screen.findByRole('alertdialog', { name: 'Save billing settings?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Longer trials')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(
      await within(settings).findByText(
        'Another staff member changed the billing settings. We loaded their values and kept what you typed. Review and save again.'
      )
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(length).toHaveValue('30')
    await waitFor(() =>
      expect(
        within(settings).getByRole('textbox', {
          name: 'Days to keep Paid after the last failed payment',
        })
      ).toHaveValue('10')
    )

    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    dialog = await screen.findByRole('alertdialog', { name: 'Save billing settings?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Longer trials')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Billing settings saved.'))
    expect(saves[1]).toEqual({ version: 2, trialDays: 30, reason: 'Longer trials' })
  })

  it('words the save dialog for a grace change alone, then for both kinds of change', async () => {
    recordSettingsSave(testBillingSettings)
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    const grace = await within(settings).findByRole('textbox', {
      name: 'Days to keep Paid after the last failed payment',
    })
    await user.clear(grace)
    await user.type(grace, '10')
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    let dialog = await screen.findByRole('alertdialog', { name: 'Save billing settings?' })
    expect(within(dialog).getByText(/^The new grace/)).toHaveTextContent(
      /^The new grace applies now to every tenant with a failed payment\.$/
    )
    expect(dialog).not.toHaveTextContent('New trials')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await user.click(
      within(settings).getByRole('switch', { name: 'Give new workspaces a Paid trial' })
    )
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    dialog = await screen.findByRole('alertdialog', { name: 'Save billing settings?' })
    expect(dialog).toHaveTextContent(
      'New trials use these rules. Trials already running keep their end dates. The new grace applies now to every tenant with a failed payment.'
    )
  })

  it('reads 014 trial days as the stored 14: no change, express’s message, and nothing posted', async () => {
    const saves = recordSettingsSave(testBillingSettings)
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    const length = await within(settings).findByRole('textbox', { name: 'Trial length (days)' })
    await user.clear(length)
    await user.type(length, '014')
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    expect(await within(settings).findByText(NO_SETTING_CHANGED)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(saves).toEqual([])
  })

  it('after a conflict, loads their grace over a typed 07 that equals the stored 7', async () => {
    const theirs: BillingSettings = { ...testBillingSettings, version: 2, pastDueGraceDays: 10 }
    serveSettings(testBillingSettings, theirs)
    const saves: unknown[] = []
    server.use(
      http.patch('/api/v1/platform/billing-settings', async ({ request }) => {
        saves.push(await request.json())
        return fail('Someone changed the billing settings.', 409, 'PLAN_VERSION_CONFLICT')
      })
    )
    const user = userEvent.setup()
    openPlans('admin')
    const settings = await settingsCard()
    const length = await within(settings).findByRole('textbox', { name: 'Trial length (days)' })
    const grace = within(settings).getByRole('textbox', {
      name: 'Days to keep Paid after the last failed payment',
    })
    await user.clear(length)
    await user.type(length, '30')
    await user.clear(grace)
    await user.type(grace, '07')
    await user.click(within(settings).getByRole('button', { name: 'Save billing settings' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Save billing settings?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Longer trials')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(saves[0]).toEqual({ version: 1, trialDays: 30, reason: 'Longer trials' })
    await waitFor(() => expect(grace).toHaveValue('10'))
    expect(length).toHaveValue('30')
  })
})
