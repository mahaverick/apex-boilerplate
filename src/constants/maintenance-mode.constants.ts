/**
 * @file Maintenance mode's fixed values, mirroring express's
 * maintenance-mode.constants.ts, and the words Apex uses for each mode.
 */
import type { MaintenanceMode } from '@/types/api.types'

/** How each mode reads in a badge or a sentence. */
export const MAINTENANCE_MODE_LABELS: Record<MaintenanceMode, string> = {
  off: 'Off',
  read_only: 'Read-only',
  full: 'Full',
}

/** 409: the state changed since the caller read the version it sent. */
export const MAINTENANCE_MODE_CONFLICT = 'MAINTENANCE_MODE_CONFLICT'

/** 400: a switch-on whose `confirm` is not the API's `APP_ENV`. */
export const CONFIRMATION_MISMATCH = 'CONFIRMATION_MISMATCH'

/** A save express answered with the version unchanged: it stored nothing. */
export const NOTHING_CHANGED = 'Nothing changed.'

/**
 * A 409 whose re-read failed, in the change dialog: what someone else saved is
 * unknown. Submitting again conflicts again and retries the read, keeping what
 * was typed.
 */
export const MAINTENANCE_CONFLICT_UNREAD =
  'Someone else changed maintenance mode, and we couldn’t load the new state. Submit again to reload it; what you typed is kept.'

/** The same, in the switch-off dialog, which has nothing typed to keep. */
export const MAINTENANCE_CONFLICT_UNREAD_TURN_OFF =
  'Someone else changed maintenance mode, and we couldn’t load the new state. Select Turn off again.'

/** A same-mode save whose message and reason are what is saved. */
export const MAINTENANCE_UNCHANGED_SAVE = 'Change the message or reason before saving.'

/** The API's cap on the customer message and the reason. */
export const MAINTENANCE_TEXT_MAX_LENGTH = 500

/**
 * How long after a switch to `full` the queues may still be running: the
 * change waits up to 10 s from its commit for its notices and no reload pauses
 * the queues sooner (express's reconciliation grace), a replica reloads at
 * least every 10 s, and the rest is headroom for clock skew between the API
 * and the browser.
 */
export const MAINTENANCE_PAUSE_SETTLE_MS = 30_000

/** How often Apex asks again while maintenance is on, for the banner and the page. */
export const MAINTENANCE_MODE_POLL_MS = 30_000

/** How often Apex asks again while maintenance is off, so a switch-on by someone else shows up. */
export const MAINTENANCE_MODE_IDLE_POLL_MS = 60_000

/**
 * What maintenance leaves working for staff, said on the Maintenance page:
 * the API lets platform staff through on `/platform/*` and on the customer
 * routes Apex calls.
 */
export const STAFF_WRITES_NOTE =
  'Staff actions in Apex, including the tenant, member, invitation and Staff pages, and staff sign-ins keep working and writing during maintenance.'
