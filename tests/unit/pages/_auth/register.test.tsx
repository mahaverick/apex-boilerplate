import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAppAt, signOut } from '@/tests/fixtures/render-app'
import { fail, ok, TEST_INVITATION_TOKEN, testInvitationPreview } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const PATH = `/register?invitation=${TEST_INVITATION_TOKEN}`
const EMAIL = testInvitationPreview.email.toLowerCase()

async function submit(password = 'secret123') {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('/register (invitation only)', () => {
  beforeEach(() => {
    signOut()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a visitor without an invitation to /login', async () => {
    const router = renderAppAt('/register')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('prefills and locks the invited address', async () => {
    renderAppAt(`/register?invitation=${TEST_INVITATION_TOKEN}`)
    const email = await screen.findByLabelText('Email')
    expect(email).toHaveValue(testInvitationPreview.email)
    expect(email).toHaveAttribute('readonly')
    expect(screen.getByText(new RegExp(testInvitationPreview.tenant.name))).toBeInTheDocument()
  })

  it('says an unusable invitation cannot be used, with no form', async () => {
    server.use(
      http.post('/api/v1/invitations/preview', () =>
        fail('Invalid invitation', 404, 'invitation_invalid')
      )
    )
    renderAppAt(`/register?invitation=${TEST_INVITATION_TOKEN}`)
    expect(
      await screen.findByRole('heading', { name: 'This invitation can’t be used', level: 1 })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('registers and shows the check-your-email card', async () => {
    const user = userEvent.setup()
    renderAppAt(`/register?invitation=${TEST_INVITATION_TOKEN}`)
    await user.type(await screen.findByLabelText('Password'), 'longenough1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText(/Check your email/i)).toBeInTheDocument()
  })

  it('posts the invited address, the password and app: "apex"', async () => {
    let body: unknown
    server.use(
      http.post('/api/v1/auth/register', async ({ request }) => {
        body = await request.json()
        return ok(null, 'Accepted.', 202)
      })
    )
    renderAppAt(PATH)
    await submit()

    expect(await screen.findByText(new RegExp(`verification link to ${EMAIL}`))).toBeInTheDocument()
    // Empty optional names are dropped by the schema, not posted as ''.
    expect(body).toEqual({ email: EMAIL, password: 'secret123', app: 'apex' })
  })

  it("maps the server's 400 field errors onto the form and stays on it", async () => {
    server.use(
      http.post('/api/v1/auth/register', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Validation failed',
            statusCode: 400,
            errors: { password: ['Password is too long.'] },
            requestId: 'test-request-id',
          },
          { status: 400 }
        )
      )
    )
    renderAppAt(PATH)
    await submit()

    expect(await screen.findByText('Password is too long.')).toBeInTheDocument()
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription('Password is too long.')
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument()
  })

  it('announces a rate-limited attempt once, in the form, and stays on it', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/auth/register', () =>
        fail('Too many attempts. Please try again later.', 429, 'RATE_LIMITED')
      )
    )
    renderAppAt(PATH)
    await submit()

    const message = await screen.findByText('Too many attempts. Please try again later.')
    expect(message.closest('form')).not.toBeNull()
    expect(screen.getAllByText('Too many attempts. Please try again later.')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
    })
    expect(screen.getByRole('heading', { name: 'Create an account', level: 1 })).toBeInTheDocument()
  })

  it('resends to the registered address with app: "apex", and tells the invitee to reopen the invitation', async () => {
    let resendBody: unknown
    server.use(
      http.post('/api/v1/auth/resend-verification', async ({ request }) => {
        resendBody = await request.json()
        return ok(null, 'Accepted.', 202)
      })
    )
    renderAppAt(PATH)
    await submit()

    expect(await screen.findByText(/open your invitation link again to join/)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }))

    await waitFor(() => {
      expect(resendBody).toEqual({ email: EMAIL, app: 'apex' })
    })
  })

  it('shows one heading and no form while the invitation loads', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('/api/v1/invitations/preview', async () => {
        await gate
        return ok(testInvitationPreview, 'Invitation retrieved.')
      })
    )
    renderAppAt(PATH)

    expect(
      await screen.findByRole('heading', { name: 'Create an account', level: 1 })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

    release()
    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
  })
})
