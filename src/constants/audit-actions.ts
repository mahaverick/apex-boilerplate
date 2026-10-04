import { templateLabel } from '@/constants/email.constants'
import { MEMBERSHIP_ROLES, ROLE_LABELS, type MembershipRole } from '@/constants/roles'
import { TIMELINE_RANGE_LABELS, TIMELINE_VIEW_LABELS } from '@/constants/timeline.constants'

/** Every action the API writes to its audit log. An action the server adds still renders, through the fallback sentence. */
export const AUDIT_ACTIONS = [
  'tenant.created',
  'tenant.updated',
  'tenant.settings_updated',
  'member.role_changed',
  'member.removed',
  'invitation.created',
  'invitation.resent',
  'invitation.revoked',
  'invitation.accepted',
  'platform.member.auto_joined',
  'platform.member.granted',
  'tenant.accessed_by_platform',
  'tenant.suspended',
  'tenant.reactivated',
  'tenant.archived',
  'tenant.owner_invited',
  'user.created',
  'user.updated',
  'user.deactivated',
  'user.reactivated',
  'user.signed_out',
  'user.password_setup_sent',
  'user.verification_resent',
  'user.deleted',
  'user.purged',
  'tenant.purged',
  'auth.reauthenticated',
  'email.resent',
  'email.suppression_lifted',
  'onboarding.dismissed',
  'onboarding.undismissed',
  'onboarding.step_completed',
  'onboarding.reminder_sent',
  'user.timeline_viewed',
  'tenant.timeline_viewed',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

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
  'invitation.created': 'Invitation sent',
  'invitation.resent': 'Invitation resent',
  'invitation.revoked': 'Invitation revoked',
  'invitation.accepted': 'Invitation accepted',
  'platform.member.auto_joined': 'Staff auto-joined',
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
  'user.password_setup_sent': 'Password link sent',
  'user.verification_resent': 'Verification resent',
  'user.deleted': 'User deleted',
  'user.purged': 'User permanently deleted',
  'tenant.purged': 'Tenant permanently deleted',
  'auth.reauthenticated': 'Identity confirmed',
  'email.resent': 'Email resent',
  'email.suppression_lifted': 'Suppression lifted',
  'onboarding.dismissed': 'Getting started dismissed',
  'onboarding.undismissed': 'Getting started restored',
  'onboarding.step_completed': 'Onboarding step completed',
  'onboarding.reminder_sent': 'Onboarding reminder sent',
  'user.timeline_viewed': 'User timeline viewed',
  'tenant.timeline_viewed': 'Tenant timeline viewed',
}

type Metadata = Record<string, unknown>

function text(metadata: Metadata, key: string): string | undefined {
  const value = metadata[key]
  return typeof value === 'string' ? value : undefined
}

function isMembershipRole(value: string): value is MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(value)
}

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

/** " (last 7 days, Key events)", or nothing when the window is missing or unknown. */
function timelineWindow(metadata: Metadata): string {
  const range = text(metadata, 'range')
  const view = text(metadata, 'view')
  if (range === undefined || !Object.hasOwn(TIMELINE_RANGE_LABELS, range)) return ''
  const label = TIMELINE_RANGE_LABELS[range as keyof typeof TIMELINE_RANGE_LABELS]
  const which =
    view !== undefined && Object.hasOwn(TIMELINE_VIEW_LABELS, view)
      ? `, ${TIMELINE_VIEW_LABELS[view as keyof typeof TIMELINE_VIEW_LABELS]}`
      : ''
  return ` (last ${label}${which})`
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
  'invitation.created': (m) => `invited someone at ${domain(m)} as ${roleLabel(m, 'role')}`,
  'invitation.resent': (m) => `resent the invitation to someone at ${domain(m)}`,
  'invitation.revoked': (m) => `revoked the invitation to someone at ${domain(m)}`,
  'invitation.accepted': (m) => `accepted an invitation as ${roleLabel(m, 'role')}`,
  'platform.member.auto_joined': (m) =>
    `added someone at ${domain(m)} to the platform as Viewer (auto-join)`,
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
  'user.password_setup_sent': (m) =>
    text(m, 'kind') === 'reset'
      ? 'sent a user a password reset link'
      : 'sent a user a set-password link',
  'user.verification_resent': () => 'resent a user’s verification email',
  'user.deleted': (m) => `deleted a user${because(m)}`,
  'user.purged': (m) => `permanently deleted a user${because(m)}`,
  'tenant.purged': (m) => {
    const name = text(m, 'name')
    return `permanently deleted ${name ? `the tenant ${name}` : 'a tenant'}${because(m)}`
  },
  'auth.reauthenticated': (m) =>
    text(m, 'outcome') === 'failure'
      ? 'failed to confirm their identity'
      : 'confirmed their identity',
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
  'user.timeline_viewed': (m) => `viewed a user’s timeline${timelineWindow(m)}`,
  'tenant.timeline_viewed': (m) => `viewed a tenant’s timeline${timelineWindow(m)}`,
}

/**
 * What the actor did, as the rest of a sentence their name begins. Reads the
 * metadata defensively: a row written under an older schema still renders.
 */
export function auditSentence(entry: { action: string; metadata: Metadata }): string {
  const build: ((metadata: Metadata) => string) | undefined = isAuditAction(entry.action)
    ? SENTENCES[entry.action]
    : undefined
  return build ? build(entry.metadata) : `performed ${entry.action}`
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
