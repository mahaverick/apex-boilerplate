/**
 * @file The staff queue of account deletion requests (`GET /platform/deletion-requests`).
 * Only admins and owners may read it; below that the API answers 404. The staff delete
 * (`useDeleteUser`) completes a request, so it invalidates `deletionRequestKeys.all`.
 */
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { defineList } from '@/schemas/list.schemas'
import type { DeletionRequestRow } from '@/types/api.types'
import type { ListRequest } from '@/types/list.types'

/** Every deletion requests page; a delete invalidates them all. */
export const deletionRequestKeys = {
  all: ['platform', 'deletion-requests'] as const,
}

/** The queue's URL contract: soonest due first, which is the API's default, so the URL stays clean. */
export const deletionRequestsList = defineList({
  sorts: ['due', '-due'],
  filters: {},
  table: analyticsKey('deletion_requests'),
})

/**
 * One page of open deletion requests, for the Deletion requests table.
 * @param request - From `listRequest(deletionRequestsList, …)`.
 * @param options - `total: false` for a read that never shows the total.
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function deletionRequestsListOptions(
  request: ListRequest,
  options: { total?: boolean } = {}
) {
  return listQueryOptions<DeletionRequestRow>({
    key: deletionRequestKeys.all,
    path: '/platform/deletion-requests',
    request,
    ...options,
  })
}
