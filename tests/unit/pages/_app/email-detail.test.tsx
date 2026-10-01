import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/states/auth.store'
import {
  EMAIL_ATTEMPT_ID,
  EMAIL_ATTEMPT_ID_2,
  EMAIL_EVENT_ID,
  EMAIL_ID,
  EMAIL_ID_2,
  EMAIL_ID_3,
  SUPPRESSION_ID,
  TENANT_ID,
  USER_ID_2,
} from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { emailDetail, fail, ok, testEmailPreview, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { REAUTH_REQUIRED, type EmailMessageDetail } from '@/types/api.types'

const PAGE = `/emails/${EMAIL_ID}`

/** Answers the detail with `overrides` and counts the requests. */
function serve(overrides: Partial<EmailMessageDetail> = {}) {
  const calls = { detail: 0, preview: 0 }
  server.use(
    http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () => {
      calls.detail += 1
      return ok(emailDetail(overrides), 'Email retrieved.')
    }),
    http.get(`/api/v1/platform/emails/${EMAIL_ID}/preview`, () => {
      calls.preview += 1
      return ok(testEmailPreview, 'Email preview rendered.')
    })
  )
  return calls
}

async function heading() {
  return screen.findByRole('heading', { name: 'cleo@example.com', level: 1 })
}

describe('/emails/$emailId', () => {
  beforeEach(() => {
    signIn()
  })

  it('heads the page with the recipient, template, status, sender and links', async () => {
    serve()
    renderAppAt(PAGE)
    await heading()
    expect(screen.getByText('Tenant invitation')).toBeInTheDocument()
    expect(screen.getAllByText('Delivered')[0]).toHaveAttribute('data-tone', 'success')
    expect(screen.getByText('Transactional sender')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cleo Doe' })).toHaveAttribute(
      'href',
      `/users/${USER_ID_2}`
    )
    expect(screen.getByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
      'href',
      `/tenants/${TENANT_ID}`
    )
    await waitFor(() => expect(document.title).toBe('Email · Apex'))
    const trail = screen.getByRole('navigation', { name: 'breadcrumb' })
    expect(within(trail).getByRole('link', { name: 'Emails' })).toHaveAttribute('href', '/emails')
    expect(within(trail).getByText('cleo@example.com')).toBeInTheDocument()
  })

  it('shows the timeline by default: queued, each attempt and each provider event, in time order', async () => {
    const calls = serve({
      status: 'bounced',
      attempts: [
        {
          id: EMAIL_ATTEMPT_ID,
          status: 'failed',
          errorCode: 'ECONNECTION',
          createdAt: '2026-09-29T10:00:01.000Z',
        },
        {
          id: EMAIL_ATTEMPT_ID_2,
          status: 'sent',
          errorCode: null,
          createdAt: '2026-09-29T10:01:00.000Z',
        },
      ],
      events: [
        {
          id: EMAIL_EVENT_ID,
          provider: 'resend',
          type: 'bounced',
          bounceKind: 'hard',
          detail: 'MESSAGE_REJECTED',
          occurredAt: '2026-09-29T10:02:00.000Z',
        },
      ],
    })
    renderAppAt(PAGE)
    await heading()
    const timeline = screen.getByRole('list', { name: 'Delivery timeline' })
    expect(
      within(timeline)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('span')?.textContent)
    ).toEqual([
      'Queued',
      'Send attempt failed ECONNECTION',
      'Handed to the mail server',
      'Bounced · hard bounce MESSAGE_REJECTED · Resend',
    ])
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true')
    expect(calls.preview).toBe(0)
  })

  it('links the message it resent and the ones that resent it', async () => {
    serve({ resentFromId: EMAIL_ID_2, resentAsIds: [EMAIL_ID_3] })
    renderAppAt(PAGE)
    await heading()
    expect(screen.getByRole('link', { name: 'an earlier email' })).toHaveAttribute(
      'href',
      `/emails/${EMAIL_ID_2}`
    )
    expect(screen.getByRole('link', { name: 'a new email' })).toHaveAttribute(
      'href',
      `/emails/${EMAIL_ID_3}`
    )
  })

  it('asks for the preview only on the Preview tab, and keeps the tab in the URL', async () => {
    const calls = serve()
    const user = userEvent.setup()
    const router = renderAppAt(PAGE)
    await heading()
    expect(calls.preview).toBe(0)

    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'preview' }))
    expect(await screen.findByTitle('Email preview')).toBeInTheDocument()
    expect(calls.preview).toBe(1)

    await user.click(screen.getByRole('tab', { name: 'Timeline' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(screen.getByRole('list', { name: 'Delivery timeline' })).toBeInTheDocument()
  })

  it('opens on the tab the URL names', async () => {
    serve()
    renderAppAt(`${PAGE}?tab=preview`)
    expect(await screen.findByTitle('Email preview')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  })

  it('falls back to the timeline for a tab it does not have', async () => {
    serve()
    renderAppAt(`${PAGE}?tab=source`)
    await heading()
    expect(screen.getByRole('list', { name: 'Delivery timeline' })).toBeInTheDocument()
  })

  it('renders the preview in a scriptless sandboxed frame, with the subject and the text part', async () => {
    serve()
    renderAppAt(`${PAGE}?tab=preview`)
    const frame = await screen.findByTitle('Email preview')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('sandbox', '')
    expect(frame).toHaveAttribute('srcdoc', testEmailPreview.html)
    expect(frame.className).toMatch(/\bh-160\b/)
    expect(frame.className).toMatch(/\bbg-white\b/)
    expect(screen.getByText(testEmailPreview.subject)).toBeInTheDocument()
    expect(screen.getByText(/Accept: http:\/\/localhost:5173/)).toBeInTheDocument()
    expect(screen.getByText(/Links are masked/)).toBeInTheDocument()
    expect(screen.queryByText(/placeholders stand in/)).not.toBeInTheDocument()
  })

  it('says when placeholders stand in for values that were not stored', async () => {
    serve()
    server.use(
      http.get(`/api/v1/platform/emails/${EMAIL_ID}/preview`, () =>
        ok({ ...testEmailPreview, partial: true }, 'Email preview rendered.')
      )
    )
    renderAppAt(`${PAGE}?tab=preview`)
    expect(await screen.findByText(/placeholders stand in/)).toBeInTheDocument()
  })

  it('says so when the template is gone, rather than offering a retry', async () => {
    serve()
    server.use(
      http.get(`/api/v1/platform/emails/${EMAIL_ID}/preview`, () =>
        fail('This template is no longer available.', 409, 'template_unavailable')
      )
    )
    renderAppAt(`${PAGE}?tab=preview`)
    expect(await screen.findByText(/template is no longer part of the app/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('warns when the address is suppressed', async () => {
    serve({
      status: 'suppressed',
      suppression: {
        id: SUPPRESSION_ID,
        reason: 'complaint',
        createdAt: '2026-09-29T12:00:00.000Z',
      },
    })
    renderAppAt(PAGE)
    await heading()
    expect(screen.getByRole('status')).toHaveTextContent(
      /This address is suppressed \(Spam complaint, since .+\): no email is sent to it/
    )
  })

  it('says why a failed message failed', async () => {
    serve({ status: 'failed', failureOrigin: 'enqueue', attempts: [], events: [] })
    renderAppAt(PAGE)
    await heading()
    expect(screen.getByText('The email could not be queued, so it was never sent.')).toBeVisible()
  })

  it('offers no Resend when the API says this staff member may not', async () => {
    serve({ canResend: false })
    renderAppAt(PAGE)
    await heading()
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument()
  })

  it.each([
    ['email_verification', 'Issues a new verification link.'],
    [
      'account_setup',
      'Issues a new password link — account setup or reset, whichever applies now.',
    ],
    ['tenant_invitation', 'Sends the invitation again.'],
  ])('says what a %s resend will do', async (templateKey, sentence) => {
    serve({ templateKey })
    const user = userEvent.setup()
    renderAppAt(PAGE)
    await heading()
    await user.click(screen.getByRole('button', { name: 'Resend' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Resend this email?' })
    expect(within(dialog).getByText(sentence)).toBeInTheDocument()
  })

  it('resends with the reason, toasts, and refetches the message', async () => {
    const calls = serve()
    let body: unknown
    server.use(
      http.post(`/api/v1/platform/emails/${EMAIL_ID}/resend`, async ({ request }) => {
        body = await request.json()
        return ok({}, 'Resend requested.', 202)
      })
    )
    const user = userEvent.setup()
    renderAppAt(PAGE)
    await heading()
    await user.click(screen.getByRole('button', { name: 'Resend' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Resend this email?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Went to spam')
    await user.click(within(dialog).getByRole('button', { name: 'Resend' }))

    expect(
      await screen.findByText('Resend requested — it appears in the timeline shortly')
    ).toBeInTheDocument()
    expect(body).toEqual({ reason: 'Went to spam' })
    await waitFor(() => expect(calls.detail).toBe(2))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('warns when the action ran but its email did not go', async () => {
    serve()
    server.use(
      http.post(`/api/v1/platform/emails/${EMAIL_ID}/resend`, () =>
        ok({ emailSent: false }, 'Resend requested.', 202)
      )
    )
    const user = userEvent.setup()
    renderAppAt(PAGE)
    await heading()
    await user.click(screen.getByRole('button', { name: 'Resend' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Resend this email?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Went to spam')
    await user.click(within(dialog).getByRole('button', { name: 'Resend' }))
    expect(
      await screen.findByText(
        'The resend was recorded, but its email could not be sent. Try again shortly.'
      )
    ).toBeInTheDocument()
  })

  it.each([
    [
      'a suppressed recipient',
      409,
      'recipient_suppressed',
      'This address is suppressed. Lift the suppression first.',
    ],
    ['an invitation no longer pending', 404, 'invitation_not_found', 'Invitation not found'],
    ['a staff member the actor outranks', 403, undefined, 'You cannot mail this staff member.'],
  ])('shows the API’s own refusal for %s, and stays open', async (_name, status, code, message) => {
    serve()
    server.use(
      http.post(`/api/v1/platform/emails/${EMAIL_ID}/resend`, () => fail(message, status, code))
    )
    const user = userEvent.setup()
    renderAppAt(PAGE)
    await heading()
    await user.click(screen.getByRole('button', { name: 'Resend' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Resend this email?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Went to spam')
    await user.click(within(dialog).getByRole('button', { name: 'Resend' }))
    expect(await within(dialog).findByText(message)).toBeInTheDocument()
  })

  it('confirms a stale sign-in through step-up, then resends once more', async () => {
    serve({ tenant: { id: TENANT_ID, name: 'Platform', slug: 'platform' } })
    const bodies: unknown[] = []
    server.use(
      http.post(`/api/v1/platform/emails/${EMAIL_ID}/resend`, async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
          : ok({}, 'Resend requested.', 202)
      }),
      http.post('/api/v1/auth/reauthenticate', () =>
        ok({ accessToken: 'stepped-up-token' }, 'Reauthenticated.')
      )
    )
    const user = userEvent.setup()
    renderAppAt(PAGE)
    await heading()
    await user.click(screen.getByRole('button', { name: 'Resend' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Resend this email?' })
    await user.type(within(dialog).getByLabelText('Reason'), 'Staff invite lost')
    await user.click(within(dialog).getByRole('button', { name: 'Resend' }))

    const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(stepUp).getByLabelText('Password'), 'hunter22')
    await user.click(within(stepUp).getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByText('Resend requested — it appears in the timeline shortly')
    ).toBeInTheDocument()
    expect(bodies).toEqual([{ reason: 'Staff invite lost' }, { reason: 'Staff invite lost' }])
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      accessToken: 'stepped-up-token',
    })
  })

  it('shows a not-found panel on a 404, without signing out', async () => {
    server.use(http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () => fail('Not found', 404)))
    renderAppAt(PAGE)
    expect(await screen.findByRole('heading', { name: 'Email not found', level: 1 })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to emails' })).toHaveAttribute('href', '/emails')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('offers a retry when the message fails to load', async () => {
    let calls = 0
    server.use(
      http.get(`/api/v1/platform/emails/${EMAIL_ID}`, () => {
        calls += 1
        return calls <= 2
          ? fail('Something went wrong.', 500)
          : ok(emailDetail(), 'Email retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(PAGE)
    expect(await screen.findByText('We could not load this email.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await heading()).toBeVisible()
  })

  it('lets a viewer read the page, with no Resend when the API says so', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    serve({ canResend: false })
    renderAppAt(PAGE)
    await heading()
    expect(screen.getByRole('list', { name: 'Delivery timeline' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument()
  })
})
