import { useEffect, useRef, type ComponentProps, type RefObject } from 'react'
import type { DialogContent } from '@/components/ui/dialog'
import { requestArrivalFocus, takeArrivalFocus } from '@/lib/arrival-focus'

/**
 * Focuses `ref`'s element once, when the page is `ready` and an action that
 * left the previous page asked for it (`requestArrivalFocus`). The request
 * waits while the page is not ready, so a heading that renders only once its
 * record has loaded still gets it. It is checked only when the page mounts,
 * becomes ready or changes `record`, never on another render, so the page
 * that asked cannot take its own request before it has left.
 * @param ref - The page's `h1`, which carries `tabIndex={-1}` and `outline-none`.
 * @param ready - Whether that `h1` is on the page.
 * @param record - The id the page shows, for a layout the router keeps mounted from one record to the next.
 */
export function useArrivalFocus(
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
  record?: string
): void {
  useEffect(() => {
    if (ready && takeArrivalFocus()) ref.current?.focus()
  }, [ref, ready, record])
}

/** What a dialog's `finalFocus` accepts. */
type FinalFocus = ComponentProps<typeof DialogContent>['finalFocus']

/** How the dialog closed, as Base UI hands it to a `finalFocus` function. */
type CloseType = Parameters<Extract<NonNullable<FinalFocus>, (closeType: never) => unknown>>[0]

/**
 * For a dialog whose success leaves the page. `leave()`, called just before
 * the navigation, asks the next page for arrival focus and makes the
 * dialog's next close restore nothing, so Base UI does not pull focus back to
 * a trigger that is going. Any other close behaves as `otherwise` says.
 * @param otherwise - The dialog's `finalFocus` when it does not leave; unset returns focus to the trigger.
 * @returns `leave`, and `finalFocus` for the dialog.
 */
export function useLeavingFinalFocus(otherwise: FinalFocus) {
  const leaving = useRef(false)
  return {
    leave: () => {
      leaving.current = true
      requestArrivalFocus()
    },
    finalFocus: (closeType: CloseType): boolean | HTMLElement | null | void => {
      if (leaving.current) {
        leaving.current = false
        return false
      }
      if (typeof otherwise === 'function') return otherwise(closeType)
      if (typeof otherwise === 'object') return otherwise.current
      return otherwise ?? true
    },
  }
}
