import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/states/auth.store'
import { AUDIT_ID_5, EMAIL_ID, EMAIL_ID_2, TENANT_ID } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import {
  fail,
  ok,
  onboardingReminder,
  tenantOnboardingAfterStaffCompletion,
  tenantOnboardingDetail,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type {
  PlatformTenantDetail,
  TenantLifecycleState,
  TenantOnboardingDetail,
} from '@/types/api.types'

const ONBOARDING = `/tenants/${TENANT_ID}/onboarding`

function platformDetail(lifecycleState: TenantLifecycleState = 'active'): PlatformTenantDetail {
  return {
    id: TENANT_ID,
    name: 'Acme Corp',
    slug: 'acme',
    description: null,
    website: null,
    logo: null,
    lifecycleState,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: lifecycleState === 'archived' ? '2026-09-01T00:00:00.000Z' : null,
    settings: { timezone: 'UTC', locale: 'en' },
    memberCount: 2,
    owners: [],
    pendingInvitationCount: 0,
    pendingOwnerInvitation: null,
  }
}

/** Acme's platform detail and its onboarding; records every tenant-route request, which this tab must never make. */
function serve(onboarding: Partial<TenantOnboardingDetail> = {}) {
  const internal: string[] = []
  const lifecycleState = onboarding.tenant?.lifecycleState ?? 'active'
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
      ok(platformDetail(lifecycleState), 'Tenant retrieved.')
    ),
    http.get(`/api/v1/platform/tenants/${TENANT_ID}/onboarding`, () =>
      ok(tenantOnboardingDetail(onboarding), 'Tenant onboarding retrieved.')
    ),
    http.get('/api/v1/tenants/acme*', ({ request }) => {
      internal.push(new URL(request.url).pathname)
      return fail('Not found', 404)
    })
  )
  return internal
}

async function steps() {
  return screen.findByRole('list', { name: 'Onboarding steps' })
}

describe('/tenants/$tenantId/onboarding', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('reading', () => {
    it('is the last tab, read from the platform API alone', async () => {
      const internal = serve()
      renderAppAt(ONBOARDING)
      const nav = await screen.findByRole('navigation', { name: 'Tenant sections' })
      expect(within(nav).getByRole('link', { name: 'Onboarding' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await steps()
      expect(internal).toEqual([])
      await waitFor(() => expect(document.title).toBe('Tenant onboarding · Apex'))
    })

    it('shows the state, the progress and every step in order, with how each was done', async () => {
      serve({
        steps: tenantOnboardingAfterStaffCompletion('teammate_joined').steps,
      })
      renderAppAt(ONBOARDING)
      const list = await steps()
      expect(screen.getByText('In progress')).toHaveAttribute('data-tone', 'neutral')
      expect(screen.getByText('1 of 2 required steps done')).toBeInTheDocument()
      const items = [...list.children] as HTMLElement[]
      expect(items.map((item) => item.querySelector('.font-medium')?.textContent)).toEqual([
        'Configure your workspace',
        'Invite a teammate',
        'A teammate joins',
        'Read the getting-started guide',
      ])
      expect(within(items[0]!).getByText(', done')).toBeInTheDocument()
      expect(within(items[0]!).getByText('Required')).toBeInTheDocument()
      expect(within(items[0]!).getByText(/· Detected automatically$/)).toBeInTheDocument()
      expect(within(items[1]!).getByText(', not done')).toBeInTheDocument()
      expect(within(items[2]!).getByText('Optional')).toBeInTheDocument()
      expect(within(items[2]!).getByText(/· by staff: A B — Done on the call$/)).toBeInTheDocument()
      expect(within(items[3]!).getByText('Optional · each person')).toBeInTheDocument()
      expect(within(items[3]!).getByText(/· Ticked by the customer$/)).toBeInTheDocument()
    })

    it('says “a removed user” for a staff completion whose completer was purged', async () => {
      const [first, ...rest] = tenantOnboardingDetail().steps
      serve({
        steps: [
          { ...first!, source: 'staff', completedBy: null, reason: 'Set up on the call' },
          ...rest,
        ],
      })
      renderAppAt(ONBOARDING)
      await steps()
      expect(
        screen.getByText(/· by staff: a removed user — Set up on the call$/)
      ).toBeInTheDocument()
    })

    it('counts a member step’s members and lists each one’s own status when expanded', async () => {
      serve()
      const user = userEvent.setup()
      renderAppAt(ONBOARDING)
      await steps()
      const summary = screen.getByText('1 of 2 members')
      const details = summary.closest('details')!
      expect(details).not.toHaveAttribute('open')
      await user.click(summary)
      expect(details).toHaveAttribute('open')
      const entries = within(details).getAllByRole('listitem')
      expect(entries[0]).toHaveTextContent(/^Cleo Doe\(Owner\)Done /)
      expect(entries[1]).toHaveTextContent('Evan Editor(Editor)Not yet')
    })

    it.each([
      ['not_tracked', 'Not tracked — created before onboarding tracking.'],
      ['awaiting_owner', 'Waiting for the owner to accept their invitation.'],
    ] as const)('explains a %s tenant', async (state, note) => {
      serve({
        state,
        startedAt: null,
        lastProgressAt: null,
        steps: tenantOnboardingDetail().steps.map((step) => ({ ...step, canMarkComplete: false })),
        reminder: {
          ...tenantOnboardingDetail().reminder,
          canSend: false,
          blockedBy: 'not_in_progress',
        },
      })
      renderAppAt(ONBOARDING)
      expect(await screen.findByText(note)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Mark complete: / })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Send reminder' })).not.toBeInTheDocument()
      expect(screen.queryByText(/required steps done/)).not.toBeInTheDocument()
      if (state === 'not_tracked') {
        expect(screen.queryByRole('list', { name: 'Onboarding steps' })).not.toBeInTheDocument()
        expect(screen.queryByRole('heading', { name: 'Reminders' })).not.toBeInTheDocument()
      } else {
        expect(screen.getByRole('list', { name: 'Onboarding steps' })).toBeInTheDocument()
        // The note already says why; "still working through their steps" would misdescribe a tenant that has not started.
        expect(screen.queryByText(/^Reminders go only to/)).not.toBeInTheDocument()
      }
    })

    it('names who dismissed the checklist, and when', async () => {
      serve({
        state: 'dismissed',
        dismissedAt: '2026-09-20T09:00:00.000Z',
        dismissedBy: { id: 'x', name: 'Cleo Doe' },
      })
      renderAppAt(ONBOARDING)
      expect(
        await screen.findByText(/^Cleo Doe dismissed the getting-started checklist /)
      ).toBeInTheDocument()
      expect(screen.getByText('Dismissed')).toHaveAttribute('data-tone', 'outline')
    })

    it('says how long a stuck tenant has gone without progress', async () => {
      serve({ state: 'stuck', daysStuck: 9 })
      renderAppAt(ONBOARDING)
      expect(await screen.findByText('No progress for 9 days')).toBeInTheDocument()
      expect(screen.getByText('Stuck')).toHaveAttribute('data-tone', 'warning')
    })

    it.each(['suspended', 'archived'] as const)(
      'reads a %s tenant’s onboarding, with every action hidden',
      async (lifecycleState) => {
        serve({
          tenant: { id: TENANT_ID, name: 'Acme Corp', slug: 'acme', lifecycleState },
          steps: tenantOnboardingDetail().steps.map((step) => ({
            ...step,
            canMarkComplete: false,
          })),
          reminder: {
            ...tenantOnboardingDetail().reminder,
            canSend: false,
            blockedBy: 'tenant_state_conflict',
          },
        })
        renderAppAt(ONBOARDING)
        await steps()
        expect(
          screen.getByText(`This tenant is ${lifecycleState}: its onboarding is read-only.`)
        ).toBeInTheDocument()
        expect(
          screen.getByText(`This tenant is ${lifecycleState}, so no reminder can be sent.`)
        ).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /complete$/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Send reminder' })).not.toBeInTheDocument()
      }
    )

    it('says the role cannot see this on a 404, and offers a retry on any other failure', async () => {
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
          ok(platformDetail(), 'Tenant retrieved.')
        ),
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/onboarding`, () => fail('Not found', 404))
      )
      renderAppAt(ONBOARDING)
      expect(await screen.findByText(/Your role can’t see this any more/)).toBeInTheDocument()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })

    it('offers a retry when the onboarding fails to load', async () => {
      let calls = 0
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
          ok(platformDetail(), 'Tenant retrieved.')
        ),
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/onboarding`, () => {
          calls += 1
          return calls <= 2
            ? fail('Boom', 500)
            : ok(tenantOnboardingDetail(), 'Tenant onboarding retrieved.')
        })
      )
      const user = userEvent.setup()
      renderAppAt(ONBOARDING)
      await user.click(await screen.findByRole('button', { name: 'Try again' }))
      expect(await steps()).toBeInTheDocument()
    })
  })

  describe('marking a step complete', () => {
    it('offers Mark complete only on the steps the API would take', async () => {
      serve()
      renderAppAt(ONBOARDING)
      await steps()
      expect(
        screen.getAllByRole('button', { name: /^Mark complete: / }).map((b) => b.ariaLabel)
      ).toEqual(['Mark complete: Invite a teammate', 'Mark complete: A teammate joins'])
    })

    it('shows a viewer no action, and says an admin can', async () => {
      signIn({ ...testUser, platformRole: 'viewer' })
      serve()
      renderAppAt(ONBOARDING)
      await steps()
      expect(screen.queryByRole('button', { name: /complete$/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Send reminder' })).not.toBeInTheDocument()
      expect(
        screen.getByText('Marking steps complete and sending reminders need a platform admin.')
      ).toBeInTheDocument()
    })

    it('marks it complete with the reason, shows the staff completion, and returns focus to the heading', async () => {
      serve()
      let body: unknown
      server.use(
        http.post(
          `/api/v1/platform/tenants/${TENANT_ID}/onboarding/steps/invite_teammate/complete`,
          async ({ request }) => {
            body = await request.json()
            return ok(
              tenantOnboardingAfterStaffCompletion('invite_teammate'),
              'Onboarding step completed.'
            )
          }
        )
      )
      const success = vi.spyOn(toast, 'success')
      const user = userEvent.setup()
      renderAppAt(ONBOARDING)
      await user.click(
        await screen.findByRole('button', { name: 'Mark complete: Invite a teammate' })
      )
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Mark “Invite a teammate” complete?',
      })
      await user.type(within(dialog).getByLabelText('Reason'), 'Done on the call')
      await user.click(within(dialog).getByRole('button', { name: 'Mark complete' }))

      await waitFor(() =>
        expect(success).toHaveBeenCalledWith('Marked “Invite a teammate” complete.')
      )
      expect(body).toEqual({ reason: 'Done on the call' })
      expect(
        screen.queryByRole('button', { name: 'Mark complete: Invite a teammate' })
      ).not.toBeInTheDocument()
      const invite = (await steps()).children[1] as HTMLElement
      expect(within(invite).getByText(/· by staff: A B — Done on the call$/)).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Onboarding', level: 2 })).toHaveFocus()
      )
    })

    it('keeps the dialog open with the API’s reason when the step completed meanwhile', async () => {
      let reads = 0
      server.use(
        http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () =>
          ok(platformDetail(), 'Tenant retrieved.')
        ),
        http.get(`/api/v1/platform/tenants/${TENANT_ID}/onboarding`, () => {
          reads += 1
          return ok(
            reads === 1
              ? tenantOnboardingDetail()
              : tenantOnboardingAfterStaffCompletion('invite_teammate'),
            'Tenant onboarding retrieved.'
          )
        }),
        http.post(
          `/api/v1/platform/tenants/${TENANT_ID}/onboarding/steps/invite_teammate/complete`,
          () => fail('This step is complete already.', 409, 'already_complete')
        )
      )
      const user = userEvent.setup()
      renderAppAt(ONBOARDING)
      await user.click(
        await screen.findByRole('button', { name: 'Mark complete: Invite a teammate' })
      )
      const dialog = await screen.findByRole('alertdialog')
      await user.type(within(dialog).getByLabelText('Reason'), 'Done on the call')
      await user.click(within(dialog).getByRole('button', { name: 'Mark complete' }))

      expect(await within(dialog).findByText('This step is complete already.')).toBeInTheDocument()
      // The refusal refreshed the detail, so the button is gone while the dialog still says why.
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Mark complete: Invite a teammate' })
        ).not.toBeInTheDocument()
      )
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  describe('reminders', () => {
    it('sends one with the reason, naming the owners’ domains, never their addresses', async () => {
      serve({
        reminder: {
          ...tenantOnboardingDetail().reminder,
          recipientCount: 2,
          emailDomains: ['acme.test', 'example.com'],
        },
      })
      let body: unknown
      server.use(
        http.post(
          `/api/v1/platform/tenants/${TENANT_ID}/onboarding/remind`,
          async ({ request }) => {
            body = await request.json()
            return ok({ emailSent: true, recipientCount: 2 }, 'Reminder sent.')
          }
        )
      )
      const success = vi.spyOn(toast, 'success')
      const user = userEvent.setup()
      renderAppAt(ONBOARDING)
      await user.click(await screen.findByRole('button', { name: 'Send reminder' }))
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Send an onboarding reminder?',
      })
      expect(dialog).toHaveTextContent(
        'One email goes to each active owner (2) at acme.test, example.com'
      )
      await user.type(within(dialog).getByLabelText('Reason'), 'Stalled since the call')
      await user.click(within(dialog).getByRole('button', { name: 'Send reminder' }))

      await waitFor(() => expect(success).toHaveBeenCalledWith('Reminder sent to 2 owners.'))
      expect(body).toEqual({ reason: 'Stalled since the call' })
    })

    it('warns when not every owner’s email could be queued', async () => {
      serve()
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/onboarding/remind`, () =>
          ok({ emailSent: false, recipientCount: 1 }, 'The reminder could not be queued.')
        )
      )
      const warning = vi.spyOn(toast, 'warning')
      const user = userEvent.setup()
      renderAppAt(ONBOARDING)
      await user.click(await screen.findByRole('button', { name: 'Send reminder' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.type(within(dialog).getByLabelText('Reason'), 'Stalled')
      await user.click(within(dialog).getByRole('button', { name: 'Send reminder' }))
      await waitFor(() =>
        expect(warning).toHaveBeenCalledWith(
          'The reminder was recorded, but its email could not be queued for every owner.'
        )
      )
    })

    it('words a reminded_recently refusal with its retry time, in the reader’s locale', async () => {
      serve()
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/onboarding/remind`, () =>
          HttpResponse.json(
            {
              success: false,
              message:
                'A reminder went less than 24 hours ago; the next can go after 2026-10-03T09:00:00.000Z.',
              statusCode: 409,
              code: 'reminded_recently',
              errors: { retryAfter: '2026-10-03T09:00:00.000Z' },
              requestId: 'r',
            },
            { status: 409 }
          )
        )
      )
      const user = userEvent.setup()
      renderAppAt(ONBOARDING)
      await user.click(await screen.findByRole('button', { name: 'Send reminder' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.type(within(dialog).getByLabelText('Reason'), 'Stalled')
      await user.click(within(dialog).getByRole('button', { name: 'Send reminder' }))
      expect(
        await within(dialog).findByText(
          /^A reminder went out less than 24 hours ago\. The next one can go after (?!2026-10-03T)/
        )
      ).toBeInTheDocument()
    })

    it('shows the API’s other refusals as it words them', async () => {
      serve()
      server.use(
        http.post(`/api/v1/platform/tenants/${TENANT_ID}/onboarding/remind`, () =>
          fail('This tenant has no active owner to remind.', 409, 'no_owner')
        )
      )
      const user = userEvent.setup()
      renderAppAt(ONBOARDING)
      await user.click(await screen.findByRole('button', { name: 'Send reminder' }))
      const dialog = await screen.findByRole('alertdialog')
      await user.type(within(dialog).getByLabelText('Reason'), 'Stalled')
      await user.click(within(dialog).getByRole('button', { name: 'Send reminder' }))
      expect(
        await within(dialog).findByText('This tenant has no active owner to remind.')
      ).toBeInTheDocument()
    })

    it.each([
      ['reminded_recently', /^Reminder sent .+; the next one can go after .+\.$/],
      ['no_owner', /^This tenant has no active owner to remind\.$/],
      ['not_in_progress', /^Reminders go only to tenants still working through their steps\.$/],
    ] as const)('says why no reminder can go when %s', async (blockedBy, text) => {
      serve({
        reminder: {
          canSend: false,
          blockedBy,
          lastSentAt: '2026-09-30T09:00:00.000Z',
          nextAllowedAt: blockedBy === 'reminded_recently' ? '2026-10-01T09:00:00.000Z' : null,
          recipientCount: 1,
          emailDomains: ['example.com'],
        },
      })
      renderAppAt(ONBOARDING)
      await steps()
      expect(screen.getByText(text)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Send reminder' })).not.toBeInTheDocument()
    })

    it('lists every reminder sent, newest first, linking to each email it queued', async () => {
      serve({
        reminders: [
          onboardingReminder({
            id: AUDIT_ID_5,
            sentAt: '2026-09-29T09:00:00.000Z',
            sentBy: null,
            reason: 'Second nudge',
            recipientCount: 2,
            emailDomains: ['acme.test', 'example.com'],
            messageIds: [EMAIL_ID, EMAIL_ID_2],
          }),
          onboardingReminder(),
        ],
      })
      renderAppAt(ONBOARDING)
      const history = await screen.findByRole('list', { name: 'Reminders sent' })
      const [latest, first] = within(history).getAllByRole('listitem')
      expect(latest).toHaveTextContent('A removed user · to 2 owners at acme.test, example.com')
      expect(latest).toHaveTextContent('“Second nudge”')
      expect(within(latest!).getByRole('link', { name: 'View email 2 of 2' })).toHaveAttribute(
        'href',
        `/emails/${EMAIL_ID_2}`
      )
      expect(first).toHaveTextContent('Sam Staff · to 1 owner at example.com')
      expect(within(first!).getByRole('link', { name: 'View the email' })).toHaveAttribute(
        'href',
        `/emails/${EMAIL_ID}`
      )
    })

    it('says so when none was sent yet', async () => {
      serve()
      renderAppAt(ONBOARDING)
      expect(await screen.findByText('No reminder sent yet.')).toBeInTheDocument()
    })
  })
})
