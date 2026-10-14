import '@/lib/zod-jitless'
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest'
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by declaration merging, unused by this matcher's signature
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
  server.resetHandlers()
})
afterAll(() => server.close())
