/**
 * @file Staff reads and writes on user accounts across the platform
 * (`/platform/users*`). Every write marks the staff directory stale
 * (`invalidateDirectory`): the user shows on tenant and Staff pages too, and
 * each write is a platform audit entry, which the History card reads.
 */
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { isRoleDenied } from '@/lib/role-denied'
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { invalidateDirectory } from '@/queries/platform.queries'
import { booleanFilter, defineList, listFilter } from '@/schemas/list.schemas'
import type { CreateUserInput, UpdateUserNameInput } from '@/schemas/user-admin.schemas'
import {
  USER_STATUSES,
  type ApiSuccess,
  type PlatformUserDetail,
  type PlatformUserRow,
} from '@/types/api.types'
import type { ListRequest } from '@/types/list.types'

/** `all` is `['platform', 'users']` (lists); `detail` sits under `['platform', 'user']`, so invalidating `all` leaves open user pages alone. */
export const userAdminKeys = {
  /** Every users page; a write invalidates them all, since any row may move between filters. */
  all: ['platform', 'users'] as const,
  detail: (id: string) => ['platform', 'user', id] as const,
}

/** The Users list's URL contract: email order by default, filtered by account status, whether they have signed in, and staff. */
export const usersList = defineList({
  sorts: ['email', 'created', '-created', '-lastSignIn'],
  filters: {
    status: listFilter(USER_STATUSES),
    signedIn: booleanFilter(),
    staff: booleanFilter(),
  },
  table: analyticsKey('users'),
})

/**
 * One page of user accounts (`GET /platform/users`), for the Users table, the
 * palette and the activity actor facet.
 * @param request - From `listRequest(usersList, …)`, or `{ search, limit }`.
 * @param options - `total: false` for a read that never shows the total (the palette and pickers).
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function usersListOptions(request: ListRequest, options: { total?: boolean } = {}) {
  return listQueryOptions<PlatformUserRow>({
    key: userAdminKeys.all,
    path: '/platform/users',
    request,
    ...options,
  })
}

/** A 404 answers who is asking, so a retry changes nothing. */
function retryUnlessDenied(failureCount: number, error: Error): boolean {
  return !isRoleDenied(error) && failureCount < 1
}

/**
 * One user, with memberships, sign-in methods and pending invitations. A
 * soft-deleted user is answered with `deletedAt` set; a 404 is an
 * unknown or purged one (every staff role may read this route).
 */
export function platformUserQueryOptions(userId: string) {
  return queryOptions({
    queryKey: userAdminKeys.detail(userId),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<PlatformUserDetail>>(`/platform/users/${userId}`)),
    retry: retryUnlessDenied,
  })
}

/** Marks the staff directory stale; the user's own page is part of it. */
function useInvalidateUsers() {
  const queryClient = useQueryClient()
  return () => invalidateDirectory(queryClient)
}

/**
 * Creates a user and mails them the welcome email, whose sign-in link opens
 * the customer app (admin); `emailSent` says whether the mail was queued.
 */
export function useCreateUser() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async (input: CreateUserInput) =>
      unwrap(
        await apiClient.post<ApiSuccess<{ user: PlatformUserRow; emailSent: boolean }>>(
          '/platform/users',
          input
        )
      ),
    onSuccess: () => invalidate(),
  })
}

/** Changes a user's names (admin). */
export function useUpdateUser() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ userId, ...input }: { userId: string } & UpdateUserNameInput) =>
      unwrap(
        await apiClient.patch<ApiSuccess<PlatformUserRow>>(`/platform/users/${userId}`, input)
      ),
    onSuccess: () => invalidate(),
  })
}

/** A state change that takes a reason and answers the updated row. */
function useReasonedChange(action: 'deactivate' | 'reactivate') {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) =>
      unwrap(
        await apiClient.post<ApiSuccess<PlatformUserRow>>(`/platform/users/${userId}/${action}`, {
          reason,
        })
      ),
    onSuccess: () => invalidate(),
  })
}

/** Deactivates an account, which ends its sessions (admin; behind step-up). */
export function useDeactivateUser() {
  return useReasonedChange('deactivate')
}

/** Reactivates a deactivated account (admin). */
export function useReactivateUser() {
  return useReasonedChange('reactivate')
}

/** Ends every session of a user with an audited reason (admin). */
export function useSignOutUser() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      await apiClient.post(`/platform/users/${userId}/sign-out`, { reason })
    },
    onSuccess: () => invalidate(),
  })
}

/**
 * Mails a user a sign-in link (admin): to Apex for staff, to the customer app
 * for anyone else. The answer says whether the mail went, so the page can
 * offer another try.
 */
export function useSendSignInLink() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ userId }: { userId: string }) =>
      unwrap(
        await apiClient.post<ApiSuccess<{ emailSent: boolean }>>(
          `/platform/users/${userId}/sign-in-link`,
          {}
        )
      ),
    onSuccess: () => invalidate(),
  })
}

/** Soft delete (admin; behind step-up). The account stays readable but read-only, so its page refreshes. */
export function useDeleteUser() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      await apiClient.delete(`/platform/users/${userId}`, { data: { reason } })
    },
    onSuccess: () => invalidate(),
  })
}

/**
 * Permanent deletion of a soft-deleted account (owner; behind step-up). There
 * is nothing left to show, so `onPurged` leaves the page first, and only then
 * is its cached detail dropped: dropped while the page still showed it, the
 * page would refetch it into a 404. The rest of the directory then refreshes.
 * @param onPurged - Leaves the purged account's page; resolves once it has.
 */
export function usePurgeUser({ onPurged }: { onPurged: () => Promise<unknown> }) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      await apiClient.post(`/platform/users/${userId}/purge`, { reason })
    },
    onSuccess: async (_data, { userId }) => {
      await onPurged()
      queryClient.removeQueries({ queryKey: userAdminKeys.detail(userId) })
      await invalidateDirectory(queryClient)
    },
  })
}
