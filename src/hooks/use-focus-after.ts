import { useCallback, useEffect, useReducer, useRef, type RefCallback } from 'react'

interface FocusRequest<Key extends string> {
  keys: readonly Key[]
  trigger: HTMLElement | null | undefined
  /** The dialog has closed, so a landmark found after this is no business of its `finalFocus`. */
  isClosed: boolean
}

/**
 * Keeps keyboard focus on the page when a successful action removes the
 * button that started it (a refetch replaces Mark complete with its done
 * state, drops a revoked invitation's row, flips `canResend`). Without it the
 * browser drops focus to `<body>` and a keyboard user starts over from the top.
 *
 * The rule: focus moves to the nearest stable landmark. That is the acted-on
 * item's own row or title if it is still on the page, otherwise the heading of
 * the section or card that holds it. A landmark is any element that carries
 * `tabIndex={-1}` and `ref={target(key)}`, and styled `outline-none` like
 * the page headings, since it takes focus from code and is never a tab stop.
 *
 * Call `focusAfter` only once the action has succeeded; on an error nothing is
 * requested, so focus stays on, or returns to, the trigger. The move happens
 * once the refetched tree has rendered, never on a timer: in an effect after a
 * render of the host, or when a DOM mutation (watched by a `MutationObserver`
 * while a request is armed) shows the trigger gone. A request is armed until
 * its outcome is known, and then it is over (resolved or dropped), so it cannot
 * fire on a later unrelated change. At each check:
 * - the trigger is gone and focus is on `<body>`: focus moves to the landmark;
 * - focus is inside an open dialog, or on the trigger: it waits;
 * - focus is anywhere else (the reader moved on): it is dropped;
 * - the reader leaves the trigger (`focusout`, which a click elsewhere or Tab
 *   fires and the trigger's removal does not): it is dropped.
 * While the trigger stays on the page with focus on it, the request stays
 * armed, because the refetch that removes it may not have rendered yet; if the
 * action left its button in place, the request ends the moment the reader
 * leaves it, and if that button is removed later with focus still on it,
 * focus moves to the landmark.
 *
 * Call the hook in a component that stays mounted: the row or button that the
 * success removes cannot move focus after it is gone.
 * @returns `target` to register a landmark, `focusAfter` to request the move,
 * and `finalFocus` for a dialog's `finalFocus` prop.
 */
export function useFocusAfter<Key extends string>() {
  const landmarks = useRef(new Map<Key, HTMLElement>())
  const refCallbacks = useRef(new Map<Key, RefCallback<HTMLElement>>())
  const pending = useRef<FocusRequest<Key> | null>(null)
  const landed = useRef<HTMLElement | null>(null)
  const [, requestRender] = useReducer((count: number) => count + 1, 0)

  /** The ref callback that registers an element as the landmark called `key`. */
  const target = useCallback((key: Key): RefCallback<HTMLElement> => {
    let callback = refCallbacks.current.get(key)
    if (callback === undefined) {
      callback = (node) => {
        if (node === null) landmarks.current.delete(key)
        else landmarks.current.set(key, node)
      }
      refCallbacks.current.set(key, callback)
    }
    return callback
  }, [])

  /** The first connected landmark among `keys`, if any. */
  const find = useCallback((keys: readonly Key[]) => {
    for (const key of keys) {
      const node = landmarks.current.get(key)
      if (node?.isConnected) return node
    }
    return null
  }, [])

  /**
   * Ends the pending request if its outcome is known, returning the landmark
   * to focus when it is one. Waits while the trigger is still on the page, or
   * focus is inside a dialog; drops it when focus is anywhere but `<body>`.
   */
  const settle = useCallback(() => {
    const request = pending.current
    if (request === null) return null
    const active = document.activeElement
    const isWaiting =
      active === document.body ||
      active === request.trigger ||
      active?.closest('[role="dialog"],[role="alertdialog"]')
    if (!isWaiting) {
      pending.current = null
      return null
    }
    if (request.trigger?.isConnected || active !== document.body) return null
    pending.current = null
    const node = find(request.keys)
    if (!request.isClosed) landed.current = node
    return node
  }, [find])

  const observer = useRef<MutationObserver | null>(null)
  const stopWatching = useCallback(() => {
    observer.current?.disconnect()
    observer.current = null
  }, [])

  // A child can drop the trigger on its own render, without the host rendering again, so the host's effect alone would miss it.
  const watch = useCallback(() => {
    stopWatching()
    observer.current = new MutationObserver(() => {
      settle()?.focus()
      if (pending.current === null) stopWatching()
    })
    observer.current.observe(document.body, { childList: true, subtree: true })
  }, [settle, stopWatching])

  useEffect(() => {
    const node = settle()
    if (pending.current === null) stopWatching()
    node?.focus()
  })

  useEffect(() => stopWatching, [stopWatching])

  /**
   * Asks for focus to move after the action succeeded, superseding any request still waiting.
   * @param keys - A landmark, or landmarks in order of preference: the item's own first, its section's heading last.
   * @param trigger - The button that started the action; omitted, focus always moves.
   */
  const focusAfter = useCallback(
    (keys: Key | readonly Key[], trigger?: HTMLElement | null) => {
      landed.current = null
      const request = {
        keys: typeof keys === 'string' ? [keys] : keys,
        trigger,
        isClosed: false,
      }
      pending.current = request
      // The reader leaving the trigger (a click elsewhere, Tab) ends the request; removing it fires no focusout.
      trigger?.addEventListener(
        'focusout',
        () => {
          if (pending.current === request) pending.current = null
        },
        { once: true }
      )
      watch()
      requestRender()
    },
    [watch]
  )

  /**
   * For a dialog's `finalFocus`, called as it closes. After a success, `false`
   * (restore nothing) once focus has moved to a landmark, or when the trigger is
   * gone and the move is still to come, since the landmark takes focus itself;
   * a returned element would not do, because the dialog focuses its first
   * tabbable child, and a row's own button is one. While the trigger is
   * still on the page, `true`: the dialog returns focus to it, and the request
   * stays armed (see above). Otherwise `true`, unless a refusal that refreshed
   * the page took the trigger away and `fallback` names a landmark.
   */
  const finalFocus = useCallback(
    (trigger?: HTMLElement | null, fallback?: Key) => {
      const request = pending.current
      const moved = landed.current !== null
      landed.current = null
      if (moved) return false
      if (request !== null) {
        request.isClosed = true
        return request.trigger?.isConnected === true
      }
      if (trigger?.isConnected === false && fallback !== undefined) {
        return find([fallback]) ?? true
      }
      return true
    },
    [find]
  )

  return { target, focusAfter, finalFocus }
}
