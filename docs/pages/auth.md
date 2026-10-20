# Auth

The signed-out pages, the pages a mailed link opens, and the page for a signed-in account that is not platform staff. Back to the [route map](README.md#route-map).

All of them render inside `AuthLayout` (`src/components/layouts/auth-layout.tsx`): a muted full-height page with one narrow centred column (`max-w-sm`), which `AuthCard` (`src/components/layouts/auth-card.tsx`) fills with the app's mark and name over one card. The card's header holds the page's `h1` and description, centred, over its content. There is no brand panel and no terms line: Apex is an internal tool. `/login` sits under the `_auth` layout route, whose `beforeLoad` sends a signed-in user to `/overview` (and from there `_app` sends a non-staff account on to `/no-access`). `/auth/callback`, `/auth/link`, `/auth/confirm`, `/invitations/accept`, `/invitations/confirm` and `/no-access` are top-level routes outside `_auth`, because a signed-in user opens them too; each renders `AuthLayout` itself. None of these pages awaits a request before it renders, beyond the boot's `POST /auth/refresh` ([boot.md](boot.md#what-happens)).

Staff sign in by emailed link or Google. There is no password, no registration, no password reset and no email verification. Apex has no public sign-up, and an Apex link or Google sign-in never creates an account: a new staff member joins by invitation. The shots of these pages are retaken once a live express 6 stack runs (`pnpm capture:pages`); until then the pages below have no shot.

### `/login` — Sign in

|                     |                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Ask for a sign-in link by email, or sign in with Google.                                                                                                                                                                                                                                                                                                                            |
| File                | `src/pages/_auth/login.tsx`, rendering `SignInLinkForm` (`src/components/features/auth/sign-in-link-form.tsx`) and `SocialSignIn`                                                                                                                                                                                                                                                   |
| Guard and redirects | `_auth`: signed in → `/overview`. `?redirect=` is sent with the link request and with Google when `safeLanding` accepts it (a same-origin path that is not a token page); an unsafe one is dropped, not sent. `?notice=sign-in-link` (from a retired password path) shows "Sign in with an email link or Google. Passwords no longer work." `?error=<code>` raises one error toast. |
| Layout              | `AuthLayout` + `AuthCard`, titled "Sign in to Apex", described "Enter your staff email and we’ll send you a link to sign in."                                                                                                                                                                                                                                                       |
| Data                | no query; `POST /auth/link/request` (`{ email, app: 'apex', redirect? }`) on submit and on Resend                                                                                                                                                                                                                                                                                   |
| Sections            | The Email field and "Email me a sign-in link", then an "or" divider and Continue with Google. After a `202`, Check your inbox (below).                                                                                                                                                                                                                                              |
| Components          | `Form`, `FormField`, `FormError`, `Input`, `BusyButton`, `FieldGroup`, `FieldSeparator`, `Pii`, `Note`                                                                                                                                                                                                                                                                              |
| Transitions         | Email me a sign-in link → Check your inbox (same URL); the mailed link → `/auth/link`; Continue with Google → the API's Google flow → `/auth/callback`; another tab that opens the link → this tab lands on `?redirect` or `/overview`                                                                                                                                              |

**Check your inbox.** The title becomes "Check your inbox". The status line reads "We sent a sign-in link to {address}." and the next line "The link works once and expires in 15 minutes." Resend waits 60 seconds after each send ("Resend in 0:42", focusable while it waits); a 429 extends the wait to its `Retry-After`. "Use a different email" returns to the form with the address kept. While this step shows, the page listens for another tab's `signed_in` and restores the shared session when it hears one. The API answers the same `202` for an address with no staff account, so the page never says which addresses are staff.

**`?error=` codes** (from the API's Google callback):

| Code                   | Toast                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google_auth_failed`   | Google sign-in didn’t work for this account. Use your staff Google account, sign in with an email link, or ask a platform admin for an invitation. |
| `email_not_verified`   | Google hasn’t verified this email address. Verify it with Google, or sign in with an email link.                                                   |
| `google_email_missing` | Your Google account didn’t share an email address. Sign in with an email link.                                                                     |
| `processing_failed`    | We couldn’t finish signing you in with Google. Try again, or sign in with an email link.                                                           |
| anything else          | Sign-in didn’t work. Try again, or sign in with an email link.                                                                                     |

On Apex every refused Google profile (unknown, a customer, a deactivated account) is the one `google_auth_failed`, in every maintenance mode, so no toast says which.

### `/auth/link` — Sign in by emailed link

|                     |                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Where a mailed sign-in link opens (`/auth/link?token=…&email=…[&redirect=…]`): spend the token and land signed in.                                                                                                      |
| File                | `src/pages/auth/link.tsx`                                                                                                                                                                                               |
| Guard and redirects | none (top level). Lands with `replace`, so Back never returns to the token: the response's `redirect`, then the link's, through `safeLanding`; else `/overview`, whose guard sends a non-staff account to `/no-access`. |
| Layout              | `AuthLayout` + `AuthCard`, rendered by the page                                                                                                                                                                         |
| Data                | started: `POST /auth/link/verify` (`{ token, email }`, no bearer) once per page load, from a ref-guarded effect, when signed out; on the dead link `POST /auth/link/request`; on Continue `POST /auth/logout`           |
| Components          | `AuthCard`, `SigningInStatus`, `SwitchAccountPanel`, `VerifyFailedPanel` (`src/components/features/auth/link-panels.tsx`), `SignInLinkForm`, `Pii`                                                                      |
| Transitions         | as in the states below; after a verify the page posts `signed_in`, so another tab waiting on Check your inbox moves on too                                                                                              |

The page has these states:

1. **Verifying** (signed out): "Signing you in", with "Signing you in…" and the link's address, then the address the server signed in.
2. **Dead link** (any 400, or no `?token` while signed out): "This link expired or was already used", described "The link works once and expires in 15 minutes.", and the sign-in form prefilled with the link's address, its button "Email me a new link". The new link keeps the old one's `redirect`. A non-staff account's link is refused with the same 400, so the page never says which.
3. **Retryable failure** (429, 503, a network error or a 5xx): "We couldn’t sign you in", the reason (a 429 names its wait, "Too many sign-in attempts. Try again in 42 seconds.") and Try again. The link stays usable. A read-only refusal says "We can’t create new accounts during maintenance. Sign in to an account you already have, or try again when maintenance ends."; express sends it only when the click would create an account, which only a customer-app link opened here can do.
4. **Signed in as the link's address:** goes straight on to the link's `redirect` or `/overview`, spending nothing.
5. **Signed in as someone else:** "Switch account?", "You’re signed in as {current}. This link is for {target}.", Continue as {target} (signs out and reloads this URL as it opened, which then verifies) and Stay signed in as {current} (→ `/overview`).

### `/auth/callback` — Google sign-in return

No shot: the page redirects as soon as it mounts.

|                     |                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Where the API's Google callback lands (`/auth/callback[?redirect=…]`); sends the user on.                                                                                                                         |
| File                | `src/pages/auth/callback.tsx`                                                                                                                                                                                     |
| Guard and redirects | none (top level). In an effect, with `replace`: signed out → `/login?error=google_auth_failed`; else `?redirect=` when `safeLanding` accepts it (same origin, not a token page, decoded first); else `/overview`. |
| Layout              | `AuthLayout` + `AuthCard` titled "Signing in", with a spinner and "Completing sign-in…" (`role="status"`) for the instant before the redirect                                                                     |
| Data                | no query; the session restore has already used the cookie the API set                                                                                                                                             |
| Components          | `AuthCard`, `Spinner`                                                                                                                                                                                             |
| Transitions         | → the redirect, `/overview`, or `/login?error=google_auth_failed`                                                                                                                                                 |

A Google failure the API detects itself never reaches this page: the API redirects to `/login?error=<code>` (the table above). Apex Google never creates an account, so the API's `new=1` never arrives.

### `/auth/confirm` — Confirm it’s you

No shot yet.

|                     |                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Where "Confirm it’s you" finishes: the emailed step-up link (`/auth/confirm?token=…`), its one method.                                                                                                                                                   |
| File                | `src/pages/auth/confirm.tsx`                                                                                                                                                                                                                             |
| Guard and redirects | none (top level). The query is read once, at mount. Once a link's outcome is final, `token` leaves the address bar, so a reload shows the incomplete-link card instead of posting a spent link.                                                          |
| Layout              | `AuthLayout` + `AuthCard`, rendered by the page                                                                                                                                                                                                          |
| Data                | started, signed in with `?token`: `POST /auth/step-up/link/verify` once per page load (`skipAuthRetry`; an expired access token is refreshed once and the post retried); `navigator.locks.query()` before each post. Without `?token` nothing is posted. |
| Components          | `AuthCard`, `SigningInStatus`, `VerifyFailedPanel`                                                                                                                                                                                                       |
| Transitions         | after a confirm the page posts `step_up_confirmed`, and the dialog waiting in the tab that asked refreshes the session and retries its action once                                                                                                       |

The page has these states:

1. **No `?token`** (any other query included): "This link is incomplete", "Open the most recent confirmation email and use its link." Nothing is posted or broadcast.
2. **Signed out:** "Sign in to confirm", "This link works only in the browser and session that asked for it. If you signed out here, sign in and repeat the action.", and Sign in. Nothing is posted.
3. **Confirming:** "Confirming it’s you", with "Confirming it’s you…".
4. **Confirmed**, worded by the wait lock read before the post: a tab holds it, "You can close this tab."; none does, "Go back to Apex and try the action again." with Go to Overview; no Web Locks, "Return to the Apex tab where you started. If you closed it, try the action again."
5. **400** (expired, used, or another session's link; the API answers all three alike): "This link didn’t confirm it’s you", "Open the link in the browser where you asked for it, within 15 minutes. For a new link, try the action again." Nothing is elevated.
6. **404** (the role gate; the link stays unspent): "Your staff access changed", "Ask a platform owner to check your role, then go to Overview.", and Go to Overview.
7. **401** after the one refresh: "Your session ended", "Sign in again, then repeat the action.", and Sign in (a full page load).
8. **Anything else:** "We couldn’t confirm it’s you", the reason and Try again. The token stays in the URL, so a reload tries again.

### `/register`, `/forgot-password`, `/reset-password`, `/verify-email` — retired

Each redirects in `beforeLoad` to `/login?notice=sign-in-link`, dropping any `?token=`, before anything renders (`src/pages/{register,forgot-password,reset-password,verify-email}.tsx`). Old mailed links and bookmarks still reach them. The boot shell paints the auth card for them (`public/boot-variant.js`).

### `/invitations/accept` — Accept an invitation

|                     |                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | The landing page of a staff invitation email: join in one click when signed in as the invitee, or confirm by an emailed link.                                                                                                                                                                           |
| File                | `src/pages/invitations/accept.tsx`, with the shared parts in `src/components/features/invitations/invitation-parts.tsx` and `src/hooks/use-signed-in-elsewhere.ts`                                                                                                                                      |
| Guard and redirects | none: top level, opened signed out and signed in alike. A join lands on `/overview` (replace) with the toast "You joined {tenant} as {address}."                                                                                                                                                        |
| Layout              | `AuthLayout` + `AuthCard` (`InvitationCard`), rendered by the page                                                                                                                                                                                                                                      |
| Data                | started: `POST /invitations/preview` (`['invitations', 'preview', token]`; no auth); then, once per page load, `POST /invitations/verify` signed out or `POST /invitations/accept` signed in as the invitee; `POST /auth/logout` on Continue; `POST /auth/link/request` from the dead invitation's form |
| Sections            | Chosen by `?token`, the preview and who is signed in, below.                                                                                                                                                                                                                                            |
| Components          | `AuthCard`, `Skeleton`, `LoadError`, `SigningInStatus`, `SwitchAccountPanel`, `VerifyFailedPanel`, `InvitationInbox`, `SignInLinkForm`, `Pii`                                                                                                                                                           |
| Transitions         | as in the states below; Go to the home page → `/`                                                                                                                                                                                                                                                       |

The page has these states (`AcceptInvitationPage` and `InvitationForToken`):

1. **No `?token`:** "This link is incomplete", "Part of this link is missing. Open the most recent invitation email and select Join.", and "Go to the home page".
2. **Malformed token, or a 404** (revoked, expired or used): "This invitation can’t be used", described "Ask {inviter} for a new invite." when a live preview named one, else "Ask a platform admin for a new invite." Signed in, "Go to Overview"; signed out, "Or sign in:" and the sign-in form, with no address and no redirect.
3. **Preview pending:** "Checking your invitation" over skeleton bars: a sentence, two buttons and a hint.
4. **Preview failed otherwise:** "We couldn’t check this invitation", a `LoadError` reading "Your invitation link still works. Select Try again.", and "Go to the home page".
5. **Joining** (signed out, or signed in as the invited address): "Joining {tenant}", "{inviter} invited you to join {tenant} as {role}.", and "Joining {tenant} as {invited address}…". The address is the preview's, never a URL parameter.
6. **Check your inbox** (signed out; a staff invitation's verify always answers `202`): "We sent a link to {address}.", "Open it to join {tenant}. The link works once and expires in 15 minutes.", Resend (waits 60 seconds; a 429 extends it), and "Go to the home page". The page listens for another tab's `signed_in` from the confirmation link, including after a failed Resend, and then lands on Overview, with the join toast only when the restored account is the mailed address.
7. **Retryable failure:** "We couldn’t add you to {tenant}", the reason and Try again.
8. **Signed in as another address:** "Join {tenant}", the invitation sentence, "This invitation is for {invited}. You’re signed in as {current}.", Continue (signs out and reloads this page signed out, which then verifies) and Cancel (→ `/overview`).
9. **Used link, signed in as the invitee:** the accept answers `alreadyMember`, and the page lands with "You’ve already joined {tenant} as {address}."

Findings: [F-auth-3](findings.md#f-auth-3), [F-auth-4](findings.md#f-auth-4)

### `/invitations/confirm` — Confirm a join

No shot yet.

|                     |                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Where the confirmation link mailed after a `202` opens (`/invitations/confirm?token=…&email=…`): join the platform tenant as staff and sign in.                                                                   |
| File                | `src/pages/invitations/confirm.tsx`                                                                                                                                                                               |
| Guard and redirects | none (top level). Lands on `/overview` (replace) with the join toast.                                                                                                                                             |
| Layout              | `AuthLayout` + `AuthCard` (`InvitationCard`), rendered by the page                                                                                                                                                |
| Data                | started: `POST /invitations/confirm` (`{ token, email }`) once per page load, signed out or signed in as the link's address; `POST /auth/logout` on Continue; `POST /auth/link/request` from the dead link's form |
| Components          | `InvitationCard`, `SigningInStatus`, `SwitchAccountPanel`, `VerifyFailedPanel`, `ConfirmLinkDead`, `ConfirmLinkIncomplete`, `SignInLinkForm`                                                                      |
| Transitions         | after a `200` the page posts `signed_in`, so the accept page waiting on Check your inbox lands too                                                                                                                |

States: "Joining your team" while the confirm runs; "This link is incomplete" without a token or an address; "This link can’t be used" for a malformed link or a 404, described "Open your invitation email and select Join again to get a new link, or ask the person who invited you for a new invite." (signed in: "Go to Overview"; signed out: the sign-in form); "We couldn’t add you to your team" with Try again for anything else, a `503 MAINTENANCE_MODE` included; and "Join your team" with Continue and Cancel when someone else is signed in.

### `/no-access` — No platform access

No shot yet: the copy changed with the passwordless release.

|                     |                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Tell a signed-in account without a platform role that it cannot use the console, name the account, and list the ways in.                                                                                                        |
| File                | `src/pages/no-access.tsx`                                                                                                                                                                                                       |
| Guard and redirects | Its own `beforeLoad`: signed out → `/login`, with no `?redirect`; staff → `/overview`. `_app` sends every signed-in non-staff visitor here, so `/` and any `_app` URL land here for such an account.                            |
| Layout              | `AuthLayout` + `AuthCard`, rendered by the page                                                                                                                                                                                 |
| Data                | no query; the address comes from the session restore; `POST /auth/logout` from Sign out                                                                                                                                         |
| Sections            | "Signed in as {address}."; two hints: "If you were invited, open the invitation email and select Join." and "Otherwise, ask a platform admin to invite you."; Sign out (disabled while pending). Staff join only by invitation. |
| Components          | `AuthCard`, `Button`, `Pii`                                                                                                                                                                                                     |
| Transitions         | Sign out → `/login` (a full page load); a 401 on sign-out counts as signed out; any other failure toasts                                                                                                                        |
