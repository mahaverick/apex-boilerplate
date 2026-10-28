import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { documentFilename, downloadFile } from '@/lib/download-file'
import { staffMessageFrom } from '@/lib/staff-message'
import { toast } from '@/lib/toast'
import type { TaxDocumentRef } from '@/types/billing.types'

/**
 * Saves one tax document as a PDF. The bytes come through `downloadFile`
 * behind the Bearer token, on click only: express counts a download as a
 * billing read. The browser shows the saved file, so success raises no toast;
 * a failure shows express's sentence. The button stays focusable while the
 * file loads (`aria-disabled`, not `disabled`).
 * @param props.tenantId - The tenant that owns the document.
 * @param props.document - The document's id and number.
 * @param props.label - `number` shows the document number as the text; the default shows `PDF`.
 */
export function TaxDocumentDownload({
  tenantId,
  document,
  label,
}: {
  tenantId: string
  document: TaxDocumentRef
  label?: 'number'
}) {
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
  return (
    <Button
      variant={label === 'number' ? 'link' : 'outline'}
      size="sm"
      className={label === 'number' ? 'h-auto p-0' : undefined}
      aria-label={`Download ${document.number} as a PDF`}
      aria-disabled={busy}
      onClick={() => void save()}
    >
      {busy ? 'Downloading…' : label === 'number' ? document.number : 'PDF'}
    </Button>
  )
}
