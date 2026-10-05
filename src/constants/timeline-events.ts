/**
 * @file A timeline row as a sentence, for every event in the SP5a taxonomy:
 * PostHog's browser events, the browser registry, express's product and
 * email events, and every audit action under the name express sends it.
 * An event outside the taxonomy renders its own name.
 */
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  auditSentence,
  type AuditAction,
} from '@/constants/audit-actions'
import { templateLabel } from '@/constants/email.constants'
import type { BrowserEvent } from '@/observability/analytics'
import type { EmailEventType, TimelineRow } from '@/types/api.types'

/** Mirrors express's `PRODUCT_EVENTS` (analytics.constants.ts). */
export const TIMELINE_PRODUCT_EVENTS = [
  'user_signed_up',
  'user_signed_in',
  'user_signed_out',
  'password_changed',
  'password_reset_completed',
  'email_verified',
  'onboarding_step_completed',
] as const

/** One of `TIMELINE_PRODUCT_EVENTS`. */
export type TimelineProductEvent = (typeof TIMELINE_PRODUCT_EVENTS)[number]

/** The events posthog-js captures on its own that a timeline words as a sentence; any other `$` event is unverified and says so. */
export const TIMELINE_POSTHOG_EVENTS = [
  '$pageview',
  '$pageleave',
  '$autocapture',
  '$rageclick',
] as const

/** One of `TIMELINE_POSTHOG_EVENTS`. */
export type TimelinePosthogEvent = (typeof TIMELINE_POSTHOG_EVENTS)[number]

/**
 * Mirrors express's `AUDIT_EVENT_RENAMES`: a staff-forced sign-out is sent
 * as `user_sessions_revoked`, so it never reads as the user signing out.
 */
export const AUDIT_EVENT_RENAMES = {
  'user.signed_out': 'user_sessions_revoked',
} as const satisfies Partial<Record<AuditAction, string>>

/** `a.b.c` as `a_b_c`, at the type level. */
type Underscored<S extends string> = S extends `${infer Head}.${infer Tail}`
  ? `${Head}_${Underscored<Tail>}`
  : S

/** The PostHog name express sends each audit action under. */
type AuditEventNameOf<A extends AuditAction> = A extends keyof typeof AUDIT_EVENT_RENAMES
  ? (typeof AUDIT_EVENT_RENAMES)[A]
  : Underscored<A>

/** Every audit-backed event name. */
export type TimelineAuditEvent = { [A in AuditAction]: AuditEventNameOf<A> }[AuditAction]

/** Every email event name: `email_` then the provider event type. */
export type TimelineEmailEvent = `email_${EmailEventType}`

/** The whole SP5a taxonomy, as a timeline can meet it. */
export type TimelineTaxonomyEvent =
  | TimelinePosthogEvent
  | BrowserEvent
  | TimelineProductEvent
  | TimelineEmailEvent
  | TimelineAuditEvent

/**
 * The PostHog name of an audit action, as express's `auditEventName` builds it.
 * @param action - The audit action.
 * @returns Its event name.
 */
export function auditEventName<A extends AuditAction>(action: A): AuditEventNameOf<A> {
  const renames: Partial<Record<AuditAction, string>> = AUDIT_EVENT_RENAMES
  return (renames[action] ?? action.replaceAll('.', '_')) as AuditEventNameOf<A>
}

/** Each audit event name back to its action. */
const AUDIT_ACTION_BY_EVENT = new Map<string, AuditAction>(
  AUDIT_ACTIONS.map((action) => [auditEventName(action), action])
)

/**
 * How each audit action reads on a timeline. A row carries only the
 * allowlisted props, not the audit metadata, so `sentence` (the History
 * card's `auditSentence` wording) is used only where that wording needs no
 * metadata the row lacks; anything else says its `label`, rather than "an
 * unknown role" or a success it cannot confirm.
 */
const AUDIT_WORDING: Record<AuditAction, 'sentence' | 'label'> = {
  'tenant.created': 'label',
  'tenant.updated': 'sentence',
  'tenant.settings_updated': 'sentence',
  'member.role_changed': 'label',
  'member.removed': 'label',
  'invitation.created': 'label',
  'invitation.resent': 'label',
  'invitation.revoked': 'label',
  'invitation.accepted': 'label',
  'platform.member.auto_joined': 'label',
  'platform.member.granted': 'label',
  'tenant.accessed_by_platform': 'label',
  'tenant.suspended': 'sentence',
  'tenant.reactivated': 'sentence',
  'tenant.archived': 'sentence',
  'tenant.owner_invited': 'label',
  'user.created': 'label',
  'user.updated': 'sentence',
  'user.deactivated': 'sentence',
  'user.reactivated': 'sentence',
  'user.signed_out': 'sentence',
  'user.password_setup_sent': 'label',
  'user.verification_resent': 'sentence',
  'user.deleted': 'sentence',
  'user.purged': 'sentence',
  'tenant.purged': 'sentence',
  'auth.reauthenticated': 'label',
  'email.resent': 'label',
  'email.suppression_lifted': 'label',
  'onboarding.dismissed': 'sentence',
  'onboarding.undismissed': 'sentence',
  'onboarding.step_completed': 'sentence',
  'onboarding.reminder_sent': 'sentence',
  'user.timeline_viewed': 'label',
  'tenant.timeline_viewed': 'label',
  'user.errors_viewed': 'label',
  'tenant.errors_viewed': 'label',
}

/**
 * Labels that would claim more than a row knows. `auth.reauthenticated`'s
 * filter label says "confirmed", but the row does not carry the outcome.
 */
const AUDIT_LABEL_OVERRIDES: Partial<Record<AuditAction, string>> = {
  'auth.reauthenticated': 'Identity check (step-up)',
}

/** The first letter in upper case: `auditSentence` returns the rest of a sentence. */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A string prop, or `undefined` when it is absent or not a string. */
function text(row: TimelineRow, key: keyof TimelineRow['props']): string | undefined {
  const value = row.props[key]
  return typeof value === 'string' ? value : undefined
}

/** An audit row's sentence, from the props a timeline row carries. */
function auditTimelineSentence(action: AuditAction, row: TimelineRow): string {
  if (AUDIT_WORDING[action] === 'label') {
    return AUDIT_LABEL_OVERRIDES[action] ?? AUDIT_ACTION_LABELS[action]
  }
  const stepKey = text(row, 'step_key')
  return capitalised(auditSentence({ action, metadata: stepKey === undefined ? {} : { stepKey } }))
}

/** A boolean prop, which express may send as `true` or as the string `'true'`. */
function flag(row: TimelineRow, key: 'required' | 'via_invitation' | 'has_reason'): boolean {
  const value = row.props[key]
  return value === true || value === 'true'
}

/** "with Google", "with a password", or nothing for a method this build does not know. */
function viaMethod(row: TimelineRow): string {
  const method = text(row, 'method')
  if (method === 'google') return ' with Google'
  if (method === 'password') return ' with a password'
  return ''
}

/** The quoted step key, or "a step" when the row has none. */
function step(row: TimelineRow): string {
  const key = text(row, 'step_key')
  return key === undefined ? 'an onboarding step' : `the onboarding step “${key}”`
}

/** A list's or a control's fixed key, or a fallback when the row has none. */
function key(row: TimelineRow, prop: 'cta' | 'table' | 'action', fallback: string): string {
  return text(row, prop) ?? fallback
}

const POSTHOG_SENTENCES: Record<TimelinePosthogEvent, (row: TimelineRow) => string> = {
  $pageview: (row) => `Viewed ${row.path ?? 'a page'}`,
  $pageleave: (row) => `Left ${row.path ?? 'a page'}`,
  $autocapture: (row) =>
    row.elementText === null ? 'Clicked an element' : `Clicked '${row.elementText}'`,
  $rageclick: (row) =>
    row.elementText === null ? 'Rage-clicked an element' : `Rage-clicked '${row.elementText}'`,
}

const BROWSER_SENTENCES: Record<BrowserEvent, (row: TimelineRow) => string> = {
  tenant_switched: () => 'Switched tenant',
  onboarding_checklist_opened: () => 'Opened the getting-started checklist',
  feature_cta_clicked: (row) => `Followed a call to action (${key(row, 'cta', 'unnamed')})`,
  table_filtered: (row) => `Filtered the ${key(row, 'table', 'unnamed')} list`,
  table_exported: (row) => `Exported the ${key(row, 'table', 'unnamed')} list`,
  command_palette_opened: () => 'Opened the command palette',
  command_palette_action_run: (row) =>
    `Ran a command palette action (${key(row, 'action', 'unnamed')})`,
}

const PRODUCT_SENTENCES: Record<TimelineProductEvent, (row: TimelineRow) => string> = {
  user_signed_up: (row) =>
    `Signed up${viaMethod(row)}${flag(row, 'via_invitation') ? ' from an invitation' : ''}`,
  user_signed_in: (row) => `Signed in${viaMethod(row)}`,
  user_signed_out: () => 'Signed out',
  password_changed: () => 'Changed their password',
  password_reset_completed: () => 'Reset their password',
  email_verified: () => 'Verified their email address',
  onboarding_step_completed: (row) =>
    text(row, 'how') === 'auto'
      ? `Completed ${step(row)} automatically`
      : `Marked ${step(row)} complete`,
}

const EMAIL_SENTENCES: Record<EmailEventType, string> = {
  delivered: 'Email delivered',
  deferred: 'Email delivery delayed',
  bounced: 'Email bounced',
  complained: 'Email marked as spam',
  opened: 'Email opened',
  clicked: 'Email link clicked',
  failed: 'Email failed at the provider',
}

/** The email event's type, when `event` is `email_<type>` for a type this build knows. */
function emailType(event: string): EmailEventType | undefined {
  const type = event.startsWith('email_') ? event.slice('email_'.length) : ''
  return Object.hasOwn(EMAIL_SENTENCES, type) ? (type as EmailEventType) : undefined
}

/** " (Tenant invitation, hard bounce)", or nothing when the row names neither. */
function emailDetail(row: TimelineRow): string {
  const template = text(row, 'template_key')
  const bounce = text(row, 'bounce_kind')
  const parts = [
    ...(template === undefined ? [] : [templateLabel(template)]),
    ...(bounce === undefined ? [] : [`${bounce} bounce`]),
  ]
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

/**
 * What happened, as one sentence: "Viewed /settings", "Clicked 'Save'",
 * "Signed in with Google", "Email delivered (Tenant invitation)", or an
 * audit action in its History-card wording. The source decides between
 * names two sources share (`onboarding_step_completed`, and `email_verified`
 * against the `email_` events). A row express did not sign gets a sentence
 * only when it is a browser event (posthog-js's own, or the registry's);
 * anything else unverified says so, naming the event as sent, since a
 * forged `user_deactivated` must not read as a staff action. A verified
 * event outside the taxonomy renders its name.
 * @param row - The timeline row.
 * @returns The sentence.
 */
export function timelineSentence(row: TimelineRow): string {
  if (!row.verified) {
    if (Object.hasOwn(POSTHOG_SENTENCES, row.event)) {
      return POSTHOG_SENTENCES[row.event as TimelinePosthogEvent](row)
    }
    return Object.hasOwn(BROWSER_SENTENCES, row.event)
      ? BROWSER_SENTENCES[row.event as BrowserEvent](row)
      : `Unverified event "${row.event}"`
  }
  const source = row.source
  if (source === 'audit') {
    const action = AUDIT_ACTION_BY_EVENT.get(row.event)
    return action === undefined ? row.event : auditTimelineSentence(action, row)
  }
  if (source === 'email') {
    const type = emailType(row.event)
    return type === undefined ? row.event : `${EMAIL_SENTENCES[type]}${emailDetail(row)}`
  }
  if (source === 'product') {
    return Object.hasOwn(PRODUCT_SENTENCES, row.event)
      ? PRODUCT_SENTENCES[row.event as TimelineProductEvent](row)
      : row.event
  }
  if (Object.hasOwn(POSTHOG_SENTENCES, row.event)) {
    return POSTHOG_SENTENCES[row.event as TimelinePosthogEvent](row)
  }
  return Object.hasOwn(BROWSER_SENTENCES, row.event)
    ? BROWSER_SENTENCES[row.event as BrowserEvent](row)
    : row.event
}
