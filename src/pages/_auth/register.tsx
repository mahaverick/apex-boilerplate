import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useRegister, useResendVerification } from '@/queries/auth.queries'
import { useInvitationPreview } from '@/queries/invitation.queries'
import { registerSchema, type RegisterInput } from '@/schemas/auth.schemas'

/**
 * The registration page, reached only from an invitation: Apex has no public
 * sign-up, so `?invitation=` is required and a visitor without one is sent to
 * the login page. `.catch` ignores a non-string, since the router JSON-parses
 * search values.
 */
export const Route = createFileRoute('/_auth/register')({
  validateSearch: z.object({ invitation: z.string().optional().catch(undefined) }),
  beforeLoad: ({ search }) => {
    // Apex has no public sign-up: an account is created only to accept an invitation.
    if (!search.invitation) throw redirect({ to: ROUTES.login })
  },
  head: () => ({ meta: [{ title: pageTitle('Create an account') }] }),
  component: RegisterPage,
})

/** Looks the invitation up, then shows the form for its address, or says it cannot be used. */
function RegisterPage() {
  const { invitation: token } = Route.useSearch()
  const preview = useInvitationPreview(token)

  if (preview.isPending) return <RegisterSkeleton />
  if (preview.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>This invitation can’t be used</h1>
          </CardTitle>
          <CardDescription>
            It may have expired or been revoked. Ask the person who invited you for a new one.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return <RegisterForm invitedEmail={preview.data.email} tenantName={preview.data.tenant.name} />
}

function RegisterSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Create an account</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  )
}

/**
 * The registration form, then a "check your email" card with a resend control
 * for the address just registered. The address is the invited one, read-only.
 * The value is parsed before posting, so the schema's trimming and lowercasing
 * reach the wire; the API answers with no user, so the card shows the
 * submitted, normalised address.
 */
function RegisterForm({ invitedEmail, tenantName }: { invitedEmail: string; tenantName: string }) {
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)
  const register = useRegister()
  const resend = useResendVerification()
  const serverErrors = useServerErrors()

  /** Annotated: the names are optional in the schema, and an inferred `string` would not match. */
  const defaultValues: RegisterInput = {
    email: invitedEmail,
    password: '',
    firstName: '',
    lastName: '',
  }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: registerSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        const input = registerSchema.parse(value)
        await register.mutateAsync(input)
        setRegisteredEmail(input.email)
      } catch (submitError) {
        serverErrors.capture(submitError)
      }
    },
  })

  if (registeredEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Check your email</h1>
          </CardTitle>
          <CardDescription>
            We sent a verification link to {registeredEmail}. Open it to finish setting up your
            account, then open your invitation link again to join.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            disabled={resend.isPending}
            onClick={() => {
              resend.mutate(
                { email: registeredEmail },
                {
                  // The same message either way, so it never reveals whether the address is pending.
                  onSettled: () =>
                    toast.success('If that address needs verifying, a new email is on its way.'),
                }
              )
            }}
          >
            {resend.isPending ? 'Sending…' : 'Resend verification email'}
          </Button>
          <div className="mt-4 text-sm">
            <Link to={ROUTES.login} className="underline underline-offset-4">
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Create an account</h1>
        </CardTitle>
        <CardDescription>{`Create an account with ${invitedEmail} to join ${tenantName}.`}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form form={form} serverErrors={serverErrors}>
          <FormField form={form} name="firstName">
            {(field) => (
              <FormItem>
                <FormLabel>First name (optional)</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="given-name"
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
                <FormLabel>Last name (optional)</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="family-name"
                    value={fieldValue(field.state.value)}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>

          <FormField form={form} name="email">
            {(field) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    readOnly
                    value={fieldValue(field.state.value)}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>

          <FormField form={form} name="password">
            {(field) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
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

          <Button type="submit" className="w-full" disabled={register.isPending}>
            {register.isPending ? 'Creating account…' : 'Create account'}
          </Button>
        </Form>

        <div className="mt-4 text-sm">
          <Link to={ROUTES.login} className="underline underline-offset-4">
            Already have an account? Sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
