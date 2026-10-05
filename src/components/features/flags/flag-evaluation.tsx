import { useQuery } from '@tanstack/react-query'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { ToneBadge } from '@/components/features/tone-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  FLAG_APP_LABELS,
  FLAG_REASON_BADGES,
  FLAGS_EVALUATE_ERROR,
  FLAGS_STALE_NOTE,
  TRAIT_NAMES,
} from '@/constants/flags.constants'
import {
  flagsEvaluateQueryOptions,
  type FlagEvaluateParams,
} from '@/queries/flag-inspector.queries'
import { isRoleDenied } from '@/queries/platform.queries'
import type { FlagEvaluationRow, FlagRow, FlagsEvaluateResponse } from '@/types/api.types'

/** The traits express derived, in declaration order; an absent one is said to be unset. */
function TraitValues({ traits }: { traits: FlagsEvaluateResponse['traits'] }) {
  return (
    <dl aria-label="Traits" className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
      {TRAIT_NAMES.map((name) => (
        <div key={name} className="contents">
          <dt>
            <code>{name}</code>
          </dt>
          <dd>
            {traits[name] === undefined ? (
              <span className="text-muted-foreground">Not set</span>
            ) : (
              <code>{String(traits[name])}</code>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** One flag's value, why, and for a holdout user what exposure records. */
function EvaluationRow({ row, sentToApp }: { row: FlagEvaluationRow; sentToApp: boolean }) {
  const badge = FLAG_REASON_BADGES[row.reason]
  return (
    <TableRow>
      <TableCell className="align-top">
        <code className="text-sm font-medium break-all">{row.key}</code>
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <code className="text-sm">{String(row.value)}</code>
        {row.holdoutVariant !== undefined && (
          <p className="text-xs text-muted-foreground">
            Sees {String(row.value)}, recorded as {row.holdoutVariant}
          </p>
        )}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
        {row.conditionIndex !== undefined && (
          <p className="text-xs text-muted-foreground">Condition {row.conditionIndex + 1}</p>
        )}
      </TableCell>
      <TableCell className="align-top">{sentToApp ? 'Yes' : 'No'}</TableCell>
    </TableRow>
  )
}

/**
 * Every registered flag as express evaluates it for one person: the traits
 * it derived, each value with its reason, and whether the chosen app's
 * browser receives it. A 404 is a role refusal; any other failure gets one
 * copy, since an evaluation that failed says nothing about the flags.
 */
export function FlagEvaluation({
  params,
  registry,
}: {
  params: FlagEvaluateParams
  registry: FlagRow[]
}) {
  const evaluation = useQuery(flagsEvaluateQueryOptions(params))
  if (evaluation.isError) {
    return isRoleDenied(evaluation.error) ? (
      <RoleDenied />
    ) : (
      <LoadError message={FLAGS_EVALUATE_ERROR} onRetry={() => void evaluation.refetch()} />
    )
  }
  if (evaluation.data === undefined) return <Skeleton className="h-48 w-full" />
  const sentTo = new Set(
    registry.filter((row) => row.client && row.apps.includes(params.app)).map((row) => row.key)
  )
  const appLabel = FLAG_APP_LABELS[params.app]
  return (
    <div className="grid gap-4">
      {evaluation.data.snapshot.stale && (
        <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
          {FLAGS_STALE_NOTE}
        </p>
      )}
      <TraitValues traits={evaluation.data.traits} />
      <Table aria-label="Evaluation">
        <TableHeader>
          <TableRow>
            <TableHead>Flag</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Sent to {appLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {evaluation.data.flags.map((row) => (
            <EvaluationRow key={row.key} row={row} sentToApp={sentTo.has(row.key)} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
