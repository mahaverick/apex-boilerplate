import {
  AUDIT_ACTIONS,
  type AuditAction,
  type RetiredAuditAction,
} from '@/constants/audit-action-names'
import { templateLabel } from '@/constants/email.constants'
import { MEMBERSHIP_ROLES, ROLE_LABELS, type MembershipRole } from '@/constants/roles'

export { AUDIT_ACTIONS, type AuditAction }

/** Whether `value` is an audit action this build has a sentence for. */
export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
}

/** Short names, for the action filter. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'tenant.created': 'Tenant created',
  'tenant.updated': 'Tenant updated',
  'tenant.settings_updated': 'Settings changed',
  'member.role_changed': 'Role changed',
  'member.removed': 'Member removed',
  'member.left': 'Member left',
  'invitation.created': 'Invitation sent',
  'invitation.resent': 'Invitation resent',
  'invitation.revoked': 'Invitation revoked',
  'invitation.accepted': 'Invitation accepted',
  'platform.member.granted': 'Staff role granted',
  'tenant.accessed_by_platform': 'Staff visit',
  'tenant.suspended': 'Tenant suspended',
  'tenant.reactivated': 'Tenant reactivated',
  'tenant.archived': 'Tenant archived',
  'tenant.owner_invited': 'Owner invited',
  'user.created': 'User created',
  'user.updated': 'User updated',
  'user.deactivated': 'User deactivated',
  'user.reactivated': 'User reactivated',
  'user.signed_out': 'User signed out',
  'user.sign_in_link_sent': 'Sign-in link sent',
  'user.deleted': 'User deleted',
  'user.purged': 'User permanently deleted',
  'tenant.purged': 'Tenant permanently deleted',
  'auth.step_up_confirmed': 'Identity confirmed',
  'auth.step_up_refused': 'Identity check refused',
  'email.resent': 'Email resent',
  'email.suppression_lifted': 'Suppression lifted',
  'onboarding.dismissed': 'Getting started dismissed',
  'onboarding.undismissed': 'Getting started restored',
  'onboarding.step_completed': 'Onboarding step completed',
  'onboarding.reminder_sent': 'Onboarding reminder sent',
  'user.flags_evaluated': 'User flags evaluated',
  'platform.maintenance_mode_changed': 'Maintenance mode changed',
}

/** An audit entry's free-form metadata, whose fields are checked before use. */
type Metadata = Record<string, unknown>

/** A string field of the metadata, or undefined when it is missing or not a string. */
function text(metadata: Metadata, key: string): string | undefined {
  const value = metadata[key]
  return typeof value === 'string' ? value : undefined
}

/** Whether `value` names a role this build knows. */
function isMembershipRole(value: string): value is MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(value)
}

/** A role field as a label, passing an unknown role through as sent. */
function roleLabel(metadata: Metadata, key: string): string {
  const value = text(metadata, key)
  if (value === undefined) return 'an unknown role'
  return isMembershipRole(value) ? ROLE_LABELS[value] : value
}

/** " (name, website)", or nothing when the list is missing or empty. */
function changedFields(metadata: Metadata): string {
  const value = metadata.changed
  const fields = Array.isArray(value)
    ? value.filter((field): field is string => typeof field === 'string')
    : []
  return fields.length > 0 ? ` (${fields.join(', ')})` : ''
}

/** The invitee's domain only: the log never holds a full address. */
function domain(metadata: Metadata): string {
  return text(metadata, 'emailDomain') ?? 'an unknown domain'
}

/** The strings in an array field, or none when it is missing or mistyped. */
function texts(metadata: Metadata, key: string): string[] {
  const value = metadata[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/** "2 owners at acme.test, corp.test", or "the owners" when the counts are missing. */
function reminderRecipients(metadata: Metadata): string {
  const count = metadata.recipientCount
  const domains = texts(metadata, 'emailDomains')
  const who =
    typeof count === 'number' ? `${count} ${count === 1 ? 'owner' : 'owners'}` : 'the owners'
  return domains.length > 0 ? `${who} at ${domains.join(', ')}` : who
}

/** " for the customer app, in a tenant", or nothing when the entry names neither. */
function flagsEvaluatedFor(metadata: Metadata): string {
  const app = text(metadata, 'clientApp')
  const which = app === 'apex' ? ' for Apex' : app === 'react' ? ' for the customer app' : ''
  return `${which}${text(metadata, 'tenantId') === undefined ? '' : ', in a tenant'}`
}

/** A maintenance mode as a sentence names it. */
const MAINTENANCE_MODE_WORDS: Record<string, string> = {
  off: 'off',
  read_only: 'read-only',
  full: 'full',
}

/**
 * A maintenance-mode change as a sentence: on, off, escalated, eased, or a
 * changed customer message; a mode it does not know reads as a change.
 */
function maintenanceChange(metadata: Metadata): string {
  const from = text(metadata, 'from')
  const to = text(metadata, 'to')
  if (from === undefined || to === undefined) return 'changed maintenance mode'
  if (!Object.hasOwn(MAINTENANCE_MODE_WORDS, from) || !Object.hasOwn(MAINTENANCE_MODE_WORDS, to)) {
    return 'changed maintenance mode'
  }
  const toWord = MAINTENANCE_MODE_WORDS[to]
  if (to === 'off') return 'turned maintenance off'
  if (from === 'off') return `turned on ${toWord} maintenance`
  if (from === to) {
    return metadata.messageChanged === true
      ? `changed the ${toWord} maintenance message`
      : 'changed maintenance mode'
  }
  return to === 'full'
    ? 'escalated maintenance from read-only to full'
    : 'eased maintenance from full to read-only'
}

/** `: “why”`, or nothing when the entry carries no reason. */
function because(metadata: Metadata): string {
  const reason = text(metadata, 'reason')
  return reason ? `: “${reason}”` : ''
}

const SENTENCES: Record<AuditAction, (metadata: Metadata) => string> = {
  'tenant.created': (m) => `created the tenant “${text(m, 'name') ?? 'unnamed'}”`,
  'tenant.updated': (m) => `updated the tenant${changedFields(m)}`,
  'tenant.settings_updated': (m) => `changed the settings${changedFields(m)}`,
  'member.role_changed': (m) =>
    `changed a member’s role from ${roleLabel(m, 'from')} to ${roleLabel(m, 'to')}`,
  'member.removed': (m) =>
    m.self === true ? 'left the tenant' : `removed a member (${roleLabel(m, 'role')})`,
  'member.left': () => 'left the tenant',
  'invitation.created': (m) => `invited someone at ${domain(m)} as ${roleLabel(m, 'role')}`,
  'invitation.resent': (m) => `resent the invitation to someone at ${domain(m)}`,
  'invitation.revoked': (m) => `revoked the invitation to someone at ${domain(m)}`,
  'invitation.accepted': (m) => `accepted an invitation as ${roleLabel(m, 'role')}`,
  'platform.member.granted': (m) => `granted a platform member the ${roleLabel(m, 'role')} role`,
  'tenant.accessed_by_platform': (m) =>
    `opened this tenant as platform staff (${roleLabel(m, 'platformRole')})`,
  'tenant.suspended': (m) => `suspended the tenant${because(m)}`,
  'tenant.reactivated': (m) => `reactivated the tenant${because(m)}`,
  'tenant.archived': (m) => `archived the tenant${because(m)}`,
  'tenant.owner_invited': (m) => `invited someone at ${domain(m)} as the owner${because(m)}`,
  'user.created': (m) => `created an account for someone at ${domain(m)}`,
  'user.updated': (m) => `updated a user${changedFields(m)}`,
  'user.deactivated': (m) => `deactivated a user${because(m)}`,
  'user.reactivated': (m) => `reactivated a user${because(m)}`,
  'user.signed_out': (m) => `signed a user out everywhere${because(m)}`,
  'user.sign_in_link_sent': (m) =>
    m.app === 'apex' ? 'sent a staff member a sign-in link to Apex' : 'sent a user a sign-in link',
  'user.deleted': (m) => `deleted a user${because(m)}`,
  'user.purged': (m) => `permanently deleted a user${because(m)}`,
  'tenant.purged': (m) => {
    const name = text(m, 'name')
    return `permanently deleted ${name ? `the tenant ${name}` : 'a tenant'}${because(m)}`
  },
  'auth.step_up_confirmed': (m) =>
    m.method === 'google'
      ? 'confirmed it was them with Google'
      : 'confirmed it was them by email link',
  'auth.step_up_refused': (m) =>
    m.method === 'google'
      ? 'failed a Google identity check'
      : 'failed an email-link identity check',
  'email.resent': (m) => {
    const template = text(m, 'templateKey')
    const which = template === undefined ? '' : ` (${templateLabel(template)})`
    return `resent an email${which} to someone at ${domain(m)}${because(m)}`
  },
  'email.suppression_lifted': (m) =>
    `lifted the email suppression on an address at ${domain(m)}${because(m)}`,
  'onboarding.dismissed': () => 'dismissed the getting-started checklist',
  'onboarding.undismissed': () => 'brought back the getting-started checklist',
  'onboarding.step_completed': (m) => {
    const step = text(m, 'stepKey')
    const which = step === undefined ? 'an onboarding step' : `the onboarding step “${step}”`
    return `marked ${which} complete${because(m)}`
  },
  'onboarding.reminder_sent': (m) =>
    `sent an onboarding reminder to ${reminderRecipients(m)}${because(m)}`,
  'user.flags_evaluated': (m) => `evaluated a user’s feature flags${flagsEvaluatedFor(m)}`,
  'platform.maintenance_mode_changed': (m) => `${maintenanceChange(m)}${because(m)}`,
}

/**
 * Sentences for the retired password-era actions, whose rows stay in the log
 * though nothing writes them any more. The retired view actions keep the
 * fallback sentence.
 */
const RETIRED_SENTENCES = {
  'auth.reauthenticated': 'confirmed it was them with a password',
  'user.password_setup_sent': 'sent a user a password setup email',
  'user.verification_resent': 'resent a user a verification email',
  'platform.member.auto_joined': 'joined staff by email domain',
} as const satisfies Partial<Record<RetiredAuditAction, string>>

/** Whether `value` is a retired action that still has its own sentence. */
function hasRetiredSentence(value: string): value is keyof typeof RETIRED_SENTENCES {
  return Object.hasOwn(RETIRED_SENTENCES, value)
}

/**
 * An action name as words ("tenant errors viewed"), for a stored action this
 * build has no sentence for.
 * @param action - The stored action name, such as `tenant.errors_viewed`.
 */
export function readableAction(action: string): string {
  return action.replaceAll(/[._]+/g, ' ')
}

/**
 * What the actor did, as the rest of a sentence their name begins. Reads the
 * metadata defensively, so a row whose fields are missing or mistyped still renders.
 */
export function auditSentence(entry: { action: string; metadata: Metadata }): string {
  if (isAuditAction(entry.action)) return SENTENCES[entry.action](entry.metadata)
  if (hasRetiredSentence(entry.action)) return RETIRED_SENTENCES[entry.action]
  return `performed ${readableAction(entry.action)}`
}

/**
 * Who acted: their name, else their email, else the system (scripts have no
 * actor). Structural rather than importing `AuditActor`: `api.types` imports
 * this module's `AuditAction`, so the reverse import would be circular. An
 * `id` field, present on the real actor, is accepted but not required.
 */
export function actorName(actor: { id?: string; name: string; email: string } | null): string {
  if (actor === null) return 'System'
  return actor.name === '' ? actor.email : actor.name
}
