import { ToneBadge } from '@/components/features/tone-badge'
import { EMAIL_STATUS_BADGE } from '@/constants/email.constants'
import type { EmailMessageStatus } from '@/types/api.types'

/** A message's delivery status as a badge in its shared tone. */
export function EmailStatusBadge({ status }: { status: EmailMessageStatus }) {
  const { label, tone } = EMAIL_STATUS_BADGE[status]
  return <ToneBadge tone={tone}>{label}</ToneBadge>
}
