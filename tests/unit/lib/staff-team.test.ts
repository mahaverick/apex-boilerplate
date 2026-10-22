import { describe, expect, it } from 'vite-plus/test'
import { teamName, tenantLabel } from '@/lib/staff-team'

const PLATFORM = { name: 'Platform', slug: 'platform' }
const ACME = { name: 'Acme', slug: 'acme' }

describe('tenantLabel', () => {
  it('labels the platform tenant as the staff team, not by its internal name', () => {
    expect(tenantLabel(PLATFORM)).toBe('Staff team')
  })

  it('labels a customer tenant by its name', () => {
    expect(tenantLabel(ACME)).toBe('Acme')
  })
})

describe('teamName', () => {
  it('names the platform tenant as the staff team inside a sentence', () => {
    expect(teamName(PLATFORM)).toBe('the staff team')
  })

  it('names a customer tenant by its name', () => {
    expect(teamName(ACME)).toBe('Acme')
  })
})
