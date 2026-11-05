import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { describe, expect, it } from 'vite-plus/test'
import { deletionRequestsListOptions } from '@/queries/deletion-request.queries'
import { listPage } from '@/tests/fixtures/list-page'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('deletionRequestsListOptions', () => {
  it('asks for the first page with total=1', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/platform/deletion-requests', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage([]), 'Deletion requests retrieved.')
      })
    )
    await new QueryClient().fetchQuery(deletionRequestsListOptions({}))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.get('total')).toBe('1')
    expect(seen[0]?.get('sort')).toBeNull()
  })
})
