/**
 * @file Tenant form schemas, mirroring express's tenant.validators.ts field
 * for field so a form rejects locally what the API would reject. Each ceiling
 * is its column's width: over-long input reaching the database is a Postgres
 * 22001 (a 500), not a 400. Not sibling-synced: the two apps' tenant forms differ.
 */
import { z } from 'zod'
import { MEMBERSHIP_ROLES } from '@/constants/roles'
import { emailSchema } from '@/schemas/auth.schemas'
import { reasonSchema } from '@/schemas/reason.schemas'
import { normalizeMultilineText, notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

const MAX_TENANT_NAME_LENGTH = 255
const MAX_TENANT_DESCRIPTION_LENGTH = 1000
const MAX_TENANT_LOGO_LENGTH = 255
const MAX_TENANT_WEBSITE_LENGTH = 255
const MIN_SLUG_LENGTH = 3
const MAX_SLUG_LENGTH = 100

/**
 * Slugs no tenant may register, mirroring the API's `RESERVED_SLUGS`
 * (tenant.constants.ts). Each collides with a plausible route segment, would
 * mislead as an organization's identifier, or masquerades as another value.
 */
const RESERVED_SLUGS = [
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
 * than lowercased: the slug names the tenant in the API's tenant routes and
 * the customer app's URLs, and rewriting "MyOrg" to "myorg" would register a
 * string the user did not type.
 */
const slugSchema = z
  .string()
  .trim()
  .min(MIN_SLUG_LENGTH, `Slug must be at least ${MIN_SLUG_LENGTH} characters.`)
  .max(MAX_SLUG_LENGTH, `Slug must be at most ${MAX_SLUG_LENGTH} characters.`)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Slug must be lowercase letters, numbers and hyphens, and cannot start or end with a hyphen.'
  )
  .refine((slug) => !RESERVED.has(slug), 'This slug is reserved and cannot be used.')

/**
 * Which of the API's checks a field gets: `safeText` on one line or several,
 * or `url`, a single-line `safeText` field that must also be an http or https
 * URL. Absent means none.
 */
type SafeTextMode = 'single-line' | 'multiline' | 'url'

/** An absolute http or https URL, as the API's `z.url({ protocol: /^https?$/ })` takes it. */
const HTTP_URL = z.url({ protocol: /^https?$/ })

/**
 * Whether `value` is free of what the API refuses before its URL check: a
 * backslash anywhere, or credentials (`user:pw@`) in a parsable URL, either of
 * which can make one host read as another. An `@` in the path or query is fine.
 * @param value - The trimmed candidate.
 * @returns True when neither is present.
 */
function hasNoUserinfoOrBackslash(value: string): boolean {
  if (value.includes('\\')) return false
  // `new URL` in a try, not `URL.canParse`, which Safari 16 lacks.
  try {
    const { username, password } = new URL(value)
    return username === '' && password === ''
  } catch {
    return true
  }
}

/**
 * The API's URL check, which it pipes so that it runs only once every earlier
 * check passed. A blank passes, for the caller to read as "not given" or
 * "clear it".
 */
function httpUrlCheck(message: string) {
  return z.string().refine((value) => value === '' || HTTP_URL.safeParse(value).success, message)
}

/**
 * A trimmed string capped at `max`. With `safe`, it also refuses what the
 * API's `safeText` refuses, after turning `\r\n` into `\n` on a multiline field;
 * with `url`, anything but a blank or an http or https URL as well.
 */
function boundedText(max: number, label: string, safe?: SafeTextMode) {
  const multiline = safe === 'multiline'
  const field = multiline ? z.string().overwrite(normalizeMultilineText) : z.string()
  const bounded = field.trim().max(max, `${label} must be at most ${max} characters.`)
  if (!safe) return bounded
  const safeField = bounded.refine(safeText({ multiline }), notAllowedMessage(label))
  if (safe !== 'url') return safeField
  const notHttpUrl = `${label} must be an http or https URL.`
  return safeField.refine(hasNoUserinfoOrBackslash, notHttpUrl).pipe(httpUrlCheck(notHttpUrl))
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

/**
 * The same field on a PATCH body, where the API takes three states: omitted
 * leaves the column alone, `null` clears it, a string sets it. A cleared input
 * sends `null`, since `undefined` would keep the old value.
 */
function clearableText(max: number, label: string, safe?: SafeTextMode) {
  return boundedText(max, label, safe)
    .transform((value) => (value === '' ? null : value))
    .nullable()
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
  website: optionalText(MAX_TENANT_WEBSITE_LENGTH, 'Website', 'url'),
})

export type CreatePlatformTenantInput = z.infer<typeof createPlatformTenantSchema>

/**
 * `PATCH /tenants/:slug`. No `slug`, as on the server: it is the tenant's URL
 * identity. Blank clears a column (`null`); an omitted field is left alone.
 */
export const updateTenantSchema = z.object({
  name: nameSchema.optional(),
  description: clearableText(MAX_TENANT_DESCRIPTION_LENGTH, 'Description', 'multiline'),
  logo: clearableText(MAX_TENANT_LOGO_LENGTH, 'Logo', 'url'),
  website: clearableText(MAX_TENANT_WEBSITE_LENGTH, 'Website', 'url'),
})

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>

/** `POST /tenants/:slug/invitations`. Which roles may be offered is `canActorGrantRole`'s job. */
export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(MEMBERSHIP_ROLES),
})

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

/** `POST /platform/tenants/:id/owner-invitation`: audited with its reason. */
export const ownerInvitationSchema = z.object({ email: emailSchema, reason: reasonSchema })
