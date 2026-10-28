import { describe, expect, it } from 'vite-plus/test'
import { IST, taxSplitText } from '@/lib/tax-format'
import { testTaxDocuments } from '@/tests/fixtures/billing'

const [intraInvoice, , , interInvoice] = testTaxDocuments

describe('taxSplitText', () => {
  it('splits an intra-state supply into CGST and SGST', () => {
    expect(taxSplitText(intraInvoice!.amounts, 'intra')).toBe('CGST ₹76.19 + SGST ₹76.20')
  })

  it('shows one IGST amount for an inter-state supply', () => {
    expect(taxSplitText(interInvoice!.amounts, 'inter')).toBe('IGST ₹152.39')
  })
})

describe('IST', () => {
  it('names the zone the PDFs are dated in', () => {
    expect(IST).toBe('Asia/Kolkata')
  })
})
