import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { navItemsFor } from '@/constants/navigation'
import { EMAIL_ID, EMAIL_ID_2, EMAIL_ID_3, TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { emailSummary, fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { EmailMessageSummary } from '@/types/api.types'

const PAGE_ONE: EmailMessageSummary[] = [
  emailSummary(),
  emailSummary({
    id: EMAIL_ID_2,
    recipient: 'ops@corp.test',
    templateKey: 'password_changed',
    status: 'bounced',
    senderClass: 'general',
    user: null,
    tenant: null,
    canResend: false,
  }),
]

/** Page one, then page two after `next`; `prev` from page two answers page one. Records every query. */
function pages(seen: URLSearchParams[]) {
  server.use(
    http.get('/api/v1/platform/emails', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      if (params.get('cursor') === 'c2') {
        return ok(
          {
            messages: [emailSummary({ id: EMAIL_ID_3, recipient: 'late@example.com' })],
            nextCursor: null,
            prevCursor: 'p1',
          },
          'Emails retrieved.'
        )
      }
      return ok({ messages: PAGE_ONE, nextCursor: 'c2', prevCursor: null }, 'Emails retrieved.')
    })
  )
}

describe('/emails', () => {
  it('is the first Operations item, for every staff role', () => {
    const operations = navItemsFor('viewer').filter((item) => item.group === 'Operations')
    expect(operations.map((item) => [item.label, item.to])).toEqual([['Emails', '/emails']])
  })

  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('lists recipient, template, status, created, user and tenant', async () => {
    pages([])
    renderAppAt('/emails')
    const table = await screen.findByRole('table', { name: 'Emails' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Recipient', 'Template', 'Status', 'Created', 'User', 'Tenant'])
    const [, first, second] = within(table).getAllByRole('row')
    expect(within(first!).getByRole('link', { name: 'cleo@example.com' })).toBeInTheDocument()
    expect(within(first!).getByText('Tenant invitation')).toBeInTheDocument()
    expect(within(first!).getByText('Delivered')).toHaveAttribute('data-tone', 'success')
    expect(within(first!).getByRole('link', { name: 'Cleo Doe' })).toHaveAttribute(
      'href',
      `/users/${USER_ID_2}`
    )
    expect(within(first!).getByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
      'href',
      `/tenants/${TENANT_ID}`
    )
    expect(within(second!).getByText('Password changed')).toBeInTheDocument()
    expect(within(second!).getByText('Bounced')).toHaveAttribute('data-tone', 'destructive')
    expect(within(second!).getAllByText('—')).toHaveLength(2)
  })

  it('opens a message from its recipient', async () => {
    pages([])
    const user = userEvent.setup()
    const router = renderAppAt('/emails')
    const link = await screen.findByRole('link', { name: 'cleo@example.com' })
    expect(link).toHaveAttribute('href', `/emails/${EMAIL_ID}`)
    await user.click(link)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/emails/${EMAIL_ID}`))
    expect(await screen.findByRole('heading', { name: 'cleo@example.com', level: 1 })).toBeVisible()
  })

  it('pages with the API cursors, carrying them in the URL', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/emails')
    await screen.findByText('cleo@example.com')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('late@example.com')).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ cursor: 'c2', dir: 'next' })
    expect(seen.at(-1)?.get('direction')).toBe('next')

    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'p1', dir: 'prev' }))
    expect(seen.at(-1)?.get('direction')).toBe('prev')
  })

  it.each([
    ['Filter by status', 'Suppressed', { status: 'suppressed' }],
    ['Filter by template', 'Account setup', { template: 'account_setup' }],
  ])('%s drops the cursor and sends the filter', async (label, option, expected) => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/emails?cursor=c2&dir=next')
    await screen.findByText('late@example.com')

    await user.click(screen.getByRole('combobox', { name: label }))
    await user.click(await screen.findByRole('option', { name: option }))

    await waitFor(() => expect(router.state.location.search).toEqual(expected))
    const [[key, value]] = Object.entries(expected) as [[string, string]]
    await waitFor(() => expect(seen.at(-1)?.get(key)).toBe(value))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('debounces the recipient search into ?q and starts from the first page', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/emails?cursor=c2&dir=next')
    await screen.findByText('late@example.com')

    await user.type(screen.getByRole('searchbox', { name: 'Search emails' }), 'cleo@')

    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'cleo@' }))
    await waitFor(() => expect(seen.at(-1)?.get('q')).toBe('cleo@'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('keeps a numeric search, which the router hands over as a number', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    renderAppAt('/emails?q=2026')
    await screen.findByText('cleo@example.com')
    expect(screen.getByRole('searchbox', { name: 'Search emails' })).toHaveValue('2026')
    expect(seen.at(-1)?.get('q')).toBe('2026')
  })

  it('drops malformed filters rather than sending them', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const router = renderAppAt(
      '/emails?status=lost&template=welcome&userId=not-a-uuid&from=2026-13-40&to=yesterday'
    )
    await screen.findByText('cleo@example.com')
    expect(router.state.location.search).toEqual({})
    expect(Object.fromEntries(seen.at(-1)!)).toEqual({ limit: '20' })
  })

  it('reads a date range from the URL and names it on the trigger', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    renderAppAt('/emails?from=2026-09-01&to=2026-09-30')
    await screen.findByText('cleo@example.com')
    expect(
      screen.getByRole('button', { name: 'Filter by date. Current: Sep 1 – Sep 30' })
    ).toBeInTheDocument()
    expect(seen.at(-1)?.get('from')).toBe('2026-09-01')
    expect(seen.at(-1)?.get('to')).toBe('2026-09-30')
  })

  it('picks days on the calendar: one day, then a range, then clears them', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/emails?from=2026-09-10&to=2026-09-10&cursor=c2&dir=next')
    await screen.findByText('late@example.com')

    await user.click(screen.getByRole('button', { name: /^Filter by date/ }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by date' })
    await user.click(within(popup).getByRole('button', { name: /September 12th, 2026/ }))

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ from: '2026-09-10', to: '2026-09-12' })
    )
    await waitFor(() => expect(seen.at(-1)?.get('to')).toBe('2026-09-12'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()

    await user.click(within(popup).getByRole('button', { name: 'Clear dates' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Filter by date' })).not.toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Filter by date. Current: Any date' })).toBeVisible()
  })

  it('shows ?userId and ?tenantId as chips named from the listed rows, and removes them', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt(`/emails?userId=${USER_ID_2}&tenantId=${TENANT_ID}&status=delivered`)
    await screen.findByText('cleo@example.com')
    expect(seen.at(-1)?.get('userId')).toBe(USER_ID_2)
    expect(seen.at(-1)?.get('tenantId')).toBe(TENANT_ID)

    await user.click(screen.getByRole('button', { name: 'Remove filter: User: Cleo Doe' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ tenantId: TENANT_ID, status: 'delivered' })
    )
    await user.click(screen.getByRole('button', { name: 'Remove filter: Tenant: Acme Corp' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'delivered' }))
    await waitFor(() => expect(seen.at(-1)?.get('tenantId')).toBeNull())
  })

  it('names a chip from the record when no row does, and says so when it is gone', async () => {
    server.use(
      http.get('/api/v1/platform/emails', () =>
        ok({ messages: [], nextCursor: null, prevCursor: null }, 'Emails retrieved.')
      ),
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)),
      http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
        ok({ id: TENANT_ID, name: 'Acme Corp' }, 'Tenant retrieved.')
      )
    )
    renderAppAt(`/emails?userId=${USER_ID_2}&tenantId=${TENANT_ID}`)
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Tenant: Acme Corp' })
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Remove filter: User: Unknown user' })
    ).toBeInTheDocument()
    expect(screen.getByText('No emails match these filters.')).toBeInTheDocument()
  })

  it('says there is no mail yet when nothing is filtered', async () => {
    renderAppAt('/emails')
    expect(await screen.findByText('No emails yet.')).toBeInTheDocument()
  })

  it('offers the first page when a linked page has emptied', async () => {
    server.use(
      http.get('/api/v1/platform/emails', ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'gone'
          ? ok({ messages: [], nextCursor: null, prevCursor: null }, 'Emails retrieved.')
          : ok({ messages: PAGE_ONE, nextCursor: null, prevCursor: null }, 'Emails retrieved.')
      )
    )
    const user = userEvent.setup()
    const router = renderAppAt('/emails?status=delivered&cursor=gone&dir=next')
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'First page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'delivered' }))
    expect(await screen.findByText('cleo@example.com')).toBeInTheDocument()
  })

  it('shows the role-denied state on a 404, without signing out', async () => {
    server.use(http.get('/api/v1/platform/emails', () => fail('Not found', 404)))
    renderAppAt('/emails')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
  })

  it('offers a retry when the list fails to load', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/emails', () => {
        calls += 1
        return calls <= 2
          ? fail('Something went wrong.', 500)
          : ok({ messages: PAGE_ONE, nextCursor: null, prevCursor: null }, 'Emails retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/emails')
    expect(await screen.findByText('We could not load the emails.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('cleo@example.com')).toBeInTheDocument()
  })

  it('is titled and has its crumb', async () => {
    pages([])
    renderAppAt('/emails')
    await screen.findByText('cleo@example.com')
    await waitFor(() => expect(document.title).toBe('Emails · Apex'))
    const trail = screen.getByRole('navigation', { name: 'breadcrumb' })
    expect(within(trail).getByText('Emails')).toBeInTheDocument()
  })
})
