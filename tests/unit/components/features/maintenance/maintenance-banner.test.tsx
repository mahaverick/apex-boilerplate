import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { maintenanceModeKeys } from '@/queries/maintenance-mode.queries'
import { queryClient } from '@/router'
import { fullMaintenanceView, maintenanceModeView } from '@/tests/fixtures/maintenance-mode'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformMaintenanceModeView } from '@/types/api.types'

/** Serves the platform GET from `state.view`, counting requests. */
function serve(initial: PlatformMaintenanceModeView | (() => Response)) {
  const state = { view: initial, calls: 0 }
  server.use(
    http.get('/api/v1/platform/maintenance-mode', () => {
      state.calls += 1
      return typeof state.view === 'function'
        ? state.view()
        : ok(state.view, 'Maintenance mode retrieved.')
    })
  )
  return state
}

/** Asks for the platform state again, as the 30-second poll does (the poll itself is the query's test). */
async function poll() {
  await act(() => queryClient.refetchQueries({ queryKey: maintenanceModeKeys.view }))
}

describe('the maintenance banner', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('shows on every staff page while customers are in maintenance, with who set it and a link', async () => {
    serve(fullMaintenanceView())
    renderAppAt('/tenants')
    const text = await screen.findByText(
      /^Customers are in FULL maintenance since .+, set by Sam Staff\.$/
    )
    const status = text.closest('[role="status"]')
    expect(status).not.toBeNull()
    expect(text).toHaveClass('ph-sensitive')
    expect(within(status as HTMLElement).getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/maintenance'
    )
  })

  it('says READ-ONLY for read-only maintenance', async () => {
    serve(fullMaintenanceView({ mode: 'read_only' }))
    renderAppAt('/overview')
    expect(await screen.findByText(/^Customers are in READ-ONLY maintenance/)).toBeVisible()
  })

  it('shows nothing while maintenance is off', async () => {
    const state = serve(maintenanceModeView())
    renderAppAt('/tenants')
    await screen.findByRole('heading', { name: 'Tenants', level: 1 })
    await waitFor(() => expect(state.calls).toBe(1))
    expect(screen.queryByText(/^Customers are in/)).toBeNull()
  })

  it('shows nothing, and does not sign out, when an older API answers 404', async () => {
    const state = serve(() => fail('Not found', 404))
    renderAppAt('/tenants')
    await screen.findByRole('heading', { name: 'Tenants', level: 1 })
    await waitFor(() => expect(state.calls).toBe(1))
    expect(screen.queryByText(/^Customers are in/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Tenants', level: 1 })).toBeVisible()
  })

  it('goes away when the next answer is off', async () => {
    const state = serve(fullMaintenanceView())
    renderAppAt('/tenants')
    await screen.findByText(/^Customers are in FULL maintenance/)
    state.view = maintenanceModeView({ version: 6 })
    await poll()
    await waitFor(() => expect(screen.queryByText(/^Customers are in/)).toBeNull())
  })

  it('keeps the last answer up when a poll fails', async () => {
    const state = serve(fullMaintenanceView())
    renderAppAt('/tenants')
    await screen.findByText(/^Customers are in FULL maintenance/)
    state.view = () => fail('Bad gateway', 502)
    await poll()
    expect(state.calls).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/^Customers are in FULL maintenance/)).toBeVisible()
  })

  it('ignores the Maintenance-Mode response header: only the platform state drives it', async () => {
    const state = serve(maintenanceModeView())
    server.use(
      http.get('/api/v1/platform/tenants', () =>
        HttpResponse.json(
          {
            success: true,
            message: 'Tenants retrieved.',
            statusCode: 200,
            data: { tenants: [], nextCursor: null, prevCursor: null },
          },
          { headers: { 'Maintenance-Mode': 'full' } }
        )
      )
    )
    renderAppAt('/tenants')
    await screen.findByText('No tenants yet.')
    await waitFor(() => expect(state.calls).toBe(1))
    expect(screen.queryByText(/^Customers are in/)).toBeNull()
  })
})
