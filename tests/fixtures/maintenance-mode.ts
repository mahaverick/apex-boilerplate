/**
 * @file Maintenance-mode answers as express sends them: the platform state
 * (`GET /platform/maintenance-mode`) and the system status's section.
 */
import { STAFF_USER_ID } from '@/tests/fixtures/ids'
import type {
  MaintenanceModeStatus,
  PlatformMaintenanceModeView,
  QueuePauseState,
} from '@/types/api.types'

/** The four queues `queue.service.ts` creates, running and idle. */
export const RUNNING_QUEUES: QueuePauseState[] = [
  { name: 'email', paused: false, active: 0 },
  { name: 'notification', paused: false, active: 0 },
  { name: 'maintenance', paused: false, active: 0 },
  { name: 'analytics', paused: false, active: 2 },
]

/** The same queues paused, with one analytics job still finishing. */
export const PAUSED_QUEUES: QueuePauseState[] = RUNNING_QUEUES.map((queue) => ({
  ...queue,
  paused: true,
  active: queue.name === 'analytics' ? 1 : 0,
}))

/**
 * The platform state: off since a staff member switched it off, in `staging`.
 * @param overrides - Fields to replace.
 * @returns The view.
 */
export function maintenanceModeView(
  overrides: Partial<PlatformMaintenanceModeView> = {}
): PlatformMaintenanceModeView {
  return {
    mode: 'off',
    message: null,
    reason: null,
    since: '2026-10-05T09:00:00.000Z',
    changedBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
    version: 4,
    queues: RUNNING_QUEUES,
    environment: 'staging',
    ...overrides,
  }
}

/** Full maintenance, set by Sam Staff with a reason and a two-line message. */
export function fullMaintenanceView(
  overrides: Partial<PlatformMaintenanceModeView> = {}
): PlatformMaintenanceModeView {
  return maintenanceModeView({
    mode: 'full',
    message: 'We are upgrading the database.\nBack by 11:00 UTC.',
    reason: 'Postgres 18 upgrade',
    since: '2026-10-06T10:42:00.000Z',
    version: 5,
    queues: PAUSED_QUEUES,
    ...overrides,
  })
}

/**
 * The status card's section: off, known, every queue running.
 * @param overrides - Fields to replace.
 * @returns The section.
 */
export function maintenanceStatus(
  overrides: Partial<MaintenanceModeStatus> = {}
): MaintenanceModeStatus {
  return {
    mode: 'off',
    since: '2026-10-05T09:00:00.000Z',
    known: true,
    queuesPaused: false,
    queues: RUNNING_QUEUES,
    noticesPending: false,
    lastReloadError: null,
    ...overrides,
  }
}
