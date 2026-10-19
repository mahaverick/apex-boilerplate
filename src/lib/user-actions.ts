import {
  canPlatformActorModifyTarget,
  platformRoleAtLeast,
  type MembershipRole,
} from '@/constants/roles'
import type { PlatformUserDetail } from '@/types/api.types'

/** The Send sign-in link dialog's notice when the request was taken but its email did not go. */
export const SIGN_IN_LINK_NOT_SENT = 'The email couldn’t be sent. Select Send link to try again.'

/** The warning when the new user's welcome Resend also did not go; their page has Send sign-in link. */
export const WELCOME_RESEND_NOT_SENT =
  'The email couldn’t be sent. Send a sign-in link from their page.'

/** One action the user detail's menu can offer. */
export type UserAction =
  'edit' | 'signInLink' | 'signOut' | 'deactivate' | 'reactivate' | 'delete' | 'purge'

/** What the rules read about the user on the page. */
export type UserActionTarget = Pick<
  PlatformUserDetail,
  'id' | 'active' | 'emailVerifiedAt' | 'platformRole' | 'deletedAt'
>

/**
 * The actions the menu offers `actor` on `target`: never one the API
 * refuses, and one it would accept only where it does something. Admin for
 * every live write, soft delete included; owner for Delete permanently, which
 * only a soft-deleted account offers. A staff target also needs
 * `canPlatformActorModifyTarget`, except for Send sign-in link, which needs
 * the actor to rank at or above the target. An inactive account gets no link
 * (the API refuses it) and no sign-out: the API would accept one, but
 * deactivation already revoked every session, so it would end nothing. A
 * link goes whether or not the address is verified, since its first click
 * verifies it. No write is offered on oneself; only the sign-in link can
 * target the actor.
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
  if (mayMail) allowed.add('signInLink')
  if (mayModify) {
    allowed.add('edit')
    if (target.active) allowed.add('signOut')
    allowed.add(target.active ? 'deactivate' : 'reactivate')
    allowed.add('delete')
  }
  return allowed
}
