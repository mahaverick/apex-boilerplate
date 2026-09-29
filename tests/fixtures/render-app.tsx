import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { testUser } from '@/tests/mocks/handlers'
import type { User } from '@/types/api.types'

/**
 * Put the store where a finished bootstrap leaves a signed-in user, so
 * `__root`'s beforeLoad returns at once and the guards see `user`.
 * @param user - Who is signed in; the staff admin `testUser` by default.
 */
export function signIn(user: User = testUser): void {
  resetSessionForTests()
  queryClient.clear()
  useAuthStore.setState({
    accessToken: 'test-token',
    user,
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/** Put the store where a finished bootstrap leaves a signed-out visitor. */
export function signOut(): void {
  resetSessionForTests()
  queryClient.clear()
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: true,
  })
}

/**
 * Mount the real route tree at `path`. Call `signIn` or `signOut` first.
 * @param path - The URL to start at, search included.
 * @returns The router, to assert on its location, plus `unmount`.
 */
export function renderAppAt(path: string): AnyRouter & { unmount: () => void } {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return Object.assign(router as AnyRouter, { unmount })
}
