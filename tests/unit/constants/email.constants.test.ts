import { describe, expect, it } from 'vitest'
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

  it('offers a resend for the four token emails and none for the two security notices', () => {
    const resendable = EMAIL_TEMPLATE_KEYS.filter((key) => EMAIL_TEMPLATES[key].resendLabel)
    expect(resendable.sort()).toEqual(
      ['account_setup', 'email_verification', 'password_reset', 'tenant_invitation'].sort()
    )
    expect(EMAIL_TEMPLATES.email_verification.resendLabel).toBe('Issues a new verification link.')
    expect(EMAIL_TEMPLATES.password_reset.resendLabel).toBe(
      'Issues a new password link — account setup or reset, whichever applies now.'
    )
    expect(EMAIL_TEMPLATES.account_setup.resendLabel).toBe(
      EMAIL_TEMPLATES.password_reset.resendLabel
    )
    expect(EMAIL_TEMPLATES.tenant_invitation.resendLabel).toBe('Sends the invitation again.')
  })

  it('names a template this build does not know by its raw key', () => {
    expect(templateLabel('tenant_invitation')).toBe('Tenant invitation')
    expect(templateLabel('onboarding_reminder')).toBe('Onboarding reminder')
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
