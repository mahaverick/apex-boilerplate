/**
 * @file How a tax document's money and dates read on the Billing tab. Document
 * dates are in India Standard Time, as printed on the PDF, whatever zone the
 * tenant keeps.
 */
import { formatInr } from '@/lib/billing-format'
import type { StaffTaxDocumentItem, SupplyKind, TaxAmounts } from '@/types/billing.types'

/** The zone every tax document, credit note, held charge and export period is dated in. */
export const IST = 'Asia/Kolkata'

/**
 * The tax a document charges, split the way its PDF prints it.
 * @param amounts - The document's amounts in paise.
 * @param supply - `intra` splits the tax into CGST and SGST; `inter` is IGST.
 * @returns For example `CGST ₹76.19 + SGST ₹76.20`, or `IGST ₹152.39`.
 */
export function taxSplitText(amounts: TaxAmounts, supply: SupplyKind): string {
  return supply === 'intra'
    ? `CGST ${formatInr(amounts.cgstMinor)} + SGST ${formatInr(amounts.sgstMinor)}`
    : `IGST ${formatInr(amounts.igstMinor)}`
}

/**
 * What an invoice can still be credited, in paise.
 * @param invoice - A tax document row.
 */
export const remainingCreditMinor = (invoice: StaffTaxDocumentItem) =>
  invoice.amounts.totalMinor - invoice.creditedMinor
