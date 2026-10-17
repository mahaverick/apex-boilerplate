import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { historyList, platformActivityList, tenantActivityList } from '@/queries/audit.queries'
import { emailsList, suppressionsList, tenantEmailsList } from '@/queries/email.queries'
import { flagsList, unregisteredFlagsList } from '@/queries/flag-inspector.queries'
import { onboardingTenantsList } from '@/queries/onboarding.queries'
import { tenantsList } from '@/queries/tenant-admin.queries'
import { invitationsList, membersList } from '@/queries/tenant.queries'
import { usersList } from '@/queries/user-admin.queries'

const FEATURES = 'src/components/features'

/** Each table's source and every list definition it renders (13 in all). */
const TABLES: { file: string; lists: { name: string; sorts: readonly string[] }[] }[] = [
  { file: 'tenants/tenants-table.tsx', lists: [{ name: 'tenantsList', ...tenantsList }] },
  { file: 'users/users-table.tsx', lists: [{ name: 'usersList', ...usersList }] },
  {
    file: 'emails/emails-table.tsx',
    lists: [
      { name: 'emailsList', ...emailsList },
      { name: 'tenantEmailsList', ...tenantEmailsList },
    ],
  },
  {
    file: 'suppressions/suppressions-table.tsx',
    lists: [{ name: 'suppressionsList', ...suppressionsList }],
  },
  {
    file: 'onboarding/onboarding-tenants-table.tsx',
    lists: [{ name: 'onboardingTenantsList', ...onboardingTenantsList }],
  },
  {
    file: 'activity/activity-table.tsx',
    lists: [
      { name: 'platformActivityList', ...platformActivityList },
      { name: 'tenantActivityList', ...tenantActivityList },
      { name: 'historyList', ...historyList },
    ],
  },
  { file: 'tenant/members-card.tsx', lists: [{ name: 'membersList', ...membersList }] },
  {
    file: 'tenant/pending-invitations.tsx',
    lists: [{ name: 'invitationsList', ...invitationsList }],
  },
  { file: 'flags/flag-registry-table.tsx', lists: [{ name: 'flagsList', ...flagsList }] },
  {
    file: 'flags/unregistered-flags-table.tsx',
    lists: [{ name: 'unregisteredFlagsList', ...unregisteredFlagsList }],
  },
]

/** The API sort keys a table's source gives its columns (`sorts: [...]`). */
function columnSortKeys(file: string): string[] {
  const source = readFileSync(resolve(process.cwd(), FEATURES, file), 'utf8')
  return [...source.matchAll(/\bsorts:\s*\[([^\]]*)\]/g)].flatMap((match) =>
    [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((key) => key[1] as string)
  )
}

describe('column sort keys', () => {
  it('covers all 13 list definitions', () => {
    expect(TABLES.flatMap((table) => table.lists)).toHaveLength(13)
  })

  it.each(TABLES)('$file sorts only by keys its lists whitelist', ({ file, lists }) => {
    const keys = columnSortKeys(file)
    for (const list of lists) {
      // A key outside the whitelist is `.catch`ed out of the URL, leaving a header that does nothing.
      expect(
        keys.filter((key) => !list.sorts.includes(key)),
        list.name
      ).toEqual([])
    }
  })

  it('finds the keys it checks, so a changed source shape cannot pass it empty', () => {
    expect(columnSortKeys('tenants/tenants-table.tsx')).toEqual(['name', 'created', '-created'])
    expect(columnSortKeys('tenant/members-card.tsx')).toEqual(['name', 'email', 'role'])
  })
})
