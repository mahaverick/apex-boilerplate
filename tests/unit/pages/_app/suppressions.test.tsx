import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { navItemsFor } from '@/constants/navigation'
import { useAuthStore } from '@/states/auth.store'
import { EMAIL_ID, STAFF_USER_ID, SUPPRESSION_ID, SUPPRESSION_ID_2 } from '@/tests/fixtures/ids'
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
        return ok({ suppressions: [], nextCursor: null, prevCursor: 'p1' }, 'ok')
      }
      return ok({ suppressions: rows, nextCursor, prevCursor: null }, 'Suppressions retrieved.')
    })
  )
}

describe('/suppressions', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
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
    expect(within(lifted!).getByText(/^Lifted .+ by Sam Staff$/)).toBeInTheDocument()
    expect(within(lifted!).getByText('The customer asked to be mailed again')).toBeInTheDocument()
    expect(within(lifted!).queryByRole('link')).not.toBeInTheDocument()
    expect(within(lifted!).queryByRole('button', { name: /Lift/ })).not.toBeInTheDocument()
  })

  it('keeps the state filter in the URL, and leaves the default out of it', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/suppressions?cursor=c1&dir=next')
    await screen.findByRole('table', { name: 'Suppressions' })

    await user.click(screen.getByRole('combobox', { name: 'Filter by state' }))
    await user.click(await screen.findByRole('option', { name: 'Lifted' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'lifted' }))
    await waitFor(() => expect(seen.at(-1)?.get('state')).toBe('lifted'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()

    await user.click(screen.getByRole('combobox', { name: 'Filter by state' }))
    await user.click(await screen.findByRole('option', { name: 'Active' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('falls back to active for a state it does not offer', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    renderAppAt('/suppressions?state=expired')
    await screen.findByRole('table', { name: 'Suppressions' })
    expect(seen.at(-1)?.get('state')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Filter by state' })).toHaveTextContent('Active')
  })

  it('debounces the address search into ?q and starts from the first page', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/suppressions?state=all&cursor=c1&dir=next')
    await screen.findByRole('table', { name: 'Suppressions' })

    await user.type(screen.getByRole('searchbox', { name: 'Search suppressions' }), 'bounced')

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ q: 'bounced', state: 'all' })
    )
    await waitFor(() => expect(seen.at(-1)?.get('q')).toBe('bounced'))
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
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c3', dir: 'next' }))
    await waitFor(() => expect(seen.at(-1)?.get('cursor')).toBe('c3'))
    expect(seen.at(-1)?.get('direction')).toBe('next')
  })

  it('says a stale page is empty and offers the first page', async () => {
    const seen: URLSearchParams[] = []
    serve(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/suppressions?cursor=c2&dir=next')
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'First page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(await screen.findByRole('table', { name: 'Suppressions' })).toBeInTheDocument()
  })

  it.each([
    ['/suppressions', 'No suppressed addresses.'],
    ['/suppressions?state=lifted', 'No lifted suppressions.'],
    ['/suppressions?state=all', 'No suppressions yet.'],
    ['/suppressions?q=nobody', 'No suppressions match this search.'],
  ])('%s with nothing in it says %s', async (path, message) => {
    serve([], [])
    renderAppAt(path)
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

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
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith('Suppression lifted for bounced@example.com.')
    )
    await waitFor(() => expect(seen.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
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
    expect(within(table).queryByRole('button')).not.toBeInTheDocument()
    expect(within(table).queryByText('Actions')).not.toBeInTheDocument()
  })

  it('shows a retryable error, then the list', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/email-suppressions', () => {
        calls += 1
        return calls <= 2
          ? fail('Boom', 500)
          : ok({ suppressions: [ACTIVE], nextCursor: null, prevCursor: null }, 'ok')
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
