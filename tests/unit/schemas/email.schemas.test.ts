import { describe, expect, it } from 'vitest'
import { emailsSearchSchema } from '@/schemas/email.schemas'
import { TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'

describe('emailsSearchSchema', () => {
  it('keeps every well-formed filter', () => {
    const search = {
      q: 'cleo',
      status: 'bounced',
      template: 'password_reset',
      userId: USER_ID_2,
      tenantId: TENANT_ID,
      from: '2026-09-01',
      to: '2026-09-30',
      cursor: 'c1',
      dir: 'prev',
    }
    expect(emailsSearchSchema.parse(search)).toEqual(search)
  })

  it('drops each malformed filter on its own, keeping the rest', () => {
    expect(
      emailsSearchSchema.parse({
        q: 2026,
        status: 'lost',
        template: 'welcome',
        userId: 'not-a-uuid',
        tenantId: 42,
        from: '2026-02-30',
        to: '30/09/2026',
        cursor: 7,
        dir: 'sideways',
      })
    ).toEqual({ q: '2026' })
  })
})
