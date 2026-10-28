/**
 * @file The audit action names alone, apart from their wording, so a route's
 * `validateSearch` and the list definitions can name the Action facet's values
 * without pulling the sentences into the entry chunk.
 */
/**
 * The audit actions this build has a sentence for, which the Action facet
 * offers. One the server stores that is not listed (a retired one such as
 * `tenant.errors_viewed`, which stays filterable on the API but is never
 * written again) still renders, through the fallback sentence.
 */
export const AUDIT_ACTIONS = [
  'tenant.created',
  'tenant.updated',
  'tenant.settings_updated',
  'member.role_changed',
  'member.removed',
  'member.left',
  'invitation.created',
  'invitation.resent',
  'invitation.revoked',
  'invitation.accepted',
  'platform.member.granted',
  'tenant.accessed_by_platform',
  'tenant.suspended',
  'tenant.reactivated',
  'tenant.archived',
  'tenant.owner_invited',
  'user.created',
  'user.updated',
  'user.deactivated',
  'user.reactivated',
  'user.signed_out',
  'user.sign_in_link_sent',
  'user.passkey_created',
  'user.passkey_deleted',
  'user.passkeys_cleared_on_claim',
  'user.deleted',
  'user.purged',
  'tenant.purged',
  'auth.step_up_confirmed',
  'auth.step_up_refused',
  'email.resent',
  'email.suppression_lifted',
  'onboarding.dismissed',
  'onboarding.undismissed',
  'onboarding.step_completed',
  'onboarding.reminder_sent',
  'user.flags_evaluated',
  'platform.maintenance_mode_changed',
  'billing.checkout_started',
  'billing.cancel_scheduled',
  'billing.interval_switch_scheduled',
  'billing.card_change_started',
  'billing.grant_expired',
  'billing.viewed',
  'billing.resynced',
  'billing.trial_extended',
  'billing.grant_added',
  'billing.grant_revoked',
  'billing.cancelled_by_staff',
  'plan.updated',
  'plan.price_created',
  'billing.settings_updated',
  'billing.tax_details_updated',
  'billing.tax_document_issued',
  'billing.credit_note_issued_by_staff',
  'billing.held_charge_resolved',
  'billing.tax_export_downloaded',
] as const
/** An audit action as the API names it (`area.event`) that this build has wording for. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/**
 * Actions the API still stores and filters by but never writes again. A link
 * made before they were retired keeps working; the Action facet never offers them.
 */
export const RETIRED_AUDIT_ACTIONS = [
  'user.timeline_viewed',
  'tenant.timeline_viewed',
  'user.errors_viewed',
  'tenant.errors_viewed',
  'platform.member.auto_joined',
  'auth.reauthenticated',
  'user.password_setup_sent',
  'user.verification_resent',
] as const

/** An action the API still stores but never writes again. */
export type RetiredAuditAction = (typeof RETIRED_AUDIT_ACTIONS)[number]

/** Every action name a stored row may hold, which the `action` URL param accepts. */
export const STORED_AUDIT_ACTIONS = [...AUDIT_ACTIONS, ...RETIRED_AUDIT_ACTIONS] as const
