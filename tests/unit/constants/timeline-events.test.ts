import { describe, expect, expectTypeOf, it } from 'vitest'
import { AUDIT_ACTIONS, type AuditAction } from '@/constants/audit-actions'
import {
  auditEventName,
  TIMELINE_PRODUCT_EVENTS,
  timelineSentence,
  type TimelineAuditEvent,
  type TimelineEmailEvent,
  type TimelineProductEvent,
} from '@/constants/timeline-events'
import type { BrowserEvent } from '@/observability/analytics'
import { timelineRow } from '@/tests/fixtures/timeline'
import type { EmailEventType, TimelineRow } from '@/types/api.types'

/** A row of `event` from `source`, with `props`; express signed every server row. */
function row(
  event: string,
  source: TimelineRow['source'],
  props: TimelineRow['props'] = {}
): TimelineRow {
  return timelineRow({
    event,
    source,
    props,
    verified: source !== 'browser',
    path: null,
    sessionId: null,
  })
}

describe('the SP5a taxonomy, at the type level', () => {
  it('names the product events express sends, and no others', () => {
    expectTypeOf<TimelineProductEvent>().toEqualTypeOf<
      | 'user_signed_up'
      | 'user_signed_in'
      | 'user_signed_out'
      | 'password_changed'
      | 'password_reset_completed'
      | 'email_verified'
      | 'onboarding_step_completed'
    >()
  })

  it('names every email event type express forwards', () => {
    expectTypeOf<TimelineEmailEvent>().toEqualTypeOf<
      | 'email_delivered'
      | 'email_deferred'
      | 'email_bounced'
      | 'email_complained'
      | 'email_opened'
      | 'email_clicked'
      | 'email_failed'
    >()
  })

  it('sends a staff-forced sign-out as user_sessions_revoked, never as user_signed_out', () => {
    expectTypeOf<'user_sessions_revoked'>().toExtend<TimelineAuditEvent>()
    expectTypeOf<'user_signed_out'>().not.toExtend<TimelineAuditEvent>()
    expectTypeOf<'platform_member_auto_joined'>().toExtend<TimelineAuditEvent>()
    expectTypeOf(auditEventName('user.signed_out')).toEqualTypeOf<'user_sessions_revoked'>()
  })
})

describe('auditEventName', () => {
  it('maps each action as express does: dots to underscores, except the rename', () => {
    expect(auditEventName('invitation.created')).toBe('invitation_created')
    expect(auditEventName('platform.member.granted')).toBe('platform_member_granted')
    expect(auditEventName('user.signed_out')).toBe('user_sessions_revoked')
  })
})

describe('timelineSentence', () => {
  it.each([
    ['$pageview', { path: '/settings' }, 'Viewed /settings'],
    ['$pageview', { path: null }, 'Viewed a page'],
    ['$pageleave', { path: '/settings' }, 'Left /settings'],
    ['$autocapture', { elementText: 'Save' }, "Clicked 'Save'"],
    ['$autocapture', { elementText: null }, 'Clicked an element'],
    ['$rageclick', { elementText: 'Save' }, "Rage-clicked 'Save'"],
    ['$rageclick', { elementText: null }, 'Rage-clicked an element'],
  ])('says %s as a sentence', (event, fields, sentence) => {
    expect(timelineSentence(timelineRow({ event, ...fields }))).toBe(sentence)
  })

  it.each<[BrowserEvent, TimelineRow['props'], string]>([
    ['tenant_switched', {}, 'Switched tenant'],
    ['onboarding_checklist_opened', {}, 'Opened the getting-started checklist'],
    [
      'feature_cta_clicked',
      { cta: 'onboarding_open_settings' },
      'Followed a call to action (onboarding_open_settings)',
    ],
    ['feature_cta_clicked', {}, 'Followed a call to action (unnamed)'],
    ['table_filtered', { table: 'users' }, 'Filtered the users list'],
    ['table_exported', { table: 'users' }, 'Exported the users list'],
    ['command_palette_opened', {}, 'Opened the command palette'],
    ['command_palette_action_run', { action: 'user' }, 'Ran a command palette action (user)'],
  ])('says the registry event %s', (event, props, sentence) => {
    expect(timelineSentence(row(event, 'browser', props))).toBe(sentence)
  })

  it.each<[TimelineProductEvent, TimelineRow['props'], string]>([
    [
      'user_signed_up',
      { method: 'google', via_invitation: true },
      'Signed up with Google from an invitation',
    ],
    ['user_signed_up', { method: 'password', via_invitation: false }, 'Signed up with a password'],
    [
      'user_signed_up',
      { method: 'google', via_invitation: 'true' },
      'Signed up with Google from an invitation',
    ],
    ['user_signed_up', { method: 'google', via_invitation: 'false' }, 'Signed up with Google'],
    ['user_signed_in', { method: 'google' }, 'Signed in with Google'],
    ['user_signed_in', {}, 'Signed in'],
    ['user_signed_out', {}, 'Signed out'],
    ['password_changed', {}, 'Changed their password'],
    ['password_reset_completed', {}, 'Reset their password'],
    ['email_verified', {}, 'Verified their email address'],
    [
      'onboarding_step_completed',
      { step_key: 'configure_settings', how: 'auto', required: true },
      'Completed the onboarding step “configure_settings” automatically',
    ],
    [
      'onboarding_step_completed',
      { step_key: 'read_getting_started', how: 'manual', required: false },
      'Marked the onboarding step “read_getting_started” complete',
    ],
  ])('says the product event %s', (event, props, sentence) => {
    expect(timelineSentence(row(event, 'product', props))).toBe(sentence)
  })

  it('has a sentence for every product event', () => {
    for (const event of TIMELINE_PRODUCT_EVENTS) {
      expect(timelineSentence(row(event, 'product')), event).not.toBe(event)
    }
  })

  it.each<[EmailEventType, TimelineRow['props'], string]>([
    ['delivered', { template_key: 'tenant_invitation' }, 'Email delivered (Tenant invitation)'],
    ['deferred', {}, 'Email delivery delayed'],
    [
      'bounced',
      { template_key: 'password_reset', bounce_kind: 'hard' },
      'Email bounced (Password reset, hard bounce)',
    ],
    ['complained', {}, 'Email marked as spam'],
    ['opened', {}, 'Email opened'],
    ['clicked', { template_key: 'not_a_template' }, 'Email link clicked (not_a_template)'],
    ['failed', {}, 'Email failed at the provider'],
  ])('says the email event email_%s', (type, props, sentence) => {
    expect(timelineSentence(row(`email_${type}`, 'email', props))).toBe(sentence)
  })

  it('reads email_verified as the product event it is, not an email event', () => {
    expect(timelineSentence(row('email_verified', 'product'))).toBe('Verified their email address')
  })

  it.each<[AuditAction, TimelineRow['props'], string]>([
    ['tenant.suspended', { has_reason: true }, 'Suspended the tenant'],
    ['user.signed_out', { has_reason: true }, 'Signed a user out everywhere'],
    ['tenant.purged', {}, 'Permanently deleted a tenant'],
    [
      'onboarding.step_completed',
      { step_key: 'invite_teammate', how: 'manual', required: true },
      'Marked the onboarding step “invite_teammate” complete',
    ],
    ['onboarding.step_completed', {}, 'Marked an onboarding step complete'],
    ['member.role_changed', { target_type: 'membership' }, 'Role changed'],
    ['invitation.created', {}, 'Invitation sent'],
    ['email.resent', { template_key: 'password_reset' }, 'Email resent'],
    ['auth.reauthenticated', {}, 'Identity check (step-up)'],
  ])(
    'says the audit action %s in History-card wording where the row allows',
    (action, props, sentence) => {
      expect(timelineSentence(row(auditEventName(action), 'audit', props))).toBe(sentence)
    }
  )

  it('has a sentence for every audit action, none of them its raw event name', () => {
    for (const action of AUDIT_ACTIONS) {
      const event = auditEventName(action)
      const sentence = timelineSentence(row(event, 'audit'))
      expect(sentence, action).not.toBe(event)
      expect(sentence, action).not.toMatch(/unknown|performed/)
      expect(sentence.charAt(0), action).toBe(sentence.charAt(0).toUpperCase())
    }
  })

  it('gives a row express did not sign a sentence only when it is a browser event', () => {
    const forged = (event: string, fields: Partial<TimelineRow> = {}) =>
      timelineRow({ event, verified: false, path: null, ...fields })
    expect(
      timelineSentence(
        forged('user_deactivated', {
          source: 'audit',
          access: 'platform',
          props: { target_type: 'user', target_id: 'u1' },
        })
      )
    ).toBe('Unverified event "user_deactivated"')
    expect(timelineSentence(forged('invitation_created', { source: 'audit' }))).toBe(
      'Unverified event "invitation_created"'
    )
    expect(timelineSentence(forged('email_delivered', { source: 'email' }))).toBe(
      'Unverified event "email_delivered"'
    )
    expect(timelineSentence(forged('user_signed_in'))).toBe('Unverified event "user_signed_in"')
    expect(timelineSentence(forged('$web_vitals'))).toBe('Unverified event "$web_vitals"')
    expect(timelineSentence(forged('$pageview', { path: '/settings' }))).toBe('Viewed /settings')
    expect(timelineSentence(forged('tenant_switched', { source: 'audit' }))).toBe('Switched tenant')
  })

  it('gives the same event, verified, its audit sentence', () => {
    expect(
      timelineSentence(
        timelineRow({ event: 'user_deactivated', source: 'audit', verified: true, path: null })
      )
    ).toBe('Deactivated a user')
  })

  it('renders a verified event outside the taxonomy as its name', () => {
    expect(timelineSentence(timelineRow({ event: '$web_vitals', verified: true }))).toBe(
      '$web_vitals'
    )
    expect(timelineSentence(row('something_new', 'product'))).toBe('something_new')
    expect(timelineSentence(row('email_unknown_type', 'email'))).toBe('email_unknown_type')
    expect(timelineSentence(row('tenant_renamed', 'audit'))).toBe('tenant_renamed')
  })
})
