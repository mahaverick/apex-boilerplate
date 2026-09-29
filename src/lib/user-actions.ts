import {
  canPlatformActorModifyTarget,
  platformRoleAtLeast,
  type MembershipRole,
} from '@/constants/roles'
import type { PlatformUserDetail } from '@/types/api.types'

/** One action the user detail's menu can offer. */
export type UserAction =
  | 'edit'
  | 'passwordSetup'
  | 'resendVerification'
  | 'signOut'
  | 'deactivate'
  | 'reactivate'
  | 'delete'
  | 'purge'

/** What the rules read about the user on the page. */
export type UserActionTarget = Pick<
  PlatformUserDetail,
  'id' | 'active' | 'emailVerifiedAt' | 'platformRole' | 'hasPassword' | 'deletedAt'
>

/**
 * The actions the API would accept from `actor` on `target`, so the menu never
 * offers one it refuses. Admin for
 * every live write, soft delete included; owner for Delete permanently, which
 * only a soft-deleted account offers. A staff target also needs
 * `canPlatformActorModifyTarget`, except for the two mail actions, which need
 * the actor to rank at or above the target. An inactive account gets no mail
 * and no sign-out (its sessions already ended); verification is resent only
 * to an account with a password, since the set-password link verifies the
 * others. Nobody acts on themselves except to send their own reset link.
 * @param actor - The signed-in user and their platform role.
 * @param target - The user on the page.
 * @returns The allowed actions; empty below admin.
 */
export function availableUserActions(
  actor: { id: string; platformRole: MembershipRole | null | undefined },
  target: UserActionTarget
): Set<UserAction> {
  const allowed = new Set<UserAction>()
  const role = actor.platformRole
  if (!role || !platformRoleAtLeast(role, 'admin')) return allowed

  const isSelf = actor.id === target.id
  const mayModify =
    !isSelf &&
    (target.platformRole === null || canPlatformActorModifyTarget(role, target.platformRole, false))

  if (target.deletedAt !== null) {
    if (role === 'owner' && mayModify) allowed.add('purge')
    return allowed
  }

  const mayMail =
    target.active &&
    (target.platformRole === null || platformRoleAtLeast(role, target.platformRole))
  if (mayMail) allowed.add('passwordSetup')
  if (mayMail && target.hasPassword && target.emailVerifiedAt === null) {
    allowed.add('resendVerification')
  }
  if (mayModify) {
    allowed.add('edit')
    if (target.active) allowed.add('signOut')
    allowed.add(target.active ? 'deactivate' : 'reactivate')
    allowed.add('delete')
  }
  return allowed
}
