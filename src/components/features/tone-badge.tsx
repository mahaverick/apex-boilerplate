import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { BadgeTone } from '@/constants/badge-tones'

/** Each tone on the vendored badge: a variant, plus the status tokens where no variant fits. */
const TONES: Record<
  BadgeTone,
  { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }
> = {
  success: {
    variant: 'default',
    className: 'border-transparent bg-success text-success-foreground',
  },
  neutral: { variant: 'secondary' },
  'neutral-outline': { variant: 'secondary', className: 'border-border' },
  warning: {
    variant: 'default',
    className: 'border-transparent bg-warning text-warning-foreground',
  },
  destructive: { variant: 'destructive' },
  outline: { variant: 'outline' },
  muted: { variant: 'outline', className: 'text-muted-foreground' },
}

/** A status label as a badge in one of the shared tones; `data-tone` names the tone for tests and styling. */
export function ToneBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  const { variant, className } = TONES[tone]
  return (
    <Badge variant={variant} className={className} data-tone={tone}>
      {children}
    </Badge>
  )
}
