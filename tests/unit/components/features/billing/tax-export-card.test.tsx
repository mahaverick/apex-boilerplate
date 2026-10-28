import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MembershipRole } from '@/constants/roles'
import { toast } from '@/lib/toast'
import { queryClient } from '@/router'
import { testBillingSettings, testPlans } from '@/tests/fixtures/billing'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp } from '@/tests/mocks/step-up'
import { REAUTH_REQUIRED } from '@/types/api.types'
import type { BillingSettings } from '@/types/billing.types'

const EXPORT = '/api/v1/platform/billing/tax-export'
const ON: BillingSettings = { ...testBillingSettings, taxDocumentsEnabled: true }

/**
 * Serves the plans and the billing settings.
 * @param settings - The settings every read answers.
 */
function serve(settings: BillingSettings = ON) {
  server.use(
    http.get('/api/v1/platform/plans', () => ok(testPlans, 'Plans retrieved.')),
    http.get('/api/v1/platform/billing-settings', () => ok(settings, 'Billing settings retrieved.'))
  )
}

/**
 * Signs in at `role` and opens the Plans page.
 * @param role - The platform role.
 */
function openPlans(role: MembershipRole = 'admin') {
  signIn({ ...testUser, platformRole: role })
  renderAppAt('/plans')
}

/** Waits until the page holds the billing settings, so an absent card is the gate's doing. */
async function settingsLoaded() {
  await screen.findByRole('region', { name: 'Trials and grace' })
  await waitFor(() =>
    expect(queryClient.getQueryData(['platform', 'billing-settings'])).toBeDefined()
  )
  await screen.findByText('Never changed.')
}

/** The export card, found by its heading. */
const exportCard = () => screen.findByRole('region', { name: 'GST return export' })

describe('GST return export card', () => {
  beforeEach(() => {
    // Only the clock: 27 October 2026, in IST.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-27T10:00:00+05:30'))
    serve()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['viewer', 'manager'] as const)('shows a %s no export card', async (role) => {
    openPlans(role)
    await settingsLoaded()
    expect(screen.queryByRole('region', { name: 'GST return export' })).not.toBeInTheDocument()
  })

  it('hides the card from an admin when registration is off and no document exists', async () => {
    serve({ ...ON, taxDocumentsEnabled: false, hasTaxDocuments: false })
    openPlans()
    await settingsLoaded()
    expect(screen.queryByRole('region', { name: 'GST return export' })).not.toBeInTheDocument()
  })

  it.each([
    { taxDocumentsEnabled: true, hasTaxDocuments: false },
    { taxDocumentsEnabled: false, hasTaxDocuments: true },
  ])('shows an admin the card for %j', async (flags) => {
    serve({ ...ON, ...flags })
    openPlans()
    const card = await exportCard()
    expect(card).toHaveTextContent('Download one month or quarter of tax invoices')
    expect(within(card).getByRole('radio', { name: 'Month' })).toBeChecked()
    expect(within(card).getByRole('combobox', { name: 'Period' })).toHaveTextContent(
      'September 2026'
    )
  })

  it('offers quarters, last quarter first', async () => {
    const user = userEvent.setup()
    openPlans()
    const card = await exportCard()
    await user.click(within(card).getByRole('radio', { name: 'Quarter (for quarterly filers)' }))
    const select = within(card).getByRole('combobox', { name: 'Period' })
    expect(select).toHaveTextContent('Q2 2026-27 (Jul–Sep 2026)')
    await user.click(select)
    expect(await screen.findAllByRole('option')).toHaveLength(8)
  })

  it('stops the months at the GST start date', async () => {
    const user = userEvent.setup()
    serve({ ...ON, gstEffectiveFrom: '2026-08-15' })
    openPlans()
    const card = await exportCard()
    await user.click(within(card).getByRole('combobox', { name: 'Period' }))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'October 2026',
      'September 2026',
      'August 2026',
    ])
  })

  it('downloads behind step-up and toasts the saved name', async () => {
    const user = userEvent.setup()
    const success = vi.spyOn(toast, 'success')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const periods: Array<string | null> = []
    server.use(
      http.get(EXPORT, ({ request }) => {
        periods.push(new URL(request.url).searchParams.get('period'))
        return periods.length === 1
          ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
          : new HttpResponse('zip', {
              headers: {
                'content-type': 'application/zip',
                'content-disposition': 'attachment; filename="gstr1-2026-09.zip"',
              },
            })
      })
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    openPlans()
    const card = await exportCard()
    await user.click(within(card).getByRole('button', { name: 'Download export' }))
    await confirmStepUp(user)
    await waitFor(() => expect(success).toHaveBeenCalledWith('gstr1-2026-09.zip downloaded.'))
    expect(periods).toEqual(['2026-09', '2026-09'])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['platform', 'audit-log'] })
    expect(within(card).getByRole('button', { name: 'Download export' })).toBeInTheDocument()
  })

  it('sends the period picked', async () => {
    const user = userEvent.setup()
    vi.spyOn(toast, 'success')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const periods: Array<string | null> = []
    server.use(
      http.get(EXPORT, ({ request }) => {
        periods.push(new URL(request.url).searchParams.get('period'))
        return new HttpResponse('zip', { headers: { 'content-type': 'application/zip' } })
      })
    )
    openPlans()
    const card = await exportCard()
    await user.click(within(card).getByRole('radio', { name: 'Quarter (for quarterly filers)' }))
    await user.click(within(card).getByRole('combobox', { name: 'Period' }))
    await user.click(await screen.findByRole('option', { name: 'Q3 2026-27 (Oct–Dec 2026)' }))
    await user.click(within(card).getByRole('button', { name: 'Download export' }))
    await waitFor(() => expect(periods).toEqual(['2026-Q3']))
  })

  it('toasts express’s sentence when registration was switched off, and reloads the settings', async () => {
    const user = userEvent.setup()
    const error = vi.spyOn(toast, 'error')
    let reads = 0
    server.use(
      http.get('/api/v1/platform/billing-settings', () => {
        reads += 1
        return ok({ ...ON, hasTaxDocuments: true }, 'Billing settings retrieved.')
      }),
      http.get(EXPORT, () =>
        fail('GST registration is off. There is nothing to export.', 404, 'tax_documents_disabled')
      )
    )
    openPlans()
    const card = await exportCard()
    const before = reads
    await user.click(within(card).getByRole('button', { name: 'Download export' }))
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('GST registration is off. There is nothing to export.')
    )
    await waitFor(() => expect(reads).toBeGreaterThan(before))
  })

  it('toasts the role wording for another 404', async () => {
    const user = userEvent.setup()
    const error = vi.spyOn(toast, 'error')
    server.use(http.get(EXPORT, () => fail('Not found.', 404, 'not_found')))
    openPlans()
    const card = await exportCard()
    await user.click(within(card).getByRole('button', { name: 'Download export' }))
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Your role no longer allows'))
    )
  })

  it('toasts express’s field message for a 400', async () => {
    const user = userEvent.setup()
    const error = vi.spyOn(toast, 'error')
    server.use(
      http.get(EXPORT, () =>
        fail('Period must be before the next period.', 400, 'VALIDATION_ERROR')
      )
    )
    openPlans()
    const card = await exportCard()
    await user.click(within(card).getByRole('button', { name: 'Download export' }))
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Period must be before the next period.')
    )
  })
})
