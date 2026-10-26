import { describe, expect, it } from 'vite-plus/test'
import {
  changeLine,
  entitlementErrorFields,
  entitlementText,
  fieldsAfterConflict,
  planCountsLine,
  tenantsOnPlan,
} from '@/lib/plan-editor'
import { planEditForm } from '@/schemas/billing.schemas'
import { testPlans } from '@/tests/fixtures/billing'

const [FREE, PAID] = testPlans.plans as [(typeof testPlans.plans)[0], (typeof testPlans.plans)[0]]
const { catalog } = testPlans

describe('plan editor wording', () => {
  it('words values: On, Off, No limit and the number', () => {
    expect([true, false, null, 3, 100_000].map(entitlementText)).toEqual([
      'On',
      'Off',
      'No limit',
      '3',
      '100,000',
    ])
  })

  it('counts each plan by the states express serves under it', () => {
    expect(planCountsLine(FREE)).toBe('4 on Free')
    expect(planCountsLine({ ...FREE, name: 'Starter' })).toBe('4 on Starter')
    expect(planCountsLine(PAID)).toBe('3 paying · 2 in trial · 1 with a failed payment')
  })

  it('names how many tenants are on a plan, singular for one', () => {
    const affected = { trialing: 2, active: 3, past_due: 1, free: 0 }
    expect(tenantsOnPlan({ changes: [], affected }, 'Paid')).toBe('6 tenants are on Paid')
    expect(
      tenantsOnPlan(
        { changes: [], affected: { trialing: 0, active: 0, past_due: 0, free: 1 } },
        'Free'
      )
    ).toBe('1 tenant is on Free')
  })

  it('lists a change with its label, from and to', () => {
    expect(changeLine({ key: 'members', from: null, to: 10, direction: 'decrease' }, catalog)).toBe(
      'Members: No limit → 10'
    )
    expect(changeLine({ key: 'gone', from: 1, to: 2, direction: 'increase' }, catalog)).toBe(
      'gone: 1 → 2'
    )
  })
})

describe('fieldsAfterConflict', () => {
  const loaded = planEditForm(FREE, catalog)
  const fresh = planEditForm(
    {
      ...FREE,
      description: 'Theirs.',
      entitlements: { members: 5, advanced_example: true },
    },
    catalog
  )

  it('takes their value for each field this reader left alone, and keeps each typed one', () => {
    const current = { ...loaded, name: 'Starter', features: { advanced_example: false } }
    expect(new Map(fieldsAfterConflict(current, loaded, fresh))).toEqual(
      new Map<string, unknown>([
        ['description', 'Theirs.'],
        ['limits.members', '5'],
        ['features.advanced_example', true],
      ])
    )
  })

  it('keeps a typed limit whole when they saved No limit for it', () => {
    const theirsNoLimit = planEditForm(
      { ...FREE, entitlements: { ...FREE.entitlements, members: null } },
      catalog
    )
    const current = { ...loaded, limits: { members: '5' } }
    const updates = new Map(fieldsAfterConflict(current, loaded, theirsNoLimit))
    expect(updates.has('limits.members')).toBe(false)
    expect(updates.has('noLimit.members')).toBe(false)
  })

  it('keeps a ticked No limit whole when they saved a number for it', () => {
    const current = { ...loaded, limits: { members: '' }, noLimit: { members: true } }
    const updates = new Map(fieldsAfterConflict(current, loaded, fresh))
    expect(updates.has('limits.members')).toBe(false)
    expect(updates.has('noLimit.members')).toBe(false)
  })

  it('takes both halves of a limit the reader left alone', () => {
    const theirsNoLimit = planEditForm(
      { ...FREE, entitlements: { ...FREE.entitlements, members: null } },
      catalog
    )
    const updates = new Map(fieldsAfterConflict(loaded, loaded, theirsNoLimit))
    expect(updates.get('noLimit.members')).toBe(true)
    expect(updates.get('limits.members')).toBe(theirsNoLimit.limits.members)
  })

  it('keeps a typed value even where they saved one too', () => {
    const current = { ...loaded, limits: { members: '8' } }
    expect(fieldsAfterConflict(current, loaded, fresh)).not.toContainEqual(['limits.members', '5'])
  })
})

describe('entitlementErrorFields', () => {
  it('puts each message on its entry by label, and keeps the rest for the form', () => {
    expect(
      entitlementErrorFields(
        [
          'Members: enter a whole number from 1 to 1,000,000, or choose No limit.',
          'Workspace insights: choose whether the plan includes this feature.',
          'Send at least one entitlement to change.',
        ],
        catalog
      )
    ).toEqual({
      fields: {
        'limits.members': [
          'Members: enter a whole number from 1 to 1,000,000, or choose No limit.',
        ],
        'features.advanced_example': [
          'Workspace insights: choose whether the plan includes this feature.',
        ],
      },
      unplaced: ['Send at least one entitlement to change.'],
    })
  })
})
