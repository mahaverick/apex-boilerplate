import { describe, expect, it } from 'vitest'
import { createPlatformTenantSchema, updateTenantSchema } from '@/schemas/tenant.schemas'

/** A create body that passes, so a case changes one field. */
const CREATE = { name: 'Acme', slug: 'acme', ownerEmail: 'owner@acme.test' }

describe('tenant link fields', () => {
  it.each([
    ['website javascript:', { website: 'javascript:alert(document.domain)' }],
    ['logo javascript:', { logo: 'javascript:alert(1)' }],
    ['logo data:', { logo: 'data:text/html,<script>alert(1)</script>' }],
    ['website not a URL', { website: 'call us maybe' }],
    ['website ftp:', { website: 'ftp://files.acme.test' }],
    ['website with credentials', { website: 'https://user:pw@acme.test/' }],
    ['logo with a user name', { logo: 'https://user@cdn.acme.test/l.png' }],
    ['website with a backslash', { website: 'https://acme.test\\@evil.test/' }],
    ['logo with a backslash in the path', { logo: 'https://cdn.acme.test/a\\b.png' }],
  ])('PATCH refuses %s', (_label, body) => {
    const result = updateTenantSchema.safeParse(body)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/must be an http or https URL\.$/)
  })

  it('PATCH takes an http or https URL, trimmed, and a cleared field as null', () => {
    expect(
      updateTenantSchema.parse({
        website: ' https://acme.test/about ',
        logo: 'http://cdn.acme.test/l.png',
      })
    ).toEqual({ website: 'https://acme.test/about', logo: 'http://cdn.acme.test/l.png' })
    expect(updateTenantSchema.parse({ website: '', logo: '' })).toEqual({
      website: null,
      logo: null,
    })
  })

  it('PATCH takes an @ in the path or query, which names no user', () => {
    expect(
      updateTenantSchema.parse({ website: 'https://acme.test/@team?by=a@acme.test' }).website
    ).toBe('https://acme.test/@team?by=a@acme.test')
  })

  it('PATCH says only that a link field holds characters it refuses, not that it is no URL', () => {
    const result = updateTenantSchema.safeParse({ website: 'https://acme.test/\u{200B}' })
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Website contains characters that are not allowed',
    ])
  })

  it('create refuses a javascript: website and takes an https one or none', () => {
    expect(
      createPlatformTenantSchema.safeParse({ ...CREATE, website: 'javascript:alert(1)' }).success
    ).toBe(false)
    expect(
      createPlatformTenantSchema.parse({ ...CREATE, website: 'https://acme.test' }).website
    ).toBe('https://acme.test')
    expect(createPlatformTenantSchema.parse({ ...CREATE, website: '' }).website).toBeUndefined()
    expect(
      createPlatformTenantSchema.safeParse({ ...CREATE, website: 'https://user:pw@acme.test' })
        .error?.issues[0]?.message
    ).toBe('Website must be an http or https URL.')
  })
})
