import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { ErrorsPanel } from '@/components/features/errors/errors-panel'
import { resetSessionForTests } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { errorIssue, errorsPage } from '@/tests/fixtures/errors'
import { USER_ID_2 } from '@/tests/fixtures/ids'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('ErrorsPanel', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({ accessToken: 'access-token', user: testUser, isAuthenticated: true })
  })

  it('renders a message holding markup as literal text, never as an element', async () => {
    const value = '<img src=x onerror=alert(1)>'
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}/errors`, () =>
        ok(errorsPage([errorIssue({ value })]), 'Errors retrieved.')
      )
    )
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ErrorsPanel kind="user" id={USER_ID_2} />
      </QueryClientProvider>
    )
    expect(await screen.findByText(value)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})
