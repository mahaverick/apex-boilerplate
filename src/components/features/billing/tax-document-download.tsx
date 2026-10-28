import type { Ref } from 'react'
import { Button } from '@/components/ui/button'
import { useSaveTaxDocument } from '@/hooks/use-save-tax-document'
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
 * @param props.ref - The button, for a caller that moves focus to it.
 */
export function TaxDocumentDownload({
  tenantId,
  document,
  label,
  ref,
}: {
  tenantId: string
  document: TaxDocumentRef
  label?: 'number'
  ref?: Ref<HTMLButtonElement>
}) {
  const { busy, save } = useSaveTaxDocument(tenantId, document)
  return (
    <Button
      ref={ref}
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
