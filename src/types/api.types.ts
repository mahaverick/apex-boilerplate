import type { AuditAction } from '@/constants/audit-actions'
import type { MembershipRole } from '@/constants/roles'

export interface ApiSuccess<T> {
  success: true
  message: string
  statusCode: number
  data: T
}

export interface ApiErrorBody {
  success: false
  message: string
  statusCode: number
  /** Stable machine-readable discriminator, e.g. ACCESS_TOKEN_EXPIRED. */
  code?: string
  /** Field-level validator detail, shaped by the backend's Zod flatten. */
  errors?: Record<string, string[]>
  requestId: string
}

/**
 * `toPublicUser` on the server (AuthenticatedUser plus createdAt), plus the
 * caller's role in the platform tenant. `platformRole` is `null` for everyone
 * who is not staff; test it with `isStaff`, never by truthiness of a copy.
 */
export interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  createdAt: string
  platformRole: MembershipRole | null
}

export const ACCESS_TOKEN_EXPIRED = 'ACCESS_TOKEN_EXPIRED'

/**
 * 401 on a destructive staff route whose session last authenticated too long
 * ago (express `requireRecentAuth`). Not a verdict on the session: the
 * interceptor passes it through untouched, and `useStepUp` asks the user to
 * confirm who they are, then retries once.
 */
export const REAUTH_REQUIRED = 'REAUTH_REQUIRED'

/** A 409 for a slug a live tenant already uses: it belongs on the slug field. */
export const SLUG_TAKEN = 'slug_taken'

/** A 409 for an owner address whose account is deactivated: it belongs on the email field. */
export const INVITEE_DEACTIVATED = 'invitee_deactivated'

/** `POST /invitations/preview` with `{ token }`: what an invite link opens onto. */
export interface InvitationPreview {
  tenant: { name: string; slug: string }
  role: MembershipRole
  invitedBy: { firstName: string | null; lastName: string | null } | null
  /** The address the invitation was sent to. */
  email: string
}

/** `POST /invitations/accept`: the tenant the caller is now a member of. */
export interface AcceptedInvitation {
  tenant: { name: string; slug: string }
  /** The caller's current role there: an existing member keeps theirs, so not necessarily the invited one. */
  role: MembershipRole
}

/** 409 on invite: that address already belongs to a member of this tenant. */
export const ALREADY_MEMBER = 'already_member'

/**
 * 409 on invite: two invitations for the same address raced, and this one
 * lost. Retrying after a refresh is safe.
 */
export const INVITATION_CONFLICT = 'invitation_conflict'

/** 404 on resend and revoke: the invitation stopped being pending meanwhile. */
export const INVITATION_NOT_FOUND = 'invitation_not_found'

/** 404 on preview and accept: invalid, expired, revoked or already used. */
export const INVITATION_INVALID = 'invitation_invalid'

/** 403 on accept: the signed-in account's email is not the invited one. */
export const INVITATION_EMAIL_MISMATCH = 'invitation_email_mismatch'

/** 403 on accept: the signed-in account is the invited one, but its email is unverified. */
export const INVITATION_EMAIL_UNVERIFIED = 'invitation_email_unverified'

/** A keyset page's direction. `prev` pages backward from the given cursor. */
export const PAGE_DIRECTIONS = ['next', 'prev'] as const
export type PageDirection = (typeof PAGE_DIRECTIONS)[number]

/** Mirrors express's TENANT_LIFECYCLE_STATES. */
export type TenantLifecycleState = 'active' | 'suspended' | 'archived'

/**
 * `GET /platform/tenants?state=`. Omitted means the API's default, active and
 * suspended together; `archived` and `all` reach archived (soft-deleted) rows.
 */
export const TENANT_STATE_FILTERS = ['active', 'suspended', 'archived', 'all'] as const
export type TenantStateFilter = (typeof TENANT_STATE_FILTERS)[number]

/** One row of `GET /platform/tenants`: staff search across every tenant. */
export interface PlatformTenantRow {
  id: string
  name: string
  slug: string
  lifecycleState: TenantLifecycleState
  memberCount: number
  createdAt: string
}

/**
 * A keyset page of `GET /platform/tenants`. Both cursors are opaque; send one
 * back as-is with `direction`. Each is null at its own end, so the first page
 * has `prevCursor: null`.
 */
export interface PlatformTenantPage {
  tenants: PlatformTenantRow[]
  nextCursor: string | null
  prevCursor: string | null
}

/** How an audit entry's actor reached the tenant. `system` is a script, with no actor. */
export type AuditAccess = 'member' | 'platform' | 'system'

/** The actor on an audit entry. `name` is the email when the actor has no name on file. */
export interface AuditActor {
  id: string
  name: string
  email: string
}

export interface AuditTarget {
  type:
    | 'tenant'
    | 'membership'
    | 'invitation'
    | 'settings'
    | 'user'
    | 'email_message'
    | 'email_suppression'
  id: string
}

/** One row of a tenant's `GET /tenants/:slug/audit-log`. */
export interface AuditEntry {
  id: string
  /** ISO 8601, millisecond precision. */
  occurredAt: string
  action: AuditAction
  access: AuditAccess
  actor: AuditActor | null
  target: AuditTarget | null
  /** Per-action; never a full email address or a token. */
  metadata: Record<string, unknown>
}

/** One row of `GET /platform/audit-log`: the same entry, plus where it happened. */
export interface PlatformAuditEntry extends AuditEntry {
  tenant: { id: string; name: string; slug: string }
}

/** A keyset page of either audit log. `nextCursor` is opaque. */
export interface AuditPage<T extends AuditEntry> {
  entries: T[]
  nextCursor: string | null
}

/** One sign-in method linked to the account, as `GET /auth/providers` lists it. */
export interface AuthProviderLink {
  /** `'email'` or `'google'`. A string, so a new provider renders rather than breaks. */
  provider: string
  /** ISO timestamp of when the method was linked. */
  linkedAt: string
}

/**
 * `GET /auth/providers`. `hasPassword` is the only password signal: a Google
 * sign-up also has an `'email'` row, and cannot sign in with a password.
 */
export interface AuthProviders {
  providers: AuthProviderLink[]
  hasPassword: boolean
}

/** A window the staff Overview offers. Mirrors express's STATS_RANGES. */
export type StatsRange = '7d' | '30d'

/** `GET /platform/stats`: live totals and one zero-filled entry per UTC day, oldest first. */
export interface PlatformStats {
  range: StatsRange
  /** Live counts. `users` is active users only; `staff` is the platform tenant's members. */
  totals: { tenants: number; users: number; staff: number }
  /**
   * Per UTC day. `users` counts every non-deleted user created that day, inactive and staff
   * included, so it does not sum to `totals.users`.
   */
  signups: { date: string; users: number; tenants: number }[]
  /**
   * Per UTC day, one count per send attempt. `failed` counts failed attempts, not failed
   * emails: a mail retried then sent contributes to both `failed` and `sent`.
   * @deprecated Apex reads `emailMessages`; express keeps this series for older clients.
   */
  emails: { date: string; sent: number; failed: number }[]
  /**
   * Per UTC day of creation, each email counted once in one of five disjoint groups by its
   * current status (express 1.3.0). `queued` emails are in none of them. Without a provider
   * webhook no email reaches `delivered` or `complained`, so every successful send stays in `sent`.
   */
  emailMessages: EmailMessageDay[]
}

/** `GET /platform/tenants/:id`: any lifecycle state, the platform tenant excepted. */
export interface PlatformTenantDetail {
  id: string
  name: string
  slug: string
  description: string | null
  website: string | null
  logo: string | null
  lifecycleState: TenantLifecycleState
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  settings: { timezone: string; locale: string }
  memberCount: number
  owners: PlatformTenantOwner[]
  pendingInvitationCount: number
  pendingOwnerInvitation: { id: string; email: string; expiresAt: string } | null
}

/**
 * An owner of a tenant. `active` is false for a deactivated account, which
 * the API does not count as an owner: a tenant whose only owners
 * are inactive can be sent a new owner invitation.
 */
export interface PlatformTenantOwner {
  userId: string
  email: string
  firstName: string | null
  lastName: string | null
  active: boolean
}

/**
 * One row of `GET /platform/users`. `membershipCount` leaves the platform
 * tenant out. `deletedAt` is set only on the rows `status=deleted` reaches.
 */
export interface PlatformUserRow {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  active: boolean
  emailVerifiedAt: string | null
  lastLoggedInAt: string | null
  createdAt: string
  deletedAt: string | null
  platformRole: MembershipRole | null
  membershipCount: number
}

/** A keyset page of `GET /platform/users`; cursors as for `PlatformTenantPage`. */
export interface PlatformUserPage {
  users: PlatformUserRow[]
  nextCursor: string | null
  prevCursor: string | null
}

/**
 * `GET /platform/users?status=`. Omitted means active and inactive live
 * accounts; `deleted` reaches soft-deleted ones, which only a purge removes.
 */
export const USER_STATUS_FILTERS = ['active', 'inactive', 'deleted'] as const
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number]

export interface PlatformUserMembership {
  tenantId: string
  tenantName: string
  tenantSlug: string
  lifecycleState: TenantLifecycleState
  role: MembershipRole
  joinedAt: string
}

export interface PlatformUserPendingInvitation {
  id: string
  tenantId: string
  tenantName: string
  role: MembershipRole
  expiresAt: string
}

/** `GET /platform/users/:id`. `authProviders` are provider ids (`'email'`, `'google'`). */
export interface PlatformUserDetail extends PlatformUserRow {
  hasPassword: boolean
  authProviders: string[]
  memberships: PlatformUserMembership[]
  pendingInvitations: PlatformUserPendingInvitation[]
}

/**
 * What a write that mails someone answers. The mail goes after the write
 * commits, so `false` means the write stands and only the email failed: offer
 * a resend.
 */
export interface EmailSentResult {
  emailSent: boolean
}

/** How a caller reached a tenant: as a member, or through their platform role. */
export type TenantAccess = 'member' | 'platform'

/**
 * `invitedBy` on a pending-invitation row, or `null` once the inviter's
 * account is gone (the column is `on delete set null`).
 */
export interface InvitationInviter {
  id: string
  firstName: string | null
  lastName: string | null
}

/**
 * One row of `GET /tenants/:slug/invitations`. The server never sends the
 * token or its hash, so nothing here can be used to accept the invitation.
 */
export interface TenantInvitation {
  id: string
  email: string
  role: MembershipRole
  invitedBy: InvitationInviter | null
  expiresAt: string
  createdAt: string
}

/** A logical email's delivery state. Mirrors express's EMAIL_MESSAGE_STATUSES. */
export const EMAIL_MESSAGE_STATUSES = [
  'queued',
  'sent',
  'deferred',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'suppressed',
] as const
export type EmailMessageStatus = (typeof EMAIL_MESSAGE_STATUSES)[number]

/** The templates express sends. A key the API adds later still renders, by its raw name. */
export const EMAIL_TEMPLATE_KEYS = [
  'email_verification',
  'password_reset',
  'account_setup',
  'tenant_invitation',
  'password_changed',
  'registration_attempt',
] as const
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number]

/**
 * Which sender a template uses. Every token-bearing template is `transactional`,
 * whose domain keeps click tracking off.
 */
export type EmailSenderClass = 'transactional' | 'general'

/** Who set a message `failed`: our send, the provider, or the queue refusing the job. */
export type EmailFailureOrigin = 'send' | 'provider' | 'enqueue'

/** Mirrors express's EMAIL_EVENT_TYPES. `opened` and `clicked` never change a status. */
export type EmailEventType =
  'delivered' | 'deferred' | 'bounced' | 'complained' | 'opened' | 'clicked' | 'failed'

/** Why an address is suppressed: only a hard bounce or a complaint adds one. */
export type SuppressionReason = 'hard_bounce' | 'complaint'

/** `GET /platform/email-suppressions?state=`; the API's default is `active`. */
export const SUPPRESSION_STATE_FILTERS = ['active', 'lifted', 'all'] as const
export type SuppressionStateFilter = (typeof SUPPRESSION_STATE_FILTERS)[number]

/** The five disjoint status groups the stats and the health report count, in stacking order. */
export const EMAIL_GROUP_KEYS = [
  'delivered',
  'sent',
  'undelivered',
  'complained',
  'suppressed',
] as const
export type EmailGroup = (typeof EMAIL_GROUP_KEYS)[number]

/**
 * One UTC day of logical emails by current status: `sent` is sent or deferred
 * (no final provider outcome yet, which on an install without a provider
 * webhook is every successful send), `undelivered` is a hard bounce or a
 * failure, and `suppressed` was never sent.
 */
export type EmailMessageDay = { date: string } & Record<EmailGroup, number>

/**
 * One row of `GET /platform/emails`. `user` and `tenant` are null when the
 * mail had none or the record was purged since. `canResend` is the API's
 * answer for the signed-in staff member (role, template, suppression and the
 * originating action's own rules); the resend endpoint still enforces them.
 */
export interface EmailMessageSummary {
  id: string
  recipient: string
  /** An `EmailTemplateKey`, typed wide so a template the API adds still renders. */
  templateKey: string
  status: EmailMessageStatus
  senderClass: EmailSenderClass
  createdAt: string
  statusUpdatedAt: string
  user: { id: string; name: string } | null
  tenant: { id: string; name: string; slug: string } | null
  canResend: boolean
}

/** A keyset page of `GET /platform/emails`, newest first; cursors as for `PlatformTenantPage`. */
export interface EmailMessagePage {
  messages: EmailMessageSummary[]
  nextCursor: string | null
  prevCursor: string | null
}

/** One send attempt (`email_logs`). `errorCode` is set on a failed one. */
export interface EmailAttempt {
  id: string
  status: 'sent' | 'failed'
  errorCode: string | null
  createdAt: string
}

/**
 * One provider event. `bounceKind` is set only on `bounced`; `detail` is an
 * UPPER_SNAKE code, never a raw payload or a clicked URL.
 */
export interface EmailProviderEvent {
  id: string
  provider: string
  type: EmailEventType
  bounceKind: 'hard' | 'soft' | null
  detail: string | null
  occurredAt: string
}

/**
 * `GET /platform/emails/:id`. `suppression` is the recipient's active
 * suppression, if any. `resentFromId` names the message this one resent;
 * `resentAsIds` the messages that resent this one.
 */
export interface EmailMessageDetail extends EmailMessageSummary {
  linkApp: 'web' | 'apex' | null
  failureOrigin: EmailFailureOrigin | null
  attempts: EmailAttempt[]
  events: EmailProviderEvent[]
  suppression: { id: string; reason: SuppressionReason; createdAt: string } | null
  resentFromId: string | null
  resentAsIds: string[]
}

/**
 * `GET /platform/emails/:id/preview`: the stored template re-rendered, with
 * every token link masked. `partial` is true when a value other than a token
 * had to be filled with a placeholder (older mail stored no values).
 */
export interface EmailPreview {
  subject: string
  html: string
  text: string
  partial: boolean
}

/**
 * `POST /platform/emails/:id/resend` (202). `emailSent` is present only when
 * the originating action reports it (password setup); `data` may be null.
 */
export type EmailResendResult = { emailSent?: boolean } | null

/**
 * One rate of `GET /platform/emails/health`. `value` is `numerator /
 * denominator` as a fraction from 0 to 1, or null when the API has no figure:
 * a provider-dependent rate while no provider event has arrived in the range.
 */
export interface EmailRate {
  value: number | null
  numerator: number
  denominator: number
}

/** A row of the health report's by-template or top-10 by-domain table. */
export interface EmailBreakdownRow {
  key: string
  messages: number
  undelivered: number
  complained: number
}

/**
 * `GET /platform/emails/health?range=`. Rates are over mail that left the
 * server (sent, delivered, undelivered, complained). `undeliveredRate` needs
 * no provider; the others do, and open and click rates count only
 * general-sender mail.
 */
export interface EmailHealth {
  range: StatsRange
  totals: Record<EmailGroup, number> & {
    /** Messages that left the server in the range: every status except queued and suppressed. */
    messages: number
    /** Provider events received in the range; 0 means no webhook is feeding this install. */
    providerEvents: number
  }
  rates: {
    undeliveredRate: EmailRate
    deliveredRate: EmailRate
    bounceRate: EmailRate
    complaintRate: EmailRate
    openRate: EmailRate
    clickRate: EmailRate
  }
  days: EmailMessageDay[]
  byTemplate: EmailBreakdownRow[]
  byDomain: EmailBreakdownRow[]
}

/**
 * One row of `GET /platform/email-suppressions`. `address` is lowercased.
 * `liftedAt`, `liftedBy` and `liftReason` are set once staff lift it;
 * `liftedBy` is null again when that staff member was purged.
 */
export interface EmailSuppression {
  id: string
  address: string
  reason: SuppressionReason
  sourceMessageId: string | null
  createdAt: string
  liftedAt: string | null
  liftedBy: { id: string; name: string } | null
  liftReason: string | null
}

/** A keyset page of `GET /platform/email-suppressions`; cursors as for `PlatformTenantPage`. */
export interface EmailSuppressionPage {
  suppressions: EmailSuppression[]
  nextCursor: string | null
  prevCursor: string | null
}

/** 409 on resend: the recipient's address is suppressed; lift it first. */
export const RECIPIENT_SUPPRESSED = 'recipient_suppressed'

/** 409 on resend or preview: the stored template is no longer in the API's registry. */
export const TEMPLATE_UNAVAILABLE = 'template_unavailable'

/** 409 on resend: a security notice, or an older message without the ids its action needs. */
export const NOT_RESENDABLE = 'not_resendable'

/** 409 on lift: someone lifted it first. */
export const ALREADY_LIFTED = 'already_lifted'
