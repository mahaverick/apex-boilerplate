import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
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
import { ROUTES } from '@/constants/routes'
import { useLeavingFinalFocus } from '@/hooks/use-arrival-focus'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { staffMessageFrom } from '@/lib/staff-message'
import { toast } from '@/lib/toast'
import { WELCOME_RESEND_NOT_SENT } from '@/lib/user-actions'
import { useCreateUser, useSendSignInLink } from '@/queries/user-admin.queries'
import { createUserSchema } from '@/schemas/user-admin.schemas'

/**
 * New user: email and optional names. The API creates the account and mails
 * a welcome email with a sign-in link to the customer app. When the mail did
 * not go, the toast offers a resend, which sends a fresh sign-in link, and the
 * resend's own outcome is toasted too. A create opens the new user's page
 * with focus on its heading. However the dialog closes, it opens blank next
 * time.
 */
export function CreateUserDialog() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const create = useCreateUser()
  const resend = useSendSignInLink()
  const serverErrors = useServerErrors()
  const leaving = useLeavingFinalFocus(undefined)

  const form = useForm({
    defaultValues: { email: '', firstName: '', lastName: '' },
    validators: { onSubmit: createUserSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        const { user, emailSent } = await create.mutateAsync(createUserSchema.parse(value))
        if (emailSent) {
          toast.success(
            <>
              Welcome email sent to <Pii>{user.email}</Pii>.
            </>
          )
        } else {
          toast.warning('The user was created, but the welcome email wasn’t sent. Select Resend.', {
            action: {
              label: 'Resend',
              // A promise, not mutate's callbacks: those never fire once this dialog has unmounted, and it has by now, on the new user's page.
              onClick: () =>
                void resend.mutateAsync({ userId: user.id }).then(
                  ({ emailSent: sent }) => {
                    if (sent) {
                      toast.success(
                        <>
                          Sign-in link sent to <Pii>{user.email}</Pii>.
                        </>
                      )
                    } else toast.warning(WELCOME_RESEND_NOT_SENT)
                  },
                  (error: unknown) => toast.error(staffMessageFrom(error))
                ),
            },
          })
        }
        leaving.leave()
        close(false)
        void navigate({ to: ROUTES.user, params: { userId: user.id } })
      } catch (error) {
        serverErrors.capture(error)
      }
    },
  })

  /** Opens or closes the dialog; closing it clears the form and any server errors. */
  function close(next: boolean) {
    setOpen(next)
    if (next) return
    form.reset()
    serverErrors.reset()
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>New user</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent finalFocus={leaving.finalFocus}>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              We email them a sign-in link to the customer app. It expires in 15 minutes. You can
              send a new one from their page.
            </DialogDescription>
          </DialogHeader>
          <Form form={form} serverErrors={serverErrors}>
            <FormField form={form} name="email">
              {(field) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
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
            <FormField form={form} name="firstName">
              {(field) => (
                <FormItem>
                  <FormLabel>First name</FormLabel>
                  <FormControl>
                    <Input
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
            <FormField form={form} name="lastName">
              {(field) => (
                <FormItem>
                  <FormLabel>Last name</FormLabel>
                  <FormControl>
                    <Input
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
            <FormError />
            <DialogFooter>
              <BusyButton busy={create.isPending} busyLabel="Creating…" type="submit">
                Create user
              </BusyButton>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  )
}
