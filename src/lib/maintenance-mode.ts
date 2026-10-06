/**
 * @file Maintenance mode's rules and sentences outside React: which change
 * the API guards hardest, and how the banner and a conflict word the state.
 */
import { MAINTENANCE_MODE_LABELS } from '@/constants/maintenance-mode.constants'
import { absoluteTime } from '@/lib/relative-time'
import type {
  MaintenanceMode,
  PlatformMaintenanceModeView,
  QueuePauseState,
} from '@/types/api.types'

/**
 * Whether going from `from` to `to` switches maintenance on or escalates it:
 * the moves the API refuses without a reason and the typed environment.
 * @param from - The mode now.
 * @param to - The mode asked for.
 * @returns True for `off` to any other mode, and `read_only` to `full`.
 */
export function isSwitchOn(from: MaintenanceMode, to: MaintenanceMode): boolean {
  return (from === 'off' && to !== 'off') || (from === 'read_only' && to === 'full')
}

/**
 * When a mode began, short: the time alone on the same local day, else the
 * date and time.
 * @param iso - The instant.
 * @param now - Today, for tests.
 * @returns "10:42", or "Oct 5, 2026, 10:42 AM" in the reader's locale.
 */
export function sinceLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'an unknown time'
  if (date.toDateString() !== now.toDateString()) return absoluteTime(iso)
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date)
}

/**
 * The red banner's sentence: the mode in capitals, since when and by whom.
 * @param view - The state, whose mode is not `off`.
 * @param now - Today, for tests.
 * @returns "Customers are in FULL maintenance since 10:42, set by Ada."
 */
export function bannerSentence(view: PlatformMaintenanceModeView, now?: Date): string {
  const mode = MAINTENANCE_MODE_LABELS[view.mode].toUpperCase()
  const since = view.since === null ? '' : ` since ${sinceLabel(view.since, now)}`
  const by = view.changedBy === null ? '' : `, set by ${view.changedBy.name}`
  return `Customers are in ${mode} maintenance${since}${by}.`
}

/**
 * What a 409 found: the state someone else saved meanwhile.
 * @param view - The state read again after the conflict.
 * @param now - Today, for tests.
 * @returns A sentence naming the mode, the actor and the time, and what to do.
 */
export function conflictSentence(view: PlatformMaintenanceModeView, now?: Date): string {
  const mode = MAINTENANCE_MODE_LABELS[view.mode].toLowerCase()
  const by = view.changedBy === null ? '' : ` by ${view.changedBy.name}`
  const at = view.since === null ? '' : ` at ${sinceLabel(view.since, now)}`
  const set = by === '' && at === '' ? '' : `, set${by}${at}`
  return `Someone changed maintenance mode while you were editing: it is now ${mode}${set}. Check the page and try again.`
}

/** Whether a queue is paused, in words; null is a queue Redis did not answer for. */
function pauseWords(paused: boolean | null): string {
  if (paused === null) return 'pause state unknown'
  return paused ? 'paused' : 'not paused'
}

/**
 * One queue's line, as the Maintenance page and the status card list it.
 * @param queue - The queue's state.
 * @returns "email: paused, 0 running", with "unknown" for what Redis did not answer.
 */
export function queueLine(queue: QueuePauseState): string {
  const running =
    queue.active === null
      ? 'running count unknown'
      : `${queue.active.toLocaleString('en-US')} running`
  return `${queue.name}: ${pauseWords(queue.paused)}, ${running}`
}
