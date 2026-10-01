import { useId } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { EmailBreakdownRow } from '@/types/api.types'

interface BreakdownCardProps {
  /** The card's heading, which also names its table. */
  title: string
  /** The first column's header: what `key` is. */
  keyHeader: string
  rows: EmailBreakdownRow[]
  /** How a row's key reads: a template's label, a domain as it is. */
  labelOf: (key: string) => string
}

/**
 * The window's emails split one way (by template, by recipient domain), with
 * the undelivered and complained counts beside each. The API orders the rows.
 */
export function BreakdownCard({ title, keyHeader, rows, labelOf }: BreakdownCardProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId}>{title}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No emails in this window.</p>
          ) : (
            <Table aria-labelledby={headingId}>
              <TableCaption className="sr-only">Emails, undelivered and complained</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{keyHeader}</TableHead>
                  <TableHead scope="col" className="text-right">
                    Emails
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Undelivered
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Complained
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium break-all whitespace-normal">
                      {labelOf(row.key)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.messages.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.undelivered.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.complained.toLocaleString('en-US')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
