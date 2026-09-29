import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom } from '@/lib/api-error'
import { useCreateUser, useSendPasswordSetup } from '@/queries/user-admin.queries'
import { createUserSchema } from '@/schemas/user-admin.schemas'

/**
 * New user: email and optional names. The API creates the account without a
 * password and mails a set-password link; staff never see a password. When
 * the mail did not go, the toast offers a resend rather than hiding it.
 */
export function CreateUserDialog() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const create = useCreateUser()
  const resend = useSendPasswordSetup()
  const serverErrors = useServerErrors()

  const form = useForm({
    defaultValues: { email: '', firstName: '', lastName: '' },
    validators: { onSubmit: createUserSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        const { user, emailSent } = await create.mutateAsync(createUserSchema.parse(value))
        if (emailSent) {
          toast.success(`Set-password email sent to ${user.email}.`)
        } else {
          toast.warning('The user was created, but the set-password email could not be sent.', {
            action: {
              label: 'Resend',
              onClick: () =>
                resend.mutate(
                  { userId: user.id },
                  { onError: (error) => toast.error(messageFrom(error)) }
                ),
            },
          })
        }
        setOpen(false)
        form.reset()
        void navigate({ to: ROUTES.user, params: { userId: user.id } })
      } catch (error) {
        serverErrors.capture(error)
      }
    },
  })

  return (
    <>
      <Button onClick={() => setOpen(true)}>New user</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              They get an email with a link to set their own password. The link lasts 24 hours by
              default.
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
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create user'}
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  )
}
