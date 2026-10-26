/**
 * @file The Plans page's wording and the plan editor's form arithmetic: the
 * counts line, a change's line, an entitlement's value as text, the merge
 * after another staff member saved first, and where an API entitlement
 * error belongs.
 */
import { countOf } from '@/lib/plural'
import type { PlanEditForm } from '@/schemas/billing.schemas'
import type {
  BillingInterval,
  EntitlementCatalogEntry,
  EntitlementValue,
  PlanChangePreview,
  StaffPlan,
} from '@/types/billing.types'

/** Each interval as a price's row and the new-price select name it. */
export const INTERVAL_LABELS: Record<BillingInterval, string> = {
  month: 'Monthly',
  year: 'Yearly',
}

/**
 * An entitlement's value as staff read it: On or Off for a feature, the
 * number or No limit for a limit.
 * @param value - The value.
 */
export function entitlementText(value: EntitlementValue | undefined): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (value === null) return 'No limit'
  return value === undefined ? '—' : value.toLocaleString('en-IN')
}

/**
 * The tenants a plan serves, by the states express counts under it: Paid
 * serves trialing, active and past-due tenants; Free serves free ones.
 * @param plan - The plan.
 */
export function planCountsLine(plan: StaffPlan): string {
  const counts = plan.tenantCounts
  if (plan.key === 'free') return `${String(counts.free)} on Free`
  return `${String(counts.active)} paying · ${String(counts.trialing)} in trial · ${String(counts.past_due)} with a failed payment`
}

/**
 * The tenants an edit reaches, as the preview counts them, in a sentence's
 * subject: "4 tenants are on Free".
 * @param preview - The preview.
 * @param planName - The plan's name.
 */
export function tenantsOnPlan(preview: PlanChangePreview, planName: string): string {
  const { trialing, active, past_due: pastDue, free } = preview.affected
  const total = trialing + active + pastDue + free
  return `${countOf(total, 'tenants')} ${total === 1 ? 'is' : 'are'} on ${planName}`
}

/**
 * One change as the lower-limits dialog lists it: "Members: 3 → 2".
 * @param change - One of the preview's changes.
 * @param catalog - The entitlements this product has, for the label.
 */
export function changeLine(
  change: PlanChangePreview['changes'][number],
  catalog: readonly EntitlementCatalogEntry[]
): string {
  const label = catalog.find((entry) => entry.key === change.key)?.label ?? change.key
  return `${label}: ${entitlementText(change.from)} → ${entitlementText(change.to)}`
}

/**
 * The form's field names and their values, flat: `name`, `description`,
 * `limits.<key>`, `noLimit.<key>` and `features.<key>`.
 * @param form - The form's values.
 */
function flatFields(form: PlanEditForm): Map<string, unknown> {
  const fields = new Map<string, unknown>([
    ['name', form.name],
    ['description', form.description],
  ])
  for (const group of ['limits', 'noLimit', 'features'] as const) {
    for (const [key, value] of Object.entries(form[group])) fields.set(`${group}.${key}`, value)
  }
  return fields
}

/**
 * The fields to set after another staff member saved first: each field the
 * reader left as it was loaded takes the newly saved value, and each field
 * the reader changed keeps what they typed, so the next save neither loses
 * their edit nor sends back the other's. A limit's number and its No limit
 * box are one value: when the reader changed either half, both stay as they
 * are; otherwise both take the saved value.
 * @param current - The form's values now.
 * @param loaded - The values the form opened with.
 * @param fresh - The values just saved by the other staff member.
 * @returns The field names to set, with their new values.
 */
export function fieldsAfterConflict(
  current: PlanEditForm,
  loaded: PlanEditForm,
  fresh: PlanEditForm
): Array<[string, unknown]> {
  const was = flatFields(loaded)
  const now = flatFields(current)
  /** Whether the reader changed `name` from its loaded value. */
  const typed = (name: string) => !Object.is(now.get(name), was.get(name))
  const updates: Array<[string, unknown]> = []
  for (const [name, value] of flatFields(fresh)) {
    const key = /^(?:limits|noLimit)\.(.+)$/.exec(name)?.[1]
    const kept = key === undefined ? typed(name) : typed(`limits.${key}`) || typed(`noLimit.${key}`)
    if (!kept && !Object.is(now.get(name), value)) updates.push([name, value])
  }
  return updates
}

/**
 * Where each of express's entitlement messages belongs. Express flattens its
 * errors to the body's first key, so every entitlement's message arrives
 * under `entitlements`, starting with the entry's label ("Members: …"); it
 * goes on that entry's field, and any it can't place stays at form level.
 * @param messages - The messages under `entitlements`.
 * @param catalog - The entitlements this product has.
 */
export function entitlementErrorFields(
  messages: readonly string[],
  catalog: readonly EntitlementCatalogEntry[]
): { fields: Record<string, string[]>; unplaced: string[] } {
  const fields: Record<string, string[]> = {}
  const unplaced: string[] = []
  for (const message of messages) {
    const entry = catalog.find(({ label }) => message.startsWith(`${label}:`))
    if (entry === undefined) {
      unplaced.push(message)
      continue
    }
    const name = `${entry.kind === 'feature' ? 'features' : 'limits'}.${entry.key}`
    fields[name] = [...(fields[name] ?? []), message]
  }
  return { fields, unplaced }
}
