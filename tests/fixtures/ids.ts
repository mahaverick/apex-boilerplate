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
/** The second tenant (Globex), which the Activity tenant filter lists beside Acme. */
export const TENANT_ID_2 = '10000000-0000-4000-8000-000000000002'
/** A third tenant row (the archived 'Gamma Inc') in the a11y tenants list. */
export const TENANT_ID_3 = '10000000-0000-4000-8000-000000000003'
/** A reserved fourth tenant id; no test references it. */
export const TENANT_ID_4 = '10000000-0000-4000-8000-000000000004'
/** A reserved tenant id at ordinal 9; no test references it. */
export const TENANT_ID_9 = '10000000-0000-4000-8000-000000000009'
/** The platform tenant that staff accounts belong to. */
export const PLATFORM_TENANT_ID = '10000000-0000-4000-8000-000000000100'

/** `testUser.id`: the user every signed-in test signs in as. */
export const USER_ID = '20000000-0000-4000-8000-000000000001'
/** Cleo, the second user: Acme's owner and the account whose detail, errors and timeline pages tests open. */
export const USER_ID_2 = '20000000-0000-4000-8000-000000000002'
/** A non-owner member: 'Vic' in the members tests, 'Evan Editor' in the onboarding fixtures. */
export const USER_ID_3 = '20000000-0000-4000-8000-000000000003'
/** Otto, the second owner in the members tests, so the signed-in owner is not the last one. */
export const USER_ID_4 = '20000000-0000-4000-8000-000000000004'
/** Amy, the second admin in the members tests that check what an admin may touch. */
export const USER_ID_5 = '20000000-0000-4000-8000-000000000005'
/** A reserved user id at ordinal 9; no test references it. */
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
/** A second pending row in the invitations list tests. */
export const INVITATION_ID_2 = '40000000-0000-4000-8000-000000000002'
/** A further pending row, with the editor role, in the resend and revoke tests. */
export const INVITATION_ID_3 = '40000000-0000-4000-8000-000000000003'
/**
 * An invitation at ordinal 9: absent from the base fixtures, for one a test adds after the first render.
 */
export const INVITATION_ID_9 = '40000000-0000-4000-8000-000000000009'

/** The older tenant-history entry (tenant.created), listed after `AUDIT_ID_2`. */
export const AUDIT_ID_1 = '60000000-0000-4000-8000-000000000001'
/** The newer tenant-history entry (a staff settings update), listed first; also the second reminder in the a11y onboarding page. */
export const AUDIT_ID_2 = '60000000-0000-4000-8000-000000000002'
/** A reserved audit id; no test references it. */
export const AUDIT_ID_3 = '60000000-0000-4000-8000-000000000003'
/** The id of the default `onboardingReminder`. */
export const AUDIT_ID_4 = '60000000-0000-4000-8000-000000000004'
/** The id of the second reminder in the onboarding tab's newest-first list. */
export const AUDIT_ID_5 = '60000000-0000-4000-8000-000000000005'
/** The id of the platform-wide entry the Activity page lists. */
export const PLATFORM_AUDIT_ID = '60000000-0000-4000-8000-000000000100'

/** The earlier send attempt, which the timeline orders before `EMAIL_ATTEMPT_ID_2`. */
export const EMAIL_ATTEMPT_ID = '50000000-0000-4000-8000-000000000001'
/** The later send attempt, for the timeline's merge-order tests. */
export const EMAIL_ATTEMPT_ID_2 = '50000000-0000-4000-8000-000000000002'

/** The message `emailSummary` and `emailDetail` describe by default. */
export const EMAIL_ID = '70000000-0000-4000-8000-000000000001'
/** A second message: the one a resend came from (`resentFromId`) and a row in list pages. */
export const EMAIL_ID_2 = '70000000-0000-4000-8000-000000000002'
/** The message a resend produced (`resentAsIds`). */
export const EMAIL_ID_3 = '70000000-0000-4000-8000-000000000003'

/** The provider event in the default `emailDetail`. */
export const EMAIL_EVENT_ID = '80000000-0000-4000-8000-000000000001'
/** A second provider event, for the timeline's merge-order tests. */
export const EMAIL_EVENT_ID_2 = '80000000-0000-4000-8000-000000000002'

/** The suppression `emailSuppression` builds by default. */
export const SUPPRESSION_ID = '90000000-0000-4000-8000-000000000001'
/** A second, lifted suppression in the suppressions list tests. */
export const SUPPRESSION_ID_2 = '90000000-0000-4000-8000-000000000002'
