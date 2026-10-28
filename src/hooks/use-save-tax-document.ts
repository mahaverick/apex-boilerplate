import { useState } from 'react'
import { documentFilename, downloadFile } from '@/lib/download-file'
import { staffMessageFrom } from '@/lib/staff-message'
import { toast } from '@/lib/toast'
import type { TaxDocumentRef } from '@/types/billing.types'

/**
 * The save behind a tax document's PDF control, a button or a menu item.
 * @param tenantId - The tenant that owns the document.
 * @param document - The document's id and number.
 * @returns `busy` while the file loads, and `save`, which does nothing while busy.
 */
export function useSaveTaxDocument(tenantId: string, document: TaxDocumentRef) {
  const [busy, setBusy] = useState(false)
  /** Fetches and saves the PDF; a second click while it loads does nothing. */
  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      await downloadFile(
        `/platform/tenants/${tenantId}/billing/tax-documents/${document.id}/pdf`,
        documentFilename(document.number)
      )
    } catch (error) {
      toast.error(staffMessageFrom(error))
    } finally {
      setBusy(false)
    }
  }
  return { busy, save }
}
