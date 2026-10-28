import { describe, expect, it } from 'vite-plus/test'
import {
  EMAIL_EVENT_LABELS,
  EMAIL_GROUPS,
  EMAIL_STATUS_BADGE,
  EMAIL_TEMPLATES,
  isEmailTemplateKey,
  providerLabel,
  templateLabel,
} from '@/constants/email.constants'
import { EMAIL_GROUP_KEYS, EMAIL_MESSAGE_STATUSES, EMAIL_TEMPLATE_KEYS } from '@/types/api.types'

describe('EMAIL_TEMPLATES', () => {
  it('labels every template express sends', () => {
    expect(Object.keys(EMAIL_TEMPLATES).sort()).toEqual([...EMAIL_TEMPLATE_KEYS].sort())
    for (const key of EMAIL_TEMPLATE_KEYS) expect(EMAIL_TEMPLATES[key].label).not.toBe('')
  })

  it('matches express’s template keys, the twenty-five it sends and the five it retired', () => {
    expect([...EMAIL_TEMPLATE_KEYS].sort()).toEqual(
      [
        'tenant_invitation',
        'onboarding_reminder',
        'maintenance_mode_changed',
        'sign_in_link',
        'step_up_link',
        'welcome',
        'invitation_confirm',
        'passkey_created',
        'passkey_deleted',
        'trial_started',
        'trial_midpoint',
        'trial_ending',
        'trial_ends_today',
        'trial_ended',
        'paid_welcome',
        'renewal_upcoming',
        'payment_failed',
        'moved_to_free',
        'paid_cancelled',
        'interval_switch_scheduled',
        'payer_left',
        'upgrade_requested',
        'upgrade_request_fulfilled',
        'winback',
        'tax_document_issued',
        'email_verification',
        'password_reset',
        'registration_attempt',
        'password_changed',
        'account_setup',
      ].sort()
    )
  })

  it('labels the tax document notice and offers no resend', () => {
    expect(EMAIL_TEMPLATES.tax_document_issued).toEqual({
      label: 'Tax document issued',
      resendLabel: null,
    })
  })

  it('offers a resend for sign_in_link and welcome, and none for step_up_link or a retired key', () => {
    const resendable = EMAIL_TEMPLATE_KEYS.filter((key) => EMAIL_TEMPLATES[key].resendLabel)
    expect(resendable.sort()).toEqual(
      ['invitation_confirm', 'sign_in_link', 'tenant_invitation', 'welcome'].sort()
    )
    expect(EMAIL_TEMPLATES.sign_in_link).toEqual({
      label: 'Sign-in link',
      resendLabel: 'Sends a new sign-in link.',
    })
    expect(EMAIL_TEMPLATES.welcome).toEqual({
      label: 'Welcome',
      resendLabel: 'Sends a new sign-in link.',
    })
    expect(EMAIL_TEMPLATES.step_up_link).toEqual({
      label: 'Identity confirmation link',
      resendLabel: null,
    })
    expect(EMAIL_TEMPLATES.invitation_confirm).toEqual({
      label: 'Invitation confirmation',
      resendLabel: 'Sends the invitation again.',
    })
    expect(EMAIL_TEMPLATES.passkey_created).toEqual({ label: 'Passkey created', resendLabel: null })
    expect(EMAIL_TEMPLATES.passkey_deleted).toEqual({ label: 'Passkey deleted', resendLabel: null })
    expect(EMAIL_TEMPLATES.tenant_invitation.resendLabel).toBe('Sends the invitation again.')
    for (const retired of [
      'email_verification',
      'password_reset',
      'account_setup',
      'password_changed',
      'registration_attempt',
    ] as const) {
      expect(EMAIL_TEMPLATES[retired].resendLabel).toBeNull()
      expect(EMAIL_TEMPLATES[retired].label).not.toBe('')
    }
    expect(EMAIL_TEMPLATES.password_reset.label).toBe('Password reset')
  })

  it('names a template this build does not know by its raw key', () => {
    expect(templateLabel('tenant_invitation')).toBe('Tenant invitation')
    expect(templateLabel('onboarding_reminder')).toBe('Onboarding reminder')
    expect(templateLabel('maintenance_mode_changed')).toBe('Maintenance mode changed')
    expect(templateLabel('sign_in_link')).toBe('Sign-in link')
    expect(templateLabel('welcome_v2')).toBe('welcome_v2')
    expect(isEmailTemplateKey('toString')).toBe(false)
  })
})

describe('EMAIL_STATUS_BADGE', () => {
  it('gives each status the tone the spec assigns', () => {
    expect(Object.keys(EMAIL_STATUS_BADGE).sort()).toEqual([...EMAIL_MESSAGE_STATUSES].sort())
    expect(
      Object.fromEntries(EMAIL_MESSAGE_STATUSES.map((s) => [s, EMAIL_STATUS_BADGE[s].tone]))
    ).toEqual({
      queued: 'neutral',
      sent: 'neutral',
      deferred: 'warning',
      delivered: 'success',
      bounced: 'destructive',
      complained: 'destructive',
      failed: 'destructive',
      suppressed: 'muted',
    })
  })
})

describe('EMAIL_GROUPS', () => {
  it('draws the five groups on exactly the five existing chart tokens', () => {
    expect(Object.keys(EMAIL_GROUPS)).toEqual([...EMAIL_GROUP_KEYS])
    expect(EMAIL_GROUP_KEYS.map((group) => EMAIL_GROUPS[group].color).sort()).toEqual([
      'var(--chart-1)',
      'var(--chart-2)',
      'var(--chart-3)',
      'var(--chart-4)',
      'var(--chart-5)',
    ])
  })
})

describe('timeline labels', () => {
  it('names every event type and the known providers', () => {
    for (const label of Object.values(EMAIL_EVENT_LABELS)) expect(label).not.toBe('')
    expect(providerLabel('resend')).toBe('Resend')
    expect(providerLabel('postmark')).toBe('postmark')
  })
})
