import '@/lib/zod-jitless'
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, expect, vi } from 'vite-plus/test'
// This import loads `use-list-search` for every test file: a `vi.mock` of that module must use `vi.doMock` or a reset.
import { resetListPositions } from '@/components/shared/data-table/use-list-search'
import { toast } from '@/lib/toast'
import { server } from '@/tests/mocks/server'

expect.extend(toHaveNoViolations)

/**
 * The budget for every `findBy*` and `waitFor`; vitest's `testTimeout` does not
 * govern it. Testing Library's default of one second can run out under
 * full-suite contention, when each test file runs in its own worker. It stays
 * below `testTimeout` in vitest.config.ts, so a hung test fails on its own
 * assertion rather than being cut off mid-wait.
 */
configure({ asyncUtilTimeout: 5_000 })

/**
 * Every `<Toaster>` in the unit tests keeps its toasts for 60 s instead of
 * Base UI's 5 s, longer than any test runs (`testTimeout` is 20 s), so no
 * assertion can pass or fail on the auto-dismiss racing it. A toast still
 * closes through its close button, an action or `toast.dismiss`. A test that
 * needs the timer passes its own `timeout`. This also reaches the Toaster that
 * `ToastHost` imports lazily.
 */
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  return {
    ...actual,
    Toaster: (props: Parameters<typeof actual.Toaster>[0]) =>
      createElement(actual.Toaster, { timeout: 60_000, ...props }),
  }
})

/**
 * By default react-query waits a backoff (about a second) before it retries a failed read, so
 * a test that waits for that read's error state spends the second on top of its own work, and
 * under full-suite contention it can outlast `asyncUtilTimeout`. Every client built in a unit
 * test, the app's own `queryClient` included, retries with no wait; `retry` itself stays
 * whatever the client sets, so the number of attempts is the app's.
 */
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  /** The real client with `retryDelay: 0` as a default a caller's own option still overrides. */
  class FastRetryQueryClient extends actual.QueryClient {
    /** @param config The caller's client options, passed through with the default added. */
    constructor(config: ConstructorParameters<typeof actual.QueryClient>[0] = {}) {
      super({
        ...config,
        defaultOptions: {
          ...config.defaultOptions,
          queries: { retryDelay: 0, ...config.defaultOptions?.queries },
        },
      })
    }
  }
  return { ...actual, QueryClient: FastRetryQueryClient }
})

declare module 'vitest' {
  /**
   * Makes `toHaveNoViolations()` type-check in `tests/unit/a11y.test.tsx`:
   * `@types/jest-axe` augments `jest.Matchers`, and this project has no `jest`
   * global. Both type parameters repeat vitest's own declaration, because
   * declaration merging rejects an interface whose parameters differ at all,
   * so `T` stays although this matcher takes no subject type. `T` is not
   * narrowed to axe's result type: `@types/jest-axe` declares its own
   * `AxeResults` locally and axe-core's is a different declaration, so a
   * `T extends AxeResults` guard would resolve to `never`.
   */
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R
  }
}

/**
 * jsdom ships no `window.matchMedia`. `useIsMobile` and `AppLayout`'s
 * system-theme effect call it unguarded, so any test that mounts the real
 * route tree would throw instead of rendering the page. This stub answers
 * false for every query except `max-width`, which compares against
 * `window.innerWidth`, so a test picks the viewport `useIsMobile` reports by
 * setting the width. A test about another query overrides it locally, as
 * theme.store.test.ts does.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    get matches() {
      const maxWidth = /max-width:\s*(\d+)px/.exec(query)
      return maxWidth ? window.innerWidth <= Number(maxWidth[1]) : false
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

/**
 * jsdom's `window.scrollTo` only logs "Not implemented" through its virtual
 * console, and TanStack Router calls it on every navigation, so each test that
 * mounts the route tree would print a console line per navigation and bury real
 * warnings. A silent no-op loses nothing: jsdom has no layout, so there is no
 * scroll position to change. Unconditional, unlike `matchMedia` above, because
 * the property already exists and a `!window.scrollTo` guard would never fire.
 */
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}

/** `onUnhandledRequest: 'error'` makes a request to an unmocked URL fail the test instead of reaching a real network. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
/**
 * `@/lib/toast` queues a toast raised while no `<Toaster>` is mounted, and the
 * queue is module-global: a test that toasts without a Toaster would hand its
 * toast to the next test's Toaster. Unmounting first leaves no Toaster
 * subscribed, then the dismiss empties the queue. Testing Library's own
 * cleanup runs after this hook and finds nothing left to unmount.
 */
afterEach(() => {
  cleanup()
  toast.dismiss()
  resetListPositions()
  server.resetHandlers()
})
/**
 * The frame callbacks still queued, by the handle `requestAnimationFrame`
 * returned. The wrappers below keep it, so `runQueuedFrames` can run them
 * without jsdom's frame loop.
 */
const queuedFrames = new Map<number, FrameRequestCallback>()

if (typeof window !== 'undefined' && window.requestAnimationFrame) {
  const requestFrame = window.requestAnimationFrame.bind(window)
  const cancelFrame = window.cancelAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) => {
    const handle = requestFrame((time) => {
      queuedFrames.delete(handle)
      callback(time)
    })
    queuedFrames.set(handle, callback)
    return handle
  }
  window.cancelAnimationFrame = (handle) => {
    queuedFrames.delete(handle)
    cancelFrame(handle)
  }
}

/**
 * Runs every frame callback still queued, before jsdom is torn down.
 * Recharts' Redux store batches its notifications on a `requestAnimationFrame`,
 * with a 100 ms Node `setTimeout` as fallback, and the frame's callback clears
 * that timer. If the teardown closes the window first, the frame never runs.
 * The timer then fires in a window-less worker, calls the removed
 * `cancelAnimationFrame`, and throws an uncaught ReferenceError.
 *
 * The callbacks run here, synchronously, rather than on jsdom's frame loop.
 * That loop is a `setInterval`: a file that fakes `setInterval` while the loop
 * starts leaves it dead, so waiting on a frame would hang. A callback that
 * queues another frame gets up to three more rounds. Whatever is left after
 * that is cancelled unrun. Every component is unmounted by now, and Redux
 * Toolkit's callback runs in the first round and queues nothing.
 */
function runQueuedFrames(): void {
  for (let round = 0; round < 4 && queuedFrames.size > 0; round += 1) {
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot: the loop body deletes from queuedFrames
    for (const [handle, callback] of [...queuedFrames]) {
      // A callback earlier in the round may have cancelled this one.
      if (!queuedFrames.has(handle)) continue
      window.cancelAnimationFrame(handle)
      callback(performance.now())
    }
  }
  // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot: the loop body deletes from queuedFrames
  for (const handle of [...queuedFrames.keys()]) window.cancelAnimationFrame(handle)
}

afterAll(() => {
  vi.useRealTimers()
  runQueuedFrames()
  server.close()
})
