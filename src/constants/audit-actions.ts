import {
  AUDIT_ACTIONS,
  type AuditAction,
  type RetiredAuditAction,
} from '@/constants/audit-action-names'
import { billingDateTime } from '@/constants/billing-labels'
import { templateLabel } from '@/constants/email.constants'
import { entitlementLabel } from '@/constants/entitlements'
import { MEMBERSHIP_ROLES, ROLE_LABELS, type MembershipRole } from '@/constants/roles'
import { formatBillingDate, formatInr } from '@/lib/billing-format'
import { formatCount } from '@/lib/format'
import { countOf } from '@/lib/plural'

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
  'user.passkey_created': 'Passkey created',
  'user.passkey_deleted': 'Passkey deleted',
  'user.passkeys_cleared_on_claim': 'Passkeys cleared on claim',
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
  'billing.checkout_started': 'Checkout started',
  'billing.cancel_scheduled': 'Paid cancelled by owner',
  'billing.interval_switch_scheduled': 'Billing switch scheduled',
  'billing.card_change_started': 'Card change started',
  'billing.grant_expired': 'Grant expired',
  'billing.viewed': 'Billing viewed',
  'billing.resynced': 'Billing resynced',
  'billing.trial_extended': 'Trial set by staff',
  'billing.grant_added': 'Grant added',
  'billing.grant_revoked': 'Grant revoked',
  'billing.cancelled_by_staff': 'Subscription cancelled by staff',
  'plan.updated': 'Plan edited',
  'plan.price_created': 'Price added',
  'billing.settings_updated': 'Billing settings changed',
}

/** An audit entry's free-form metadata, whose fields are checked before use. */
type Metadata = Record<string, unknown>

/** Where a passkey changed, from the `app` that made the request: Apex, the customer app, or nowhere named. */
function where(metadata: Metadata): string {
  const app = text(metadata, 'app')
  if (app === 'apex') return ' in Apex'
  if (app === 'web') return ' in the customer app'
  return ''
}

/** The authenticator's listed name in parentheses, or nothing when the row has none. */
function providerNote(metadata: Metadata): string {
  const provider = text(metadata, 'provider')
  return provider === undefined ? '' : ` (${provider})`
}

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

/** "yearly" or "monthly" from an `interval` field, or undefined when it is neither. */
function cadence(metadata: Metadata): string | undefined {
  const interval = text(metadata, 'interval')
  if (interval === 'year') return 'yearly'
  if (interval === 'month') return 'monthly'
  return undefined
}

/** A grant's entitlement by its label ("Members"), its key when unknown, or "an entitlement" when the entry names none. */
function grantKey(metadata: Metadata): string {
  const key = text(metadata, 'key')
  return key === undefined ? 'an entitlement' : entitlementLabel(key)
}

/**
 * The day a billing entry's moment falls on in the tenant's zone, as the
 * Billing tab writes it ("26 November 2026"), so the log and the tab name the
 * same day. Without the zone (a log across tenants) the day alone would be a
 * guess, so it names the moment in UTC with the zone said: "26 November 2026
 * at 23:59 UTC". Null when the value is missing or not a date.
 * @param iso - The stored moment.
 * @param timeZone - The tenant's `settings.timezone`, or undefined when the log spans tenants.
 */
function billingDay(iso: string | undefined, timeZone: string | undefined): string | null {
  if (iso === undefined || Number.isNaN(new Date(iso).getTime())) return null
  return timeZone === undefined ? billingDateTime(iso, 'UTC') : formatBillingDate(iso, timeZone)
}

/**
 * A trial staff set, which extends a running trial or starts one on a Free
 * tenant: "set the trial to end on 9 November 2026 (7 days)". The end and the
 * days are each left out when missing or mistyped.
 */
function trialSet(metadata: Metadata, timeZone: string | undefined): string {
  const days = metadata.days
  const date = billingDay(text(metadata, 'trialEndsAt'), timeZone)
  const length = typeof days === 'number' ? countOf(days, 'days') : null
  if (date === null) return length === null ? 'set the trial' : `set the trial (${length})`
  return `set the trial to end on ${date}${length === null ? '' : ` (${length})`}`
}

/**
 * A grant's value and end: "granted Members (10) until 1 December 2026",
 * "granted Members (no limit)". The end is the last moment of the day staff
 * chose, in the tenant's zone, so it reads as that day there.
 */
function grantAdded(metadata: Metadata, timeZone: string | undefined): string {
  const value = metadata.value
  const shown =
    value === null
      ? ' (no limit)'
      : value === true
        ? ' (on)'
        : typeof value === 'number'
          ? ` (${formatCount(value)})`
          : ''
  const until = billingDay(text(metadata, 'expiresAt'), timeZone)
  return `granted ${grantKey(metadata)}${shown}${until === null ? '' : ` until ${until}`}`
}

/** The plan's name after the edit, from `after.name`, or undefined when the entry lacks it. */
function editedPlanName(metadata: Metadata): string | undefined {
  const after = metadata.after
  if (typeof after !== 'object' || after === null) return undefined
  return text(after as Metadata, 'name')
}

/** A new price: "added a monthly price of ₹1,299", leaving out a missing interval or amount. */
function priceCreated(metadata: Metadata): string {
  const every = cadence(metadata)
  const amount = metadata.amountMinor
  const of = typeof amount === 'number' ? ` of ${formatInr(amount)}` : ''
  return `added a ${every === undefined ? '' : `${every} `}price${of}`
}

/** Each billing setting as a sentence names it; a field this build does not know keeps its name. */
const BILLING_SETTING_WORDS: Readonly<Record<string, string>> = {
  trialEnabled: 'trials on or off',
  trialDays: 'trial length',
  pastDueGraceDays: 'grace period',
}

/**
 * A billing settings save: the settings it changed, in words, or a save
 * with no changes, which express records too. A list with no field names
 * in it says nothing about what changed, so it reads as a plain change. express stores the field
 * names under `changedFields`, not the `changed` other updates use.
 */
function settingsChange(metadata: Metadata): string {
  if (!Array.isArray(metadata.changedFields)) return 'changed the billing settings'
  if (metadata.changedFields.length === 0) return 'saved the billing settings with no changes'
  const fields = texts(metadata, 'changedFields')
  if (fields.length === 0) return 'changed the billing settings'
  const words = fields.map((field) => BILLING_SETTING_WORDS[field] ?? field)
  return `changed the billing settings (${words.join(', ')})`
}

/** `: “why”`, or nothing when the entry carries no reason. */
function because(metadata: Metadata): string {
  const reason = text(metadata, 'reason')
  return reason ? `: “${reason}”` : ''
}

/**
 * Each action's sentence, from its metadata and, for the billing dates, the
 * tenant's zone (undefined on a log across tenants).
 */
const SENTENCES: Record<AuditAction, (metadata: Metadata, timeZone: string | undefined) => string> =
  {
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
      m.app === 'apex'
        ? 'sent a staff member a sign-in link to Apex'
        : 'sent a user a sign-in link',
    'user.passkey_created': (m) => `created a passkey${providerNote(m)}${where(m)}`,
    'user.passkey_deleted': (m) => `deleted a passkey${providerNote(m)}${where(m)}`,
    'user.passkeys_cleared_on_claim': (m) =>
      typeof m.count === 'number'
        ? `deleted ${m.count} ${m.count === 1 ? 'passkey' : 'passkeys'} from an unverified account when its owner claimed it`
        : 'deleted the passkeys on an unverified account when its owner claimed it',
    'user.deleted': (m) => `deleted a user${because(m)}`,
    'user.purged': (m) => `permanently deleted a user${because(m)}`,
    'tenant.purged': (m) => {
      const name = text(m, 'name')
      return `permanently deleted ${name ? `the tenant ${name}` : 'a tenant'}${because(m)}`
    },
    // Apex confirms by passkey or email link; the `'google'` arms label rows written before Google step-up was dropped.
    'auth.step_up_confirmed': (m) =>
      m.method === 'google'
        ? 'confirmed it was them with Google'
        : m.method === 'passkey'
          ? 'confirmed it was them with a passkey'
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
    'billing.checkout_started': (m) => {
      const every = cadence(m)
      return every === undefined ? 'started a Paid checkout' : `started a ${every} Paid checkout`
    },
    // Express records a cycle-end cancel, a past-due cancel and an uncharged one (both now) alike, with no metadata.
    'billing.cancel_scheduled': () => 'cancelled Paid',
    'billing.interval_switch_scheduled': (m) => {
      const every = cadence(m)
      return every === undefined
        ? 'scheduled a billing switch'
        : `scheduled a switch to ${every} billing`
    },
    'billing.card_change_started': () => 'started a payment method change',
    'billing.grant_expired': (m) => `marked the ${grantKey(m)} grant expired`,
    'billing.viewed': () => 'viewed the tenant’s billing',
    'billing.resynced': (m) => `resynced billing with the payment provider${because(m)}`,
    'billing.trial_extended': (m, zone) => `${trialSet(m, zone)}${because(m)}`,
    'billing.grant_added': (m, zone) => `${grantAdded(m, zone)}${because(m)}`,
    'billing.grant_revoked': (m) => `revoked the ${grantKey(m)} grant${because(m)}`,
    'billing.cancelled_by_staff': (m) => {
      const when = text(m, 'when')
      const at = when === 'now' ? ' now' : when === 'cycle_end' ? ' at its period end' : ''
      return `cancelled the subscription${at}${because(m)}`
    },
    'plan.updated': (m) => {
      const name = editedPlanName(m)
      return `${name === undefined ? 'edited a plan' : `edited the ${name} plan`}${because(m)}`
    },
    'plan.price_created': (m) => `${priceCreated(m)}${because(m)}`,
    'billing.settings_updated': (m) => `${settingsChange(m)}${because(m)}`,
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
 * @param entry - The audit entry.
 * @param timeZone - The tenant's `settings.timezone` on a log of one tenant, so a
 * billing date names the tenant's day; undefined on a log across tenants.
 */
export function auditSentence(
  entry: { action: string; metadata: Metadata },
  timeZone?: string
): string {
  if (isAuditAction(entry.action)) return SENTENCES[entry.action](entry.metadata, timeZone)
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
