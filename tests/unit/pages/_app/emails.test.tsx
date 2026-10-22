import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { navItemsFor } from '@/constants/navigation'
import { EMAIL_ID, EMAIL_ID_2, EMAIL_ID_3, TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
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

/** Answers page one, then page two after `next`; `prev` from page two answers page one. Records every query. */
function pages(seen: URLSearchParams[]) {
  server.use(
    http.get('/api/v1/platform/emails', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      if (params.get('cursor') === 'c2') {
        return ok(
          listPage([emailSummary({ id: EMAIL_ID_3, recipient: 'late@example.com' })], {
            prevCursor: 'p1',
            hasPrev: true,
          }),
          'Emails retrieved.'
        )
      }
      return ok(
        listPage(PAGE_ONE, { nextCursor: 'c2', hasNext: true }, { count: 2, capped: false }),
        'Emails retrieved.'
      )
    })
  )
}

describe('/emails', () => {
  it('is the first Operations item, for every staff role', () => {
    const operations = navItemsFor('viewer').filter((item) => item.group === 'Operations')
    expect(operations.map((item) => [item.label, item.to])[0]).toEqual(['Emails', '/emails'])
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

  it('labels the platform tenant Staff team and links it to Staff', async () => {
    server.use(
      http.get('/api/v1/platform/emails', () =>
        ok(
          listPage([
            emailSummary({ tenant: { id: TENANT_ID, name: 'Platform', slug: 'platform' } }),
          ]),
          'Emails retrieved.'
        )
      )
    )
    renderAppAt('/emails')
    expect(await screen.findByRole('link', { name: 'Staff team' })).toHaveAttribute(
      'href',
      '/settings/platform/staff'
    )
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

  it('sorts newest first by default, and by oldest first from the Created header', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/emails')
    const table = await screen.findByRole('table', { name: 'Emails' })
    expect(within(table).getByRole('columnheader', { name: 'Created' })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
    expect(seen.at(-1)?.get('sort')).toBeNull()

    await user.click(within(table).getByRole('button', { name: 'Created' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: 'created' }))
    await waitFor(() => expect(seen.at(-1)?.get('sort')).toBe('created'))
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
    expect(router.state.location.search).toEqual({ cursor: 'c2' })
    expect(seen.at(-1)?.get('cursor')).toBe('c2')

    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ cursor: 'p1', direction: 'prev' })
    )
    expect(seen.at(-1)?.get('direction')).toBe('prev')
  })

  it('filters by status, dropping the cursor', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/emails?cursor=c2')
    await screen.findByText('late@example.com')

    await user.click(screen.getByRole('button', { name: 'Filter by status, Emails' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Emails' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Suppressed' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'suppressed' }))
    await waitFor(() => expect(seen.at(-1)?.get('status')).toBe('suppressed'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('filters by two templates through one comma list', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/emails')
    await screen.findByText('cleo@example.com')

    await user.click(screen.getByRole('button', { name: 'Filter by template, Emails' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by template, Emails' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Password changed' }))
    await user.click(within(popup).getByRole('checkbox', { name: 'Account setup' }))

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ template: 'account_setup,password_changed' })
    )
    await waitFor(() => expect(seen.at(-1)?.get('template')).toBe('account_setup,password_changed'))
  })

  it('debounces the recipient search into ?search and starts from the first page', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/emails?cursor=c2')
    await screen.findByText('late@example.com')

    const box = screen.getByRole('searchbox', { name: 'Search emails' })
    expect(box).toHaveAttribute('placeholder', 'Search by recipient')
    await user.type(box, 'cleo@')

    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'cleo@' }))
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('cleo@'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('keeps a numeric search, which the router hands over as a number', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    renderAppAt('/emails?search=2026')
    await screen.findByText('cleo@example.com')
    expect(screen.getByRole('searchbox', { name: 'Search emails' })).toHaveValue('2026')
    expect(seen.at(-1)?.get('search')).toBe('2026')
  })

  it('drops malformed filters rather than sending them', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const router = renderAppAt(
      '/emails?status=lost&template=welcome_v2&user=not-a-uuid&from=2026-13-40&to=yesterday'
    )
    await screen.findByText('cleo@example.com')
    expect(router.state.location.search).toEqual({})
    expect(Object.fromEntries(seen.at(-1)!)).toEqual({ total: '1' })
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

  it('drops an inverted date range, which the API refuses, and asks for the list without it', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    renderAppAt('/emails?from=2026-09-30&to=2026-09-01&status=delivered')
    await screen.findByText('cleo@example.com')
    expect(
      screen.getByRole('button', { name: 'Filter by date. Current: Any date' })
    ).toBeInTheDocument()
    expect(seen.every((params) => params.get('from') === null && params.get('to') === null)).toBe(
      true
    )
    expect(seen.at(-1)?.get('status')).toBe('delivered')
  })

  it('keeps a one-day range, whose bounds are equal', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    renderAppAt('/emails?from=2026-09-10&to=2026-09-10')
    await screen.findByText('cleo@example.com')
    expect(seen.at(-1)?.get('from')).toBe('2026-09-10')
    expect(seen.at(-1)?.get('to')).toBe('2026-09-10')
  })

  it('picks days on the calendar: one day, then a range, then clears them', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/emails?from=2026-09-10&to=2026-09-10&cursor=c2')
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

  it('shows ?user and ?tenant as chips named from the listed rows, and removes them', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt(`/emails?user=${USER_ID_2}&tenant=${TENANT_ID}&status=delivered`)
    await screen.findByText('cleo@example.com')
    expect(seen.at(-1)?.get('user')).toBe(USER_ID_2)
    expect(seen.at(-1)?.get('tenant')).toBe(TENANT_ID)
    // The chips have no button of their own: the URL sets them from a link on the user's or tenant's page.
    expect(screen.queryByRole('button', { name: /^Filter by user/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Filter by tenant/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove filter: User: Cleo Doe' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ tenant: TENANT_ID, status: 'delivered' })
    )
    await user.click(screen.getByRole('button', { name: 'Remove filter: Tenant: Acme Corp' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'delivered' }))
    await waitFor(() => expect(seen.at(-1)?.get('tenant')).toBeNull())
  })

  it('names a ?tenant chip for the platform tenant Staff team, from the listed rows', async () => {
    server.use(
      http.get('/api/v1/platform/emails', () =>
        ok(
          listPage([
            emailSummary({ tenant: { id: TENANT_ID, name: 'Platform', slug: 'platform' } }),
          ]),
          'Emails retrieved.'
        )
      )
    )
    renderAppAt(`/emails?tenant=${TENANT_ID}`)
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Tenant: Staff team' })
    ).toBeVisible()
  })

  it('masks the user chip’s name for session replay, and not the tenant’s', async () => {
    pages([])
    renderAppAt(`/emails?user=${USER_ID_2}&tenant=${TENANT_ID}`)
    await screen.findByText('cleo@example.com')
    const userChip = screen.getByRole('button', { name: 'Remove filter: User: Cleo Doe' })
    expect(within(userChip.parentElement!).getByText('Cleo Doe')).toHaveClass('ph-mask')
    const tenantChip = screen.getByRole('button', { name: 'Remove filter: Tenant: Acme Corp' })
    expect(tenantChip.parentElement!.querySelector('.ph-mask')).toBeNull()
  })

  it('masks each recipient and user name in the rows', async () => {
    pages([])
    renderAppAt('/emails')
    const table = await screen.findByRole('table', { name: 'Emails' })
    const [, first] = within(table).getAllByRole('row')
    expect(within(first!).getByText('cleo@example.com')).toHaveClass('ph-mask')
    expect(within(first!).getByText('Cleo Doe')).toHaveClass('ph-mask')
  })

  it('names a chip from the record when no row does, and says so when it is gone', async () => {
    server.use(
      http.get('/api/v1/platform/emails', () => ok(listPage([]), 'Emails retrieved.')),
      http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404)),
      http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
        ok({ id: TENANT_ID, name: 'Acme Corp' }, 'Tenant retrieved.')
      )
    )
    renderAppAt(`/emails?user=${USER_ID_2}&tenant=${TENANT_ID}`)
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Tenant: Acme Corp' })
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Remove filter: User: Unknown user' })
    ).toBeInTheDocument()
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
  })

  it('says there is no mail yet when nothing is filtered', async () => {
    renderAppAt('/emails')
    expect(await screen.findByText('No emails yet.')).toBeInTheDocument()
  })

  it('offers the first page when a linked page has emptied', async () => {
    server.use(
      http.get('/api/v1/platform/emails', ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'gone'
          ? ok(listPage([]), 'Emails retrieved.')
          : ok(listPage(PAGE_ONE), 'Emails retrieved.')
      )
    )
    const user = userEvent.setup()
    const router = renderAppAt('/emails?status=delivered&cursor=gone')
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
          : ok(listPage(PAGE_ONE), 'Emails retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/emails')
    expect(
      await screen.findByText('We couldn’t load the emails. Select Try again.')
    ).toBeInTheDocument()
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
