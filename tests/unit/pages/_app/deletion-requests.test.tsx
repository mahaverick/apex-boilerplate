import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/lib/toast'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp } from '@/tests/mocks/step-up'
import type { DeletionRequestRow } from '@/types/api.types'

const REQUEST_ID = '95000000-0000-4000-8000-000000000001'
const SECOND_ID = '95000000-0000-4000-8000-000000000002'
const PERSON_ID = '20000000-0000-4000-8000-000000000041'
const FUTURE = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()

/** One open request; `over` changes what a test cares about. */
function request(over: Partial<DeletionRequestRow> = {}): DeletionRequestRow {
  return {
    id: REQUEST_ID,
    requestedAt: '2026-10-01T00:00:00.000Z',
    dueAt: FUTURE,
    reason: 'I no longer use it.',
    user: { id: PERSON_ID, email: 'dana@example.com', firstName: 'Dana', lastName: 'Lee' },
    soleOwnedWorkspaces: [],
    ...over,
  }
}

/** Serves `rows`, recording each query. */
function serve(rows: DeletionRequestRow[], seen: URLSearchParams[] = []) {
  server.use(
    http.get('/api/v1/platform/deletion-requests', ({ request: req }) => {
      seen.push(new URL(req.url).searchParams)
      return ok(listPage(rows), 'Deletion requests retrieved.')
    })
  )
}

/** Opens the delete dialog of the first row and types the email. */
async function openDelete(user: ReturnType<typeof userEvent.setup>) {
  const table = await screen.findByRole('table', { name: 'Deletion requests' })
  await user.click(within(table).getAllByRole('button', { name: 'Delete account' })[0]!)
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete account' })
  await user.type(within(dialog).getByLabelText(/Type .* to confirm/), 'dana@example.com')
  return dialog
}

describe('/deletion-requests', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  it('shows the rows in the order the server sends and asks for no sort', async () => {
    const seen: URLSearchParams[] = []
    serve(
      [
        request({ dueAt: PAST }),
        request({
          id: SECOND_ID,
          user: { id: PERSON_ID, email: 'eli@example.com', firstName: null, lastName: null },
        }),
      ],
      seen
    )
    renderAppAt('/deletion-requests')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Deletion requests' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'People who asked us to delete their account. Delete each account by its due date.'
      )
    ).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Deletion requests' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('dana@example.com')
    expect(rows[1]).toHaveTextContent('eli@example.com')
    expect(within(rows[0]!).getByRole('link', { name: /dana@example\.com/ })).toHaveAttribute(
      'href',
      `/users/${PERSON_ID}`
    )
    // The customer's own words are never rendered.
    expect(screen.queryByText('I no longer use it.')).toBeNull()
    expect(seen.at(-1)?.get('sort')).toBeNull()
    expect(seen.at(-1)?.get('total')).toBe('1')
  })

  it('requests the latest due first from the Due header', async () => {
    const seen: URLSearchParams[] = []
    serve([request()], seen)
    const user = userEvent.setup()
    const router = renderAppAt('/deletion-requests')
    const table = await screen.findByRole('table', { name: 'Deletion requests' })
    await user.click(within(table).getByRole('button', { name: 'Due' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: '-due' }))
    await waitFor(() => expect(seen.at(-1)?.get('sort')).toBe('-due'))
  })

  it('shows Overdue only after the due moment, not at it', async () => {
    const due = new Date('2026-11-10T12:00:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(due)
      serve([request({ dueAt: due.toISOString() })])
      renderAppAt('/deletion-requests')
      await screen.findByRole('table', { name: 'Deletion requests' })
      expect(screen.queryByText('Overdue')).toBeNull()
      cleanup()
    } finally {
      vi.useRealTimers()
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(due.getTime() + 1))
      renderAppAt('/deletion-requests')
      expect(await screen.findAllByText('Overdue')).not.toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks a request past its due date as Overdue', async () => {
    serve([request({ dueAt: PAST }), request({ id: SECOND_ID })])
    renderAppAt('/deletion-requests')
    const table = await screen.findByRole('table', { name: 'Deletion requests' })
    const [late, onTime] = within(table).getAllByRole('row').slice(1)
    expect(within(late!).getByText('Overdue')).toBeInTheDocument()
    expect(within(onTime!).queryByText('Overdue')).toBeNull()
  })

  it('shows the workspaces the person solely owns, or None', async () => {
    serve([
      request({
        soleOwnedWorkspaces: [
          { id: 'w1', name: 'Acme Corp' },
          { id: 'w2', name: 'Beta' },
        ],
      }),
      request({ id: SECOND_ID }),
    ])
    renderAppAt('/deletion-requests')
    const table = await screen.findByRole('table', { name: 'Deletion requests' })
    const [owner, none] = within(table).getAllByRole('row').slice(1)
    expect(owner).toHaveTextContent('Acme Corp, Beta')
    expect(none).toHaveTextContent('None')
  })

  it('says when no one has asked', async () => {
    serve([])
    renderAppAt('/deletion-requests')
    expect(await screen.findByText('No one has asked to delete their account.')).toBeInTheDocument()
  })

  it('deletes through step-up with the request id as the reason, then drops the row', async () => {
    let deleted = false
    const bodies: unknown[] = []
    server.use(
      http.get('/api/v1/platform/deletion-requests', () =>
        ok(listPage(deleted ? [] : [request()]), 'Deletion requests retrieved.')
      ),
      http.delete(`/api/v1/platform/users/${PERSON_ID}`, async ({ request: req }) => {
        bodies.push(await req.json())
        if (bodies.length === 1) return fail('Recent sign-in required', 401, 'REAUTH_REQUIRED')
        deleted = true
        return ok(null, 'User deleted.')
      })
    )
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderAppAt('/deletion-requests')
    const dialog = await openDelete(user)
    expect(within(dialog).queryByLabelText('Reason')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))
    await confirmStepUp(user)
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies).toEqual([{ reason: REQUEST_ID }, { reason: REQUEST_ID }])
    await waitFor(() => expect(success).toHaveBeenCalledWith('Account deleted.'))
    expect(await screen.findByText('No one has asked to delete their account.')).toBeInTheDocument()
    expect(screen.queryByText('dana@example.com')).toBeNull()
  })

  it.each([
    [
      'LAST_OWNER',
      undefined,
      'This user is the last owner of Acme Corp. Make someone else an owner there first.',
    ],
    [
      'REQUESTER_PAYS_SUBSCRIPTION',
      'REQUESTER_PAYS_SUBSCRIPTION',
      'This user pays for Acme Corp. Ask a co-owner there to take over the payment method, or cancel the subscription, then try again.',
    ],
  ] as const)('shows a 409 inline and keeps the row (%s)', async (_name, code, message) => {
    serve([request()])
    server.use(http.delete(`/api/v1/platform/users/${PERSON_ID}`, () => fail(message, 409, code)))
    const user = userEvent.setup()
    renderAppAt('/deletion-requests')
    const dialog = await openDelete(user)
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('alertdialog', { name: 'Delete account' })).toBeInTheDocument()
    expect(screen.getAllByText('dana@example.com').length).toBeGreaterThan(0)
  })

  it('a viewer sees the not-found page and no nav item', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    const seen: URLSearchParams[] = []
    serve([request()], seen)
    renderAppAt('/deletion-requests')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not available' })
    ).toBeInTheDocument()
    // The breadcrumb names the page too; only the sidebar's links are the nav item.
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', {
        name: 'Deletion requests',
      })
    ).toBeNull()
    expect(seen).toHaveLength(0)
  })

  it('shows an admin the nav item', async () => {
    serve([])
    renderAppAt('/overview')
    expect(await screen.findByRole('link', { name: 'Deletion requests' })).toBeInTheDocument()
  })
})
