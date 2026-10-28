# Changelog

## [8.2.1](https://github.com/mahaverick/apex-boilerplate/compare/v8.2.0...v8.2.1) (2026-10-28)


### Bug Fixes

* **billing:** keep held-charge history visible and move focus after a full credit ([#119](https://github.com/mahaverick/apex-boilerplate/issues/119)) ([a36d5a9](https://github.com/mahaverick/apex-boilerplate/commit/a36d5a9684c62d083bce99589c1321e7c2e5738e))

## [8.2.0](https://github.com/mahaverick/apex-boilerplate/compare/v8.1.3...v8.2.0) (2026-10-28)


### Features

* **billing:** show GST tax documents, credit notes and the GSTR-1 export to staff ([#117](https://github.com/mahaverick/apex-boilerplate/issues/117)) ([7b71e9a](https://github.com/mahaverick/apex-boilerplate/commit/7b71e9a565d6b2c6d45df92ea1aca57579e9d964))

## [8.1.3](https://github.com/mahaverick/apex-boilerplate/compare/v8.1.2...v8.1.3) (2026-10-27)


### Bug Fixes

* **e2e:** bound restoreSession's waits and check the restored user; picked autofill flag ([#114](https://github.com/mahaverick/apex-boilerplate/issues/114)) ([ae1a27f](https://github.com/mahaverick/apex-boilerplate/commit/ae1a27f6eea2a12e70c098bdcbe4bb60a48ee8b6))

## [8.1.2](https://github.com/mahaverick/apex-boilerplate/compare/v8.1.1...v8.1.2) (2026-10-27)


### Bug Fixes

* **e2e:** fresh sessions for dark and customer captures; quiet passkey autofill ([#112](https://github.com/mahaverick/apex-boilerplate/issues/112)) ([c7dffbb](https://github.com/mahaverick/apex-boilerplate/commit/c7dffbb8b3d75e4f984dd8c33837d15ce2246dc2))

## [8.1.1](https://github.com/mahaverick/apex-boilerplate/compare/v8.1.0...v8.1.1) (2026-10-27)


### Bug Fixes

* **billing:** grant dates in the tenant's zone, Start trial label, one date format ([#109](https://github.com/mahaverick/apex-boilerplate/issues/109)) ([90a94fb](https://github.com/mahaverick/apex-boilerplate/commit/90a94fb66c5d89324fb3a88905dc26a6b34cebbe))

## [8.1.0](https://github.com/mahaverick/apex-boilerplate/compare/v8.0.4...v8.1.0) (2026-10-26)


### Features

* **billing:** staff billing — tenant Billing tab, actions, Plans page, settings and alerts ([#107](https://github.com/mahaverick/apex-boilerplate/issues/107)) ([28c7077](https://github.com/mahaverick/apex-boilerplate/commit/28c7077eac2be01acbe1ceb22e164ce21d38640a))

## [8.0.4](https://github.com/mahaverick/apex-boilerplate/compare/v8.0.3...v8.0.4) (2026-10-23)


### Performance Improvements

* **ci:** take docker off the critical path ([#105](https://github.com/mahaverick/apex-boilerplate/issues/105)) ([889064f](https://github.com/mahaverick/apex-boilerplate/commit/889064f065654562ea672e8a6ab6021d4e739bf0))

## [8.0.3](https://github.com/mahaverick/apex-boilerplate/compare/v8.0.2...v8.0.3) (2026-10-23)


### Bug Fixes

* **palette:** keep keys typed while focus passes to the palette ([#103](https://github.com/mahaverick/apex-boilerplate/issues/103)) ([b31b66b](https://github.com/mahaverick/apex-boilerplate/commit/b31b66bd2ac2a6a58b372aa16d1743e595640b4c))

## [8.0.2](https://github.com/mahaverick/apex-boilerplate/compare/v8.0.1...v8.0.2) (2026-10-23)


### Bug Fixes

* **e2e:** hide passkey autofill and keep the real failure in the live passkey spec ([#101](https://github.com/mahaverick/apex-boilerplate/issues/101)) ([b7cabc0](https://github.com/mahaverick/apex-boilerplate/commit/b7cabc0279a2fd066f4b8cb500c6330c01712e56))

## [8.0.1](https://github.com/mahaverick/apex-boilerplate/compare/v8.0.0...v8.0.1) (2026-10-23)


### Performance Improvements

* **ci:** faster tests ([#98](https://github.com/mahaverick/apex-boilerplate/issues/98)) ([ea31402](https://github.com/mahaverick/apex-boilerplate/commit/ea3140209fb872bb1a1de5a91717d5a9092c46a5))

## [8.0.0](https://github.com/mahaverick/apex-boilerplate/compare/v7.0.1...v8.0.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* **auth:** Apex now needs express 8.0.1 or later. The step-up link request sends { app: 'apex' }, which older express refuses with 400.

### Features

* **auth:** passkeys for staff sign-in, confirm it's you and account security ([1d54c52](https://github.com/mahaverick/apex-boilerplate/commit/1d54c5276e5a27a1c10bba842dbfbfc2fa99d3e2))

## [7.0.1](https://github.com/mahaverick/apex-boilerplate/compare/v7.0.0...v7.0.1) (2026-10-20)


### Bug Fixes

* **copy:** absolute dates, named references, units and no vague time in apex copy ([#92](https://github.com/mahaverick/apex-boilerplate/issues/92)) ([1d65bb3](https://github.com/mahaverick/apex-boilerplate/commit/1d65bb36bb839d2a75dbf5f2e167d93b0c333a87))

## [7.0.0](https://github.com/mahaverick/apex-boilerplate/compare/v6.0.0...v7.0.0) (2026-10-20)


### ⚠ BREAKING CHANGES

* **errors:** map member and route 404s by code only
* **staff:** apex needs an API that sends member_not_found on every member 404 and not_found on route and role-gate 404s; a codeless "Member not found" 404 is no longer read as a departed member.

### Bug Fixes

* **copy:** reword apex's legacy load errors and toasts to the copy rules ([afee6bc](https://github.com/mahaverick/apex-boilerplate/commit/afee6bc40c23f03ce4eb52129b8aeeb64bf71d25))
* **errors:** map member and route 404s by code only ([afee6bc](https://github.com/mahaverick/apex-boilerplate/commit/afee6bc40c23f03ce4eb52129b8aeeb64bf71d25))
* **errors:** never show express's not_found sentence to staff ([afee6bc](https://github.com/mahaverick/apex-boilerplate/commit/afee6bc40c23f03ce4eb52129b8aeeb64bf71d25))
* **queries:** a cancelled auth providers read aborts its request ([afee6bc](https://github.com/mahaverick/apex-boilerplate/commit/afee6bc40c23f03ce4eb52129b8aeeb64bf71d25))
* **staff:** name the platform tenant "the staff team" wherever staff see it ([afee6bc](https://github.com/mahaverick/apex-boilerplate/commit/afee6bc40c23f03ce4eb52129b8aeeb64bf71d25))
* **users:** label a pending staff invitation "Staff team" ([afee6bc](https://github.com/mahaverick/apex-boilerplate/commit/afee6bc40c23f03ce4eb52129b8aeeb64bf71d25))

## [6.0.0](https://github.com/mahaverick/apex-boilerplate/compare/v5.0.0...v6.0.0) (2026-10-20)


### ⚠ BREAKING CHANGES

* **auth:** Apex no longer calls POST /auth/step-up/google/start or GET /auth/step-up/google, and /auth/confirm no longer handles ?result=confirmed or ?error=step_up_failed (both now show "This link is incomplete"). Removed exports: useStartGoogleStepUp (src/queries/auth.queries.ts), GOOGLE_STEP_UP_PATH (src/constants/routes.ts) and GOOGLE_STEP_UP_TIMEOUT_MS (src/lib/step-up.ts). A derived project that kept a Google step-up path must drop it; the step-up dialog confirms by emailed link only. It works with an express that has removed /auth/step-up/google*.

### Features

* **auth:** drop the Google step-up; confirm it's you by email link only ([69ad981](https://github.com/mahaverick/apex-boilerplate/commit/69ad981497a72d9581f6e18dc268ba7633d228ac))


### Bug Fixes

* **queries:** a cancelled read aborts its request; no request or timer outlives teardown ([#88](https://github.com/mahaverick/apex-boilerplate/issues/88)) ([48c1e4e](https://github.com/mahaverick/apex-boilerplate/commit/48c1e4edcbefeed2daf89b8c5de28b2cd29096e1))

## [5.0.0](https://github.com/mahaverick/apex-boilerplate/compare/v4.3.0...v5.0.0) (2026-10-20)


### ⚠ BREAKING CHANGES

* password sign-in, password step-up and the password pages are removed. Staff sign in and confirm it's them by emailed link or Google: /login requests a link with app 'apex', /auth/link spends it, and /auth/confirm finishes "Confirm it's you" by link or by the Google popup's return. Staff invitations confirm by an emailed link on /invitations/confirm. /register, /forgot-password, /reset-password and /verify-email redirect to /login?notice=sign-in-link. There is no domain auto-join. This needs express >= 6.1.0. Code a derived project must update:
    - Removed: loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, resendVerificationSchema, changePasswordSchema, MIN_PASSWORD_LENGTH and their *Input types (src/schemas/auth.schemas.ts now exports emailSchema and signInLinkRequestSchema); useLogin, useRegister, useForgotPassword, useResetPassword, useVerifyEmail, useResendVerification, useChangePassword and useReauthenticate (src/queries/auth.queries.ts); useSendPasswordSetup and the staff useResendVerification (src/queries/user-admin.queries.ts); useMembers (src/queries/tenant.queries.ts); EMAIL_ALREADY_VERIFIED, INVITATION_EMAIL_UNVERIFIED, AuthProviders.hasPassword and PlatformUserDetail.hasPassword (src/types/api.types.ts); the STEP_UP_DISMISSED export of src/components/features/reason-dialog.tsx (a dialog now words a step-up refusal with stepUpRefusal from src/lib/step-up.ts); ROUTES.register and ROUTES.forgotPassword; the src/pages/_auth/register.tsx and forgot-password.tsx pages; the page_action_password_setup and page_action_resend_verification palette keys.
    - Added: ROUTES.authLink, ROUTES.authConfirm and ROUTES.invitationConfirm; GOOGLE_STEP_UP_PATH (src/constants/routes.ts); useRequestSignInLink, useVerifySignInLink, useRequestStepUpLink, useConfirmStepUpLink and useStartGoogleStepUp (src/queries/auth.queries.ts); useVerifyInvitation and useConfirmInvitation (src/queries/invitation.queries.ts); useSendSignInLink (src/queries/user-admin.queries.ts) and the page_action_send_sign_in_link palette key; useStepUpWaiting and STEP_UP_WAITING_LABEL (src/hooks/use-step-up.ts); holdStepUpWait, isStepUpWaitHeld and STEP_UP_WAIT_LOCK (src/lib/step-up-presence.ts); authTimeOf, isNewConfirmation, stepUpRefusal, STEP_UP_LINK_TTL_MS and GOOGLE_STEP_UP_TIMEOUT_MS (src/lib/step-up.ts); safeLanding (src/lib/landing.ts); requestArrivalFocus, useArrivalFocus and useLeavingFinalFocus; the shared sign-in-link form, link panels, invitation parts and useSignedInElsewhere; broadcastAuthMessage, subscribeAuthMessage and switchIdentity (src/http/session.ts), whose auth channel now carries signed_in and step_up_confirmed.
    - Changed: SocialProvider.href is now hrefFor(redirect?), and SocialSignIn takes a redirect; bannerSentence(view, now) takes a required now in milliseconds; the UserAction union replaces passwordSetup and resendVerification with signInLink, and UserActionTarget drops hasPassword; ROLE_DENIED_ACTION's text changed; the Users list's verified filter is now signedIn (GET /platform/users?signedIn=, keyed on the last sign-in), so old ?verified= links are dropped; the "Never signed in" badge keys on lastLoggedInAt; TenantInvitation and each PlatformUserDetail pending invitation gain lastSentAt and resendAvailableAt; AcceptedInvitation gains alreadyMember; EMAIL_TEMPLATE_KEYS adds sign_in_link, step_up_link, welcome and invitation_confirm, and the retired template keys keep their labels with no resend; the retired audit actions auth.reauthenticated, user.password_setup_sent, user.verification_resent and platform.member.auto_joined move to RETIRED_AUDIT_ACTIONS; ANALYTICS_URL_QUERY_ALLOWLIST adds utm_source, utm_medium, utm_campaign and utm_content (kept only when the value matches ^[a-z0-9_-]{1,64}$); CreateTenantDialog's onCreated is required; messageFrom's fallback text changed; e2e/live/helpers.ts drops PASSWORD, createVerifiedUser and resetPasswordWith, reads links with mailedLink from e2e/capture/mailpit.ts, and acceptInvitationAs takes a URL.

### Features

* passwordless staff sign-in and step-up by email link or Google ([dd52211](https://github.com/mahaverick/apex-boilerplate/commit/dd52211bde6ec72510f094de7d8c7123fbd61ce3))

## [4.3.0](https://github.com/mahaverick/apex-boilerplate/compare/v4.2.1...v4.3.0) (2026-10-17)


### Features

* **palette:** move the palette onto the shared shell, with page actions and recents ([#79](https://github.com/mahaverick/apex-boilerplate/issues/79)) ([1dd2c17](https://github.com/mahaverick/apex-boilerplate/commit/1dd2c176c2194389671d9e6d50a803a0d30653a3))

## [4.2.1](https://github.com/mahaverick/apex-boilerplate/compare/v4.2.0...v4.2.1) (2026-10-17)


### Bug Fixes

* **telemetry:** mask the prefixed list search keys in posthog URLs ([#77](https://github.com/mahaverick/apex-boilerplate/issues/77)) ([2fda5d0](https://github.com/mahaverick/apex-boilerplate/commit/2fda5d0503315ee6d47463a9f7c6fa188d52e294))

## [4.2.0](https://github.com/mahaverick/apex-boilerplate/compare/v4.1.0...v4.2.0) (2026-10-17)


### Features

* **lists:** one shared DataTable for every apex list, on the 5.0.0 list API ([#74](https://github.com/mahaverick/apex-boilerplate/issues/74)) ([063dda2](https://github.com/mahaverick/apex-boilerplate/commit/063dda20934db14bbe96b2d04b4ef1b487e8cf38))

## [4.1.0](https://github.com/mahaverick/apex-boilerplate/compare/v4.0.0...v4.1.0) (2026-10-16)


### Features

* **loading:** styled boot shell, skeleton templates and per-section loading ([#71](https://github.com/mahaverick/apex-boilerplate/issues/71)) ([76c720c](https://github.com/mahaverick/apex-boilerplate/commit/76c720c0f8261c637bceef31ac4f1eb4e2039633))

## [4.0.0](https://github.com/mahaverick/apex-boilerplate/compare/v3.1.0...v4.0.0) (2026-10-16)


### ⚠ BREAKING CHANGES

* drop the Timeline and Errors pages; PostHog holds both ([#69](https://github.com/mahaverick/apex-boilerplate/issues/69))

### Features

* drop the Timeline and Errors pages; PostHog holds both ([#69](https://github.com/mahaverick/apex-boilerplate/issues/69)) ([1bc31eb](https://github.com/mahaverick/apex-boilerplate/commit/1bc31eb84ad6c3fbe605291af115d60731256556))

## [3.1.0](https://github.com/mahaverick/apex-boilerplate/compare/v3.0.0...v3.1.0) (2026-10-15)


### Features

* **ui:** shadcn sweep — shared empty/note/busy/error components, full width ([#67](https://github.com/mahaverick/apex-boilerplate/issues/67)) ([f55937f](https://github.com/mahaverick/apex-boilerplate/commit/f55937f2db3a8ba8c21995d646c487e4eb20b429))

## [3.0.0](https://github.com/mahaverick/apex-boilerplate/compare/v2.2.1...v3.0.0) (2026-10-14)


### ⚠ BREAKING CHANGES

* **toast:** `sonner` is gone. Import `toast` from '@/lib/toast' instead of 'sonner'; `__root.tsx` mounts `<ToastHost />`. Only success, error and warning toasts with `description`, `id` and `action` options exist. The default timeout is Base UI's 5 s (sonner's was 4 s).

### Features

* **toast:** replace sonner with the Base UI toast ([265fa37](https://github.com/mahaverick/apex-boilerplate/commit/265fa37fd81c73808eb07dea4d32249d6c131f0e))

## [2.2.1](https://github.com/mahaverick/apex-boilerplate/compare/v2.2.0...v2.2.1) (2026-10-13)


### Bug Fixes

* **settings:** stop settings cards repeating their page heading ([#60](https://github.com/mahaverick/apex-boilerplate/issues/60)) ([df9d0d0](https://github.com/mahaverick/apex-boilerplate/commit/df9d0d0914f61cec200e324abda787696dc03846))

## [2.2.0](https://github.com/mahaverick/apex-boilerplate/compare/v2.1.0...v2.2.0) (2026-10-13)


### Features

* **settings:** one settings area for account and platform ([#57](https://github.com/mahaverick/apex-boilerplate/issues/57)) ([51f70d2](https://github.com/mahaverick/apex-boilerplate/commit/51f70d24f029d461b34820b81baea77405bfadbe))


### Bug Fixes

* **a11y:** hide the vendored ui icons from assistive tech ([#59](https://github.com/mahaverick/apex-boilerplate/issues/59)) ([7b9a486](https://github.com/mahaverick/apex-boilerplate/commit/7b9a486b9e53ed5d4aa6c18178eb345641a7c03d))

## [2.1.0](https://github.com/mahaverick/apex-boilerplate/compare/v2.0.3...v2.1.0) (2026-10-13)


### Features

* **ui:** restyle on the shadcn base-vega preset with login-03 and sidebar-07 ([#54](https://github.com/mahaverick/apex-boilerplate/issues/54)) ([924e854](https://github.com/mahaverick/apex-boilerplate/commit/924e85489884012056cbaaeb7451e4f6d3c447c7))

## [2.0.3](https://github.com/mahaverick/apex-boilerplate/compare/v2.0.2...v2.0.3) (2026-10-13)


### Bug Fixes

* **observability:** move analytics modules off blocker-matched paths ([#52](https://github.com/mahaverick/apex-boilerplate/issues/52)) ([56275e1](https://github.com/mahaverick/apex-boilerplate/commit/56275e1b397f7baffe07845946f984361d9bf873))

## [2.0.2](https://github.com/mahaverick/apex-boilerplate/compare/v2.0.1...v2.0.2) (2026-10-13)


### Bug Fixes

* **styleseed:** re-pin the engine to v4.2.0 and fix the members locator ([#50](https://github.com/mahaverick/apex-boilerplate/issues/50)) ([e1e33a2](https://github.com/mahaverick/apex-boilerplate/commit/e1e33a2b4eab491d34e5d0c73aaca4de5d7e28c5))

## [2.0.1](https://github.com/mahaverick/apex-boilerplate/compare/v2.0.0...v2.0.1) (2026-10-13)


### Bug Fixes

* close the open follow-ups (callback error log, canvas pin, pii masks, scrubber port) ([#48](https://github.com/mahaverick/apex-boilerplate/issues/48)) ([caffa74](https://github.com/mahaverick/apex-boilerplate/commit/caffa7441ee0f923f58d7fd68e17c423cd7bbffb))

## [2.0.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.10.3...v2.0.0) (2026-10-12)


### ⚠ BREAKING CHANGES

* **auth:** the register, reset-password, change-password and verify-email forms now refuse a password shorter than 15 characters, matching express-boilerplate 4.0.0. Sign-in still accepts existing shorter passwords.

### Features

* **auth:** raise the new-password minimum to 15 characters ([e2bfd9a](https://github.com/mahaverick/apex-boilerplate/commit/e2bfd9a8ef4b108a9bfbedf75eabc4c4589546c6))
* **auth:** show a sign-in link when a verify-email link was already used ([e2bfd9a](https://github.com/mahaverick/apex-boilerplate/commit/e2bfd9a8ef4b108a9bfbedf75eabc4c4589546c6))

## [1.10.3](https://github.com/mahaverick/apex-boilerplate/compare/v1.10.2...v1.10.3) (2026-10-12)


### Bug Fixes

* close the P3 follow-ups (member.left, session events, invite domain, mirror files) ([#43](https://github.com/mahaverick/apex-boilerplate/issues/43)) ([2474efe](https://github.com/mahaverick/apex-boilerplate/commit/2474efec16c5bff753d9a95821f3418b453755dd))

## [1.10.2](https://github.com/mahaverick/apex-boilerplate/compare/v1.10.1...v1.10.2) (2026-10-12)


### Bug Fixes

* **errors:** sync the scrubber with express (AWS key, email query, compass) ([#41](https://github.com/mahaverick/apex-boilerplate/issues/41)) ([1ee2a5c](https://github.com/mahaverick/apex-boilerplate/commit/1ee2a5cd4ca248baefd3a8c36e61a1fbef62c813))

## [1.10.1](https://github.com/mahaverick/apex-boilerplate/compare/v1.10.0...v1.10.1) (2026-10-11)


### Bug Fixes

* **errors:** take the shared scrubber; prune the SSE client, four UI files and dead code ([#37](https://github.com/mahaverick/apex-boilerplate/issues/37)) ([17abde9](https://github.com/mahaverick/apex-boilerplate/commit/17abde91a344376c0b1cbe3a162c0ef1cd57f748))

## [1.10.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.9.0...v1.10.0) (2026-10-10)


### Features

* **members:** member_not_found and active owners, react re-sync, and P1 follow-ups ([#35](https://github.com/mahaverick/apex-boilerplate/issues/35)) ([785c936](https://github.com/mahaverick/apex-boilerplate/commit/785c936dad374547ed3ed3625d26365359502636))

## [1.9.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.8.1...v1.9.0) (2026-10-09)


### Features

* staff reasons, leave a tenant, sign out other sessions, and the cleanup P1 client fixes ([#33](https://github.com/mahaverick/apex-boilerplate/issues/33)) ([b9fe81e](https://github.com/mahaverick/apex-boilerplate/commit/b9fe81e8bc4d9223374663d43caf0c3191504501))

## [1.8.1](https://github.com/mahaverick/apex-boilerplate/compare/v1.8.0...v1.8.1) (2026-10-06)


### Bug Fixes

* **analytics:** let the sibling registry supersede a tab after a stalled event loop ([#31](https://github.com/mahaverick/apex-boilerplate/issues/31)) ([6785476](https://github.com/mahaverick/apex-boilerplate/commit/678547603a0fe28c05648aa74e19aca5f8b69815))

## [1.8.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.7.2...v1.8.0) (2026-10-06)


### Features

* **maintenance:** maintenance page, owner dialogs, banner and status card (sp5e-1) ([#28](https://github.com/mahaverick/apex-boilerplate/issues/28)) ([5d3cdbd](https://github.com/mahaverick/apex-boilerplate/commit/5d3cdbdfbe867d2d9bca7f695ae6642009fb2dda))

## [1.7.2](https://github.com/mahaverick/apex-boilerplate/compare/v1.7.1...v1.7.2) (2026-10-06)


### Bug Fixes

* **flags:** landing pageview flag properties and SP5d review follow-ups ([#25](https://github.com/mahaverick/apex-boilerplate/issues/25)) ([c35b654](https://github.com/mahaverick/apex-boilerplate/commit/c35b65482ec0c092699e07808886a277a6cf7529))

## [1.7.1](https://github.com/mahaverick/apex-boilerplate/compare/v1.7.0...v1.7.1) (2026-10-06)


### Bug Fixes

* **flags:** sync $feature/* in a layout effect and reset it on sign-out ([#23](https://github.com/mahaverick/apex-boilerplate/issues/23)) ([2a82d49](https://github.com/mahaverick/apex-boilerplate/commit/2a82d49c5c7477a8b666bd96aa666a3da1fa0259))

## [1.7.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.6.0...v1.7.0) (2026-10-05)


### Features

* feature flags inspector and shared flags module (sp5d) ([#21](https://github.com/mahaverick/apex-boilerplate/issues/21)) ([cbc5a92](https://github.com/mahaverick/apex-boilerplate/commit/cbc5a9250b7b1e96d4894ac7d92752ceb836cba7))

## [1.6.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.5.0...v1.6.0) (2026-10-05)


### Features

* error tracking, sourcemaps and the errors pages (sp5c) ([#19](https://github.com/mahaverick/apex-boilerplate/issues/19)) ([2da4bc0](https://github.com/mahaverick/apex-boilerplate/commit/2da4bc0b89e818659d8f9e50704583096903bbd6))

## [1.5.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.4.0...v1.5.0) (2026-10-04)


### Features

* posthog user and tenant timelines ([#17](https://github.com/mahaverick/apex-boilerplate/issues/17)) ([4b31d82](https://github.com/mahaverick/apex-boilerplate/commit/4b31d82786d3865154566f63c87b233ea449e7e4))

## [1.4.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.3.2...v1.4.0) (2026-10-03)


### Features

* posthog analytics with run-time configuration, masked replay and pii guards ([#15](https://github.com/mahaverick/apex-boilerplate/issues/15)) ([a0353ac](https://github.com/mahaverick/apex-boilerplate/commit/a0353ace06e2cb1a18d6db4403b024b4115def94))

## [1.3.2](https://github.com/mahaverick/apex-boilerplate/compare/v1.3.1...v1.3.2) (2026-10-02)


### Bug Fixes

* keep keyboard focus when an action replaces its button ([#13](https://github.com/mahaverick/apex-boilerplate/issues/13)) ([561b7a1](https://github.com/mahaverick/apex-boilerplate/commit/561b7a1f8937a440156d913ec4fe852c5794e737))

## [1.3.1](https://github.com/mahaverick/apex-boilerplate/compare/v1.3.0...v1.3.1) (2026-10-02)


### Bug Fixes

* list pages scroll their tables, not the layout, on phones ([#11](https://github.com/mahaverick/apex-boilerplate/issues/11)) ([f2b51ac](https://github.com/mahaverick/apex-boilerplate/commit/f2b51ac3026e226a6a45c5f82ee74d5a698b065d))

## [1.3.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.2.0...v1.3.0) (2026-10-02)


### Features

* onboarding funnel, stuck tenants and reminders (Apex SP4) ([#9](https://github.com/mahaverick/apex-boilerplate/issues/9)) ([911994c](https://github.com/mahaverick/apex-boilerplate/commit/911994cd4231bfd51e5de5bbe07157b3826332bd))

## [1.2.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.1.1...v1.2.0) (2026-10-01)


### Features

* message tracking — emails, deliverability, suppressions (Apex SP3) ([#7](https://github.com/mahaverick/apex-boilerplate/issues/7)) ([09c2c60](https://github.com/mahaverick/apex-boilerplate/commit/09c2c60bdbde2775bb4d2fe9790ef0f03246a4d8))

## [1.1.1](https://github.com/mahaverick/apex-boilerplate/compare/v1.1.0...v1.1.1) (2026-09-30)


### Bug Fixes

* staff UI follow-ups — focus after archive, reactivate flash, narrow-screen crumbs ([#5](https://github.com/mahaverick/apex-boilerplate/issues/5)) ([d62f159](https://github.com/mahaverick/apex-boilerplate/commit/d62f159cc20b68b12da4409232c9054be2a847da))

## [1.1.0](https://github.com/mahaverick/apex-boilerplate/compare/v1.0.0...v1.1.0) (2026-09-30)


### Features

* staff directory and management UI (Apex SP2) ([#3](https://github.com/mahaverick/apex-boilerplate/issues/3)) ([87fffa6](https://github.com/mahaverick/apex-boilerplate/commit/87fffa69c57c3a4f4b2dac7755b5369b8d3ac894))

## 1.0.0 (2026-09-29)


### Features

* **activity:** admin-only platform log with a role-denied state ([6b34867](https://github.com/mahaverick/apex-boilerplate/commit/6b34867d787b65f9fb8072142091f461d5470794))
* **auth:** apex links, Google return, invitation-only registration ([3a83bb0](https://github.com/mahaverick/apex-boilerplate/commit/3a83bb019c5192e157bb155ec3533ed7fe628e12))
* **overview:** key-figure cards and sign-up and email charts from platform stats ([d6d3b19](https://github.com/mahaverick/apex-boilerplate/commit/d6d3b197d4ed743e5e9b03ea4fda3b557a039d36))
* **shell:** role-aware navigation and a Base UI command palette ([341984f](https://github.com/mahaverick/apex-boilerplate/commit/341984f462f47bbc0f57e55bf98970c4bdd1af1e))
* **shell:** staff guard, no-access page and the grouped sidebar shell ([9887c3a](https://github.com/mahaverick/apex-boilerplate/commit/9887c3a379b34f92a2a40a84ef9a62e6ee8d3e10))
* **tenants:** searchable, paged tenant table for staff ([2b147f0](https://github.com/mahaverick/apex-boilerplate/commit/2b147f01e052f1031d21dc767d6e63e76ee53c5a))
* **theme:** indigo-tinted neutrals, chart hues and status tokens ([7cb09d8](https://github.com/mahaverick/apex-boilerplate/commit/7cb09d8fa447da32c2a60c85f018c5e7c75de15a))
* **ui:** add base-nova dashboard components and lock out Radix and cmdk ([ed4a998](https://github.com/mahaverick/apex-boilerplate/commit/ed4a998b874b00069ef4a729e36e4ea31d79ec1a))


### Bug Fixes

* brand mark, platform shortcut hint, register preview errors, overview aria-busy and docs truth ([abcc10e](https://github.com/mahaverick/apex-boilerplate/commit/abcc10e2c1775395bac5468361d34aeef4a01020))
* **overview:** empty states, loaded-state a11y grading, legend contrast proof, stable range switch ([d3f2586](https://github.com/mahaverick/apex-boilerplate/commit/d3f2586d90f6070f5c4ba43d9bd58008c882d705))
* **shell:** harden the command palette's reset, shortcut and tenant states ([8cb80d9](https://github.com/mahaverick/apex-boilerplate/commit/8cb80d98bcd3f6a3a8d218bb378e2c462ae5e5d6))
* **tenants:** keep in-flight keystrokes, honest page counter, way back from a failed page ([72752b7](https://github.com/mahaverick/apex-boilerplate/commit/72752b771306d2f7936c6dbd1c5d86edf31b33d9))
* **theme:** darken --chart-3 to 3:1 on the card; measure no-access, the palette and chart series ([580dddc](https://github.com/mahaverick/apex-boilerplate/commit/580dddcdc178267b14aa06090ec44589aa16b77f))
