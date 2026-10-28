import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Note } from '@/components/shared/note'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useNow } from '@/hooks/use-now'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { codeFrom } from '@/lib/api-error'
import { staffMessageFrom } from '@/lib/staff-message'
import { isReauthRequired } from '@/lib/step-up'
import { defaultPeriod, exportPeriods } from '@/lib/tax-export'
import { toast } from '@/lib/toast'
import { useDownloadTaxExport } from '@/queries/billing-admin.queries'
import { billingAdminKeys } from '@/queries/billing-reads.queries'
import { TAX_DOCUMENTS_DISABLED } from '@/types/billing.types'

/** The two ways a return covers its sales. */
type PeriodKind = 'month' | 'quarter'

/**
 * The GST return export (admin): one month or quarter of tax invoices and
 * credit notes as GSTR-1 CSV files in a ZIP. Periods are in IST and run back
 * to the GST start date. The download runs behind step-up. A 404
 * `tax_documents_disabled` (registration turned off since the page loaded)
 * shows express's sentence in a note and reloads the billing settings; any
 * other refusal shows express's sentence in a toast. The route is a GET, so
 * there is no reason field.
 * @param props.effectiveFrom - The GST start date as `YYYY-MM-DD` in IST, or `null`.
 */
export function TaxExportCard({ effectiveFrom }: { effectiveFrom: string | null }) {
  const headingId = useId()
  const now = new Date(useNow())
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const download = useDownloadTaxExport()
  const [kind, setKind] = useState<PeriodKind>('month')
  const [picked, setPicked] = useState<string | null>(null)
  const [disabled, setDisabled] = useState<string | null>(null)
  const periods = exportPeriods(now, kind, effectiveFrom)
  const period =
    picked !== null && periods.some((option) => option.value === picked)
      ? picked
      : defaultPeriod(now, kind, effectiveFrom)

  /** Downloads the period, and says where a refusal came from. */
  const run = async () => {
    if (download.isPending) return
    setDisabled(null)
    try {
      const { filename } = await stepUp.run(() => download.mutateAsync(period))
      toast.success(`${filename} downloaded.`)
    } catch (error) {
      if (isReauthRequired(error)) return
      if (codeFrom(error) === TAX_DOCUMENTS_DISABLED) {
        setDisabled(staffMessageFrom(error))
        await queryClient.invalidateQueries({ queryKey: billingAdminKeys.settings })
        return
      }
      toast.error(staffMessageFrom(error))
    }
  }

  return (
    <Card id="gst-return-export" role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle>
          <h2 id={headingId}>GST return export</h2>
        </CardTitle>
        <CardDescription>
          Download one month or quarter of tax invoices and credit notes as CSV files laid out for
          GSTR-1, the GST return for sales. A document belongs to the period of its India Standard
          Time (IST) date.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {disabled !== null && <Note tone="info">{disabled}</Note>}
        <div className="grid gap-2">
          <p id="tax-export-kind" className="text-sm font-medium">
            Return period
          </p>
          <RadioGroup
            aria-labelledby="tax-export-kind"
            value={kind}
            onValueChange={(next) => {
              setKind(next as PeriodKind)
              setPicked(null)
            }}
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="month" />
              Month
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="quarter" />
              Quarter (for quarterly filers)
            </label>
          </RadioGroup>
        </div>
        <div className="grid gap-2">
          <p id="tax-export-period" className="text-sm font-medium">
            Period
          </p>
          <Select
            value={period}
            onValueChange={(next: string | null) => {
              if (next !== null) setPicked(next)
            }}
          >
            <SelectTrigger aria-labelledby="tax-export-period" className="w-full max-w-sm">
              <SelectValue>
                {(value: string | null) =>
                  periods.find((option) => option.value === value)?.label ?? 'Choose one'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {periods.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Button aria-disabled={download.isPending} onClick={() => void run()}>
            {download.isPending
              ? waiting
                ? STEP_UP_WAITING_LABEL
                : 'Preparing export…'
              : 'Download export'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
