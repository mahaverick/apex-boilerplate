/**
 * @file Staff reads and writes on tracked email (`/platform/emails*`,
 * `/platform/email-suppressions*`). Imports nothing from platform.queries.ts,
 * which calls `invalidateEmails` from `invalidateDirectory`.
 */
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import { analyticsKey } from '@/observability/telemetry'
import { auditKeys } from '@/queries/audit.queries'
import { listQueryOptions } from '@/queries/list.queries'
import { dayFilter, defineList, idFilter, listFilter } from '@/schemas/list.schemas'
import {
  EMAIL_MESSAGE_STATUSES,
  EMAIL_TEMPLATE_KEYS,
  type ApiSuccess,
  type EmailHealth,
  type EmailMessageDetail,
  type EmailMessagePage,
  type EmailMessageStatus,
  type EmailMessageSummary,
  type EmailPreview,
  type EmailResendResult,
  type EmailSuppression,
  type EmailSuppressionPage,
  type PageDirection,
  type StatsRange,
  type SuppressionStateFilter,
} from '@/types/api.types'
import type { ListRequest } from '@/types/list.types'

/** The API's default page; its cap is 50. */
const EMAIL_PAGE_SIZE = 20

/** The API refuses a longer term. */
const MAX_QUERY_LENGTH = 100

/** `GET /platform/emails` filters, in the API's own names. `from` and `to` are UTC `YYYY-MM-DD`, `to` inclusive. */
export interface EmailSearchParams {
  /** Part of the recipient address, case-insensitive. */
  q?: string
  status?: EmailMessageStatus
  template?: string
  userId?: string
  tenantId?: string
  from?: string
  to?: string
  cursor?: string
  /** Which way `cursor` pages. Sent only with a cursor. */
  direction?: PageDirection
  limit?: number
}

/** `GET /platform/email-suppressions` filters. Unset `state` is the API's default, `active`. */
export interface SuppressionSearchParams {
  q?: string
  state?: SuppressionStateFilter
  cursor?: string
  direction?: PageDirection
  limit?: number
}

/**
 * `all` prefixes every email list and the health report; a message's detail and
 * preview sit under `['platform', 'email', id]`, so one prefix reaches both.
 */
export const emailKeys = {
  all: ['platform', 'emails'] as const,
  list: (params: EmailSearchParams) => ['platform', 'emails', params] as const,
  health: (range: StatsRange) => ['platform', 'emails', 'health', range] as const,
  message: ['platform', 'email'] as const,
  detail: (id: string) => ['platform', 'email', id] as const,
  preview: (id: string) => ['platform', 'email', id, 'preview'] as const,
  suppressionsAll: ['platform', 'email-suppressions'] as const,
  suppressions: (params: SuppressionSearchParams) =>
    ['platform', 'email-suppressions', params] as const,
}

/** The trimmed term, or nothing: an empty `q` is not a search. */
function term(q: string | undefined): { q?: string } {
  const value = q?.trim().slice(0, MAX_QUERY_LENGTH)
  return value ? { q: value } : {}
}

/** The cursor with its direction, or nothing on the first page. */
function page(cursor: string | undefined, direction: PageDirection | undefined) {
  return cursor ? { cursor, direction: direction ?? 'next' } : {}
}

/** The params as sent: unset filters left out, so equal searches share one cache entry. */
function normaliseEmails(params: EmailSearchParams): EmailSearchParams {
  return {
    ...term(params.q),
    ...(params.status ? { status: params.status } : {}),
    ...(params.template ? { template: params.template } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
    ...page(params.cursor, params.direction),
    limit: params.limit ?? EMAIL_PAGE_SIZE,
  }
}

/** The suppression params as sent: unset filters left out, so equal searches share one cache entry. */
function normaliseSuppressions(params: SuppressionSearchParams): SuppressionSearchParams {
  return {
    ...term(params.q),
    ...(params.state ? { state: params.state } : {}),
    ...page(params.cursor, params.direction),
    limit: params.limit ?? EMAIL_PAGE_SIZE,
  }
}

/** The Emails list's URL contract: newest first, filtered by status, template, user, tenant and day. */
export const emailsList = defineList({
  sorts: ['-created', 'created'],
  filters: {
    status: listFilter(EMAIL_MESSAGE_STATUSES),
    template: listFilter(EMAIL_TEMPLATE_KEYS),
    user: idFilter(),
    tenant: idFilter(),
    from: dayFilter(),
    to: dayFilter(),
  },
  table: analyticsKey('emails'),
})

/** A tenant's Emails tab: the same list with the tenant fixed by the page, so its URL has no `tenant` or user facet. */
export const tenantEmailsList = defineList({
  sorts: ['-created', 'created'],
  filters: {
    status: listFilter(EMAIL_MESSAGE_STATUSES),
    template: listFilter(EMAIL_TEMPLATE_KEYS),
  },
  table: analyticsKey('tenant_emails'),
})

/** The Suppressions list's URL contract: newest first, active ones unless the state says otherwise. */
export const suppressionsList = defineList({
  sorts: ['-created', 'created', 'address'],
  filters: { state: listFilter(['active', 'lifted']) },
  table: analyticsKey('suppressions'),
})

/**
 * One page of tracked email (`GET /platform/emails`), for the Emails page, a
 * user's Emails card and a tenant's Emails tab (which adds its `tenant`).
 * @param request - From `listRequest(emailsList, …)` or `listRequest(tenantEmailsList, …)` with `tenant`.
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function emailsListOptions(request: ListRequest) {
  return listQueryOptions<EmailMessageSummary>({
    key: emailKeys.all,
    path: '/platform/emails',
    request,
  })
}

/**
 * One page of suppressed addresses (`GET /platform/email-suppressions`).
 * @param request - From `listRequest(suppressionsList, …)`.
 * @returns Query options for `useListQuery`, `useQuery` or a route loader.
 */
export function suppressionsListOptions(request: ListRequest) {
  return listQueryOptions<EmailSuppression>({
    key: emailKeys.suppressionsAll,
    path: '/platform/email-suppressions',
    request,
  })
}

/** A 404 answers who is asking (or an unknown id), so a retry changes nothing. */
function retryUnlessDenied(failureCount: number, error: Error): boolean {
  return statusFrom(error) !== 404 && failureCount < 1
}

/**
 * One keyset page of tracked email, newest first, for the Emails page, a
 * user's Emails card and a tenant's Emails tab.
 * @param params - Filters and the cursor to page from.
 * @returns Query options for `useQuery` or a route loader.
 */
export function emailsQueryOptions(params: EmailSearchParams) {
  const sent = normaliseEmails(params)
  return queryOptions({
    queryKey: emailKeys.list(sent),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<EmailMessagePage>>('/platform/emails', { params: sent })
      ),
    placeholderData: keepPreviousData,
    retry: retryUnlessDenied,
  })
}

/** One message with its attempts, provider events, suppression and resend links. A 404 is an unknown or expired id. */
export function emailQueryOptions(id: string) {
  return queryOptions({
    queryKey: emailKeys.detail(id),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<EmailMessageDetail>>(`/platform/emails/${id}`)),
    retry: retryUnlessDenied,
  })
}

/**
 * The message re-rendered from its template, tokens masked. A 409
 * `template_unavailable` means the template is gone from the API, and asking
 * again changes nothing.
 */
export function emailPreviewQueryOptions(id: string) {
  return queryOptions({
    queryKey: emailKeys.preview(id),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<EmailPreview>>(`/platform/emails/${id}/preview`)),
    retry: (failureCount, error) => {
      const status = statusFrom(error)
      return status !== 404 && status !== 409 && failureCount < 1
    },
  })
}

/** Deliverability for one window. The previous window's figures stay up while the next loads. */
export function emailHealthQueryOptions(range: StatsRange) {
  return queryOptions({
    queryKey: emailKeys.health(range),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<EmailHealth>>('/platform/emails/health', {
          params: { range },
        })
      ),
    placeholderData: keepPreviousData,
    retry: retryUnlessDenied,
  })
}

/** One keyset page of suppressed addresses. */
export function emailSuppressionsQueryOptions(params: SuppressionSearchParams) {
  const sent = normaliseSuppressions(params)
  return queryOptions({
    queryKey: emailKeys.suppressions(sent),
    queryFn: async () =>
      unwrap(
        await apiClient.get<ApiSuccess<EmailSuppressionPage>>('/platform/email-suppressions', {
          params: sent,
        })
      ),
    placeholderData: keepPreviousData,
    retry: retryUnlessDenied,
  })
}

/**
 * Mark every email query stale: lists, the health report, each message's
 * detail and preview, and the suppressions. Only the queries on screen refetch.
 * @param queryClient - The app's query client.
 * @returns Resolves once the on-screen queries have refetched.
 */
export async function invalidateEmails(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    [emailKeys.all, emailKeys.message, emailKeys.suppressionsAll].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey })
    )
  )
}

/**
 * Resend a token email by re-running the action that sent it (admin; an
 * invitation, on any tenant, also needs a recent sign-in, so call it through
 * `useStepUp`). The reason also goes on the invitation's own audit entry. The
 * resend's message joins the timeline once enqueued. The email queries refresh
 * whether or not the resend was accepted; after an accepted one the platform
 * log refreshes too, and a resent invitation gets a fresh expiry, which the
 * tenant's pages and the invitee's user page show.
 */
export function useResendEmail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      unwrap(
        await apiClient.post<ApiSuccess<EmailResendResult>>(`/platform/emails/${id}/resend`, {
          reason,
        })
      ),
    // A refusal (the address was suppressed since the page loaded, say) leaves the cached message stale, so the email queries refresh either way.
    onSettled: () => invalidateEmails(queryClient),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
        queryClient.invalidateQueries({ queryKey: ['tenants'] }),
        queryClient.invalidateQueries({ queryKey: ['platform', 'user'] }),
      ])
    },
  })
}

/**
 * Lift an active suppression with an audited reason (admin), so mail to the
 * address is sent again. A 409 `already_lifted` means the cached row was stale,
 * so the email queries refresh either way.
 */
export function useLiftSuppression() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await apiClient.post(`/platform/email-suppressions/${id}/lift`, { reason })
    },
    onSettled: async () => {
      await Promise.all([
        invalidateEmails(queryClient),
        queryClient.invalidateQueries({ queryKey: auditKeys.platformAll }),
      ])
    },
  })
}
