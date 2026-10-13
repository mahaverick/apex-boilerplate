import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

// A deployment without Google OAuth empties the list; the page must then draw neither the buttons nor the divider.
vi.mock('@/constants/auth-providers', () => ({ SOCIAL_PROVIDERS: [] }))

/** Mounts the login page through the real route tree, signed out. */
function renderSignedOutLogin() {
  resetSessionForTests()
  queryClient.clear()
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('login page with no social provider configured', () => {
  beforeEach(renderSignedOutLogin)

  it('renders no social button and no divider, and keeps the email form', async () => {
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    expect(screen.queryByRole('link', { name: /continue with/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Or continue with')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})
