/**
 * @file Labels for the email tracking pages, mirroring express's template
 * registry, message statuses and stats groups, so every page names them alike.
 */
import type {
  EmailEventType,
  EmailGroup,
  EmailMessageStatus,
  EmailTemplateKey,
  SuppressionReason,
} from '@/types/api.types'

/**
 * Each template's label and, for the four that carry a token, the sentence
 * the Resend dialog shows: a resend re-runs the originating action, which
 * issues a fresh link. The two security notices have no resend.
 */
export const EMAIL_TEMPLATES: Record<
  EmailTemplateKey,
  { label: string; resendLabel: string | null }
> = {
  email_verification: {
    label: 'Email verification',
    resendLabel: 'Issues a new verification link.',
  },
  password_reset: {
    label: 'Password reset',
    resendLabel: 'Issues a new password link — account setup or reset, whichever applies now.',
  },
  account_setup: {
    label: 'Account setup',
    resendLabel: 'Issues a new password link — account setup or reset, whichever applies now.',
  },
  tenant_invitation: { label: 'Tenant invitation', resendLabel: 'Sends the invitation again.' },
  password_changed: { label: 'Password changed', resendLabel: null },
  registration_attempt: { label: 'Registration attempt', resendLabel: null },
}

/** Whether `key` is a template this build knows. */
export function isEmailTemplateKey(key: string): key is EmailTemplateKey {
  return Object.hasOwn(EMAIL_TEMPLATES, key)
}

/** A template's label, or its raw key when the API sends one this build does not know. */
export function templateLabel(key: string): string {
  return isEmailTemplateKey(key) ? EMAIL_TEMPLATES[key].label : key
}

/** How a status badge reads: `neutral` is the secondary variant, `muted` an outline with muted text. */
export type EmailBadgeTone = 'success' | 'neutral' | 'warning' | 'destructive' | 'muted'

/** Each message status's label and badge tone. */
export const EMAIL_STATUS_BADGE: Record<
  EmailMessageStatus,
  { label: string; tone: EmailBadgeTone }
> = {
  queued: { label: 'Queued', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'neutral' },
  deferred: { label: 'Deferred', tone: 'warning' },
  delivered: { label: 'Delivered', tone: 'success' },
  bounced: { label: 'Bounced', tone: 'destructive' },
  complained: { label: 'Complained', tone: 'destructive' },
  failed: { label: 'Failed', tone: 'destructive' },
  suppressed: { label: 'Suppressed', tone: 'muted' },
}

/**
 * The five disjoint groups the Overview and Deliverability charts stack, each
 * on one of the five existing chart tokens.
 */
export const EMAIL_GROUPS: Record<EmailGroup, { label: string; color: string }> = {
  delivered: { label: 'Delivered', color: 'var(--chart-2)' },
  sent: { label: 'Sent', color: 'var(--chart-1)' },
  undelivered: { label: 'Undelivered', color: 'var(--chart-4)' },
  complained: { label: 'Complained', color: 'var(--chart-3)' },
  suppressed: { label: 'Suppressed', color: 'var(--chart-5)' },
}

/** A suppression's cause, as the Suppressions table and the detail banner say it. */
export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  hard_bounce: 'Hard bounce',
  complaint: 'Spam complaint',
}

/** Each provider event type, as the timeline names it. */
export const EMAIL_EVENT_LABELS: Record<EmailEventType, string> = {
  delivered: 'Delivered',
  deferred: 'Delivery delayed',
  bounced: 'Bounced',
  complained: 'Marked as spam',
  opened: 'Opened',
  clicked: 'Link clicked',
  failed: 'Provider failure',
}

/** A webhook provider's display name, or the API's own id for one this build does not know. */
export function providerLabel(provider: string): string {
  const labels: Record<string, string> = { resend: 'Resend', fake: 'Local test provider' }
  return labels[provider] ?? provider
}

/** The toast once the API has taken a resend. */
export const RESEND_REQUESTED = 'Resend requested — it appears in the timeline shortly'

/** The warning toast when the originating action ran but reports that its email did not go. */
export const RESEND_NOT_SENT =
  'The resend was recorded, but its email could not be sent. Try again shortly.'
