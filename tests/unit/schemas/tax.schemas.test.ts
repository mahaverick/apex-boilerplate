import { describe, expect, it } from 'vite-plus/test'
import { TEXT_PATTERN_MESSAGE } from '@/schemas/tax-details.schemas'
import { creditNoteSchema } from '@/schemas/tax.schemas'

const AMOUNT_MESSAGE = 'Enter an amount in rupees, such as 499 or 499.50.'

/** The first message the schema gives, or undefined when the form parses. */
function messageOf(amountRupees: string, remainingMinor = 1_000_000) {
  const result = creditNoteSchema(remainingMinor).safeParse({ amountRupees, reason: 'Refund' })
  return result.success ? undefined : result.error.issues[0]?.message
}

describe('creditNoteSchema', () => {
  it('parses 499.50 into 49950 paise and keeps the reason', () => {
    expect(
      creditNoteSchema(1_000_000).parse({ amountRupees: '499.50', reason: ' Duplicate charge ' })
    ).toEqual({ amountMinor: 49950, reason: 'Duplicate charge' })
  })

  it('parses whole rupees and a single decimal digit', () => {
    const schema = creditNoteSchema(1_000_000)
    expect(schema.parse({ amountRupees: '499', reason: 'r' }).amountMinor).toBe(49900)
    expect(schema.parse({ amountRupees: '499.5', reason: 'r' }).amountMinor).toBe(49950)
    expect(schema.parse({ amountRupees: '1', reason: 'r' }).amountMinor).toBe(100)
  })

  it('refuses 0.29, below ₹1', () => {
    expect(messageOf('0.29')).toBe('Enter ₹1 to ₹10,000.')
  })

  it('refuses 499.995, a third decimal digit', () => {
    expect(messageOf('499.995')).toBe(AMOUNT_MESSAGE)
  })

  it('refuses exponent, sign, comma and empty text', () => {
    for (const text of ['1e3', '-5', '1,000', '', ' ', '.5', '12345678']) {
      expect(messageOf(text), text).toBe(AMOUNT_MESSAGE)
    }
  })

  it('accepts up to the remaining amount and refuses a paisa over it', () => {
    expect(creditNoteSchema(49950).safeParse({ amountRupees: '499.50', reason: 'r' }).success).toBe(
      true
    )
    expect(messageOf('499.51', 49950)).toBe('Enter ₹1 to ₹499.50.')
  })

  it('requires a reason', () => {
    const result = creditNoteSchema(49950).safeParse({ amountRupees: '10', reason: '  ' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['reason'])
  })

  it('reports a bad amount and a missing reason together', () => {
    const result = creditNoteSchema(49950).safeParse({ amountRupees: '1e3', reason: '' })
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map((issue) => issue.path.join('.'))
    expect(paths).toContain('amountRupees')
    expect(paths).toContain('reason')
  })

  it('caps the amount at ₹1,00,000 however much is left', () => {
    expect(messageOf('100000.01', 20_000_000)).toBe('Enter ₹1 to ₹1,00,000.')
    expect(
      creditNoteSchema(20_000_000).parse({ amountRupees: '100000', reason: 'r' }).amountMinor
    ).toBe(10_000_000)
  })

  describe('the reason', () => {
    /** Parses a ₹10 note with the given reason. */
    const parse = (reason: string) =>
      creditNoteSchema(1_000_000).safeParse({ amountRupees: '10', reason })

    it('accepts one line of plain text', () => {
      expect(parse('Chargeback lost').data?.reason).toBe('Chargeback lost')
    })

    it('refuses Devanagari with the shared message', () => {
      const result = parse('चार्जबैक')
      expect(result.error?.issues[0]?.message).toBe(TEXT_PATTERN_MESSAGE)
    })

    it('refuses a line break', () => {
      expect(parse('a\nb').success).toBe(false)
    })

    it('accepts a curly apostrophe and sends it straight', () => {
      expect(parse('Customer’s dispute').data?.reason).toBe("Customer's dispute")
    })

    it('refuses more than 500 characters', () => {
      expect(parse('a'.repeat(501)).success).toBe(false)
    })
  })
})
