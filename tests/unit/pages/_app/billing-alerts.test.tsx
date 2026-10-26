import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useAuthStore } from '@/states/auth.store'
import { testBillingAlerts } from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** Answers every alerts request with the two alerts, recording each query. */
function serve(seen: URLSearchParams[], nextCursor: string | null = null) {
  server.use(
    http.get('/api/v1/platform/billing/alerts', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      return ok(
        listPage(
          testBillingAlerts,
          { nextCursor, hasNext: nextCursor !== null },
          { count: testBillingAlerts.length, capped: false }
        ),
        'Billing alerts retrieved.'
      )
    })
  )
}

describe('/billing-alerts', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('lists every alert with its kind, tenant, message and time, newest first', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    renderAppAt('/billing-alerts')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Billing alerts' })
    ).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Billing alerts' })
    const [duplicate, failing] = within(table).getAllByRole('row').slice(1)
    expect(within(duplicate!).getByText('Duplicate refunded')).toBeInTheDocument()
    expect(within(duplicate!).getByText(testBillingAlerts[0]!.message)).toBeInTheDocument()
    expect(within(duplicate!).getByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
      'href',
      `/tenants/${TENANT_ID}/billing`
    )
    expect(within(failing!).getByText('Provider event failing')).toBeInTheDocument()
    expect(within(failing!).getByText('No tenant')).toBeInTheDocument()
    expect(within(failing!).queryByRole('link')).toBeNull()
    expect(within(table).getByRole('columnheader', { name: 'When' })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
    expect(seen.at(-1)?.get('sort')).toBeNull()
    expect(seen.at(-1)?.get('total')).toBe('1')
  })

  it('sorts oldest first from the When header, in the URL', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/billing-alerts')
    const table = await screen.findByRole('table', { name: 'Billing alerts' })
    await user.click(within(table).getByRole('button', { name: 'When' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: 'at' }))
    await waitFor(() => expect(seen.at(-1)?.get('sort')).toBe('at'))
  })

  it('debounces the message search into ?search and starts from the first page', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/billing-alerts?cursor=c1')
    await screen.findByRole('table', { name: 'Billing alerts' })
    const box = screen.getByRole('searchbox', { name: 'Search billing alerts' })
    expect(box).toHaveAttribute('placeholder', 'Search by message')
    await user.type(box, 'refunded')
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'refunded' }))
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('refunded'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('pages with the API cursor', async () => {
    const seen: URLSearchParams[] = []
    serve(seen, 'c3')
    const user = userEvent.setup()
    const router = renderAppAt('/billing-alerts')
    await screen.findByRole('table', { name: 'Billing alerts' })
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c3' }))
    await waitFor(() => expect(seen.at(-1)?.get('cursor')).toBe('c3'))
  })

  it('says when there are no billing alerts', async () => {
    server.use(http.get('/api/v1/platform/billing/alerts', () => ok(listPage([]), 'ok')))
    renderAppAt('/billing-alerts')
    expect(await screen.findByText('No billing alerts.')).toBeInTheDocument()
  })

  it('says the role cannot see this, and does not sign out, on a 404', async () => {
    server.use(http.get('/api/v1/platform/billing/alerts', () => fail('Not found', 404)))
    renderAppAt('/billing-alerts')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it.each(['viewer', 'manager'] as const)(
    'shows a %s the not-available card and never asks for the alerts',
    async (role) => {
      signIn({ ...testUser, platformRole: role })
      const seen: URLSearchParams[] = []
      serve(seen)
      renderAppAt('/billing-alerts')
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Page not available' })
      ).toBeInTheDocument()
      expect(seen).toHaveLength(0)
    }
  )
})
