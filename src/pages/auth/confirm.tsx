import '@/lib/zod-jitless'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { SigningInStatus, VerifyFailedPanel } from '@/components/features/auth/link-panels'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { buttonVariants } from '@/components/ui/button'
import { pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { broadcastAuthMessage } from '@/http/session'
import { messageFrom, statusFrom } from '@/lib/api-error'
import { isStepUpWaitHeld } from '@/lib/step-up-presence'
import { cn } from '@/lib/utils'
import { useConfirmStepUpLink } from '@/queries/auth.queries'
import { useAuthStore } from '@/states/auth.store'

/**
 * Where "Confirm it's you" finishes: the emailed link
 * (`/auth/confirm?token=…`) and the Google popup's return
 * (`?result=confirmed` or `?error=step_up_failed`). Top level, under neither
 * `_auth` nor `_app`: the link must open signed in, and the popup may land
 * either way. It renders `AuthLayout` itself. `.catch` drops any other value,
 * since the router JSON-parses search values; enums, not literals, because the
 * entry chunk already carries Zod's enum class.
 */
export const Route = createFileRoute('/auth/confirm')({
  validateSearch: z.object({
    token: z.string().optional().catch(undefined),
    result: z.enum(['confirmed']).optional().catch(undefined),
    error: z.enum(['step_up_failed']).optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: pageTitle('Confirm it’s you') }] }),
  component: ConfirmPage,
  pendingComponent: AuthPagePending,
})

/** Every state's frame: one `<main>` (AuthLayout) and one `<h1>`. */
function ConfirmCard({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <AuthLayout>
      <AuthCard title={title} description={description}>
        {children}
      </AuthCard>
    </AuthLayout>
  )
}

/** A full-width link styled as the card's one button. */
function linkButton(): string {
  return cn(buttonVariants(), 'w-full')
}

/** The way back into the app, for a state with nothing left to do here. */
function OverviewLink() {
  return (
    <Link to={ROUTES.overview} className={linkButton()}>
      Go to Overview
    </Link>
  )
}

/**
 * Picks the state from the query: the Google popup's result first, then its
 * failure, then the emailed link.
 */
function ConfirmPage() {
  const { token, result, error } = Route.useSearch()
  if (result === 'confirmed') return <GoogleConfirmed />
  if (error === 'step_up_failed') {
    return (
      <ConfirmCard
        title="We couldn’t confirm it’s you"
        description="Google didn’t confirm your sign-in. Close this window, then try again in Apex or use the email link."
      />
    )
  }
  if (!token) {
    return (
      <ConfirmCard
        title="This link is incomplete"
        description="Open the most recent confirmation email and use its link."
      />
    )
  }
  return <LinkConfirm token={token} />
}

/**
 * The Google popup's landing after a confirmed sign-in. The API already moved
 * the session's `auth_time`, so the page only tells the waiting tab, which
 * refreshes and retries, then closes itself. The ref keeps StrictMode's second
 * effect run from telling it twice. A browser that refuses `window.close()`
 * leaves the card's own instruction.
 */
function GoogleConfirmed() {
  const reported = useRef(false)

  useEffect(() => {
    if (reported.current) return
    reported.current = true
    broadcastAuthMessage('step_up_confirmed')
    window.close()
  }, [])

  return <ConfirmCard title="Confirmed" description="You can close this window." />
}

/**
 * Whether a tab is still waiting to hear the confirmation: the step-up wait
 * lock, or `null` where the browser cannot say.
 */
async function waitingTab(): Promise<boolean | null> {
  // Without BroadcastChannel the waiting tab can never hear, so it is told to retry itself.
  if (typeof BroadcastChannel === 'undefined') return false
  return isStepUpWaitHeld()
}

/** A verify's settled answer; the page renders from this, never from the mutation's live state. */
type Outcome = { confirmed: true } | { confirmed: false; error: unknown }

/**
 * Confirms an emailed link in the session that asked for it, once per page
 * load. Whether someone is signed in is read once, at mount. Signed out,
 * nothing is posted: the link is bound to a session, and this browser has
 * none. Signed in, a ref-guarded effect posts the token, so StrictMode's
 * second run never spends it twice; Try again posts again on purpose.
 *
 * Each post first asks whether a tab holds the wait lock, before the request
 * leaves: once the broadcast lands, the waiting tab retries and lets go, and a
 * later read would tell a person whose action already ran to try it again.
 *
 * A 400 is the one dead link, whatever its cause (expired, used, or another
 * session's), and leaves the session as it was. A 404 is the role gate: the
 * caller is no longer staff enough, and the link stays unspent. A 401 is the
 * session's end; the verify skips the refresh-and-retry, so the token never
 * travels into `/login?redirect=`. Anything else leaves the link usable.
 */
function LinkConfirm({ token }: { token: string }) {
  const [signedIn] = useState(() => useAuthStore.getState().isAuthenticated)
  const confirm = useConfirmStepUpLink()
  /** The wait lock as it stood before the last post; undefined until that read settles. */
  const [waiting, setWaiting] = useState<boolean | null | undefined>(undefined)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const started = useRef(false)

  /** Reads the wait lock, then posts the token; the outcome alone decides what shows next. */
  const post = () => {
    setWaiting(undefined)
    void waitingTab().then(setWaiting)
    confirm.mutate(token, {
      onSuccess: () => setOutcome({ confirmed: true }),
      onError: (error) => setOutcome({ confirmed: false, error }),
    })
  }

  const start = useEffectEvent(() => {
    if (signedIn) post()
  })

  useEffect(() => {
    if (started.current) return
    started.current = true
    start()
  }, [])

  if (!signedIn) {
    return (
      <ConfirmCard
        title="Sign in to confirm"
        description="This link works only in the browser and session that asked for it. If you signed out here, sign in and repeat the action."
      >
        <Link to={ROUTES.login} className={linkButton()}>
          Sign in
        </Link>
      </ConfirmCard>
    )
  }

  if (outcome?.confirmed && waiting !== undefined) return <Confirmed waiting={waiting} />

  if (outcome && !outcome.confirmed) {
    const status = statusFrom(outcome.error)
    if (status === 400) {
      return (
        <ConfirmCard
          title="This link didn’t confirm it’s you"
          description="Open it in the browser where you asked for it, within 15 minutes. For a new link, try the action again."
        />
      )
    }
    if (status === 404) {
      return (
        <ConfirmCard
          title="Your staff access changed"
          description="Ask a platform owner to check your role, then go to Overview."
        >
          <OverviewLink />
        </ConfirmCard>
      )
    }
    if (status === 401) {
      return (
        <ConfirmCard
          title="Your session ended"
          description="Sign in again, then repeat the action."
        >
          {/* A full load, not a router link: the store still holds the ended session, and `_auth` would bounce it to Overview. */}
          <a href={ROUTES.login} className={linkButton()}>
            Sign in
          </a>
        </ConfirmCard>
      )
    }
    return (
      <ConfirmCard title="We couldn’t confirm it’s you">
        <VerifyFailedPanel
          message={messageFrom(outcome.error)}
          retrying={confirm.isPending}
          onRetry={post}
        />
      </ConfirmCard>
    )
  }

  return (
    <ConfirmCard title="Confirming it’s you">
      <SigningInStatus label="Confirming it’s you…" />
    </ConfirmCard>
  )
}

/**
 * The confirmed card, worded by whether a tab was waiting: that tab retries
 * the action itself, a closed one cannot, and without Web Locks the page
 * cannot tell which.
 */
function Confirmed({ waiting }: { waiting: boolean | null }) {
  if (waiting === true)
    return <ConfirmCard title="Confirmed" description="You can close this tab." />
  if (waiting === false) {
    return (
      <ConfirmCard title="Confirmed" description="Go back to Apex and try the action again.">
        <OverviewLink />
      </ConfirmCard>
    )
  }
  return (
    <ConfirmCard
      title="Confirmed"
      description="Return to the Apex tab where you started. If you closed it, try the action again."
    />
  )
}
