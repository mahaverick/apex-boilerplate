import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AUDIT_ACTIONS } from '@/constants/audit-action-names'
import {
  auditKeys,
  historyList,
  platformActivityList,
  platformAuditListOptions,
  tenantActivityList,
  tenantAuditListOptions,
} from '@/queries/audit.queries'
import {
  emailKeys,
  emailsList,
  emailsListOptions,
  suppressionsList,
  suppressionsListOptions,
  tenantEmailsList,
} from '@/queries/email.queries'
import {
  flagInspectorKeys,
  flagsList,
  flagsListOptions,
  flagsMetaQueryOptions,
  unregisteredFlagsList,
  unregisteredFlagsListOptions,
} from '@/queries/flag-inspector.queries'
import {
  onboardingKeys,
  onboardingTenantsList,
  onboardingTenantsListOptions,
} from '@/queries/onboarding.queries'
import { tenantAdminKeys, tenantsList, tenantsListOptions } from '@/queries/tenant-admin.queries'
import {
  invitationsList,
  invitationsListOptions,
  membersList,
  membersListOptions,
  ownersQueryOptions,
  tenantKeys,
} from '@/queries/tenant.queries'
import { userAdminKeys, usersList, usersListOptions } from '@/queries/user-admin.queries'
import { listRequest, listValues } from '@/schemas/list-request.schemas'
import type { ListContract, ListUrlSearch } from '@/schemas/list.schemas'
import { listPage } from '@/tests/fixtures/list-page'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const ID = '00000000-0000-4000-8000-000000000001'

/**
 * A list's API request from the URL search a reader would hold.
 * @param definition - The list.
 * @param search - The route's search, unvalidated.
 */
function requestFor(
  definition: ListContract & { schema: z.ZodType<ListUrlSearch, unknown> },
  search: Record<string, unknown>
) {
  return listRequest(definition, listValues(definition, definition.schema.parse(search)))
}

describe('the apex list definitions', () => {
  it('builds the tenants, users and emails requests in the API’s names', () => {
    expect(
      requestFor(tenantsList, { search: 'acme', state: 'archived,active', sort: '-created' })
    ).toEqual({
      search: 'acme',
      state: 'active,archived',
      sort: '-created',
    })
    expect(
      requestFor(usersList, {
        status: 'deleted',
        signedIn: false,
        staff: true,
        sort: '-lastSignIn',
      })
    ).toEqual({
      status: 'deleted',
      signedIn: false,
      staff: true,
      sort: '-lastSignIn',
    })
    expect(
      requestFor(emailsList, {
        user: ID,
        tenant: ID,
        from: '2026-10-01',
        to: '2026-10-02',
        status: 'sent,bounced',
        template: 'password_reset',
        sort: 'created',
      })
    ).toEqual({
      user: ID,
      tenant: ID,
      from: '2026-10-01',
      to: '2026-10-02',
      status: 'bounced,sent',
      template: 'password_reset',
      sort: 'created',
    })
    expect(
      requestFor(tenantEmailsList, { status: 'failed', template: 'account_setup', sort: 'created' })
    ).toEqual({
      status: 'failed',
      template: 'account_setup',
      sort: 'created',
    })
    expect(requestFor(suppressionsList, { state: 'lifted,active', sort: 'address' })).toEqual({
      state: 'active,lifted',
      sort: 'address',
    })
  })

  it('leaves each default out of the request', () => {
    expect(requestFor(tenantsList, {})).toEqual({})
    expect(requestFor(emailsList, { sort: '-created' })).toEqual({})
    expect(requestFor(onboardingTenantsList, { sort: '-order' })).toEqual({})
  })

  it('builds the onboarding request, keeping the tab’s own params off the list request', () => {
    expect(
      requestFor(onboardingTenantsList, { sort: 'name', state: 'complete', range: '7d' })
    ).toEqual({ sort: 'name' })
    expect(onboardingTenantsList.schema.parse({ state: 'complete', range: '7d' })).toMatchObject({
      state: 'complete',
      range: '7d',
    })
    expect(onboardingTenantsList.schema.parse({ state: 'nope', range: 'x' })).toMatchObject({
      state: 'stuck',
      range: '30d',
    })
  })

  it('keeps the members and invitations lists apart on one route', () => {
    const search = membersList.schema.parse({
      role: 'owner,admin',
      sort: '-joined',
      invitationsRole: 'admin',
      invitationsSort: 'email',
      invitationsSearch: 'a@b',
    })
    expect(requestFor(membersList, search)).toEqual({ role: 'admin,owner', sort: '-joined' })
    expect(requestFor(invitationsList, search)).toEqual({
      role: 'admin',
      sort: 'email',
      search: 'a@b',
    })
  })

  it('keeps the flags and unregistered lists apart, and the flags route’s own params', () => {
    const search = flagsList.schema.parse({
      kind: 'boolean',
      state: 'missing,active',
      userId: ID,
      app: 'apex',
      unregisteredSearch: 'beta',
      unregisteredSort: 'key',
    })
    expect(requestFor(flagsList, search)).toEqual({ kind: 'boolean', state: 'active,missing' })
    expect(requestFor(unregisteredFlagsList, search)).toEqual({ search: 'beta' })
    expect(search).toMatchObject({ userId: ID, app: 'apex' })
  })

  it('builds the activity, history and tenant activity requests', () => {
    expect(
      requestFor(platformActivityList, {
        tenant: ID,
        actor: ID,
        action: 'user.created,tenant.created',
        access: 'platform,member',
        sort: 'occurred',
      })
    ).toEqual({
      tenant: ID,
      actor: ID,
      action: 'tenant.created,user.created',
      access: 'member,platform',
      sort: 'occurred',
    })
    expect(
      requestFor(historyList, { historyAction: 'user.updated', historySort: 'occurred' })
    ).toEqual({ action: 'user.updated', sort: 'occurred' })
    expect(requestFor(tenantActivityList, { action: 'member.left', sort: 'occurred' })).toEqual({
      action: 'member.left',
      sort: 'occurred',
    })
  })

  it('offers only written audit actions, yet keeps and sends a retired one from an old link', () => {
    const retired = [
      'user.timeline_viewed',
      'tenant.timeline_viewed',
      'user.errors_viewed',
      'tenant.errors_viewed',
      'auth.reauthenticated',
      'user.password_setup_sent',
    ]
    for (const name of retired) expect(AUDIT_ACTIONS).not.toContain(name)
    expect(AUDIT_ACTIONS).toHaveLength(35)
    expect(requestFor(platformActivityList, { action: 'auth.reauthenticated' })).toEqual({
      action: 'auth.reauthenticated',
    })
    expect(requestFor(platformActivityList, { action: 'user.errors_viewed,user.created' })).toEqual(
      {
        action: 'user.created,user.errors_viewed',
      }
    )
    expect(requestFor(tenantActivityList, { action: 'tenant.timeline_viewed' })).toEqual({
      action: 'tenant.timeline_viewed',
    })
    expect(requestFor(historyList, { historyAction: 'user.timeline_viewed' })).toEqual({
      action: 'user.timeline_viewed',
    })
    expect(requestFor(tenantActivityList, { action: 'made.up' })).toEqual({})
  })
})

describe('the apex list options', () => {
  const request = { search: 'x' }

  it('keys each list under its resource’s prefix, apart from every other list', () => {
    const keys = [
      [tenantsListOptions(request), tenantAdminKeys.all],
      [usersListOptions(request), userAdminKeys.all],
      [emailsListOptions(request), emailKeys.all],
      [suppressionsListOptions(request), emailKeys.suppressionsAll],
      [onboardingTenantsListOptions('stuck', request), [...onboardingKeys.all, 'tenants']],
      [membersListOptions('acme', ID, request), tenantKeys.members('acme', ID)],
      [invitationsListOptions('acme', ID, request), tenantKeys.invitations('acme', ID)],
      [flagsListOptions(request), [...flagInspectorKeys.all, 'registry']],
      [unregisteredFlagsListOptions(request), [...flagInspectorKeys.all, 'unregistered']],
      [platformAuditListOptions(request), auditKeys.platformAll],
      [tenantAuditListOptions('acme', ID, request), auditKeys.tenantAll('acme')],
    ] as const
    for (const [options, prefix] of keys) {
      expect(options.queryKey.slice(0, prefix.length)).toEqual(prefix)
      expect(options.queryKey).toContain('list')
    }
    expect(new Set(keys.map(([options]) => JSON.stringify(options.queryKey))).size).toBe(
      keys.length
    )
  })

  it('carries the onboarding state in the key and keeps two tabs apart', () => {
    expect(onboardingTenantsListOptions('stuck', {}).queryKey).not.toEqual(
      onboardingTenantsListOptions('complete', {}).queryKey
    )
  })

  it('keys the registry and the unregistered list apart on the same default request', () => {
    expect(flagsListOptions({}).queryKey).not.toEqual(unregisteredFlagsListOptions({}).queryKey)
  })

  it('keeps the owners read and the meta read under their own keys', () => {
    expect(ownersQueryOptions('acme', ID).queryKey).toEqual([
      ...tenantKeys.members('acme', ID),
      'owners',
    ])
    expect(flagsMetaQueryOptions().queryKey).toEqual([...flagInspectorKeys.all, 'meta'])
  })
})

describe('the apex list endpoints', () => {
  it('asks each list’s endpoint for a first page with its total, in the API’s params', async () => {
    const seen: string[] = []
    server.use(
      http.get(/\/api\/v1\/(platform|tenants)\/.*/, ({ request }) => {
        const url = new URL(request.url)
        seen.push(`${url.pathname.replace('/api/v1', '')}?${url.searchParams.toString()}`)
        return ok(listPage([]), 'Retrieved.')
      })
    )
    const client = new QueryClient()
    await client.fetchQuery(tenantsListOptions({ state: 'archived' }))
    await client.fetchQuery(usersListOptions({ staff: true }))
    await client.fetchQuery(emailsListOptions({ tenant: ID }))
    await client.fetchQuery(suppressionsListOptions({ sort: 'address' }))
    await client.fetchQuery(onboardingTenantsListOptions('complete', { sort: 'name' }))
    await client.fetchQuery(membersListOptions('acme', ID, { role: 'owner' }))
    await client.fetchQuery(invitationsListOptions('acme', ID, { sort: 'email' }))
    await client.fetchQuery(flagsListOptions({ kind: 'boolean' }))
    await client.fetchQuery(unregisteredFlagsListOptions({}))
    await client.fetchQuery(platformAuditListOptions({ target: ID }))
    await client.fetchQuery(tenantAuditListOptions('acme', ID, { action: 'member.left' }))
    await client.fetchQuery(ownersQueryOptions('acme', ID))

    expect(seen).toEqual([
      '/platform/tenants?state=archived&total=1',
      '/platform/users?staff=true&total=1',
      `/platform/emails?tenant=${ID}&total=1`,
      '/platform/email-suppressions?sort=address&total=1',
      '/platform/onboarding/tenants?sort=name&state=complete&total=1',
      '/tenants/acme/members?role=owner&total=1',
      '/tenants/acme/invitations?sort=email&total=1',
      '/platform/flags?kind=boolean&total=1',
      '/platform/flags/unregistered?total=1',
      `/platform/audit-log?target=${ID}&total=1`,
      '/tenants/acme/audit-log?action=member.left&total=1',
      '/tenants/acme/members?role=owner&limit=100',
    ])
  })

  it('reads the flags meta from its own endpoint', async () => {
    const paths: string[] = []
    server.use(
      http.get(/\/api\/v1\/platform\/.*/, ({ request }) => {
        paths.push(new URL(request.url).pathname)
        return ok(
          { traits: [], snapshot: { enabled: true, fetchedAt: null, stale: false } },
          'Retrieved.'
        )
      })
    )
    const client = new QueryClient()
    await expect(client.fetchQuery(flagsMetaQueryOptions())).resolves.toMatchObject({ traits: [] })
    expect(paths).toEqual(['/api/v1/platform/flags/meta'])
  })
})

describe('the apex list total opt-out', () => {
  it('keys a read without its total apart and leaves total=1 off the request', async () => {
    const seen: string[] = []
    server.use(
      http.get(/\/api\/v1\/platform\/.*/, ({ request }) => {
        seen.push(new URL(request.url).search)
        return ok(listPage([]), 'Retrieved.')
      })
    )
    const client = new QueryClient()
    const pairs = [
      [tenantsListOptions({ limit: 50 }), tenantsListOptions({ limit: 50 }, { total: false })],
      [usersListOptions({ limit: 50 }), usersListOptions({ limit: 50 }, { total: false })],
      [flagsListOptions({ limit: 50 }), flagsListOptions({ limit: 50 }, { total: false })],
    ] as const
    for (const [withTotal, without] of pairs) {
      expect(without.queryKey).not.toEqual(withTotal.queryKey)
      expect(without.queryKey.at(-1)).toBe('no-total')
    }
    await client.fetchQuery(tenantsListOptions({ limit: 50 }, { total: false }))
    await client.fetchQuery(usersListOptions({ limit: 50 }, { total: false }))
    await client.fetchQuery(flagsListOptions({ limit: 50 }, { total: false }))
    expect(seen).toEqual(['?limit=50', '?limit=50', '?limit=50'])
  })

  it('reads the registry for pickers without a total', () => {
    expect(flagsListOptions({ limit: 100 }, { total: false }).queryKey).toEqual([
      ...flagInspectorKeys.all,
      'registry',
      'list',
      { limit: 100 },
      'no-total',
    ])
  })
})

describe('tenantAuditListOptions keys', () => {
  it('appends the tenant id after the slug prefix, and nothing without one', () => {
    expect(tenantAuditListOptions('acme', ID, { action: 'member.left' }).queryKey).toEqual([
      ...auditKeys.tenantAll('acme'),
      { tenantId: ID },
      'list',
      { action: 'member.left' },
    ])
    expect(tenantAuditListOptions('acme', undefined, {}).queryKey).toEqual([
      ...auditKeys.tenantAll('acme'),
      'list',
      {},
    ])
  })
})
