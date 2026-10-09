import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAINTENANCE_MODE_IDLE_POLL_MS,
  MAINTENANCE_MODE_POLL_MS,
} from '@/constants/maintenance-mode.constants'
import { resetSessionForTests } from '@/http/session'
import {
  isMaintenanceModeConflict,
  MaintenanceModeConflict,
  maintenanceModeKeys,
  maintenanceModeQueryOptions,
  useChangeMaintenanceMode,
} from '@/queries/maintenance-mode.queries'
import { platformKeys } from '@/queries/platform.queries'
import { useAuthStore } from '@/states/auth.store'
import { fullMaintenanceView, maintenanceModeView } from '@/tests/fixtures/maintenance-mode'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { ChangeMaintenanceModeBody } from '@/types/api.types'

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
  resetSessionForTests()
  useAuthStore.setState({
    accessToken: 'access-token',
    user: { ...testUser, platformRole: 'owner' },
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Serves `view` from the GET, counting requests. */
function serveView(view: () => Response) {
  const calls = { count: 0 }
  server.use(
    http.get('/api/v1/platform/maintenance-mode', () => {
      calls.count += 1
      return view()
    })
  )
  return calls
}

describe('maintenanceModeQueryOptions', () => {
  it('reads the platform state', async () => {
    serveView(() => ok(fullMaintenanceView(), 'Maintenance mode retrieved.'))
    const { result } = renderHook(() => useQuery(maintenanceModeQueryOptions()), { wrapper })
    await waitFor(() => expect(result.current.data?.mode).toBe('full'))
    expect(result.current.data?.environment).toBe('staging')
  })

  it('asks again every 30 seconds while maintenance is on and every 60 while it is off', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    let view = fullMaintenanceView()
    const calls = serveView(() => ok(view, 'Maintenance mode retrieved.'))
    renderHook(() => useQuery(maintenanceModeQueryOptions()), { wrapper })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(calls.count).toBe(1)

    view = maintenanceModeView()
    await act(() => vi.advanceTimersByTimeAsync(MAINTENANCE_MODE_POLL_MS))
    expect(calls.count).toBe(2)

    // Off now: the next ask comes after the idle interval, not the on one.
    await act(() => vi.advanceTimersByTimeAsync(MAINTENANCE_MODE_IDLE_POLL_MS - 1))
    expect(calls.count).toBe(2)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(calls.count).toBe(3)

    // Someone switches it on: the poll speeds up again.
    view = fullMaintenanceView({ version: 6 })
    await act(() => vi.advanceTimersByTimeAsync(MAINTENANCE_MODE_IDLE_POLL_MS))
    expect(calls.count).toBe(4)
    await act(() => vi.advanceTimersByTimeAsync(MAINTENANCE_MODE_POLL_MS))
    expect(calls.count).toBe(5)
  })

  it('treats a 404 as an older API or a changed role: no retry, no polling', async () => {
    const calls = serveView(() => fail('Not found', 404))
    const { result } = renderHook(() => useQuery(maintenanceModeQueryOptions()), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls.count).toBe(1)
    const query = client.getQueryCache().find({ queryKey: maintenanceModeKeys.view })
    const interval = maintenanceModeQueryOptions().refetchInterval
    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(false)
  })
})

describe('useChangeMaintenanceMode', () => {
  const BODY: ChangeMaintenanceModeBody = {
    mode: 'full',
    message: 'Back soon.',
    reason: 'DB upgrade',
    expectedVersion: 4,
    confirm: 'staging',
  }

  it('sends the body as given and caches the answer', async () => {
    let sent: unknown
    server.use(
      http.put('/api/v1/platform/maintenance-mode', async ({ request }) => {
        sent = await request.json()
        return ok(fullMaintenanceView(), 'Maintenance mode updated.')
      })
    )
    const { result } = renderHook(() => useChangeMaintenanceMode(), { wrapper })
    await act(() => result.current.mutateAsync(BODY))
    expect(sent).toEqual(BODY)
    expect(client.getQueryData(maintenanceModeKeys.view)).toEqual(fullMaintenanceView())
  })

  it('lets the answer win over a read that was already in flight', async () => {
    let releaseRead: () => void = () => {}
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    server.use(
      http.get('/api/v1/platform/maintenance-mode', async () => {
        await readGate
        return ok(maintenanceModeView(), 'Maintenance mode retrieved.')
      }),
      http.put('/api/v1/platform/maintenance-mode', () =>
        ok(fullMaintenanceView(), 'Maintenance mode updated.')
      )
    )
    const { result } = renderHook(
      () => ({ change: useChangeMaintenanceMode(), view: useQuery(maintenanceModeQueryOptions()) }),
      { wrapper }
    )
    // The older read is in flight (and held) when the change lands.
    await waitFor(() => expect(result.current.view.fetchStatus).toBe('fetching'))
    await act(() => result.current.change.mutateAsync(BODY))
    releaseRead()
    await act(() => Promise.resolve())
    expect(client.getQueryData(maintenanceModeKeys.view)).toEqual(fullMaintenanceView())
    expect(result.current.view.data?.mode).toBe('full')
  })

  it('marks the status card and the audit log stale', async () => {
    server.use(
      http.put('/api/v1/platform/maintenance-mode', () =>
        ok(fullMaintenanceView(), 'Maintenance mode updated.')
      )
    )
    client.setQueryData(platformKeys.systemStatus, { release: 'dev' })
    client.setQueryData(['platform', 'audit-log', {}], { pages: [] })
    const { result } = renderHook(() => useChangeMaintenanceMode(), { wrapper })
    await act(() => result.current.mutateAsync(BODY))
    expect(client.getQueryState(platformKeys.systemStatus)?.isInvalidated).toBe(true)
    expect(client.getQueryState(['platform', 'audit-log', {}])?.isInvalidated).toBe(true)
  })

  it('on a 409 reads the state again before rejecting', async () => {
    const calls = serveView(() =>
      ok(fullMaintenanceView({ version: 9 }), 'Maintenance mode retrieved.')
    )
    server.use(
      http.put('/api/v1/platform/maintenance-mode', () =>
        fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
      )
    )
    client.setQueryData(maintenanceModeKeys.view, maintenanceModeView())
    const { result } = renderHook(
      () => ({ change: useChangeMaintenanceMode(), view: useQuery(maintenanceModeQueryOptions()) }),
      { wrapper }
    )
    let caught: unknown
    await act(async () => {
      await result.current.change.mutateAsync(BODY).catch((error: unknown) => {
        caught = error
      })
    })
    expect(isMaintenanceModeConflict(caught)).toBe(true)
    expect(calls.count).toBeGreaterThanOrEqual(1)
    expect(client.getQueryData(maintenanceModeKeys.view)).toEqual(
      fullMaintenanceView({ version: 9 })
    )
    expect((caught as MaintenanceModeConflict).fresh).toEqual(fullMaintenanceView({ version: 9 }))
  })

  it('on a 409 whose re-read fails rejects with no fresh state, reading once', async () => {
    const calls = serveView(() => fail('Server error', 500))
    server.use(
      http.put('/api/v1/platform/maintenance-mode', () =>
        fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
      )
    )
    client.setQueryData(maintenanceModeKeys.view, fullMaintenanceView())
    const { result } = renderHook(() => useChangeMaintenanceMode(), { wrapper })
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync(BODY).catch((error: unknown) => {
        caught = error
      })
    })
    expect(isMaintenanceModeConflict(caught)).toBe(true)
    expect((caught as MaintenanceModeConflict).fresh).toBeNull()
    expect(calls.count).toBe(1)
  })

  it('on a 409 while a read is on its way, cancels it and reads again', async () => {
    let gets = 0
    server.use(
      http.get('/api/v1/platform/maintenance-mode', async () => {
        gets += 1
        if (gets === 1) {
          await settle(200, 'injected latency: a read still on its way when the 409 lands')
          return ok(maintenanceModeView({ version: 4 }), 'Maintenance mode retrieved.')
        }
        return ok(fullMaintenanceView({ version: 9 }), 'Maintenance mode retrieved.')
      }),
      http.put('/api/v1/platform/maintenance-mode', () =>
        fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
      )
    )
    client.setQueryData(maintenanceModeKeys.view, maintenanceModeView())
    const { result } = renderHook(() => useChangeMaintenanceMode(), { wrapper })
    void client
      .fetchQuery({ ...maintenanceModeQueryOptions(), staleTime: 0 })
      .catch(() => undefined)
    await waitFor(() => expect(gets).toBe(1))
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync(BODY).catch((error: unknown) => {
        caught = error
      })
    })
    expect(gets).toBe(2)
    expect((caught as MaintenanceModeConflict).fresh).toEqual(fullMaintenanceView({ version: 9 }))
  })

  it('on a 409 treats a read that has not moved past the version sent as not read', async () => {
    serveView(() => ok(maintenanceModeView({ version: 4 }), 'Maintenance mode retrieved.'))
    server.use(
      http.put('/api/v1/platform/maintenance-mode', () =>
        fail('Maintenance mode changed since you loaded it.', 409, 'MAINTENANCE_MODE_CONFLICT')
      )
    )
    const { result } = renderHook(() => useChangeMaintenanceMode(), { wrapper })
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync(BODY).catch((error: unknown) => {
        caught = error
      })
    })
    expect(isMaintenanceModeConflict(caught)).toBe(true)
    expect((caught as MaintenanceModeConflict).fresh).toBeNull()
  })

  it('rejects any other failure unchanged, without reading the state again', async () => {
    const calls = serveView(() => ok(maintenanceModeView(), 'Maintenance mode retrieved.'))
    server.use(
      http.put('/api/v1/platform/maintenance-mode', () =>
        fail('Recent authentication required', 401, 'REAUTH_REQUIRED')
      )
    )
    const { result } = renderHook(() => useChangeMaintenanceMode(), { wrapper })
    let caught: unknown
    await act(async () => {
      await result.current.mutateAsync(BODY).catch((error: unknown) => {
        caught = error
      })
    })
    expect(isMaintenanceModeConflict(caught)).toBe(false)
    expect(calls.count).toBe(0)
  })
})
