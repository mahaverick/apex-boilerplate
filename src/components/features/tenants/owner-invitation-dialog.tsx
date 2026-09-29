import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { ROLE_DENIED_ACTION } from '@/components/features/reason-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useStepUp } from '@/hooks/use-step-up'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { isReauthRequired } from '@/lib/step-up'
import { useReissueOwnerInvitation } from '@/queries/tenant-admin.queries'
import { ownerInvitationSchema } from '@/schemas/tenant.schemas'
import { INVITEE_DEACTIVATED, type PlatformTenantDetail } from '@/types/api.types'

/**
 * Send, or re-send, the owner invitation of a tenant with no active owner
 * as platform admin or owner, with an audited reason, behind
 * step-up. It is prefilled with the pending invitation's address; a
 * different address revokes that one. A staff address is allowed, and the
 * audit entry records who it resolves to. Refusals show inline: a
 * deactivated invitee on Owner email; any other 409 (an active owner joined
 * meanwhile, the tenant left `active`) or a 403 on the form; a 404, which
 * means the caller's role changed, as that.
 */
export function OwnerInvitationDialog({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: PlatformTenantDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Owner invitation</DialogTitle>
          <DialogDescription>
            A new link is emailed; any earlier owner invitation stops working.
          </DialogDescription>
        </DialogHeader>
        {open && <OwnerInvitationForm tenant={tenant} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function OwnerInvitationForm({
  tenant,
  onDone,
}: {
  tenant: PlatformTenantDetail
  onDone: () => void
}) {
  const reissue = useReissueOwnerInvitation(tenant.id)
  const stepUp = useStepUp()
  const serverErrors = useServerErrors()
  const form = useForm({
    defaultValues: { email: tenant.pendingOwnerInvitation?.email ?? '', reason: '' },
    validators: { onSubmit: ownerInvitationSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      const input = ownerInvitationSchema.parse(value)
      try {
        const { emailSent } = await stepUp.run(() => reissue.mutateAsync(input))
        if (emailSent) toast.success(`Owner invitation sent to ${input.email}.`)
        else
          toast.warning('The invitation was created, but its email could not be sent. Try again.')
        onDone()
      } catch (error) {
        if (isReauthRequired(error)) {
          serverErrors.setFormErrors(['Confirm it’s you to continue.'])
          return
        }
        if (codeFrom(error) === INVITEE_DEACTIVATED) {
          serverErrors.setFieldError('email', [messageFrom(error)])
          return
        }
        const status = statusFrom(error)
        if (status === 404) {
          serverErrors.setFormErrors([ROLE_DENIED_ACTION])
          return
        }
        if (status === 403 || status === 409) {
          serverErrors.setFormErrors([messageFrom(error)])
          return
        }
        serverErrors.capture(error)
      }
    },
  })

  return (
    <Form form={form} serverErrors={serverErrors} className="grid gap-4">
      <FormField form={form} name="email">
        {(field) => (
          <FormItem>
            <FormLabel>Owner email</FormLabel>
            <FormControl>
              <Input
                type="email"
                autoComplete="off"
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      <FormField form={form} name="reason">
        {(field) => (
          <FormItem>
            <FormLabel>Reason</FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      <FormError />
      <DialogFooter>
        <Button type="submit" disabled={reissue.isPending}>
          {reissue.isPending ? 'Sending…' : 'Send invitation'}
        </Button>
      </DialogFooter>
    </Form>
  )
}
