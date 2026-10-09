import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { ErrorsPanel } from '@/components/features/errors/errors-panel'
import { resetSessionForTests } from '@/http/session'
import { PII_CLASS_NAME } from '@/observability/analytics'
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

  it('masks a forged browser $exception type for session replay, as it masks the value', async () => {
    // Any browser can send a $exception with the public project key, so `type` is attacker text, like `value`.
    const type = 'jane.doe@example.com'
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}/errors`, () =>
        ok(errorsPage([errorIssue({ type })]), 'Errors retrieved.')
      )
    )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ErrorsPanel kind="user" id={USER_ID_2} />
      </QueryClientProvider>
    )
    const cell = await screen.findByText(type, { selector: 'code' })
    expect(cell.closest(`.${PII_CLASS_NAME.split(' ')[0]}`)).not.toBeNull()
  })

  it("gives each row's PostHog link a distinct accessible name", async () => {
    server.use(
      http.get(`/api/v1/platform/users/${USER_ID_2}/errors`, () =>
        ok(
          errorsPage([
            errorIssue({ type: 'TypeError' }),
            errorIssue({ issueId: '0199b000-0000-7000-8000-0000000000a2', type: 'RangeError' }),
          ]),
          'Errors retrieved.'
        )
      )
    )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ErrorsPanel kind="user" id={USER_ID_2} />
      </QueryClientProvider>
    )
    const links = await screen.findAllByRole('link', { name: /Open in PostHog/ })
    expect(links).toHaveLength(2)
    const names = links.map((link) => link.textContent)
    expect(new Set(names).size).toBe(2)
    expect(links[1]).toHaveAccessibleName('Open in PostHog (RangeError, opens in a new tab)')
    // The type in the link's name is attacker text too, so it is masked like the cell.
    expect(
      within(links[1]!)
        .getByText('RangeError')
        .closest(`.${PII_CLASS_NAME.split(' ')[0]}`)
    ).not.toBeNull()
  })
})
