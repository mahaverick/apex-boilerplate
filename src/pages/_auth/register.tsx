import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { AuthCard } from '@/components/layouts/auth-card'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { FormFieldsSkeleton } from '@/components/shared/section-skeleton'
import { FieldDescription, FieldGroup } from '@/components/ui/field'
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
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { statusFrom } from '@/lib/api-error'
import { toast } from '@/lib/toast'
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
    if (!search.invitation) throw redirect({ to: ROUTES.login })
  },
  head: () => ({ meta: [{ title: pageTitle('Create an account') }] }),
  component: RegisterPage,
})

/**
 * Looks the invitation up, then shows the form for its address. A 404 says the
 * invitation cannot be used; any other failure offers a retry.
 */
function RegisterPage() {
  const { invitation: token } = Route.useSearch()
  const preview = useInvitationPreview(token)

  if (preview.isPending) return <RegisterSkeleton />
  if (preview.isError && statusFrom(preview.error) !== 404) {
    return (
      <AuthCard title="Create an account">
        <LoadError
          message="We could not check your invitation."
          onRetry={() => void preview.refetch()}
        />
      </AuthCard>
    )
  }
  if (preview.isError) {
    return (
      <AuthCard
        title="This invitation can’t be used"
        description="It may have expired or been revoked. Ask the person who invited you for a new one."
      />
    )
  }
  return <RegisterForm invitedEmail={preview.data.email} tenantName={preview.data.tenant.name} />
}

/** The register card while the invitation loads: the form's four fields (email, password, first and last name) and its button, at the form's own spacing. */
function RegisterSkeleton() {
  return (
    <AuthCard title="Create an account">
      <FormFieldsSkeleton fields={4} />
    </AuthCard>
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
      <AuthCard
        title="Check your email"
        description={
          <>
            We sent a verification link to <Pii>{registeredEmail}</Pii>. Open it to finish setting
            up your account, then open your invitation link again to join.
          </>
        }
      >
        <BusyButton
          busy={resend.isPending}
          busyLabel="Sending…"
          variant="outline"
          className="w-full"
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
          Resend verification email
        </BusyButton>
        <FieldDescription className="text-center">
          <Link to={ROUTES.login}>Back to sign in</Link>
        </FieldDescription>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create an account"
      description={
        <>
          Create an account with <Pii>{invitedEmail}</Pii> to join {tenantName}.
        </>
      }
    >
      <Form form={form} serverErrors={serverErrors} className="space-y-0">
        <FieldGroup className="gap-6">
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

          <BusyButton
            busy={register.isPending}
            busyLabel="Creating account…"
            type="submit"
            className="w-full"
          >
            Create account
          </BusyButton>

          <FieldDescription className="text-center">
            Already have an account? <Link to={ROUTES.login}>Sign in</Link>
          </FieldDescription>
        </FieldGroup>
      </Form>
    </AuthCard>
  )
}
