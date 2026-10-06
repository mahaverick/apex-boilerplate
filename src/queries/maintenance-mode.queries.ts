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
 * Whether a change was refused because the state moved on since it was read.
 * @param error - A mutation error.
 * @returns True for 409 `MAINTENANCE_MODE_CONFLICT`.
 */
export function isMaintenanceModeConflict(error: unknown): boolean {
  return statusFrom(error) === 409 && codeFrom(error) === MAINTENANCE_MODE_CONFLICT
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
 * state is read again before the error rejects.
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
        if (isMaintenanceModeConflict(error)) {
          await queryClient.refetchQueries({ queryKey: maintenanceModeKeys.view, exact: true })
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
