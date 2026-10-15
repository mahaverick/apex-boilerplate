# Auth

The signed-out pages, the pages a mailed link opens, and the page for a signed-in account that is not platform staff. Back to the [route map](README.md#route-map).

All of them render inside `AuthLayout` (`src/components/layouts/auth-layout.tsx`): a muted full-height page with one narrow centred column (`max-w-sm`), which `AuthCard` (`src/components/layouts/auth-card.tsx`) fills with the app's mark and name over one card. The card's header holds the page's `h1` and description, centred, over its content. There is no brand panel and no terms line: Apex is an internal tool. `/login`, `/register` and `/forgot-password` sit under the `_auth` layout route, whose `beforeLoad` sends a signed-in user to `/overview` (and from there `_app` sends a non-staff account on to `/no-access`). `/reset-password`, `/verify-email`, `/auth/callback`, `/invitations/accept` and `/no-access` are top-level routes outside `_auth`, because a signed-in user opens them too; each renders `AuthLayout` itself. None of these pages awaits a request before it renders, beyond the boot's `POST /auth/refresh` ([boot.md](boot.md#what-happens)).

Apex has no public sign-up. The way in for a new staff member is an invitation: its link opens `/invitations/accept`, whose Create account goes to `/register?invitation=<token>`.

### `/login` — Sign in

![Sign in](img/auth/login--default.jpg)

|                     |                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Sign in with email and password, or with Google.                                                                                                                                                                                   |
| File                | `src/pages/_auth/login.tsx`                                                                                                                                                                                                        |
| Guard and redirects | `_auth`: signed in → `/overview`. After sign-in → `?redirect=` when `safeRedirect` accepts it (a same-origin path), else `/overview`. `?error=<code>` raises one error toast (Google failures, `MAINTENANCE_MODE`).                |
| Layout              | `AuthLayout` + `AuthCard`                                                                                                                                                                                                          |
| Data                | no query; `POST /auth/login` on submit                                                                                                                                                                                             |
| Sections            | One link per social provider (`SocialSignIn`, a top-level navigation to the API's Google route) and the "Or continue with" divider; then email and password, with "Forgot password?" in the password label's row. No sign-up link. |
| Components          | `Form`, `FormField`, `FormError`, `Input`, `BusyButton`, `FieldGroup`, `FieldSeparator`                                                                                                                                            |
| Transitions         | Forgot password? → `/forgot-password`; Sign in → `?redirect` or `/overview` (a non-staff account then lands on `/no-access`); Continue with Google → the API's Google flow → `/auth/callback`                                      |

Pending state: the button reads "Signing in…" and is disabled. Errors: `FormError` above the button, field messages under the fields.

| Dark                                                                       | Mobile                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------- |
| ![](img/auth/login--dark.jpg)                                              | ![](img/auth/login--mobile.jpg)                    |
| The same column on dark surfaces; the primary button turns a light indigo. | The same column, full width less the page padding. |

### `/register` — Create an account

![Create an account](img/auth/register--default.jpg)

|                     |                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Create the account an invitation was sent to; then tell the user to verify the address and open the invitation again.                                                                                                                                                               |
| File                | `src/pages/_auth/register.tsx`                                                                                                                                                                                                                                                      |
| Guard and redirects | `_auth`: signed in → `/overview`. Its own `beforeLoad`: no `?invitation` → `/login` (the walk confirmed it).                                                                                                                                                                        |
| Layout              | `AuthLayout` + `AuthCard`                                                                                                                                                                                                                                                           |
| Data                | started: `POST /invitations/preview` (`['invitations', 'preview', token]`; no auth; a failure other than 404 is retried once); `POST /auth/register` on submit; `POST /auth/resend-verification` from the "Check your email" card                                                   |
| Sections            | "Create an account with {invited address} to join {tenant}." over first and last name (optional), the invited address in a read-only field, and the password. After a successful submit the card becomes "Check your email" with "Resend verification email" and "Back to sign in". |
| Components          | `AuthCard`, `Skeleton`, `LoadError`, `Form`, `FormField`, `FormError`, `Input`, `BusyButton` (also the resend), `FieldDescription`, `Pii`                                                                                                                                           |
| Transitions         | Sign in → `/login`; Create account → the "Check your email" card (same URL); the emailed link → `/verify-email?token=`                                                                                                                                                              |

The page has these states (`RegisterPage`):

1. **Preview pending:** `RegisterSkeleton`, the "Create an account" card over two `h-10` bars (shot: loading).
2. **Preview failed with 404:** "This invitation can’t be used", "It may have expired or been revoked. Ask the person who invited you for a new one.", and no link or button. The token is sent as it is: in the walk, `?invitation=not-a-real-token` posted the preview and got the 404, where `/invitations/accept` refuses the same token locally without a request.
3. **Preview failed otherwise:** the "Create an account" card around a `LoadError`, "We could not check your invitation." with Try again (shot: error).
4. **Preview loaded:** the form (shot: default). Pending: "Creating account…".
5. **Registered:** "Check your email". Not shot.

In the capture the invitation is to the platform tenant, so the sentence reads "to join Platform."

| Loading                             | Error                             |
| ----------------------------------- | --------------------------------- |
| ![](img/auth/register--loading.jpg) | ![](img/auth/register--error.jpg) |
| skeleton · 2× `h-10`                | alert · `LoadError`               |

Findings: [F-auth-5](findings.md#f-auth-5), [F-auth-6](findings.md#f-auth-6), [F-auth-7](findings.md#f-auth-7), [F-auth-8](findings.md#f-auth-8)

### `/forgot-password` — Forgot password

![Forgot your password?](img/auth/forgot-password--default.jpg)

|                     |                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Ask for a password-reset email.                                                                                                                                                                                                             |
| File                | `src/pages/_auth/forgot-password.tsx`                                                                                                                                                                                                       |
| Guard and redirects | `_auth`: signed in → `/overview`                                                                                                                                                                                                            |
| Layout              | `AuthLayout` + `AuthCard`                                                                                                                                                                                                                   |
| Data                | no query; `POST /auth/forgot-password` on submit                                                                                                                                                                                            |
| Sections            | Email form; after submit, whatever the outcome, the fixed message "If that address has an account, a reset email has been sent." (`role="status"`). Server errors are never shown, so the page cannot reveal which addresses have accounts. |
| Components          | `Form`, `FormField`, `Input`, `BusyButton`, `FieldDescription`                                                                                                                                                                              |
| Transitions         | Back to sign in → `/login`; the emailed link → `/reset-password?token=`                                                                                                                                                                     |

Pending state: "Sending…" on the button.

### `/reset-password` — Choose a new password

![Choose a new password](img/auth/reset-password--default.jpg)

|                     |                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Set a new password with the token from the reset email.                                                                                                    |
| File                | `src/pages/reset-password.tsx`                                                                                                                             |
| Guard and redirects | none: top level, so a signed-in user can use a reset link. After a successful reset → toast "Your password has been reset. Sign in with it." and `/login`. |
| Layout              | `AuthLayout` + `AuthCard`, rendered by the page                                                                                                            |
| Data                | no query; `POST /auth/reset-password` on submit (the token rides in the form values, unrendered)                                                           |
| Sections            | New password and confirmation under "It must be at least 15 characters long."; `FormError` for a refused token                                             |
| Components          | `Form`, `FormField`, `FormError`, `Input`, `BusyButton`, `FieldDescription`                                                                                |
| Transitions         | Reset password → `/login`; Back to sign in → `/login`; without a token, Request a new link → `/forgot-password`                                            |

Pending state: "Saving…" on the button.

| Empty                                                              |
| ------------------------------------------------------------------ |
| ![](img/auth/reset-password--empty.jpg)                            |
| No `?token`: "This link is incomplete", with "Request a new link". |

### `/verify-email` — Verify your email

![Verify your email](img/auth/verify-email--default.jpg)

|                     |                                                                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Confirm the emailed verification token with the account's password.                                                                                                                                                                                                              |
| File                | `src/pages/verify-email.tsx`                                                                                                                                                                                                                                                     |
| Guard and redirects | none: top level. After success → toast "Your email is verified. Sign in, then open your invitation link again to join." and `/login`.                                                                                                                                            |
| Layout              | `AuthLayout` + `AuthCard`, rendered by the page                                                                                                                                                                                                                                  |
| Data                | no query; `POST /auth/verify-email` on submit; `POST /auth/resend-verification` from the resend form                                                                                                                                                                             |
| Sections            | A visible, editable "Verification token" field prefilled from `?token`, and a password field. After a failed try, a resend form ("Links expire. Enter your address and we will send a fresh one."). After `EMAIL_ALREADY_VERIFIED`, the server's message and a "Sign in" button. |
| Components          | `Form`, `FormField`, `FormError`, `Input`, `BusyButton`, `FieldSeparator`, `FieldDescription`                                                                                                                                                                                    |
| Transitions         | Verify email → `/login`; Back to sign in → `/login`; Sign in (already verified) → `/login`                                                                                                                                                                                       |

| Empty                                                 |
| ----------------------------------------------------- |
| ![](img/auth/verify-email--empty.jpg)                 |
| No `?token`: the same form with an empty token field. |

Findings: [F-auth-1](findings.md#f-auth-1), [F-auth-2](findings.md#f-auth-2)

### `/auth/callback` — Google sign-in return

No shot: the page redirects as soon as it mounts.

|                     |                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Where the API's Google callback lands; sends the user on.                                                                                                |
| File                | `src/pages/auth/callback.tsx`                                                                                                                            |
| Guard and redirects | none (top level). In an effect: signed in → `/overview`, else `/login?error=google_auth_failed`, which toasts "Google sign-in failed. Please try again." |
| Layout              | `AuthLayout` + `AuthCard` titled "Signing in", with a spinner and "Completing sign-in…" (`role="status"`) for the instant before the redirect            |
| Data                | no query; the session restore has already used the cookie the API set                                                                                    |
| Components          | `AuthCard`, `Spinner`                                                                                                                                    |
| Transitions         | → `/overview` or `/login?error=google_auth_failed`                                                                                                       |

The walk confirmed the signed-out exit: `/auth/callback` landed on `/login?error=google_auth_failed`. The signed-in exit is from the code.

### `/invitations/accept` — Accept an invitation

![Join Platform](img/auth/invitation-accept--default.jpg)

|                     |                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | The landing page of an invitation email: preview the invitation, then sign in, switch account or accept.                                                                                                              |
| File                | `src/pages/invitations/accept.tsx`                                                                                                                                                                                    |
| Guard and redirects | none: top level, opened signed out and signed in alike. Log in → `/login?redirect=/invitations/accept?token=…`; Create account → `/register?invitation=<token>`.                                                      |
| Layout              | `AuthLayout` + `AuthCard` (`InvitationCard`), rendered by the page                                                                                                                                                    |
| Data                | started: `POST /invitations/preview` (`['invitations', 'preview', token]`; no auth; a failure other than 404 is retried once); `POST /invitations/accept` on accept; `POST /auth/logout` from the wrong-account state |
| Sections            | Chosen by `?token` and who is signed in, below.                                                                                                                                                                       |
| Components          | `AuthCard`, `Skeleton`, `LoadError`, `Alert` (destructive, the refusal), `Button`, `BusyButton` (accept, sign out), `buttonVariants`, `Pii`                                                                           |
| Transitions         | Log in → `/login` and back here; Create account → `/register`; Sign out → here, signed out; Accept invitation → `/overview`; Go to the home page → `/`                                                                |

The page has these states (`AcceptInvitationPage` and `InvitationForToken`):

1. **No `?token`:** "This link is incomplete" and "Go to the home page" (shot: empty).
2. **Malformed token** (fails `invitationTokenSchema`): "This invitation can’t be used" with the server's 404 copy and "Go to the home page", no request made. Seen in the walk with `?token=not-a-real-token`.
3. **Preview pending:** "Checking your invitation" over two skeleton bars (shot: loading).
4. **Preview failed with 404** (revoked, expired or used): "This invitation can’t be used" with the server's message.
5. **Preview failed otherwise:** "We could not load this invitation", a `LoadError` with Try again, and "Go to the home page" (shot: error).
6. **Signed out** (`SignedOut`): "Join {tenant}", "{inviter} invited you to join {tenant} as {role}.", Log in, Create account, and a hint to create the account with the invited address (shot: default; the inviter shows as "A teammate" and the tenant is the platform tenant, "Platform").
7. **Signed in as another address** (`WrongAccount`): the same title and sentence, "This invitation was sent to {invited}. You’re signed in as {current}.", a Sign out button that returns here signed out, and "Go to the home page". Not shot.
8. **Signed in as the invited address** (`AcceptPanel`): the same title and sentence, Accept invitation ("Accepting…" while pending) and "Go to the home page". A 403 shows the refusal inline (`role="alert"`), with a hint to verify the email when the code is `INVITATION_EMAIL_UNVERIFIED`; a 404 replaces the panel with state 4; other failures toast. Success toasts "You joined {tenant}." and opens `/overview`. Not shot.

| Loading                                      | Error                                      | Empty                                      |
| -------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| ![](img/auth/invitation-accept--loading.jpg) | ![](img/auth/invitation-accept--error.jpg) | ![](img/auth/invitation-accept--empty.jpg) |
| skeleton · `h-4 w-3/4` + `h-10`              | alert · `LoadError`                        | No `?token`: "This link is incomplete"     |

Findings: [F-auth-3](findings.md#f-auth-3), [F-auth-4](findings.md#f-auth-4), [F-auth-7](findings.md#f-auth-7)

### `/no-access` — No platform access

![This account has no platform access](img/auth/no-access--default.jpg)

|                     |                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Tell a signed-in account without a platform role that it cannot use the console, name the account, and list the ways in.                                                                                                      |
| File                | `src/pages/no-access.tsx`                                                                                                                                                                                                     |
| Guard and redirects | Its own `beforeLoad`: signed out → `/login`, with no `?redirect` (the walk confirmed it); staff → `/overview`. `_app` sends every signed-in non-staff visitor here, so `/` and any `_app` URL land here for such an account.  |
| Layout              | `AuthLayout` + `AuthCard`, rendered by the page                                                                                                                                                                               |
| Data                | no query; the address comes from the session restore; `POST /auth/logout` from Sign out                                                                                                                                       |
| Sections            | "Signed in as {address}."; three hints: open the invitation link again while signed in, ask a platform admin for an invitation, or verify an allow-listed domain address and sign in again; Sign out (disabled while pending) |
| Components          | `AuthCard`, `Button`, `Pii`                                                                                                                                                                                                   |
| Transitions         | Sign out → `/login` (a full page load); a 401 on sign-out counts as signed out; any other failure toasts                                                                                                                      |

The shot is taken as a signed-in customer account with no platform role; its requests were `POST /auth/refresh` 200 and `GET /profile` 200, and no shell read.
