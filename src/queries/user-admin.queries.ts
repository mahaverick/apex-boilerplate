/**
 * @file Staff reads and writes on user accounts across the platform
 * (`/platform/users*`). Every write marks the staff directory stale
 * (`invalidateDirectory`): the user shows on tenant and Staff pages too, and
 * each write is a platform audit entry, which the History card reads.
 */
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { invalidateDirectory, isRoleDenied } from '@/queries/platform.queries'
import type { CreateUserInput, UpdateUserNameInput } from '@/schemas/user-admin.schemas'
import type {
  ApiSuccess,
  PageDirection,
  PlatformUserDetail,
  PlatformUserPage,
  PlatformUserRow,
  UserStatusFilter,
} from '@/types/api.types'

/** The API's default page; its cap is 50. */
const USER_PAGE_SIZE = 20

/** The API refuses a longer term. */
const MAX_QUERY_LENGTH = 100

/** `GET /platform/users` filters, in the API's own names. Unset means "any live account". */
export interface UserSearchParams {
  q?: string
  status?: UserStatusFilter
  verified?: boolean
  staff?: boolean
  cursor?: string
  /** Which way `cursor` pages. Sent only with a cursor. */
  direction?: PageDirection
  limit?: number
}

export const userAdminKeys = {
  /** Every users page; a write invalidates them all, since any row may move between filters. */
  all: ['platform', 'users'] as const,
  list: (params: UserSearchParams) => ['platform', 'users', params] as const,
  detail: (id: string) => ['platform', 'user', id] as const,
}

/** The params as sent: trimmed term, unset filters left out, so equal searches share one cache entry. */
function normalise(params: UserSearchParams): UserSearchParams {
  const q = params.q?.trim().slice(0, MAX_QUERY_LENGTH)
  return {
    ...(q ? { q } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.verified === undefined ? {} : { verified: params.verified }),
    ...(params.staff === undefined ? {} : { staff: params.staff }),
    ...(params.cursor ? { cursor: params.cursor, direction: params.direction ?? 'next' } : {}),
    limit: params.limit ?? USER_PAGE_SIZE,
  }
}

/** A 404 answers who is asking, so a retry changes nothing. */
function retryUnlessDenied(failureCount: number, error: unknown): boolean {
  return !isRoleDenied(error) && failureCount < 1
}

/**
 * One keyset page of users, for the Users table and the palette.
 * @param params - Filters and the cursor to page from.
 * @returns Query options for `useQuery` or a route loader.
 */
export function platformUsersQueryOptions(params: UserSearchParams) {
  const sent = normalise(params)
  return queryOptions({
    queryKey: userAdminKeys.list(sent),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<PlatformUserPage>>('/platform/users', { params: sent })
      ),
    placeholderData: keepPreviousData,
    retry: retryUnlessDenied,
  })
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

export function useDeactivateUser() {
  return useReasonedChange('deactivate')
}

export function useReactivateUser() {
  return useReasonedChange('reactivate')
}

export function useSignOutUser() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      await apiClient.post(`/platform/users/${userId}/sign-out`, { reason })
    },
    onSuccess: () => invalidate(),
  })
}

/** Sends a mail; the answer says whether it went, so the page can offer a resend. */
function useMailAction(action: 'password-setup' | 'resend-verification') {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ userId }: { userId: string }) =>
      unwrap(
        await apiClient.post<ApiSuccess<{ emailSent: boolean }>>(
          `/platform/users/${userId}/${action}`,
          {}
        )
      ),
    onSuccess: () => invalidate(),
  })
}

export function useSendPasswordSetup() {
  return useMailAction('password-setup')
}

export function useResendVerification() {
  return useMailAction('resend-verification')
}

/** Soft delete (admin; behind step-up). The account stays readable, now read-only, so its page refreshes. */
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
