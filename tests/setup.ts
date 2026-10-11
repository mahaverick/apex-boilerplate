import '@/lib/zod-jitless'
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
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
 * jsdom ships no `window.matchMedia`, and sonner calls it unguarded in an
 * effect (`window.matchMedia('(prefers-color-scheme: dark)')`), so any test
 * that mounts the real route tree, whose `__root` renders sonner's `<Toaster>`,
 * would show sonner's error boundary instead of the page. This stub answers
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
 * Sonner's toast store is module-global and outlives each test's `<Toaster>`:
 * a toast still active when its Toaster unmounts is replayed into the next
 * test's Toaster for a fresh 4s. Unmounting first leaves no Toaster subscribed
 * when the active toasts are dismissed. Testing Library's own cleanup runs
 * after this hook and finds nothing left to unmount.
 */
afterEach(() => {
  cleanup()
  toast.dismiss()
  server.resetHandlers()
})
afterAll(() => server.close())
