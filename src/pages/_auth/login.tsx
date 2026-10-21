import '@/lib/zod-jitless'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { PasskeySignInButton } from '@/components/features/auth/passkey-sign-in'
import { CHECK_INBOX_TITLE, SignInLinkForm } from '@/components/features/auth/sign-in-link-form'
import { SocialSignIn } from '@/components/features/auth/social-sign-in'
import { AuthCard } from '@/components/layouts/auth-card'
import { Note } from '@/components/shared/note'
import { AuthPending } from '@/components/shared/pending-templates'
import { FieldGroup } from '@/components/ui/field'
import { APP_NAME, pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { usePasskeyAutofill } from '@/hooks/use-passkey-autofill'
import { safeLanding } from '@/lib/landing'
import { toast } from '@/lib/toast'
import { usePasskeyConfig } from '@/queries/passkey.queries'

/**
 * The sign-in page. `validateSearch` is a schema so every key is optional on
 * the input side, which lets both `_app`'s `redirect({ search: { redirect } })`
 * and `index`'s bare `redirect()` type-check against this route. `notice` is
 * set by the retired password paths; any other value is dropped.
 */
export const Route = createFileRoute('/_auth/login')({
  validateSearch: z.object({
    error: z.string().optional(),
    redirect: z.string().optional(),
    // An enum, not a literal: the entry chunk already carries Zod's enum class.
    notice: z.enum(['sign-in-link']).optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: pageTitle('Sign in') }] }),
  component: LoginPage,
  pendingComponent: AuthPending,
})

/**
 * Keyed by the `?error=` codes the API's Google callback redirects with. On
 * Apex every refused profile (unknown, customer, inactive) is the one
 * `google_auth_failed`, in every maintenance mode, so no line names which.
 */
const OAUTH_ERRORS: Record<string, string> = {
  google_auth_failed:
    'Google sign-in didn’t work for this account. Use your staff Google account, sign in with an email link, or ask a platform admin for an invitation.',
  email_not_verified:
    'Google hasn’t verified this email address. Verify it with Google, or sign in with an email link.',
  google_email_missing:
    'Your Google account didn’t share an email address. Sign in with an email link.',
  processing_failed:
    'We couldn’t finish signing you in with Google. Try again, or sign in with an email link.',
}

/**
 * Staff sign-in by emailed link, with Google as the alternative. The card
 * titles itself from `sentTo`, which this page owns, while `SignInLinkForm`
 * keeps its place in the tree across the switch to "Check your inbox", so its
 * resend clock survives. Another tab that uses the link signs this one in, and
 * the page then lands on the redirect or Overview. Apex has no public sign-up,
 * and as an internal tool it shows no terms line.
 *
 * An OAuth failure arrives as `?error=<code>` and is toasted once per distinct
 * code: StrictMode runs effects twice in dev, and a toast raised without an
 * `id` is not deduped.
 */
function LoginPage() {
  const { error, redirect, notice } = Route.useSearch()
  const navigate = useNavigate()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const passkeyConfig = usePasskeyConfig()
  const passkeysOn = passkeyConfig.data !== undefined && passkeyConfig.data.mode !== 'off'
  /** Bumped when the button's prompt ends without a sign-in, so autofill asks again. */
  const [autofillRun, setAutofillRun] = useState(0)
  // A tab reaches `/login?redirect=` from a token page when it is signed out there, and the token must not travel on.
  const landing = safeLanding(redirect) ?? undefined

  const toastedError = useRef<string | null>(null)
  useEffect(() => {
    if (!error || toastedError.current === error) return
    toastedError.current = error
    toast.error(
      OAUTH_ERRORS[error] ?? 'Sign-in didn’t work. Try again, or sign in with an email link.'
    )
  }, [error])

  /** Leaves sign-in for the landing path, replacing this page in history. */
  const onSignedIn = () => {
    void (landing
      ? navigate({ href: landing, replace: true })
      : navigate({ to: ROUTES.overview, replace: true }))
  }

  usePasskeyAutofill({
    enabled: passkeysOn && sentTo === null,
    onSignedIn,
    restartKey: autofillRun,
  })

  return (
    <AuthCard
      title={sentTo ? CHECK_INBOX_TITLE : `Sign in to ${APP_NAME}`}
      description={
        sentTo ? undefined : 'Enter your staff email and we’ll send you a link to sign in.'
      }
    >
      {notice && sentTo === null && (
        <Note tone="passive">Sign in with an email link or Google. Passwords no longer work.</Note>
      )}
      <FieldGroup className="gap-6">
        <SignInLinkForm
          sentTo={sentTo}
          onSentToChange={setSentTo}
          redirect={landing}
          onSignedIn={onSignedIn}
          passkeyAutofill={passkeysOn}
        />
        {sentTo === null && (
          <SocialSignIn
            redirect={landing}
            extra={
              passkeysOn ? (
                <PasskeySignInButton
                  onSignedIn={onSignedIn}
                  onModalSettled={() => setAutofillRun((run) => run + 1)}
                />
              ) : undefined
            }
          />
        )}
      </FieldGroup>
    </AuthCard>
  )
}
