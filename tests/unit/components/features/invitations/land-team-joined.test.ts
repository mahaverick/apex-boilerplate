import { describe, expect, it, vi } from 'vite-plus/test'
import { landTeamJoined } from '@/components/features/invitations/land-team-joined'
import { toast } from '@/lib/toast'

const PLATFORM = { name: 'Platform', slug: 'platform' }
const ACME = { name: 'Acme', slug: 'acme' }

describe('landTeamJoined', () => {
  it('tells new staff they are on the staff team and names the account, then opens', () => {
    const success = vi.spyOn(toast, 'success')
    const open = vi.fn()

    landTeamJoined(PLATFORM, 'ada@example.test', false, open)

    expect(success).toHaveBeenCalledWith(
      'You’re now on the staff team. Signed in as ada@example.test.'
    )
    expect(open).toHaveBeenCalledWith(PLATFORM)
    expect(success.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0] ?? 0)
  })

  it('says so when the staff member had joined already', () => {
    const success = vi.spyOn(toast, 'success')

    landTeamJoined(PLATFORM, 'ada@example.test', true, vi.fn())

    expect(success).toHaveBeenCalledWith(
      'You’re already on the staff team. Signed in as ada@example.test.'
    )
  })

  it('keeps the shared wording for a customer tenant', () => {
    const success = vi.spyOn(toast, 'success')
    const open = vi.fn()

    landTeamJoined(ACME, 'ada@example.test', false, open)

    expect(success).toHaveBeenCalledWith('You joined Acme as ada@example.test.')
    expect(open).toHaveBeenCalledWith(ACME)
  })
})
