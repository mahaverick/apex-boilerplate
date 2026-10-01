import { useState } from 'react'
import { toast } from 'sonner'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { Button } from '@/components/ui/button'
import {
  EMAIL_TEMPLATES,
  isEmailTemplateKey,
  RESEND_NOT_SENT,
  RESEND_REQUESTED,
} from '@/constants/email.constants'
import { useStepUp } from '@/hooks/use-step-up'
import { useResendEmail } from '@/queries/email.queries'
import type { EmailMessageSummary } from '@/types/api.types'

/**
 * Resend, offered only when the API says this staff member may
 * (`canResend`). The dialog says what the originating action will do; a
 * refusal shows the API's own message, and a stale sign-in goes through the
 * step-up dialog.
 */
export function ResendEmailButton({ message }: { message: EmailMessageSummary }) {
  const [open, setOpen] = useState(false)
  const stepUp = useStepUp()
  const resend = useResendEmail()
  if (!message.canResend) return null
  const sentence = isEmailTemplateKey(message.templateKey)
    ? EMAIL_TEMPLATES[message.templateKey].resendLabel
    : null
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Resend
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Resend this email?"
        description={sentence ?? 'Runs the action that sent it again.'}
        confirmLabel="Resend"
        onConfirm={async (reason) => {
          const result = await stepUp.run(() => resend.mutateAsync({ id: message.id, reason }))
          if (result?.emailSent === false) toast.warning(RESEND_NOT_SENT)
          else toast.success(RESEND_REQUESTED)
        }}
      />
    </>
  )
}
