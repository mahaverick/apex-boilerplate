/**
 * Fixture ids shaped like the API's own. express validates ids in paths and
 * filters as UUIDs (an invitation's `:id`, the audit log's `tenantId`), so a
 * non-UUID id models a request the real API would refuse with a 400.
 *
 * Hand-written and fixed, never generated. The first digit names the kind
 * (1 tenant, 2 user, 3 membership, 4 invitation, 5 email send attempt, 6
 * audit entry, 7 email message, 8 email provider event, 9 email suppression)
 * and the last digits the ordinal; `...100` is the platform-side one.
 */
export const TENANT_ID = '10000000-0000-4000-8000-000000000001'
/** A second customer tenant, for tests that need a tenant other than `TENANT_ID`. */
export const TENANT_ID_2 = '10000000-0000-4000-8000-000000000002'
/** A third customer tenant. */
export const TENANT_ID_3 = '10000000-0000-4000-8000-000000000003'
/** A fourth customer tenant. */
export const TENANT_ID_4 = '10000000-0000-4000-8000-000000000004'
/**
 * A customer tenant at ordinal 9: an id no base fixture references, for a record a test adds itself.
 */
export const TENANT_ID_9 = '10000000-0000-4000-8000-000000000009'
/** The platform tenant that staff accounts belong to. */
export const PLATFORM_TENANT_ID = '10000000-0000-4000-8000-000000000100'

/** `testUser.id`: the user every signed-in test signs in as. */
export const USER_ID = '20000000-0000-4000-8000-000000000001'
/** A second customer user, for tests that need someone other than the signed-in `testUser`. */
export const USER_ID_2 = '20000000-0000-4000-8000-000000000002'
/** A third customer user. */
export const USER_ID_3 = '20000000-0000-4000-8000-000000000003'
/** A fourth customer user. */
export const USER_ID_4 = '20000000-0000-4000-8000-000000000004'
/** A fifth customer user. */
export const USER_ID_5 = '20000000-0000-4000-8000-000000000005'
/**
 * A customer user at ordinal 9: an id no base fixture references, for a user a test adds itself.
 */
export const USER_ID_9 = '20000000-0000-4000-8000-000000000009'
/** The staff actor ('Sam Staff') that fixture audit, maintenance and email records name. */
export const STAFF_USER_ID = '20000000-0000-4000-8000-000000000100'

/** `MEMBERSHIP_ID_n` is `USER_ID_n`'s membership. */
export const MEMBERSHIP_ID = '30000000-0000-4000-8000-000000000001'
/** `USER_ID_2`'s membership. */
export const MEMBERSHIP_ID_2 = '30000000-0000-4000-8000-000000000002'
/** `USER_ID_3`'s membership. */
export const MEMBERSHIP_ID_3 = '30000000-0000-4000-8000-000000000003'
/** `USER_ID_4`'s membership. */
export const MEMBERSHIP_ID_4 = '30000000-0000-4000-8000-000000000004'
/** `USER_ID_5`'s membership. */
export const MEMBERSHIP_ID_5 = '30000000-0000-4000-8000-000000000005'

/** The pending invitation that `testInvitation` models. */
export const INVITATION_ID = '40000000-0000-4000-8000-000000000001'
/** A second pending invitation. */
export const INVITATION_ID_2 = '40000000-0000-4000-8000-000000000002'
/** A third pending invitation. */
export const INVITATION_ID_3 = '40000000-0000-4000-8000-000000000003'
/**
 * An invitation at ordinal 9: absent from the base fixtures, for one a test adds after the first render.
 */
export const INVITATION_ID_9 = '40000000-0000-4000-8000-000000000009'

/** The first audit entry. */
export const AUDIT_ID_1 = '60000000-0000-4000-8000-000000000001'
/** The second audit entry. */
export const AUDIT_ID_2 = '60000000-0000-4000-8000-000000000002'
/** The third audit entry. */
export const AUDIT_ID_3 = '60000000-0000-4000-8000-000000000003'
/** The fourth audit entry. */
export const AUDIT_ID_4 = '60000000-0000-4000-8000-000000000004'
/** The fifth audit entry. */
export const AUDIT_ID_5 = '60000000-0000-4000-8000-000000000005'
/** An audit entry recorded on the platform tenant. */
export const PLATFORM_AUDIT_ID = '60000000-0000-4000-8000-000000000100'

/** The first send attempt of an email message. */
export const EMAIL_ATTEMPT_ID = '50000000-0000-4000-8000-000000000001'
/** The second send attempt of an email message. */
export const EMAIL_ATTEMPT_ID_2 = '50000000-0000-4000-8000-000000000002'

/** The first email message. */
export const EMAIL_ID = '70000000-0000-4000-8000-000000000001'
/** The second email message. */
export const EMAIL_ID_2 = '70000000-0000-4000-8000-000000000002'
/** The third email message. */
export const EMAIL_ID_3 = '70000000-0000-4000-8000-000000000003'

/** The first provider event for an email message. */
export const EMAIL_EVENT_ID = '80000000-0000-4000-8000-000000000001'
/** The second provider event for an email message. */
export const EMAIL_EVENT_ID_2 = '80000000-0000-4000-8000-000000000002'

/** The first email suppression. */
export const SUPPRESSION_ID = '90000000-0000-4000-8000-000000000001'
/** The second email suppression. */
export const SUPPRESSION_ID_2 = '90000000-0000-4000-8000-000000000002'
