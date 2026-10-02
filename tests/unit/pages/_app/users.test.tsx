import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Pii } from '@/components/shared/pii'
import { navItemsFor } from '@/constants/navigation'
import { USER_ID_2, USER_ID_3 } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformUserRow } from '@/types/api.types'

function row(index: number, overrides: Partial<PlatformUserRow> = {}): PlatformUserRow {
  return {
    id: `20000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
    email: `user${String(index).padStart(2, '0')}@example.com`,
    firstName: `First${index}`,
    lastName: 'Last',
    active: true,
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    lastLoggedInAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    platformRole: null,
    membershipCount: index,
    ...overrides,
  }
}

const PAGE_ONE = [
  row(1, { active: false }),
  row(2, { emailVerifiedAt: null, lastLoggedInAt: null }),
  row(3, { platformRole: 'admin' }),
]

/** Page one, then page two after `next`, answering `prev` from page two with page one. Records every query. */
function pages(seen: URLSearchParams[]) {
  server.use(
    http.get('/api/v1/platform/users', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      if (params.get('cursor') === 'c2') {
        return ok({ users: [row(21)], nextCursor: null, prevCursor: 'p1' }, 'Users retrieved.')
      }
      return ok({ users: PAGE_ONE, nextCursor: 'c2', prevCursor: null }, 'Users retrieved.')
    })
  )
}

describe('/users', () => {
  it('is in the Directory nav for every staff role, after Tenants', () => {
    const directory = navItemsFor('viewer').filter((item) => item.group === 'Directory')
    expect(directory.map((item) => item.label).slice(0, 2)).toEqual(['Tenants', 'Users'])
  })

  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('lists users with status, verified and staff columns', async () => {
    pages([])
    renderAppAt('/users')
    const table = await screen.findByRole('table', { name: 'Users' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(4)
    expect(within(rows[1]!).getByText('Inactive')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Unverified')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Never')).toBeInTheDocument()
    expect(within(rows[3]!).getByText('Admin')).toBeInTheDocument()
    expect(within(rows[1]!).getByRole('link', { name: 'user01@example.com' })).toHaveAttribute(
      'href',
      `/users/${PAGE_ONE[0]!.id}`
    )
  })

  it('pages with the API cursors, carrying them in the URL', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/users')
    await screen.findByText('user01@example.com')
    // First page: the API sent no prevCursor.
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('user21@example.com')).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ cursor: 'c2', dir: 'next' })
    expect(seen.at(-1)?.get('direction')).toBe('next')
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'p1', dir: 'prev' }))
    expect(seen.at(-1)?.get('cursor')).toBe('p1')
    expect(seen.at(-1)?.get('direction')).toBe('prev')
  })

  it('drops the cursor when a filter changes', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/users?cursor=c2&dir=next')
    await screen.findByText('user21@example.com')

    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }))
    await user.click(await screen.findByRole('option', { name: 'Active' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'active' }))
    await waitFor(() => expect(seen.at(-1)?.get('status')).toBe('active'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('debounces the search into ?q and starts from the first page', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    const user = userEvent.setup()
    const router = renderAppAt('/users?cursor=c2&dir=next')
    await screen.findByText('user21@example.com')

    await user.type(screen.getByRole('searchbox', { name: 'Search users' }), 'ada')

    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'ada' }))
    await waitFor(() => expect(seen.at(-1)?.get('q')).toBe('ada'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
  })

  it('keeps a numeric search, which the router hands over as a number', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    renderAppAt('/users?q=2026')
    await screen.findByText('user01@example.com')
    expect(screen.getByRole('searchbox', { name: 'Search users' })).toHaveValue('2026')
    expect(seen.at(-1)?.get('q')).toBe('2026')
  })

  it('reaches deleted accounts through ?status=deleted and badges them', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/platform/users', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(
          {
            users: [row(7, { deletedAt: '2026-09-20T00:00:00.000Z', active: false })],
            nextCursor: null,
            prevCursor: null,
          },
          'Users retrieved.'
        )
      })
    )
    renderAppAt('/users?status=deleted')
    const table = await screen.findByRole('table', { name: 'Users' })
    expect(within(table).getByText('Deleted')).toBeInTheDocument()
    expect(within(table).queryByText('Inactive')).not.toBeInTheDocument()
    expect(seen.at(-1)?.get('status')).toBe('deleted')
  })

  it('reads boolean filters from the URL and sends them', async () => {
    const seen: URLSearchParams[] = []
    pages(seen)
    renderAppAt('/users?verified=false&staff=true')
    await screen.findByText('user01@example.com')
    expect(seen.at(-1)?.get('verified')).toBe('false')
    expect(seen.at(-1)?.get('staff')).toBe('true')
  })

  it('says so when nothing matches', async () => {
    server.use(
      http.get('/api/v1/platform/users', () =>
        ok({ users: [], nextCursor: null, prevCursor: null }, 'Users retrieved.')
      )
    )
    renderAppAt('/users?q=zzz')
    expect(await screen.findByText('No users match these filters.')).toBeInTheDocument()
  })

  it('offers the first page when a linked page has emptied, rather than claiming no users', async () => {
    server.use(
      http.get('/api/v1/platform/users', ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'gone'
          ? ok({ users: [], nextCursor: null, prevCursor: null }, 'Users retrieved.')
          : ok({ users: PAGE_ONE, nextCursor: 'c2', prevCursor: null }, 'Users retrieved.')
      )
    )
    const user = userEvent.setup()
    const router = renderAppAt('/users?status=active&cursor=gone&dir=next')
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument()
    expect(screen.queryByText('No users yet.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'First page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'active' }))
    expect(await screen.findByText('user01@example.com')).toBeInTheDocument()
  })

  it('shows the role-denied state on a 404, without signing out', async () => {
    server.use(http.get('/api/v1/platform/users', () => fail('Not found', 404)))
    renderAppAt('/users')
    expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
  })

  it('hides New user below admin', async () => {
    pages([])
    renderAppAt('/users')
    await screen.findByText('user01@example.com')
    expect(screen.queryByRole('button', { name: 'New user' })).not.toBeInTheDocument()
  })

  describe('as an admin', () => {
    beforeEach(() => {
      signIn({ ...testUser, platformRole: 'admin' })
    })

    it('creates a user, toasts, and opens their page', async () => {
      pages([])
      let body: unknown
      server.use(
        http.post('/api/v1/platform/users', async ({ request }) => {
          body = await request.json()
          return ok(
            { user: row(9, { id: USER_ID_2, email: 'new@example.com' }), emailSent: true },
            'User created.',
            201
          )
        }),
        http.get(`/api/v1/platform/users/${USER_ID_2}`, () => fail('Not found', 404))
      )
      const success = vi.spyOn(toast, 'success')
      const user = userEvent.setup()
      const router = renderAppAt('/users')
      await user.click(await screen.findByRole('button', { name: 'New user' }))
      const dialog = await screen.findByRole('dialog', { name: 'New user' })
      await user.type(within(dialog).getByLabelText('Email'), '  New@Example.com ')
      await user.type(within(dialog).getByLabelText('First name'), 'Nia')
      await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

      await waitFor(() => expect(router.state.location.pathname).toBe(`/users/${USER_ID_2}`))
      expect(body).toEqual({ email: 'new@example.com', firstName: 'Nia' })
      expect(success).toHaveBeenCalledWith(
        <Pii>{'Set-password email sent to new@example.com.'}</Pii>
      )
    })

    it('warns when the email did not go, and its Resend posts password-setup', async () => {
      pages([])
      let resent = false
      server.use(
        http.post('/api/v1/platform/users', () =>
          ok({ user: row(9, { id: USER_ID_3 }), emailSent: false }, 'User created.', 201)
        ),
        http.post(`/api/v1/platform/users/${USER_ID_3}/password-setup`, () => {
          resent = true
          return ok({ emailSent: true }, 'Email sent.')
        }),
        http.get(`/api/v1/platform/users/${USER_ID_3}`, () => fail('Not found', 404))
      )
      const warning = vi.spyOn(toast, 'warning')
      const success = vi.spyOn(toast, 'success')
      const user = userEvent.setup()
      renderAppAt('/users')
      await user.click(await screen.findByRole('button', { name: 'New user' }))
      const dialog = await screen.findByRole('dialog', { name: 'New user' })
      await user.type(within(dialog).getByLabelText('Email'), 'x@example.com')
      await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

      await waitFor(() => expect(warning).toHaveBeenCalled())
      const [message, options] = warning.mock.calls[0]!
      expect(message).toBe('The user was created, but the set-password email could not be sent.')
      ;(options as unknown as { action: { onClick: () => void } }).action.onClick()
      await waitFor(() => expect(resent).toBe(true))
      await waitFor(() => expect(success).toHaveBeenCalledWith('Set-password email sent.'))
    })

    it('starts blank after the dialog is closed without creating anyone', async () => {
      pages([])
      server.use(
        http.post('/api/v1/platform/users', () =>
          fail('An account already uses that email address', 409)
        )
      )
      const user = userEvent.setup()
      renderAppAt('/users')
      await user.click(await screen.findByRole('button', { name: 'New user' }))
      const dialog = await screen.findByRole('dialog', { name: 'New user' })
      await user.type(within(dialog).getByLabelText('Email'), 'taken@example.com')
      await user.type(within(dialog).getByLabelText('First name'), 'Tia')
      await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
      await within(dialog).findByText('An account already uses that email address')

      await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'New user' })).not.toBeInTheDocument()
      )
      await user.click(screen.getByRole('button', { name: 'New user' }))
      const reopened = await screen.findByRole('dialog', { name: 'New user' })
      expect(within(reopened).getByLabelText('Email')).toHaveValue('')
      expect(within(reopened).getByLabelText('First name')).toHaveValue('')
      expect(
        within(reopened).queryByText('An account already uses that email address')
      ).not.toBeInTheDocument()
    })

    it('keeps the dialog open with the server’s 409 in it', async () => {
      pages([])
      server.use(
        http.post('/api/v1/platform/users', () =>
          fail('An account already uses that email address', 409)
        )
      )
      const user = userEvent.setup()
      renderAppAt('/users')
      await user.click(await screen.findByRole('button', { name: 'New user' }))
      const dialog = await screen.findByRole('dialog', { name: 'New user' })
      await user.type(within(dialog).getByLabelText('Email'), 'taken@example.com')
      await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

      expect(
        await within(dialog).findByText('An account already uses that email address')
      ).toBeInTheDocument()
    })
  })
})
