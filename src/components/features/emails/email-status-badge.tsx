import { Badge } from '@/components/ui/badge'
import { EMAIL_STATUS_BADGE, type EmailBadgeTone } from '@/constants/email.constants'
import type { EmailMessageStatus } from '@/types/api.types'

/** Each tone on the vendored badge: a variant, plus the status tokens where no variant fits. */
const TONES: Record<
  EmailBadgeTone,
  { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }
> = {
  success: {
    variant: 'default',
    className: 'border-transparent bg-success text-success-foreground',
  },
  neutral: { variant: 'secondary' },
  warning: {
    variant: 'default',
    className: 'border-transparent bg-warning text-warning-foreground',
  },
  destructive: { variant: 'destructive' },
  muted: { variant: 'outline', className: 'text-muted-foreground' },
}

/** A message's delivery status as a badge; `data-tone` names the tone for tests and styling. */
export function EmailStatusBadge({ status }: { status: EmailMessageStatus }) {
  const { label, tone } = EMAIL_STATUS_BADGE[status]
  const { variant, className } = TONES[tone]
  return (
    <Badge variant={variant} className={className} data-tone={tone}>
      {label}
    </Badge>
  )
}
