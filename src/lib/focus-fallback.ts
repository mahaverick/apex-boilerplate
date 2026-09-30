import type { RefObject } from 'react'

/**
 * A ref callback for an actions menu's trigger: if the trigger is unmounted
 * while it holds focus, focus moves to `fallback` rather than to <body>. An
 * action can leave nothing to offer (an admin soft-deletes an account, or
 * archives a tenant); when the trigger goes while its dialog is still open,
 * it does not hold focus and this does nothing, so the dialog's own
 * `finalFocus` has to name the fallback.
 * @param fallback - Where focus goes instead, usually the page's heading.
 * @returns The ref callback.
 */
export function focusFallbackOnRemoval(fallback: RefObject<HTMLElement | null> | undefined) {
  return (node: HTMLButtonElement | null) => () => {
    if (node !== null && document.activeElement === node) fallback?.current?.focus()
  }
}
