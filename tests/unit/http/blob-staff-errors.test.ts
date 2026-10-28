/**
 * @file Apex's staff error helpers on blob requests. A request made with
 * `responseType: 'blob'` gets its error body as a Blob; the copied interceptor
 * decodes a JSON body, so the helpers read what a JSON request would carry.
 */
import axios from 'axios'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests } from '@/http/session'
import { codeFrom } from '@/lib/api-error'
import { downloadFile } from '@/lib/download-file'
import { isRoleDenied } from '@/lib/role-denied'
import { staffMessageFrom } from '@/lib/staff-message'
import { isReauthRequired } from '@/lib/step-up'
import { useAuthStore } from '@/states/auth.store'
import { fail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { REAUTH_REQUIRED } from '@/types/api.types'

const PATH = '/api/v1/platform/billing/blob-probe'

/** A fresh axios client with the real interceptors installed. */
function makeClient() {
  const client = axios.create({ baseURL: '/api/v1', withCredentials: true })
  installInterceptors(client)
  return client
}

/** The rejection of a blob request that the server refused. */
async function refused() {
  try {
    await makeClient().get('/platform/billing/blob-probe', { responseType: 'blob' })
  } catch (error) {
    return error
  }
  throw new Error('The request was not refused.')
}

describe('staff error helpers on blob requests', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    useAuthStore.getState().login('token', testUser)
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('reads a blob 401 REAUTH_REQUIRED as a step-up request', async () => {
    server.use(http.get(PATH, () => fail('Confirm it is you.', 401, REAUTH_REQUIRED)))
    expect(isReauthRequired(await refused())).toBe(true)
  })

  it('reads a blob 404 tax_document_not_found as a role refusal with its code', async () => {
    server.use(http.get(PATH, () => fail('No such document.', 404, 'tax_document_not_found')))
    const error = await refused()
    expect(codeFrom(error)).toBe('tax_document_not_found')
    expect(isRoleDenied(error)).toBe(true)
  })

  it("gives a blob 409's message through staffMessageFrom", async () => {
    server.use(http.get(PATH, () => fail('The document is not ready yet.', 409, 'conflict')))
    expect(staffMessageFrom(await refused())).toBe('The document is not ready yet.')
  })
})

describe('downloadFile on the staff export', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.getState().login('token', testUser)
    // jsdom ships neither method, so give spyOn something to wrap; restoreAllMocks puts the originals back.
    for (const name of ['createObjectURL', 'revokeObjectURL']) {
      if (!(name in URL)) {
        Object.defineProperty(URL, name, { value: () => '', configurable: true, writable: true })
      }
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:probe')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('resolves the filename the API names', async () => {
    let period: string | null = null
    server.use(
      http.get('/api/v1/platform/billing/tax-export', ({ request }) => {
        period = new URL(request.url).searchParams.get('period')
        return new HttpResponse('zip', {
          headers: {
            'content-type': 'application/zip',
            'content-disposition': 'attachment; filename="gstr1-2026-09.zip"',
          },
        })
      })
    )
    await expect(
      downloadFile('/platform/billing/tax-export', 'export.zip', { params: { period: '2026-09' } })
    ).resolves.toEqual({ filename: 'gstr1-2026-09.zip' })
    expect(period).toBe('2026-09')
  })
})
