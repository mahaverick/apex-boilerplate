/**
 * @file A one-shot request for the next page's heading to take focus. An
 * action that leaves its page (a create that opens the new record, a delete
 * that returns to the list) sets it just before it navigates, and the
 * destination's `useArrivalFocus` takes it. A module flag, not router history
 * state, so Back to the page never focuses it again.
 */

let requested = false

/** Asks the next page that becomes ready to focus its heading. Call it just before navigating. */
export function requestArrivalFocus(): void {
  requested = true
}

/**
 * Takes the request, clearing it.
 * @returns Whether a request was waiting.
 */
export function takeArrivalFocus(): boolean {
  const was = requested
  requested = false
  return was
}
