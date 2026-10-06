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
  /** The profile's "Share usage analytics" switch, off. Stops browser analytics only. */
  analyticsOptOut: boolean
}

export const ACCESS_TOKEN_EXPIRED = 'ACCESS_TOKEN_EXPIRED'

/**
 * 401 on a destructive staff route whose session last authenticated too long
 * ago (express `requireRecentAuth`). Not a verdict on the session: the
 * interceptor passes it through untouched, and `useStepUp` asks the user to
 * confirm who they are, then retries once.
 */
export const REAUTH_REQUIRED = 'REAUTH_REQUIRED'

/**
 * 503 from a write while customers are in read-only maintenance. Apex's own
 * `/platform/*` routes are let through, but the blocked auth routes
 * (change-password, reset-password and the rest) answer it to staff too.
 */
export const READ_ONLY_MODE = 'READ_ONLY_MODE'

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
    | 'platform'
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
  /**
   * Live counts. `users` is active users only; `staff` is the platform tenant's members;
   * `stuckTenants` is active tenants whose onboarding has stalled (express 1.4.0).
   */
  totals: { tenants: number; users: number; staff: number; stuckTenants: number }
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
  'onboarding_reminder',
  'maintenance_mode_changed',
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
 * had to be filled with a placeholder because a stored preview value was
 * missing (older mail stored none). The inviter's name, always masked, and the
 * token placeholders do not set it.
 */
export interface EmailPreview {
  subject: string
  html: string
  text: string
  partial: boolean
}

/**
 * `POST /platform/emails/:id/resend` (202). `emailSent` is present only when
 * the originating action reports it (password setup and resending a
 * verification email); `data` may be null.
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

/**
 * A tenant's onboarding state, derived by the API on every read. Mirrors
 * express's ONBOARDING_STATES. The API picks the first that applies of
 * not_tracked, awaiting_owner, complete, dismissed, stuck and in_progress, so
 * a dismissed tenant that finished reads `complete`.
 */
export const ONBOARDING_STATES = [
  'not_tracked',
  'awaiting_owner',
  'in_progress',
  'stuck',
  'complete',
  'dismissed',
] as const
export type OnboardingState = (typeof ONBOARDING_STATES)[number]

/**
 * `GET /platform/onboarding/tenants?state=`, in tab order. Untracked tenants
 * are on no list.
 */
export const ONBOARDING_LIST_STATES = [
  'stuck',
  'in_progress',
  'awaiting_owner',
  'complete',
  'dismissed',
] as const satisfies readonly OnboardingState[]
export type OnboardingListState = (typeof ONBOARDING_LIST_STATES)[number]

/** The funnel's windows, in toggle order. Mirrors express's ONBOARDING_RANGES; distinct from STATS_RANGES. */
export const ONBOARDING_RANGES = ['7d', '30d', '90d'] as const
export type OnboardingRange = (typeof ONBOARDING_RANGES)[number]

/** Whether a step is done once per tenant or once per person. */
export type OnboardingScope = 'tenant' | 'member'

/** How a step completes: from a server-side event, or ticked by the customer. */
export type OnboardingCompletionKind = 'auto' | 'manual'

/** Who completed a step: the server, the customer, or staff with a reason. */
export type OnboardingSource = 'auto' | 'customer' | 'staff'

/** Someone an onboarding read names: their name, else their email. */
export interface OnboardingPerson {
  id: string
  name: string
}

/** A registry step by key and title. */
export interface OnboardingStepSummary {
  key: string
  title: string
}

/**
 * One registry step on the funnel, over the tenants that started in the
 * window. A member step counts a tenant once any active owner has done it.
 * `staffCompleted` is the part of `completed` that staff marked complete.
 */
export interface OnboardingFunnelStep {
  key: string
  title: string
  scope: OnboardingScope
  required: boolean
  completed: number
  staffCompleted: number
}

/**
 * `GET /platform/onboarding/funnel?range=`, over the active tracked tenants
 * whose onboarding started since `from`. `totals.started` counts them and the
 * other four split them by their state now. `completionRate` is
 * `complete / started` as a fraction, or null when none started.
 * `trackedTenants` counts every active tracked tenant whatever its start,
 * awaiting an owner included: 0 means none was created since tracking began.
 */
export interface OnboardingFunnel {
  range: OnboardingRange
  from: string
  totals: {
    started: number
    inProgress: number
    stuck: number
    complete: number
    dismissed: number
  }
  completionRate: number | null
  steps: OnboardingFunnelStep[]
  trackedTenants: number
}

/**
 * One row of `GET /platform/onboarding/tenants`. `owners` are the active
 * owners. `startedAt` is null while the tenant awaits its first owner;
 * `lastProgressAt` is the latest completion, else `startedAt`; `daysStuck`
 * is set on stuck rows only. `nextStep` is the first incomplete required
 * step in registry order.
 */
export interface OnboardingTenantRow {
  id: string
  name: string
  slug: string
  state: OnboardingState
  owners: OnboardingPerson[]
  startedAt: string | null
  lastProgressAt: string | null
  completedAt: string | null
  daysStuck: number | null
  nextStep: OnboardingStepSummary | null
  requiredDone: number
  requiredTotal: number
}

/** A keyset page of `GET /platform/onboarding/tenants`; cursors as for `PlatformTenantPage`. */
export interface OnboardingTenantPage {
  tenants: OnboardingTenantRow[]
  nextCursor: string | null
  prevCursor: string | null
}

/** One live member's own status on a member step. */
export interface OnboardingMemberStatus {
  user: OnboardingPerson
  role: MembershipRole
  completedAt: string | null
  source: OnboardingSource | null
}

/**
 * One step of a tenant's onboarding, in registry order. For a member step
 * the completion fields are the earliest active owner's (what counts for the
 * tenant) and `members` counts and lists every live member's own; for a
 * tenant step `members` is null. `completedBy` is null for an automatic
 * completion and once a staff completer was purged. `canMarkComplete` is
 * the API's answer, the caller's role aside: an admin still has to ask.
 */
export interface OnboardingStepDetail {
  key: string
  title: string
  description: string
  scope: OnboardingScope
  kind: OnboardingCompletionKind
  required: boolean
  completedAt: string | null
  source: OnboardingSource | null
  completedBy: OnboardingPerson | null
  reason: string | null
  members: { completed: number; total: number; entries: OnboardingMemberStatus[] } | null
  canMarkComplete: boolean
}

/** Why a reminder cannot go now: the 409 code the remind endpoint would answer. */
export type OnboardingReminderBlock =
  'tenant_state_conflict' | 'not_in_progress' | 'no_owner' | 'reminded_recently'

/**
 * One staff reminder, read from the tenant's `onboarding.reminder_sent`
 * audit entry (`id` is that entry's). `sentBy` is null once that staff
 * member was purged. `messageIds` are the tracked emails it queued, one per
 * active owner; `emailDomains` is never an address.
 */
export interface OnboardingReminderView {
  id: string
  sentAt: string
  sentBy: OnboardingPerson | null
  reason: string
  recipientCount: number
  emailDomains: string[]
  messageIds: string[]
}

/**
 * Whether the remind endpoint would take a reminder now, the caller's role
 * aside, and why not; and the active owners' email domains it would mail.
 * `nextAllowedAt` is set while `reminded_recently` blocks it.
 */
export interface OnboardingReminderAvailability {
  canSend: boolean
  blockedBy: OnboardingReminderBlock | null
  lastSentAt: string | null
  nextAllowedAt: string | null
  recipientCount: number
  emailDomains: string[]
}

/**
 * `GET /platform/tenants/:id/onboarding`, readable in every lifecycle
 * state. `reminders` are newest first.
 */
export interface TenantOnboardingDetail {
  tenant: { id: string; name: string; slug: string; lifecycleState: TenantLifecycleState }
  state: OnboardingState
  startedAt: string | null
  lastProgressAt: string | null
  completedAt: string | null
  dismissedAt: string | null
  dismissedBy: OnboardingPerson | null
  daysStuck: number | null
  requiredDone: number
  requiredTotal: number
  nextStep: OnboardingStepSummary | null
  steps: OnboardingStepDetail[]
  reminder: OnboardingReminderAvailability
  reminders: OnboardingReminderView[]
}

/**
 * `POST /platform/tenants/:id/onboarding/remind`: how many active owners it
 * addressed, and whether every one's email was queued.
 */
export interface OnboardingReminderResult {
  emailSent: boolean
  recipientCount: number
}

/** A timeline's window, as `GET /platform/users|tenants/:id/timeline` takes it. */
export type TimelineRange = '24h' | '7d' | '30d' | '90d'

/** `all` is every event; `key` drops PostHog's own `$` events (pageviews, clicks). */
export type TimelineView = 'all' | 'key'

/** Where an event came from: the browser SDK, or one of express's three server sources. */
export type TimelineSource = 'browser' | 'audit' | 'product' | 'email'

/** The `props` keys express lets through its allowlist (`TIMELINE_PROP_KEYS`). */
export type TimelinePropKey =
  | 'target_type'
  | 'target_id'
  | 'step_key'
  | 'how'
  | 'required'
  | 'method'
  | 'via_invitation'
  | 'template_key'
  | 'bounce_kind'
  | 'has_reason'
  | 'cta'
  | 'table'
  | 'action'

/**
 * Who sent a tenant-timeline row, read from Postgres by its distinct id.
 * `displayName` is the full name, else the email, and `null` when no user
 * row is left (purged). A system row has no actor at all (`actor: null`).
 */
export interface TimelineActor {
  id: string
  displayName: string | null
}

/**
 * One PostHog event, built by express from a fixed allowlist: no other
 * property leaves the server. `timestamp` is PostHog's own string
 * (microseconds), never re-formatted. `actor` is on tenant timelines only.
 * `verified` is true only for an event express signed itself; anything else
 * arrived through the public project key, so express has already demoted
 * it (`source: 'browser'`, `access: null`, no `target_type`/`target_id`).
 */
export interface TimelineRow {
  uuid: string
  event: string
  timestamp: string
  distinctId: string
  /** Express signed this event; only then do its source, access and trace mean anything. */
  verified: boolean
  /** The tenant group the event names, or `null`. */
  tenant: string | null
  source: TimelineSource
  access: AuditAccess | null
  app: 'api' | 'react' | 'apex' | null
  sessionId: string | null
  traceId: string | null
  /** The page's pathname only: no query, no hash. */
  path: string | null
  /** A clicked element's text, on `$autocapture` and `$rageclick` only, at most 80 characters. */
  elementText: string | null
  /** `required`, `via_invitation` and `has_reason` may arrive as booleans or as `'true'`/`'false'`. */
  props: Partial<Record<TimelinePropKey, string | number | boolean>>
  actor?: TimelineActor | null
}

/** PostHog deep links. `replay` is a template: Apex fills in `{sessionId}`. */
export interface TimelineLinks {
  person: string | null
  group: string | null
  replay: string
}

/**
 * One timeline page, newest first. `configured: false` is an environment
 * without the PostHog personal key: nothing was asked of PostHog and nothing
 * was audited.
 */
export type TimelinePage =
  | { configured: false }
  | {
      configured: true
      rows: TimelineRow[]
      nextCursor: string | null
      links: TimelineLinks
    }

/**
 * Where an error issue's newest event came from. `server` is an event that
 * claims express sent it (`app: 'api'`); `browser` is every other one.
 */
export type ErrorIssueSource = 'server' | 'browser'

/**
 * One PostHog Error Tracking issue seen for a user or a tenant in the last
 * 30 days, described by its newest event. `value` is the exception message,
 * scrubbed again by express, and still untrusted text: a browser event can
 * say anything. `verified` is true only when express signed that event, so a
 * `server` row with `verified: false` is a forgery or a broken signature.
 */
export interface ErrorIssue {
  issueId: string
  type: string
  value: string
  count: number
  firstSeen: string
  lastSeen: string
  source: ErrorIssueSource
  /** `api`, `react` or `apex`; `null` when the event named none or a value the API does not know. */
  app: string | null
  verified: boolean
  /** The issue in PostHog's Error Tracking. */
  link: string
}

/**
 * `GET /platform/users|tenants/:id/errors`. `configured: false` is an
 * environment without the PostHog personal key: nothing was asked of PostHog
 * and nothing was audited. The list has one page; `nextCursor` is always null.
 */
export type ErrorIssuesPage =
  { configured: false } | { configured: true; items: ErrorIssue[]; nextCursor: null }

/** Why the API dropped an error event instead of sending it to PostHog. */
export type ErrorDropReason = 'throttled' | 'buffer_full' | 'rejected' | 'retry_exhausted'

/** Error tracking's health, summed over every API and worker process for the last 15 minutes. */
export interface ErrorTrackingStatus {
  enabled: boolean
  window: '15m'
  sent: number
  dropped: Record<ErrorDropReason, number>
  /** The last batch PostHog accepted, in the last 24 hours. */
  lastSendOkAt: string | null
  /**
   * The HTTP status of the last send PostHog did not accept (refused, or
   * answered with an error to retry); cleared once a batch is accepted.
   */
  lastSendError: number | null
}

/** An app whose browser is sent a flag's value. */
export type FlagApp = 'react' | 'apex'

/** The trait names express evaluates with; there is no other. */
export type TraitName =
  'platform_role' | 'tenant_role' | 'app_env' | 'account_created_days' | 'tenant_created_days'

/**
 * Why a flag evaluated as it did. The `fallback:*` reasons served the
 * registry's fallback without evaluating; `holdout` served it to a user in
 * an experiment's holdout.
 */
export type FlagReason =
  | 'condition_match'
  | 'out_of_rollout'
  | 'no_condition_match'
  | 'holdout'
  | 'fallback:unconfigured'
  | 'fallback:snapshot_missing'
  | 'fallback:flag_missing'
  | 'fallback:inactive'
  | 'fallback:unsupported'
  | 'fallback:no_tenant'
  | 'fallback:inconclusive'

/**
 * A registered flag's state in this environment's PostHog snapshot:
 * `missing` is absent (or deleted) there, `unsupported` uses a construct
 * express cannot evaluate, so it serves its fallback.
 */
export type FlagState = 'active' | 'inactive' | 'missing' | 'unsupported'

/**
 * Why express will not evaluate a flag's PostHog definition, as a flag row's
 * `unsupportedReason` names it. `scope_drift` and `kind_drift` mean PostHog's
 * flag no longer matches the registry's scope or kind; `malformed` is a
 * definition express could not parse.
 */
export type UnsupportedConstruct =
  | 'experience_continuity'
  | 'bucketing_identifier'
  | 'evaluation_contexts'
  | 'unknown_filter'
  | 'early_access'
  | 'group_type'
  | 'cohort'
  | 'flag_dependency'
  | 'unknown_property_type'
  | 'unknown_operator'
  | 'is_not_set'
  | 'property_key'
  | 'malformed'
  | 'scope_drift'
  | 'kind_drift'

/** One registered flag, its code declaration and its live PostHog state. */
export interface FlagRow {
  key: string
  description: string
  kind: 'boolean' | 'multivariate'
  /** The variants, `control` first by convention; null on a boolean flag. */
  variants: string[] | null
  /** Who it is bucketed by: the user, or the tenant group. */
  scope: 'user' | 'tenant'
  /** Whether any browser is sent its value. */
  client: boolean
  /** The apps sent its value; empty when `client` is false. */
  apps: FlagApp[]
  experiment: boolean
  fallback: boolean | string
  state: FlagState
  /** The construct that made it unsupported, such as `cohort`; set only then. */
  unsupportedReason?: UnsupportedConstruct
  /** Release conditions in PostHog; 0 when missing. */
  conditions: number
  /** The highest rollout percentage of any condition; null when there is none. */
  maxRollout: number | null
  /** The flag in PostHog; null when the API lacks the app host or project id. */
  posthogUrl: string | null
}

/** A flag that exists in PostHog but not in the registry. Never evaluated. */
export interface UnregisteredRow {
  key: string
  active: boolean
  posthogUrl: string | null
}

/** One trait a PostHog release condition may use, for the Traits panel. */
export interface TraitRow {
  name: TraitName
  /** `person` properties or `group` (tenant) properties in PostHog. */
  where: 'person' | 'group'
  description: string
  examples: string[]
}

/** When the snapshot was fetched; `stale` once it has not been checked for 10 minutes. */
export interface FlagSnapshotInfo {
  fetchedAt: string | null
  stale: boolean
}

/**
 * The inspector list's snapshot info. `enabled: false` is an environment
 * without the feature flags key: every flag serves its fallback.
 */
export interface FlagsListSnapshot extends FlagSnapshotInfo {
  enabled: boolean
}

/** `GET /platform/flags`. */
export interface FlagsListResponse {
  items: FlagRow[]
  unregistered: UnregisteredRow[]
  traits: TraitRow[]
  snapshot: FlagsListSnapshot
}

/** One flag's evaluation for the person asked about. */
export interface FlagEvaluationRow {
  key: string
  value: boolean | string
  reason: FlagReason
  /** The release condition that matched, from 0. */
  conditionIndex?: number
  /** Set for a holdout user: they see the fallback, and exposure records this. */
  holdoutVariant?: string
}

/**
 * `GET /platform/flags/evaluate`: the traits express derived and every
 * registered flag's evaluation. `tenant_created_days` is absent when no
 * tenant was asked about.
 */
export interface FlagsEvaluateResponse {
  traits: Partial<Record<TraitName, string | number>>
  flags: FlagEvaluationRow[]
  snapshot: FlagSnapshotInfo
}

/** Why the last definitions fetch failed, as express names it. */
export type FlagFetchErrorCode =
  'unauthorized' | 'http_error' | 'timeout' | 'network' | 'body_too_large' | 'invalid_body'

/** Feature flags' health, as the system status reports it. */
export interface FlagsStatus {
  enabled: boolean
  /** When the snapshot was last fetched with changes. */
  snapshotAt: string | null
  /** When PostHog was last asked, changed or not. */
  checkedAt: string | null
  stale: boolean
  lastFetchOk: string | null
  /** A fixed code naming the last failed fetch; cleared by a good one. */
  lastFetchError: FlagFetchErrorCode | null
  /** PostHog's `property_matching_version`; express's matching is validated for 1 only. */
  propertyMatchingVersion: number | null
  counts: {
    registered: number
    active: number
    inactive: number
    missing: number
    unsupported: number
    unregistered: number
    unknownVariant15m: number
  }
}

/** Mirrors express's `MAINTENANCE_MODES`: customers fully shut out, writes refused, or neither. */
export type MaintenanceMode = 'off' | 'read_only' | 'full'

/**
 * One BullMQ queue as maintenance mode sees it: paused or not, and the jobs
 * running on it now. Either is null when Redis did not answer for that queue.
 */
export interface QueuePauseState {
  name: string
  paused: boolean | null
  active: number | null
}

/**
 * `GET /platform/maintenance-mode`, and a `PUT` there's answer (express
 * 1.9.0). `environment` is the API's `APP_ENV`, the value a switch-on must
 * type to confirm. `since` is when the mode last changed; `changedBy` is null
 * for the row the migration seeded.
 */
export interface PlatformMaintenanceModeView {
  mode: MaintenanceMode
  /** Customer-facing plain text, shown to customers while the mode is not `off`. */
  message: string | null
  /** Internal; for staff only. */
  reason: string | null
  since: string | null
  changedBy: { id: string; name: string } | null
  /** Sent back as `expectedVersion`; a stale one answers 409 `MAINTENANCE_MODE_CONFLICT`. */
  version: number
  queues: QueuePauseState[]
  environment: string
}

/**
 * `PUT /platform/maintenance-mode`'s strict body. `confirm` is sent only when
 * switching on or escalating, and `reason` only when one was given.
 */
export interface ChangeMaintenanceModeBody {
  mode: MaintenanceMode
  message?: string
  reason?: string
  expectedVersion: number
  confirm?: string
}

/**
 * The system status's maintenance section. `known: false` is a replica that
 * has not read the state since it started, and serves customers as `off`.
 */
export interface MaintenanceModeStatus {
  mode: MaintenanceMode
  since: string | null
  known: boolean
  queuesPaused: boolean
  queues: QueuePauseState[]
  /** Change notices still queued, held back by paused queues; they go out on resume. */
  noticesPending: boolean
  lastReloadError: string | null
}

/**
 * `GET /platform/system/status`. An open object: later API versions add
 * sections, which this build ignores. `flags` is absent before express 1.8.0,
 * `maintenance` before 1.9.0.
 */
export interface SystemStatus {
  /** The API's git sha, or `dev`. */
  release: string
  errorTracking: ErrorTrackingStatus
  flags?: FlagsStatus
  maintenance?: MaintenanceModeStatus
}
