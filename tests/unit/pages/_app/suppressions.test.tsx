import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { navItemsFor } from '@/constants/navigation'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/states/auth.store'
import { byContent, expectMaskedToast } from '@/tests/fixtures/content'
import { EMAIL_ID, STAFF_USER_ID, SUPPRESSION_ID, SUPPRESSION_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { emailSuppression, fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { EmailSuppression } from '@/types/api.types'

const ACTIVE = emailSuppression({
  id: SUPPRESSION_ID,
  address: 'bounced@example.com',
  reason: 'hard_bounce',
  sourceMessageId: EMAIL_ID,
  liftedAt: null,
  liftedBy: null,
  liftReason: null,
})

const LIFTED = emailSuppression({
  id: SUPPRESSION_ID_2,
  address: 'complained@example.com',
  reason: 'complaint',
  sourceMessageId: null,
  liftedAt: '2026-09-29T09:00:00.000Z',
  liftedBy: { id: STAFF_USER_ID, name: 'Sam Staff' },
  liftReason: 'The customer asked to be mailed again',
})

/** Answers every list request with `rows` (or the cursor page), recording each query. */
function serve(
  seen: URLSearchParams[],
  rows: EmailSuppression[] = [ACTIVE, LIFTED],
  nextCursor: string | null = null
) {
  server.use(
    http.get('/api/v1/platform/email-suppressions', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      if (params.get('cursor') === 'c2') {
        return ok(listPage([], { prevCursor: 'p1', hasPrev: true }), 'ok')
      }
      return ok(
        listPage(
          rows,
          { nextCursor, hasNext: nextCursor !== null },
          { count: rows.length, capped: false }
        ),
        'Suppressions retrieved.'
      )
    })
  )
}

describe('/suppressions', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  afterEach(() => {
    window.innerWidth = 1024
  })

  it('lists active suppressions by default, with the reason, source email and lift details', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    renderAppAt('/suppressions')
    const table = await screen.findByRole('table', { name: 'Suppressions' })
    expect(seen.at(-1)?.get('state')).toBeNull()

    const [active, lifted] = within(table).getAllByRole('row').slice(1)
    expect(within(active!).getByText('bounced@example.com')).toBeInTheDocument()
    expect(within(active!).getByText('Hard bounce')).toBeInTheDocument()
    expect(within(active!).getByText('Active')).toBeInTheDocument()
    expect(
      within(active!).getByRole('link', {
        name: 'View the email that suppressed bounced@example.com',
      })
    ).toHaveAttribute('href', `/emails/${EMAIL_ID}`)

    expect(within(lifted!).getByText('Spam complaint')).toBeInTheDocument()
    expect(within(lifted!).getByText(byContent(/^Lifted .+ by Sam Staff$/))).toBeInTheDocument()
    expect(within(lifted!).getByText('The customer asked to be mailed again')).toBeInTheDocument()
    expect(within(lifted!).queryByRole('link')).not.toBeInTheDocument()
    expect(within(lifted!).queryByRole('button', { name: /Lift/ })).not.toBeInTheDocument()
  })

  it('sorts newest first by default, by address and by oldest first from the headers', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/suppressions')
    const table = await screen.findByRole('table', { name: 'Suppressions' })
    expect(within(table).getByRole('columnheader', { name: 'Suppressed' })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
    expect(seen.at(-1)?.get('sort')).toBeNull()

    await user.click(within(table).getByRole('button', { name: 'Address' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: 'address' }))
    await waitFor(() => expect(seen.at(-1)?.get('sort')).toBe('address'))
    expect(within(table).getByRole('columnheader', { name: 'Address' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
  })

  it('keeps the state filter in the URL, and leaves the default out of it', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/suppressions?cursor=c1')
    await screen.findByRole('table', { name: 'Suppressions' })

    await user.click(screen.getByRole('button', { name: 'Filter by state, Suppressions' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by state, Suppressions' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Lifted' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'lifted' }))
    await waitFor(() => expect(seen.at(-1)?.get('state')).toBe('lifted'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()

    await user.click(within(popup).getByRole('checkbox', { name: 'Lifted' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    await waitFor(() => expect(seen.at(-1)?.get('state')).toBeNull())
  })

  it('asks for both states as a comma list', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/suppressions')
    await screen.findByRole('table', { name: 'Suppressions' })

    await user.click(screen.getByRole('button', { name: 'Filter by state, Suppressions' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by state, Suppressions' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Lifted' }))
    await user.click(within(popup).getByRole('checkbox', { name: 'Active' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'active,lifted' }))
    await waitFor(() => expect(seen.at(-1)?.get('state')).toBe('active,lifted'))
  })

  it('drops a state it does not offer', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const router = renderAppAt('/suppressions?state=expired,all')
    await screen.findByRole('table', { name: 'Suppressions' })
    expect(seen.at(-1)?.get('state')).toBeNull()
    expect(router.state.location.search).toEqual({})
  })

  it('debounces the address search into ?search and starts from the first page', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/suppressions?state=active,lifted&cursor=c1')
    await screen.findByRole('table', { name: 'Suppressions' })

    const box = screen.getByRole('searchbox', { name: 'Search suppressions' })
    expect(box).toHaveAttribute('placeholder', 'Search by address')
    await user.type(box, 'bounced')

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ search: 'bounced', state: 'active,lifted' })
    )
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('bounced'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('pages with the API cursor, both ways', async () => {
    const seen: URLSearchParams[] = []
    serve(seen, [ACTIVE], 'c3')
    const user = userEvent.setup()
    const router = renderAppAt('/suppressions')
    await screen.findByRole('table', { name: 'Suppressions' })
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c3' }))
    await waitFor(() => expect(seen.at(-1)?.get('cursor')).toBe('c3'))
    expect(seen.at(-1)?.get('direction')).toBeNull()
  })

  it('says a stale page is empty and offers the first page', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/suppressions?cursor=c2')
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'First page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(await screen.findByRole('table', { name: 'Suppressions' })).toBeInTheDocument()
  })

  it('says no address is suppressed when the first page is empty and nothing is filtered', async () => {
    serve([], [])
    renderAppAt('/suppressions')
    expect(await screen.findByText('No suppressed addresses.')).toBeInTheDocument()
    expect(
      screen.getByText('An address is suppressed after a hard bounce or a spam complaint.')
    ).toBeInTheDocument()
  })

  it.each(['/suppressions?search=nobody', '/suppressions?state=lifted'])(
    '%s with nothing in it says nothing matches',
    async (path) => {
      serve([], [])
      renderAppAt(path)
      expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    }
  )

  it('lifts a suppression with a reason, toasts and refetches the list', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const bodies: unknown[] = []
    server.use(
      http.post(
        `/api/v1/platform/email-suppressions/${SUPPRESSION_ID}/lift`,
        async ({ request }) => {
          bodies.push(await request.json())
          return ok({ ...ACTIVE, liftedAt: '2026-09-30T00:00:00.000Z' }, 'Suppression lifted.')
        }
      )
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt('/suppressions')
    await screen.findByRole('table', { name: 'Suppressions' })
    const before = seen.length

    await user.click(
      screen.getByRole('button', { name: 'Lift suppression for bounced@example.com' })
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Lift this suppression?' })
    expect(dialog).toHaveTextContent('Emails to bounced@example.com are sent again.')
    await user.type(within(dialog).getByLabelText('Reason'), 'Mailbox fixed by the customer')
    await user.click(within(dialog).getByRole('button', { name: 'Lift suppression' }))

    await waitFor(() => expect(bodies).toEqual([{ reason: 'Mailbox fixed by the customer' }]))
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    expectMaskedToast(
      success.mock.calls[0]![0],
      'Suppression lifted for bounced@example.com.',
      'bounced@example.com'
    )
    await waitFor(() => expect(seen.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('moves focus to the page heading once the lifted row leaves the active list', async () => {
    let lifted = false
    server.use(
      http.get('/api/v1/platform/email-suppressions', () =>
        ok(listPage(lifted ? [] : [ACTIVE]), 'Suppressions retrieved.')
      ),
      http.post(`/api/v1/platform/email-suppressions/${SUPPRESSION_ID}/lift`, () => {
        lifted = true
        return ok({ ...ACTIVE, liftedAt: '2026-09-30T00:00:00.000Z' }, 'Suppression lifted.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/suppressions')
    await user.click(
      await screen.findByRole('button', { name: 'Lift suppression for bounced@example.com' })
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Lift this suppression?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Mailbox fixed')
    await user.click(within(dialog).getByRole('button', { name: 'Lift suppression' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Lift suppression for/ })).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Suppressions', level: 1 })).toHaveFocus()
    )
  })

  it('returns focus to Lift when the lift fails', async () => {
    serve([])
    server.use(
      http.post(`/api/v1/platform/email-suppressions/${SUPPRESSION_ID}/lift`, () =>
        fail('Server error', 500, 'internal_error')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/suppressions')
    const button = await screen.findByRole('button', {
      name: 'Lift suppression for bounced@example.com',
    })
    await user.click(button)
    const dialog = await screen.findByRole('alertdialog', { name: 'Lift this suppression?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Mailbox fixed')
    await user.click(within(dialog).getByRole('button', { name: 'Lift suppression' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('moves focus to the lifted row when it stays in the list without its button', async () => {
    let lifted = false
    server.use(
      http.get('/api/v1/platform/email-suppressions', () =>
        ok(
          listPage([lifted ? { ...ACTIVE, liftedAt: '2026-09-30T00:00:00.000Z' } : ACTIVE]),
          'Suppressions retrieved.'
        )
      ),
      http.post(`/api/v1/platform/email-suppressions/${SUPPRESSION_ID}/lift`, () => {
        lifted = true
        return ok({ ...ACTIVE, liftedAt: '2026-09-30T00:00:00.000Z' }, 'Suppression lifted.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/suppressions?state=active,lifted')
    await user.click(
      await screen.findByRole('button', { name: 'Lift suppression for bounced@example.com' })
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Lift this suppression?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Mailbox fixed')
    await user.click(within(dialog).getByRole('button', { name: 'Lift suppression' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Lift suppression for/ })).not.toBeInTheDocument()
    )
    const row = within(screen.getByRole('table', { name: 'Suppressions' }))
      .getAllByRole('row')
      .at(1)
    await waitFor(() => expect(row).toHaveFocus())
  })

  it('moves focus to the lifted row’s card on a phone', async () => {
    window.innerWidth = 390
    let lifted = false
    server.use(
      http.get('/api/v1/platform/email-suppressions', () =>
        ok(
          listPage([lifted ? { ...ACTIVE, liftedAt: '2026-09-30T00:00:00.000Z' } : ACTIVE]),
          'Suppressions retrieved.'
        )
      ),
      http.post(`/api/v1/platform/email-suppressions/${SUPPRESSION_ID}/lift`, () => {
        lifted = true
        return ok({ ...ACTIVE, liftedAt: '2026-09-30T00:00:00.000Z' }, 'Suppression lifted.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/suppressions?state=active,lifted')
    await user.click(
      await screen.findByRole('button', { name: 'Lift suppression for bounced@example.com' })
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Lift this suppression?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Mailbox fixed')
    await user.click(within(dialog).getByRole('button', { name: 'Lift suppression' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Lift suppression for/ })).not.toBeInTheDocument()
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const card = within(screen.getByRole('list', { name: 'Suppressions' })).getAllByRole(
      'listitem'
    )[0]!
    await waitFor(() => expect(card).toHaveFocus())
  })

  it('shows the server’s own sentence in the dialog when the suppression was already lifted', async () => {
    serve([])
    server.use(
      http.post(`/api/v1/platform/email-suppressions/${SUPPRESSION_ID}/lift`, () =>
        fail('This suppression was already lifted.', 409, 'already_lifted')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/suppressions')
    await user.click(
      await screen.findByRole('button', { name: 'Lift suppression for bounced@example.com' })
    )
    const dialog = await screen.findByRole('alertdialog', { name: 'Lift this suppression?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Lift suppression' }))
    expect(
      await within(dialog).findByText('This suppression was already lifted.')
    ).toBeInTheDocument()
  })

  it('offers a viewer no Lift at all', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    serve([])
    renderAppAt('/suppressions')
    const table = await screen.findByRole('table', { name: 'Suppressions' })
    expect(within(table).queryByRole('button', { name: /^Lift/ })).not.toBeInTheDocument()
    expect(within(table).queryByText('Actions')).not.toBeInTheDocument()
  })

  it('shows a retryable error, then the list', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/email-suppressions', () => {
        calls += 1
        return calls <= 2 ? fail('Boom', 500) : ok(listPage([ACTIVE]), 'ok')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/suppressions')
    expect(await screen.findByText('We could not load the suppressions.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Suppressions' })).toBeInTheDocument()
  })

  it('says the role cannot see this, and does not sign out, on a 404', async () => {
    server.use(http.get('/api/v1/platform/email-suppressions', () => fail('Not found', 404)))
    renderAppAt('/suppressions')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('is in the Operations nav for every staff role, after Deliverability', () => {
    const operations = navItemsFor('viewer').filter((item) => item.group === 'Operations')
    expect(operations.map((item) => item.label).slice(0, 3)).toEqual([
      'Emails',
      'Deliverability',
      'Suppressions',
    ])
  })
})
