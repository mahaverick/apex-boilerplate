import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { RETIRED_AUDIT_ACTIONS, STORED_AUDIT_ACTIONS } from '@/constants/audit-action-names'
import {
  actorName,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  auditSentence,
  isAuditAction,
} from '@/constants/audit-actions'
import { EMAIL_ID, EMAIL_ID_2, INVITATION_ID, USER_ID, USER_ID_2 } from '@/tests/fixtures/ids'

describe('AUDIT_ACTIONS', () => {
  it('lists exactly the fifty-two actions the API writes', () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        'invitation.accepted',
        'invitation.created',
        'invitation.resent',
        'invitation.revoked',
        'member.left',
        'member.removed',
        'member.role_changed',
        'platform.member.granted',
        'tenant.accessed_by_platform',
        'tenant.created',
        'tenant.settings_updated',
        'tenant.updated',
        'auth.step_up_confirmed',
        'auth.step_up_refused',
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
        'user.purged',
        'user.reactivated',
        'user.signed_out',
        'user.sign_in_link_sent',
        'user.passkey_created',
        'user.passkey_deleted',
        'user.passkeys_cleared_on_claim',
        'user.updated',
        'user.flags_evaluated',
        'platform.maintenance_mode_changed',
        'billing.cancel_scheduled',
        'billing.cancelled_by_staff',
        'billing.card_change_started',
        'billing.checkout_started',
        'billing.grant_added',
        'billing.grant_expired',
        'billing.grant_revoked',
        'billing.interval_switch_scheduled',
        'billing.resynced',
        'billing.settings_updated',
        'billing.trial_extended',
        'billing.viewed',
        'plan.price_created',
        'plan.updated',
      ].sort()
    )
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action]).not.toBe('')
      expect(auditSentence({ action, metadata: {} })).not.toMatch(/^performed /)
    }
  })

  it('names each billing event as true for every case express records under it', () => {
    // An owner's cancel is at the period end, or now for a past-due or uncharged Paid; staff extend or start a trial.
    expect(AUDIT_ACTION_LABELS['billing.cancel_scheduled']).toBe('Paid cancelled by owner')
    expect(AUDIT_ACTION_LABELS['billing.trial_extended']).toBe('Trial set by staff')
  })

  it('keeps the four passwordless retirements stored and filterable, never offered', () => {
    for (const action of [
      'auth.reauthenticated',
      'user.password_setup_sent',
      'user.verification_resent',
      'platform.member.auto_joined',
    ]) {
      expect(RETIRED_AUDIT_ACTIONS).toContain(action)
      expect(STORED_AUDIT_ACTIONS).toContain(action)
      expect(isAuditAction(action)).toBe(false)
    }
  })

  it('recognises its own actions and nothing else', () => {
    expect(isAuditAction('member.removed')).toBe(true)
    expect(isAuditAction('member.deleted')).toBe(false)
  })
})

describe('auditSentence dates, read ahead of UTC', () => {
  /** The reader's zone before the test moved it. */
  let readerZone: string | undefined
  beforeEach(() => {
    readerZone = process.env.TZ
    process.env.TZ = 'Asia/Kolkata'
  })
  afterEach(() => {
    if (readerZone === undefined) delete process.env.TZ
    else process.env.TZ = readerZone
  })

  /** A grant chosen to end on 26 November, stored as the end of that day in `zone`. */
  const grantUntil = (expiresAt: string) => ({
    action: 'billing.grant_added',
    metadata: { key: 'members', value: null, expiresAt, reason: 'big team' },
  })

  it('names the day the grant ends in the tenant’s zone, not the reader’s', () => {
    expect(auditSentence(grantUntil('2026-11-26T23:59:59.999Z'), 'UTC')).toBe(
      'granted Members (no limit) until 26 November 2026: “big team”'
    )
    expect(auditSentence(grantUntil('2026-11-27T04:59:59.999Z'), 'America/New_York')).toBe(
      'granted Members (no limit) until 26 November 2026: “big team”'
    )
  })

  it('names the day the trial ends in the tenant’s zone, not the reader’s', () => {
    const entry = {
      action: 'billing.trial_extended',
      metadata: { days: 7, reason: 'pilot', trialEndsAt: '2026-11-09T20:00:00.000Z' },
    }
    expect(auditSentence(entry, 'UTC')).toBe(
      'set the trial to end on 9 November 2026 (7 days): “pilot”'
    )
  })

  it('names the moment in UTC, zone named, where no tenant zone is at hand', () => {
    expect(auditSentence(grantUntil('2026-11-26T23:59:59.999Z'))).toBe(
      'granted Members (no limit) until 26 November 2026 at 23:59 UTC: “big team”'
    )
  })

  it('leaves out an end that is not a date, whatever the zone', () => {
    expect(auditSentence(grantUntil('not a date'), 'UTC')).toBe(
      'granted Members (no limit): “big team”'
    )
  })
})

describe('auditSentence', () => {
  it.each([
    ['billing.checkout_started', { interval: 'year' }, 'started a yearly Paid checkout'],
    ['billing.checkout_started', { interval: 'month' }, 'started a monthly Paid checkout'],
    ['billing.cancel_scheduled', {}, 'cancelled Paid'],
    [
      'billing.interval_switch_scheduled',
      { interval: 'year' },
      'scheduled a switch to yearly billing',
    ],
    ['billing.card_change_started', {}, 'started a payment method change'],
    [
      'billing.grant_expired',
      { grantId: USER_ID, key: 'members' },
      'marked the Members grant expired',
    ],
    ['billing.viewed', {}, 'viewed the tenant’s billing'],
    [
      'billing.resynced',
      { reason: 'customer paid' },
      'resynced billing with the payment provider: “customer paid”',
    ],
    [
      'billing.trial_extended',
      { days: 7, reason: 'pilot', trialEndsAt: '2026-11-09T12:00:00.000Z' },
      'set the trial to end on 9 November 2026 at 12:00 UTC (7 days): “pilot”',
    ],
    [
      'billing.trial_extended',
      { days: 1, reason: 'pilot', trialEndsAt: 'not a date' },
      'set the trial (1 day): “pilot”',
    ],
    ['billing.trial_extended', { reason: 'pilot' }, 'set the trial: “pilot”'],
    [
      'billing.grant_added',
      { key: 'members', value: null, expiresAt: null, reason: 'big team' },
      'granted Members (no limit): “big team”',
    ],
    [
      'billing.grant_added',
      { key: 'members', value: 10, expiresAt: '2026-12-01T12:00:00.000Z', reason: 'trial' },
      'granted Members (10) until 1 December 2026 at 12:00 UTC: “trial”',
    ],
    [
      'billing.grant_added',
      { key: 'advanced_example', value: true, expiresAt: null, reason: 'demo' },
      'granted Workspace insights (on): “demo”',
    ],
    [
      'billing.grant_revoked',
      { key: 'seats_v2', reason: 'ended' },
      'revoked the seats_v2 grant: “ended”',
    ],
    [
      'billing.grant_revoked',
      { key: 'members', reason: 'ended' },
      'revoked the Members grant: “ended”',
    ],
    [
      'billing.cancelled_by_staff',
      { when: 'now', reason: 'fraud' },
      'cancelled the subscription now: “fraud”',
    ],
    [
      'billing.cancelled_by_staff',
      { when: 'cycle_end', reason: 'asked' },
      'cancelled the subscription at its period end: “asked”',
    ],
    [
      'plan.updated',
      { before: { name: 'Free' }, after: { name: 'Starter' }, reason: 'rename' },
      'edited the Starter plan: “rename”',
    ],
    ['plan.updated', {}, 'edited a plan'],
    [
      'plan.price_created',
      { interval: 'month', amountMinor: 129_900, reason: 'new price' },
      'added a monthly price of ₹1,299: “new price”',
    ],
    ['plan.price_created', {}, 'added a price'],
    [
      'billing.settings_updated',
      { changedFields: ['trialDays', 'trialEnabled'], reason: 'promo' },
      'changed the billing settings (trial length, trials on or off): “promo”',
    ],
    ['billing.settings_updated', {}, 'changed the billing settings'],
    [
      'billing.settings_updated',
      { changedFields: ['pastDueGraceDays', 'newSetting'], reason: 'promo' },
      'changed the billing settings (grace period, newSetting): “promo”',
    ],
    [
      'billing.settings_updated',
      { changedFields: [1, null], reason: 'checked' },
      'changed the billing settings: “checked”',
    ],
    [
      'billing.settings_updated',
      { changedFields: [], reason: 'checked' },
      'saved the billing settings with no changes: “checked”',
    ],
    [
      'billing.grant_added',
      { key: 'members', value: 'ten', expiresAt: null, reason: 'demo' },
      'granted Members: “demo”',
    ],
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
    ['member.left', { role: 'editor' }, 'left the tenant'],
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
    ['user.sign_in_link_sent', { app: 'apex' }, 'sent a staff member a sign-in link to Apex'],
    ['user.sign_in_link_sent', { app: 'web' }, 'sent a user a sign-in link'],
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
    [
      'user.passkey_created',
      { passkeyId: USER_ID, provider: 'Apple Passwords', app: 'apex' },
      'created a passkey (Apple Passwords) in Apex',
    ],
    ['user.passkey_created', { app: 'web' }, 'created a passkey in the customer app'],
    [
      'user.passkey_deleted',
      { provider: 'Google Password Manager', app: 'web' },
      'deleted a passkey (Google Password Manager) in the customer app',
    ],
    ['user.passkey_deleted', {}, 'deleted a passkey'],
    [
      'user.passkeys_cleared_on_claim',
      { count: 2 },
      'deleted 2 passkeys from an unverified account when its owner claimed it',
    ],
    [
      'user.passkeys_cleared_on_claim',
      { count: 1 },
      'deleted 1 passkey from an unverified account when its owner claimed it',
    ],
    [
      'user.passkeys_cleared_on_claim',
      {},
      'deleted the passkeys on an unverified account when its owner claimed it',
    ],
    ['auth.step_up_confirmed', { method: 'passkey' }, 'confirmed it was them with a passkey'],
    ['auth.step_up_confirmed', { method: 'link' }, 'confirmed it was them by email link'],
    ['auth.step_up_confirmed', { method: 'google' }, 'confirmed it was them with Google'],
    ['auth.step_up_refused', { method: 'link' }, 'failed an email-link identity check'],
    ['auth.step_up_refused', { method: 'google' }, 'failed a Google identity check'],
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

  it.each([
    ['auth.reauthenticated', 'confirmed it was them with a password'],
    ['user.password_setup_sent', 'sent a user a password setup email'],
    ['user.verification_resent', 'resent a user a verification email'],
    ['platform.member.auto_joined', 'joined staff by email domain'],
  ])('reads the retired %s as its own sentence, not the fallback', (action, sentence) => {
    expect(isAuditAction(action)).toBe(false)
    expect(auditSentence({ action, metadata: {} })).toBe(sentence)
  })

  it('renders a removed staff-read action through the fallback sentence', () => {
    expect(isAuditAction('user.timeline_viewed')).toBe(false)
    expect(auditSentence({ action: 'user.timeline_viewed', metadata: {} })).toBe(
      'performed user timeline viewed'
    )
  })

  it('degrades rather than throwing on missing or mistyped metadata', () => {
    expect(auditSentence({ action: 'member.role_changed', metadata: {} })).toBe(
      'changed a member’s role from an unknown role to an unknown role'
    )
    expect(auditSentence({ action: 'tenant.updated', metadata: { changed: 'name' } })).toBe(
      'updated the tenant'
    )
    expect(auditSentence({ action: 'tenant.deleted', metadata: {} })).toBe(
      'performed tenant deleted'
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
