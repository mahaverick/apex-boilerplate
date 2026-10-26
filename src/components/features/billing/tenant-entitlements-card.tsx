import { ToneBadge } from '@/components/features/tone-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { EntitlementCatalogEntry, StaffTenantBilling } from '@/types/billing.types'

/** One entitlement row: its label, what the tenant has, and whether a grant set it. */
interface EntitlementRow {
  key: string
  label: string
  value: string
  badge: 'Near limit' | 'At limit' | null
  source: 'plan' | 'grant' | undefined
}

/**
 * The rows in catalog order, then any key the catalog lacks under its raw
 * key, so a key added in express after this build still shows.
 * @param billing - The tenant's billing.
 * @param catalog - The catalog from the staff plans, or none when they did not load.
 */
function rowsOf(
  billing: StaffTenantBilling,
  catalog: readonly EntitlementCatalogEntry[]
): EntitlementRow[] {
  const { features, limits } = billing.entitlements
  const labels = new Map(catalog.map((entry) => [entry.key, entry.label]))
  const keys = [
    ...catalog.map((entry) => entry.key),
    ...[...Object.keys(limits), ...Object.keys(features)].filter((key) => !labels.has(key)),
  ]
  return [...new Set(keys)].flatMap((key): EntitlementRow[] => {
    const label = labels.get(key) ?? key
    const source = billing.sources[key]
    const usage = limits[key]
    if (usage !== undefined) {
      const noun = label.toLowerCase()
      const { used, limit } = usage
      return [
        {
          key,
          label,
          value: limit === null ? `${used} ${noun} · No limit` : `${used} of ${limit} ${noun}`,
          badge:
            limit !== null && used >= limit ? 'At limit' : usage.approaching ? 'Near limit' : null,
          source,
        },
      ]
    }
    const on = features[key]
    if (on === undefined) return []
    return [{ key, label, value: on ? 'On' : 'Off', badge: null, source }]
  })
}

/**
 * What the tenant may use now: each limit with its use, each feature on or
 * off, and whether the value is the plan's or a grant's. Labels come from the
 * staff plans' catalog; without it each row shows its registry key.
 */
export function TenantEntitlementsCard({
  billing,
  catalog,
}: {
  billing: StaffTenantBilling
  catalog: readonly EntitlementCatalogEntry[]
}) {
  const rows = rowsOf(billing, catalog)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Usage and access</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">This plan sets no limits or features.</p>
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            {rows.map((row) => (
              <div key={row.key} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {row.value}
                  {row.badge !== null && <ToneBadge tone="warning">{row.badge}</ToneBadge>}
                  {row.source === 'grant' ? (
                    <ToneBadge tone="neutral">Grant</ToneBadge>
                  ) : row.source === 'plan' ? (
                    <ToneBadge tone="muted">Plan</ToneBadge>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
