import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { flagsPathFor, PLATFORM_FLAG_SCOPE, useFlagScope } from '@/observability/flags/flag-scope'

describe('apex flag scope', () => {
  it('is always the platform scope: staff are evaluated with no tenant', () => {
    expect(renderHook(() => useFlagScope()).result.current).toEqual({ kind: 'platform' })
    expect(PLATFORM_FLAG_SCOPE).toEqual({ kind: 'platform' })
  })

  it('reads the platform scope from /platform/me/flags', () => {
    expect(flagsPathFor(PLATFORM_FLAG_SCOPE)).toBe('/platform/me/flags')
  })

  it('names the customer app’s endpoints for the other scopes, slug encoded', () => {
    expect(flagsPathFor({ kind: 'none' })).toBe('/flags')
    expect(flagsPathFor({ kind: 'tenant', slug: 'acme' })).toBe('/tenants/acme/flags')
    expect(flagsPathFor({ kind: 'tenant', slug: 'a/b' })).toBe('/tenants/a%2Fb/flags')
  })
})
