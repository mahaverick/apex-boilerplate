import { describe, expect, it } from 'vitest'
import {
  actorName,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  auditSentence,
  isAuditAction,
} from '@/constants/audit-actions'
import { EMAIL_ID, EMAIL_ID_2, INVITATION_ID, USER_ID, USER_ID_2 } from '@/tests/fixtures/ids'

describe('AUDIT_ACTIONS', () => {
  it('lists exactly the thirty-nine actions the API writes', () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        'invitation.accepted',
        'invitation.created',
        'invitation.resent',
        'invitation.revoked',
        'member.removed',
        'member.role_changed',
        'platform.member.auto_joined',
        'platform.member.granted',
        'tenant.accessed_by_platform',
        'tenant.created',
        'tenant.settings_updated',
        'tenant.updated',
        'auth.reauthenticated',
        'email.resent',
        'email.suppression_lifted',
        'onboarding.dismissed',
        'onboarding.reminder_sent',
        'onboarding.step_completed',
        'onboarding.undismissed',
        'tenant.archived',
        'tenant.owner_invited',
        'tenant.purged',
        'tenant.reactivated',
        'tenant.suspended',
        'user.created',
        'user.deactivated',
        'user.deleted',
        'user.password_setup_sent',
        'user.purged',
        'user.reactivated',
        'user.signed_out',
        'user.updated',
        'user.verification_resent',
        'user.timeline_viewed',
        'tenant.timeline_viewed',
        'user.errors_viewed',
        'tenant.errors_viewed',
        'user.flags_evaluated',
        'platform.maintenance_mode_changed',
      ].sort()
    )
    for (const action of AUDIT_ACTIONS) expect(AUDIT_ACTION_LABELS[action]).not.toBe('')
  })

  it('recognises its own actions and nothing else', () => {
    expect(isAuditAction('member.removed')).toBe(true)
    expect(isAuditAction('member.deleted')).toBe(false)
  })
})

describe('auditSentence', () => {
  it.each([
    ['tenant.created', { name: 'Acme Corp', slug: 'acme' }, 'created the tenant “Acme Corp”'],
    ['tenant.updated', { changed: ['name', 'website'] }, 'updated the tenant (name, website)'],
    ['tenant.settings_updated', { changed: ['timezone'] }, 'changed the settings (timezone)'],
    [
      'member.role_changed',
      { userId: USER_ID_2, from: 'viewer', to: 'editor' },
      'changed a member’s role from Viewer to Editor',
    ],
    [
      'member.removed',
      { userId: USER_ID_2, role: 'editor', self: false },
      'removed a member (Editor)',
    ],
    ['member.removed', { userId: USER_ID_2, role: 'editor', self: true }, 'left the tenant'],
    [
      'invitation.created',
      { role: 'viewer', emailDomain: 'example.com' },
      'invited someone at example.com as Viewer',
    ],
    [
      'invitation.resent',
      { role: 'viewer', emailDomain: 'example.com' },
      'resent the invitation to someone at example.com',
    ],
    [
      'invitation.revoked',
      { role: 'viewer', emailDomain: 'example.com' },
      'revoked the invitation to someone at example.com',
    ],
    [
      'invitation.accepted',
      { role: 'admin', invitationId: INVITATION_ID },
      'accepted an invitation as Admin',
    ],
    [
      'platform.member.auto_joined',
      { userId: USER_ID_2, emailDomain: 'corp.test' },
      'added someone at corp.test to the platform as Viewer (auto-join)',
    ],
    [
      'platform.member.granted',
      { userId: USER_ID_2, role: 'admin', via: 'script' },
      'granted a platform member the Admin role',
    ],
    [
      'tenant.accessed_by_platform',
      { platformRole: 'viewer' },
      'opened this tenant as platform staff (Viewer)',
    ],
    ['user.created', { emailDomain: 'corp.test' }, 'created an account for someone at corp.test'],
    ['user.updated', { changed: ['firstName'] }, 'updated a user (firstName)'],
    ['user.deactivated', { reason: 'left the company' }, 'deactivated a user: “left the company”'],
    ['user.reactivated', { reason: 'rehired' }, 'reactivated a user: “rehired”'],
    ['user.signed_out', { reason: 'lost laptop' }, 'signed a user out everywhere: “lost laptop”'],
    ['user.deleted', { reason: 'GDPR request' }, 'deleted a user: “GDPR request”'],
    ['user.password_setup_sent', { kind: 'setup' }, 'sent a user a set-password link'],
    ['user.password_setup_sent', { kind: 'reset' }, 'sent a user a password reset link'],
    ['user.verification_resent', {}, 'resent a user’s verification email'],
    ['tenant.suspended', { reason: 'unpaid' }, 'suspended the tenant: “unpaid”'],
    ['tenant.reactivated', { reason: 'paid' }, 'reactivated the tenant: “paid”'],
    ['tenant.archived', { reason: 'closed' }, 'archived the tenant: “closed”'],
    [
      'tenant.owner_invited',
      { emailDomain: 'acme.test', inviteeUserId: null, reason: 'new owner' },
      'invited someone at acme.test as the owner: “new owner”',
    ],
    [
      'tenant.owner_invited',
      { emailDomain: 'acme.test', inviteeUserId: null, reason: null },
      'invited someone at acme.test as the owner',
    ],
    [
      'user.purged',
      { reason: 'erasure request', emailDomain: 'corp.test' },
      'permanently deleted a user: “erasure request”',
    ],
    [
      'tenant.purged',
      { reason: 'contract ended', name: 'Acme Corp', slug: 'acme', memberCount: 2 },
      'permanently deleted the tenant Acme Corp: “contract ended”',
    ],
    ['auth.reauthenticated', { outcome: 'success' }, 'confirmed their identity'],
    ['auth.reauthenticated', { outcome: 'failure' }, 'failed to confirm their identity'],
    [
      'email.resent',
      { reason: 'lost in spam', emailDomain: 'acme.test', templateKey: 'tenant_invitation' },
      'resent an email (Tenant invitation) to someone at acme.test: “lost in spam”',
    ],
    [
      'email.resent',
      { reason: 'expired', emailDomain: 'acme.test', templateKey: 'welcome_v2' },
      'resent an email (welcome_v2) to someone at acme.test: “expired”',
    ],
    [
      'email.suppression_lifted',
      { reason: 'mailbox fixed', emailDomain: 'corp.test' },
      'lifted the email suppression on an address at corp.test: “mailbox fixed”',
    ],
    ['onboarding.dismissed', {}, 'dismissed the getting-started checklist'],
    ['onboarding.undismissed', {}, 'brought back the getting-started checklist'],
    [
      'onboarding.step_completed',
      { reason: 'Done on the kickoff call', stepKey: 'configure_settings' },
      'marked the onboarding step “configure_settings” complete: “Done on the kickoff call”',
    ],
    [
      'onboarding.reminder_sent',
      {
        reason: 'Stalled for a week',
        recipientCount: 2,
        emailDomains: ['acme.test', 'corp.test'],
        messageIds: [EMAIL_ID, EMAIL_ID_2],
      },
      'sent an onboarding reminder to 2 owners at acme.test, corp.test: “Stalled for a week”',
    ],
    [
      'onboarding.reminder_sent',
      { reason: 'Nudge', recipientCount: 1, emailDomains: ['acme.test'], messageIds: [EMAIL_ID] },
      'sent an onboarding reminder to 1 owner at acme.test: “Nudge”',
    ],
    [
      'user.timeline_viewed',
      { range: '7d', view: 'all' },
      'viewed a user’s timeline (last 7 days, Everything)',
    ],
    [
      'tenant.timeline_viewed',
      { range: '90d', view: 'key' },
      'viewed a tenant’s timeline (last 90 days, Key events)',
    ],
    ['user.errors_viewed', {}, 'viewed a user’s errors'],
    ['tenant.errors_viewed', {}, 'viewed a tenant’s errors'],
    [
      'user.flags_evaluated',
      { tenantId: null, clientApp: 'react' },
      'evaluated a user’s feature flags for the customer app',
    ],
    [
      'user.flags_evaluated',
      { tenantId: '01a10b7b-a119-7593-8fb8-e2c6c12a8c57', clientApp: 'react' },
      'evaluated a user’s feature flags for the customer app, in a tenant',
    ],
    [
      'user.flags_evaluated',
      { tenantId: null, clientApp: 'apex' },
      'evaluated a user’s feature flags for Apex',
    ],
    ['user.flags_evaluated', {}, 'evaluated a user’s feature flags'],
    [
      'platform.maintenance_mode_changed',
      { from: 'off', to: 'full', reason: 'DB upgrade', messageChanged: true },
      'turned on full maintenance: “DB upgrade”',
    ],
    [
      'platform.maintenance_mode_changed',
      { from: 'off', to: 'read_only', reason: 'Data fix', messageChanged: true },
      'turned on read-only maintenance: “Data fix”',
    ],
    [
      'platform.maintenance_mode_changed',
      { from: 'read_only', to: 'full', reason: 'Escalating', messageChanged: false },
      'escalated maintenance from read-only to full: “Escalating”',
    ],
    [
      'platform.maintenance_mode_changed',
      { from: 'full', to: 'read_only', reason: null, messageChanged: false },
      'eased maintenance from full to read-only',
    ],
    [
      'platform.maintenance_mode_changed',
      { from: 'full', to: 'full', reason: null, messageChanged: true },
      'changed the full maintenance message',
    ],
    [
      'platform.maintenance_mode_changed',
      { from: 'full', to: 'off', reason: 'Done', messageChanged: false },
      'turned maintenance off: “Done”',
    ],
  ])('%s reads as a sentence', (action, metadata, sentence) => {
    expect(auditSentence({ action, metadata })).toBe(sentence)
  })

  it('degrades rather than throwing on missing or mistyped metadata', () => {
    expect(auditSentence({ action: 'member.role_changed', metadata: {} })).toBe(
      'changed a member’s role from an unknown role to an unknown role'
    )
    expect(auditSentence({ action: 'tenant.updated', metadata: { changed: 'name' } })).toBe(
      'updated the tenant'
    )
    expect(auditSentence({ action: 'tenant.deleted', metadata: {} })).toBe(
      'performed tenant.deleted'
    )
    expect(auditSentence({ action: 'tenant.purged', metadata: {} })).toBe(
      'permanently deleted a tenant'
    )
    expect(auditSentence({ action: 'email.resent', metadata: {} })).toBe(
      'resent an email to someone at an unknown domain'
    )
    expect(auditSentence({ action: 'onboarding.step_completed', metadata: {} })).toBe(
      'marked an onboarding step complete'
    )
    expect(
      auditSentence({ action: 'onboarding.reminder_sent', metadata: { emailDomains: 'acme.test' } })
    ).toBe('sent an onboarding reminder to the owners')
    expect(
      auditSentence({
        action: 'invitation.created',
        metadata: { role: 'viewer', emailDomain: null },
      })
    ).toBe('invited someone at an unknown domain as Viewer')
    expect(auditSentence({ action: 'user.timeline_viewed', metadata: { range: '1y' } })).toBe(
      'viewed a user’s timeline'
    )
    expect(
      auditSentence({ action: 'tenant.timeline_viewed', metadata: { range: '24h', view: 'raw' } })
    ).toBe('viewed a tenant’s timeline (last 24 hours)')
    for (const metadata of [
      {},
      { from: 'off', to: 'paused' },
      { from: 'constructor', to: 'full' },
      { from: 'full', to: 'full', messageChanged: false },
    ]) {
      expect(auditSentence({ action: 'platform.maintenance_mode_changed', metadata })).toBe(
        'changed maintenance mode'
      )
    }
  })
})

describe('actorName', () => {
  it('prefers the name, falls back to the email, and calls a null actor the system', () => {
    expect(actorName({ id: USER_ID, name: 'Ada Lovelace', email: 'ada@example.com' })).toBe(
      'Ada Lovelace'
    )
    expect(actorName({ id: USER_ID, name: '', email: 'ada@example.com' })).toBe('ada@example.com')
    expect(actorName(null)).toBe('System')
  })
})
