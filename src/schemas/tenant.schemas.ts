/**
 * @file Tenant form schemas, mirroring express's tenant.validators.ts field
 * for field so a form rejects locally what the API would reject. Each ceiling
 * is its column's width: over-long input reaching the database is a Postgres
 * 22001 (a 500), not a 400. Ported from react-boilerplate's
 * tenant.schemas.ts; not sibling-synced, since the two apps' tenant forms differ.
 */
import { z } from 'zod'
import { emailSchema } from '@/schemas/auth.schemas'
import { normalizeMultilineText, notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

const MAX_TENANT_NAME_LENGTH = 255
const MAX_TENANT_DESCRIPTION_LENGTH = 1000
const MAX_TENANT_WEBSITE_LENGTH = 255
const MIN_SLUG_LENGTH = 3
const MAX_SLUG_LENGTH = 100

/**
 * Slugs no tenant may register, mirroring the API's `RESERVED_SLUGS`
 * (tenant.constants.ts). Each collides with a plausible route segment, would
 * mislead as an organization's identifier, or masquerades as another value.
 */
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'app',
  'auth',
  'login',
  'logout',
  'register',
  'signin',
  'signup',
  'settings',
  'billing',
  'support',
  'help',
  'docs',
  'status',
  'health',
  'static',
  'assets',
  'public',
  'cdn',
  'www',
  'mail',
  'ftp',
  'blog',
  'about',
  'contact',
  'terms',
  'privacy',
  'dashboard',
  'root',
  'system',
  'null',
  'undefined',
  'true',
  'false',
  'new',
  'edit',
  'delete',
  'create',
  'update',
  'tenants',
  'tenant',
  'users',
  'user',
  'members',
  'owner',
  'me',
  'test',
  'staging',
  'dev',
  'localhost',
  'platform',
] as const

/** A Set, because the tuple's `.includes` rejects a plain `string` argument. */
const RESERVED = new Set<string>(RESERVED_SLUGS)

/**
 * A tenant's URL-safe identifier. Trimmed, but mixed case is rejected rather
 * than lowercased: the slug is a routing identifier (`/tenants/:slug`), and
 * rewriting "MyOrg" to "myorg" would register a string the user did not type.
 */
export const slugSchema = z
  .string()
  .trim()
  .min(MIN_SLUG_LENGTH, `Slug must be at least ${MIN_SLUG_LENGTH} characters.`)
  .max(MAX_SLUG_LENGTH, `Slug must be at most ${MAX_SLUG_LENGTH} characters.`)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Slug must be lowercase letters, numbers and hyphens, and cannot start or end with a hyphen.'
  )
  .refine((slug) => !RESERVED.has(slug), 'This slug is reserved and cannot be used.')

/** Which of the API's `safeText` checks a field gets. Absent means none. */
type SafeTextMode = 'single-line' | 'multiline'

/**
 * A trimmed string capped at `max`. With `safe`, it also refuses what the
 * API's `safeText` refuses, after turning `\r\n` into `\n` on a multiline field.
 */
function boundedText(max: number, label: string, safe?: SafeTextMode) {
  const multiline = safe === 'multiline'
  const field = multiline ? z.string().overwrite(normalizeMultilineText) : z.string()
  const bounded = field.trim().max(max, `${label} must be at most ${max} characters.`)
  return safe ? bounded.refine(safeText({ multiline }), notAllowedMessage(label)) : bounded
}

/**
 * An optional text field on a create body, where blank means "not given": the
 * API's `.min(1)` rejects `''`, which an untouched input submits, so `''`
 * becomes `undefined` and drops out of the payload.
 */
function optionalText(max: number, label: string, safe?: SafeTextMode) {
  return boundedText(max, label, safe)
    .transform((value) => (value === '' ? undefined : value))
    .optional()
}

/** A tenant name: required, single-line safe text. */
const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(MAX_TENANT_NAME_LENGTH, `Name must be at most ${MAX_TENANT_NAME_LENGTH} characters.`)
  .refine(safeText(), notAllowedMessage('Name'))

/**
 * `POST /platform/tenants`. The tenant starts with no members; `ownerEmail`
 * receives an owner invitation through the usual invitation flow.
 */
export const createPlatformTenantSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  ownerEmail: emailSchema,
  description: optionalText(MAX_TENANT_DESCRIPTION_LENGTH, 'Description', 'multiline'),
  website: optionalText(MAX_TENANT_WEBSITE_LENGTH, 'Website', 'single-line'),
})

export type CreatePlatformTenantInput = z.infer<typeof createPlatformTenantSchema>
