import type { RefObject } from 'react'

/**
 * A ref callback for an actions menu's trigger. An action can leave nothing
 * to offer (an admin soft-deletes an account, or archives a tenant), which
 * unmounts the trigger just after its closing dialog handed focus back to
 * it; focus then moves to `fallback` rather than to <body>.
 * @param fallback - Where focus goes instead, usually the page's heading.
 * @returns The ref callback.
 */
export function focusFallbackOnRemoval(fallback: RefObject<HTMLElement | null> | undefined) {
  return (node: HTMLButtonElement | null) => () => {
    if (node !== null && document.activeElement === node) fallback?.current?.focus()
  }
}
