/**
 * @file Maintenance mode's platform state (`/platform/maintenance-mode`): read
 * by every staff page's banner and the Maintenance page, changed by owners. A
 * 409 reads the state again before it rejects, so the caller can say what
 * changed.
 */
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MAINTENANCE_MODE_CONFLICT,
  MAINTENANCE_MODE_IDLE_POLL_MS,
  MAINTENANCE_MODE_POLL_MS,
} from '@/constants/maintenance-mode.constants'
import { apiClient, unwrap } from '@/http/client'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { auditKeys } from '@/queries/audit.queries'
import { isRoleDenied, platformKeys } from '@/queries/platform.queries'
import type {
  ApiSuccess,
  ChangeMaintenanceModeBody,
  PlatformMaintenanceModeView,
} from '@/types/api.types'

export const maintenanceModeKeys = {
  view: ['platform', 'maintenance-mode'] as const,
}

/**
 * A change refused because the state moved on since it was read (409
 * `MAINTENANCE_MODE_CONFLICT`), with the state read again after it. `fresh`
 * is null when that read failed: the cache then holds only what was there
 * before, which is not what someone else saved.
 */
export class MaintenanceModeConflict extends Error {
  readonly fresh: PlatformMaintenanceModeView | null

  /**
   * Wraps the 409 with the state read after it.
   * @param fresh - The state read again, or null when the read failed.
   * @param cause - The 409 itself.
   */
  constructor(fresh: PlatformMaintenanceModeView | null, cause: unknown) {
    super('Maintenance mode changed since it was loaded.', { cause })
    this.name = 'MaintenanceModeConflict'
    this.fresh = fresh
  }
}

/**
 * Whether a change was refused because the state moved on since it was read.
 * @param error - A mutation error.
 * @returns True for the conflict `useChangeMaintenanceMode` rejects with.
 */
export function isMaintenanceModeConflict(error: unknown): error is MaintenanceModeConflict {
  return error instanceof MaintenanceModeConflict
}

/**
 * The platform state. Asked again every 30 seconds while maintenance is on
 * and every 60 seconds while it is off (or not yet known), and only while the
 * tab is visible (TanStack Query pauses `refetchInterval` in a hidden tab); a
 * focus or a remount asks again too. A 404 (an express older than 1.9.0, or a
 * role that changed) stops the polling.
 * @returns Query options for `useQuery`.
 */
export function maintenanceModeQueryOptions() {
  return queryOptions({
    queryKey: maintenanceModeKeys.view,
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<PlatformMaintenanceModeView>>('/platform/maintenance-mode')
      ),
    refetchInterval: (query) => {
      if (isRoleDenied(query.state.error)) return false
      const mode = query.state.data?.mode
      return mode === 'read_only' || mode === 'full'
        ? MAINTENANCE_MODE_POLL_MS
        : MAINTENANCE_MODE_IDLE_POLL_MS
    },
    /** A 404 answers who is asking, so a retry changes nothing. */
    retry: (failureCount, error) => !isRoleDenied(error) && failureCount < 1,
  })
}

/**
 * `PUT /platform/maintenance-mode`. Run it through `useStepUp().run`: the
 * route needs a recent sign-in. On success the answer replaces the cached
 * state and the status card and audit log are marked stale; on a 409 the
 * state is read again, once and without a retry, and the mutation rejects
 * with a `MaintenanceModeConflict` holding that read, or null when it failed.
 * @returns The mutation; `mutateAsync` resolves to the new state.
 */
export function useChangeMaintenanceMode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: ChangeMaintenanceModeBody) => {
      try {
        return unwrap(
          await apiClient.put<ApiSuccess<PlatformMaintenanceModeView>>(
            '/platform/maintenance-mode',
            body
          )
        )
      } catch (error) {
        if (statusFrom(error) === 409 && codeFrom(error) === MAINTENANCE_MODE_CONFLICT) {
          const fresh = await queryClient
            .fetchQuery({ ...maintenanceModeQueryOptions(), staleTime: 0, retry: false })
            .catch(() => null)
          throw new MaintenanceModeConflict(fresh, error)
        }
        throw error
      }
    },
    onSuccess: async (view) => {
      // A read that started before the change must not land over the answer.
      await queryClient.cancelQueries({ queryKey: maintenanceModeKeys.view })
      queryClient.setQueryData(maintenanceModeKeys.view, view)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: platformKeys.systemStatus }),
        queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
      ])
    },
  })
}
