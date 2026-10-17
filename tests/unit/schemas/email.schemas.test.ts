import { describe, expect, it } from 'vitest'
import { emailsSearchSchema } from '@/queries/email.queries'
import { TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'

describe('emailsSearchSchema', () => {
  it('keeps every well-formed filter', () => {
    const search = {
      search: 'cleo',
      status: 'bounced',
      template: 'password_reset',
      user: USER_ID_2,
      tenant: TENANT_ID,
      from: '2026-09-01',
      to: '2026-09-30',
      cursor: 'c1',
      direction: 'prev',
    }
    expect(emailsSearchSchema.parse(search)).toEqual(search)
  })

  it('drops each malformed filter on its own, keeping the rest', () => {
    expect(
      emailsSearchSchema.parse({
        search: 2026,
        status: 'lost',
        template: 'welcome',
        user: 'not-a-uuid',
        tenant: 42,
        from: '2026-02-30',
        to: '30/09/2026',
        cursor: 7,
        direction: 'sideways',
      })
    ).toEqual({ search: '2026' })
  })

  it('drops an inverted day range, which the API answers with a 400, and keeps the rest', () => {
    const parsed = emailsSearchSchema.parse({
      from: '2026-09-30',
      to: '2026-09-01',
      status: 'delivered',
    })
    expect(parsed.from).toBeUndefined()
    expect(parsed.to).toBeUndefined()
    expect(parsed.status).toBe('delivered')
  })

  it.each([
    ['one day', { from: '2026-09-10', to: '2026-09-10' }],
    ['a range', { from: '2026-09-01', to: '2026-09-30' }],
    ['only from', { from: '2026-09-30' }],
    ['only to', { to: '2026-09-01' }],
  ])('keeps %s', (_name, range) => {
    expect(emailsSearchSchema.parse(range)).toEqual(range)
  })
})
