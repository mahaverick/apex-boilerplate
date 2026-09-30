import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TenantLifecycleState } from '@/types/api.types'

const STATE: Record<TenantLifecycleState, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-success text-success-foreground' },
  suspended: { label: 'Suspended', className: 'bg-warning text-warning-foreground' },
  archived: { label: 'Archived', className: 'bg-muted text-muted-foreground' },
}

/** A tenant's lifecycle state as a status badge; the colours are the status tokens. */
export function TenantStateBadge({ state }: { state: TenantLifecycleState }) {
  const { label, className } = STATE[state]
  return <Badge className={cn('border-transparent', className)}>{label}</Badge>
}
