import { describe, expect, it } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { availableUserActions, type UserAction, type UserActionTarget } from '@/lib/user-actions'

const ME = '20000000-0000-4000-8000-000000000001'
const THEM = '20000000-0000-4000-8000-000000000002'

function target(
  platformRole: MembershipRole | null,
  overrides: Partial<Omit<UserActionTarget, 'platformRole'>> = {}
): UserActionTarget {
  return {
    id: THEM,
    active: true,
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    hasPassword: true,
    deletedAt: null,
    platformRole,
    ...overrides,
  }
}

/** The allowed actions as a set: order is the menu's business, not this function's. */
function actions(actorRole: MembershipRole | null, t: UserActionTarget): Set<UserAction> {
  return availableUserActions({ id: ME, platformRole: actorRole }, t)
}

const EVERY_LIVE_WRITE: UserAction[] = ['edit', 'passwordSetup', 'signOut', 'deactivate', 'delete']

describe('availableUserActions', () => {
  it('offers a viewer nothing, as the API refuses every write below admin', () => {
    expect(actions('viewer', target(null))).toEqual(new Set())
  })

  it('offers a non-staff actor nothing', () => {
    expect(actions(null, target(null))).toEqual(new Set())
  })

  it('offers an admin every live write on a customer, soft delete included', () => {
    expect(actions('admin', target(null))).toEqual(new Set(EVERY_LIVE_WRITE))
  })

  it('offers an owner the same on a live account; permanent deletion waits for a deleted one', () => {
    expect(actions('owner', target(null))).toEqual(new Set(EVERY_LIVE_WRITE))
  })

  it('on an inactive account swaps deactivate for reactivate and drops sign-out and mail', () => {
    expect(actions('admin', target(null, { active: false }))).toEqual(
      new Set<UserAction>(['edit', 'reactivate', 'delete'])
    )
  })

  it('offers resend-verification only to an unverified account that has a password', () => {
    expect(actions('admin', target(null, { emailVerifiedAt: null }))).toContain(
      'resendVerification'
    )
    expect(
      actions('admin', target(null, { emailVerifiedAt: null, hasPassword: false }))
    ).not.toContain('resendVerification')
    expect(actions('admin', target(null))).not.toContain('resendVerification')
  })

  it('leaves a deleted account read-only, with Delete permanently for an owner only', () => {
    const deleted = target(null, { deletedAt: '2026-09-29T00:00:00.000Z' })
    expect(actions('owner', deleted)).toEqual(new Set<UserAction>(['purge']))
    expect(actions('admin', deleted)).toEqual(new Set())
  })

  // The API applies canPlatformActorModifyTarget to staff targets; the menu must not offer what it refuses.
  it.each<[MembershipRole, MembershipRole, UserAction[]]>([
    ['admin', 'owner', []],
    ['admin', 'admin', ['passwordSetup']],
    ['admin', 'viewer', EVERY_LIVE_WRITE],
    ['owner', 'owner', EVERY_LIVE_WRITE],
    ['owner', 'admin', EVERY_LIVE_WRITE],
  ])('an %s acting on a staff %s gets %j', (actorRole, targetRole, expected) => {
    expect(actions(actorRole, target(targetRole))).toEqual(new Set(expected))
  })

  it('on an inactive staff target applies the staff rule and still offers no mail', () => {
    expect(actions('admin', target('viewer', { active: false }))).toEqual(
      new Set<UserAction>(['edit', 'reactivate', 'delete'])
    )
    expect(actions('admin', target('admin', { active: false }))).toEqual(new Set())
    expect(actions('owner', target('owner', { active: false }))).toEqual(
      new Set<UserAction>(['edit', 'reactivate', 'delete'])
    )
  })

  it('offers no resend-verification to an inactive account, even unverified with a password', () => {
    expect(
      actions('admin', target(null, { active: false, emailVerifiedAt: null, hasPassword: true }))
    ).toEqual(new Set<UserAction>(['edit', 'reactivate', 'delete']))
  })

  it('lets an owner permanently delete a deleted staff owner, and an admin never', () => {
    const deletedOwner = target('owner', { deletedAt: '2026-09-29T00:00:00.000Z' })
    expect(actions('owner', deletedOwner)).toEqual(new Set<UserAction>(['purge']))
    expect(actions('admin', deletedOwner)).toEqual(new Set())
  })

  it('on yourself offers only your own reset link', () => {
    expect(actions('owner', target('owner', { id: ME }))).toEqual(
      new Set<UserAction>(['passwordSetup'])
    )
    expect(actions('admin', target('admin', { id: ME }))).toEqual(
      new Set<UserAction>(['passwordSetup'])
    )
  })
})
