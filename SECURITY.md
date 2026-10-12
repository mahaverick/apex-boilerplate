# Security

What this app defends against, how, and where the defences stop. Apex is the
staff console. The API it talks to, express-boilerplate, owns every
authorization decision, the refresh cookie, rate limits, CORS and CSRF; its
own `SECURITY.md` covers those, including which routes need a recent sign-in
or a reason. This file covers the browser client and the container that
serves it.

## Threat model for a browser client

The app is a static bundle served by nginx, same-origin with the API it
proxies under `/api`. Anything in the bundle, in `/runtime-config.js` or in
browser storage is readable by whoever runs the page, so:

- **The browser enforces nothing.** A hidden button, a route guard or a
  flag-gated page (`src/observability/flags/require-client-flag.ts`) is
  presentation. The API refuses what the user may not do, so a gated page
  must be backed by a gated API route. On `/platform/*` it refuses with a
  404, not a 403 ([Staff-only access](#staff-only-access)).
- **A same-origin script is the main threat.** It could read the in-memory
  access token and call the API as a staff member. The defences are React's
  escaping and an enforced Content-Security-Policy that admits no inline or
  third-party script ([CSP and headers](#csp-and-headers)). `src/` has one
  raw-markup sink: shadcn's `ChartStyle` (`src/components/ui/chart.tsx`)
  writes a `<style>` element through `dangerouslySetInnerHTML`, built only
  from a chart's static colour config and a `useId` value, never from API
  data. No `innerHTML` is used anywhere.
- **What other people wrote renders as text.** Names, reasons and
  maintenance messages render as text, never markup. Browser-reported
  exceptions and timeline events are attacker text, and a rendered email
  renders only in a sandboxed frame ([Untrusted content](#untrusted-content)).
- **Credentials leave the browser only towards the API.** The access token
  travels in an `Authorization` header, never a URL; the refresh token is an
  httpOnly cookie the client never reads.
- **Shared browsers and multiple tabs.** One refresh cookie serves every tab.
  Where express's `COOKIE_DOMAIN` covers this app's host and the customer
  app's, that cookie is the customer app's too, so a sign-in there as someone
  else ends this tab's session at its next refresh
  (`SessionIdentityChangedError`, below). The analytics identity cookie,
  `ph_apex`, is scoped to this host and shared only between this app's tabs,
  never with a website (`src/observability/analytics/config.ts`). The
  analytics opt-out state is keyed by the PostHog project key alone, so
  another app served from this host with the same key shares it. A tab must
  never act as, or attribute events to, someone other than its own signed-in
  user.
- **Third parties see as little as possible.** Analytics and error tracking
  go to PostHog through the API's `/api/v1/collect` proxy, after masking and
  scrubbing in the browser.

## Token storage and refresh

- **The access token is memory-only.** It lives in the zustand store
  (`src/states/auth.store.ts`) with the user, and nowhere else: never
  `localStorage`, `sessionStorage`, a cookie or a query string, and the store
  has no `persist` middleware. Every page load therefore starts signed out
  and restores the session with one refresh (`bootstrapSession` in
  `src/router.tsx`). This keeps the token out of anything that outlives the
  page; it does not hide it from a script running in the page.
- **The refresh token is an httpOnly cookie** that the browser sends with
  `withCredentials` (`src/http/client.ts`). It belongs to whichever origin
  answers `/api`. Its attributes are the API's.
- **The store is the only source of the bearer token.** The request
  interceptor (`src/http/interceptors.ts`) adds `Authorization: Bearer …`
  only when a request has none, so a default `Authorization` header set
  anywhere would shadow the store's token on every request.
- **Trace and analytics headers go only to this app's API.** `traceparent`
  and `X-POSTHOG-SESSION-ID` are set only on same-origin requests under the
  API prefix; an absolute URL to another origin never carries them.
- **One refresh at a time.** `ensureSession()` in `src/http/session.ts` is
  the only caller of `POST /auth/refresh`. Every caller in a tab awaits the
  same in-flight promise, and tabs queue behind the `auth-refresh` Web Lock,
  because each refresh rotates the shared cookie and the API revokes the
  whole session when a rotated token is presented again outside its 10-second
  reuse grace window. A second call site anywhere reintroduces that race.
- **A refresh that returns someone else ends this tab's session.** The
  refresh loads `/profile` with the new token. When the profile's id differs
  from the tab's user (another tab signed a different person in on the shared
  cookie), the refresh fails with `SessionIdentityChangedError`: this tab
  signs out without broadcasting, so the other tab stays signed in, and
  nothing it started is replayed as the new person.

## Sign-out rules

- **Only an auth verdict signs a user out.** `isAuthVerdict` accepts exactly
  two things: a 401, and `SessionIdentityChangedError`. A 5xx during a rolling
  restart, a 429 from the rate-limited refresh, a malformed 200, a timeout or
  a network failure judges nobody; treating any of them as a verdict signs
  out every user during a deploy. Widen it only with a status the API's
  refresh returns as a judgment on the caller's credentials.
- **The 401 interceptor** (`src/http/interceptors.ts`) distinguishes:
  - a 401 with `ACCESS_TOKEN_EXPIRED`: refresh once, replay once
    (`_retried` stops a loop), and send the user to `/login` only when the
    refresh failed with a verdict;
  - a 401 with `REAUTH_REQUIRED`: the sign-in is too old for the action,
    not a bad session; it rejects untouched for the caller to handle;
  - any other 401 on a request that carried a bearer token: sign this tab
    out, broadcast the logout and redirect to `/login`;
  - a 401 on a request with no token (the sign-in form): a wrong password,
    not a session verdict.
- **`skipAuthRetry` opts a request out of both paths.** It is set on the two
  requests a refresh makes (re-entering `ensureSession()` there would await
  itself), on `POST /auth/logout`, and on the invitation preview, which is
  asked as a stranger.
- **Every tab follows a sign-out.** A sign-out posts `logout` on the `auth`
  BroadcastChannel; a tab that hears it while signed in clears its store and
  loads `/login`. A tab that is not signed in ignores it, and a refresh that
  fails in such a tab broadcasts nothing, so it cannot sign out a sibling
  that just logged in.
- **Choosing to sign out** (`useLogout` in `src/queries/auth.queries.ts`)
  asks the API first. The local session ends when the API confirms, or
  answers 401 because its session is already over; a network error, 5xx or
  429 leaves the user signed in with an error toast, so a sign-out never
  only looks done.
- **A sign-out is a full page load.** `redirectToLogin()` and `useLogout`
  use `window.location.assign`, which discards every in-memory cache.
- **Identity follows the user.** When the store's user changes or clears,
  analytics resets and every flag value and exposure mark is dropped, so the
  next person never sees or sends the last one's (`installAnalyticsIdentity`
  in `src/http/session.ts`).
- **The post-login redirect cannot leave the origin.** `?redirect=` arrives
  from the URL bar. `safeRedirect` (`src/pages/_auth/login.tsx`) accepts only
  a value starting with `/` that the URL parser resolves to this origin and
  whose path does not start with `//`, which refuses `/\t/evil.example` and
  `/..//evil.example`.
- **Passwords.** A password being set (registration, reset, change) needs at
  least 15 code points and at most 72 UTF-8 bytes, bcrypt's limit
  (`src/schemas/auth.schemas.ts`); sign-in and email verification check
  none, as the API does. Changing the password keeps this session; the API
  revokes every other one.
- **An already-verified link.** When `POST /auth/verify-email` answers 409
  with `email_already_verified`, the verify page
  (`src/pages/verify-email.tsx`) treats it as done, not as a failure: it shows
  the API's message and a **Sign in** link to `/login`, and offers no
  resend. The resend form shows the same message whatever the API answers,
  so it never reveals whether an address needs verifying.

## CSP and headers

nginx sends these on every response it answers itself (`nginx.conf`):

| Header                       | Value                                                          |
| ---------------------------- | -------------------------------------------------------------- |
| `Content-Security-Policy`    | see below                                                      |
| `Referrer-Policy`            | `no-referrer`                                                  |
| `X-Content-Type-Options`     | `nosniff`                                                      |
| `X-Frame-Options`            | `DENY`                                                         |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                  |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |

The policy is enforced, not report-only:

    default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
    img-src 'self' data:; connect-src 'self'; object-src 'none';
    base-uri 'none'; frame-ancestors 'none'; form-action 'self'

- **`script-src 'self'` holds because no script is inline.** The pre-paint
  theme script is the file `public/theme-init.js`, loaded by a blocking
  `<script src>`, and `/runtime-config.js` is same-origin. Never add an
  inline script, `'unsafe-inline'` or `'unsafe-eval'` for scripts.
  `src/lib/zod-jitless.ts` turns off Zod's JIT, whose `new Function` probe
  this policy reports as a violation; it is the first import of
  `src/main.tsx`.
- **`style-src 'unsafe-inline'`** is there because sonner injects a `<style>`
  element at runtime, recharts sets inline styles, and `ChartStyle` writes a
  `<style>` element; `e2e/nginx/charts.test.ts` checks the Overview's charts
  draw under this policy with no violation.
- **`connect-src 'self'`** holds because the API, analytics and error
  tracking are all same-origin: posthog-js sends to `/api/v1/collect` and
  loads its recorder from there, so the browser never talks to PostHog.
  Calling another origin from the browser means widening it in `nginx.conf`
  in the same change.
- **Session replay starts no worker.** Recording `<canvas>` content would
  start a `blob:` worker, which `script-src 'self'` blocks (`worker-src`
  falls back to it). Keep canvas recording off in the PostHog project's
  replay settings; `e2e/nginx/analytics.test.ts` asserts replay records under
  this policy with no worker and no violation.
- **No location declares an `add_header`.** In nginx, a location that sets
  any header of its own inherits none of the server block's, so it would
  silently drop every security header. Cache-Control is therefore chosen by
  a `map` on the URI. The security headers carry `always`, so error
  responses get them too.
- **A proxied API response keeps its own headers.** Each header above is
  added only when the upstream response lacks it, so express's stricter API
  values (`default-src 'none'`, `X-Frame-Options: SAMEORIGIN`) pass through
  and none is sent twice: two `Cross-Origin-Opener-Policy` lines do not
  parse, and COOP falls back to `unsafe-none`. nginx's own 502 or 504 for an
  `/api/` request carries the full set.
- **No HSTS.** Whether TLS fronts this container, and which hosts the policy
  covers, is the TLS edge's to decide, so `Strict-Transport-Security` is set
  there, not in `nginx.conf`.
- **The access log keeps no query string.** Its server-level format
  records `$uri`, not `$request`, because every SPA route falls back to
  `index.html`, including `/reset-password?token=…` and
  `/verify-email?token=…`, whose tokens are credentials mailed to users.
  `Referrer-Policy: no-referrer` keeps the page URL out of the logged
  referrer. The invitation preview posts its token in a request body, so it
  stays out of URLs and logs (`src/queries/invitation.queries.ts`).
- **The error log can keep one.** nginx writes the full request line, query
  string included, into every upstream error message, and no log format
  changes that. The error log runs at `notice` (`docker/nginx.main.conf`),
  so an upstream failure under `location /api/` records the query. No
  location lowers its error log level (see [Known gaps](#known-gaps)).
- **No source map is served.** The image deletes every `.map` after the
  upload, and `nginx.conf` answers 404 for any `.map` path outside `/api/`
  even where a file exists. A deploy of `dist/` outside the image must
  delete `*.map` first.
- `server_tokens off` drops the nginx version from the `Server` header and
  error pages.
- The `nginx` Playwright project checks the headers and asserts zero CSP
  violations (`e2e/nginx/headers.test.ts`, `e2e/nginx/csp.test.ts`,
  `e2e/nginx/csp-live.test.ts`), and `docker/check-image.sh` checks the
  built image from outside: user 101, a read-only root, each header sent
  once on proxied and unproxied responses, no source map in the image, a
  refused run-time setting that stops the container without printing its
  value, and a bundle that carries its release and no release id written by
  inject.

## Run-time config injection safety

Settings that differ between environments reach the bundle at container
start, never at build time, as `/runtime-config.js`. The variables, their
patterns and defaults are in the
[README's run-time configuration table](README.md#run-time-configuration).

- **Values are validated before they are written.**
  `docker/10-runtime-config.sh` checks each non-empty value against its
  pattern and refuses one containing a newline. No pattern admits a quote, a
  backslash, `<` or a newline, so the script writes each value into a
  JavaScript string literal unescaped and it cannot break out of it. A
  mismatch stops the container; the error names the variable and never
  prints its value.
- **The file is replaced atomically.** It is written beside the target and
  renamed, so nginx never serves a half-written file, and it sets
  `window.__APP_CONFIG__` with `Object.freeze`. nginx serves it `no-store`.
- **The bundle validates again.** `src/configs/runtime-config.ts` applies the same
  patterns. An invalid value counts as unset, except `ANALYTICS_CONSENT_MODE`,
  which fails closed to `off` rather than falling back to capturing in an app
  whose `config.ts` honours consent modes; a handoff origin list with one origin
  `URL` refuses is dropped whole. Its console warning names the keys, never the
  values. A production bundle reads only `window.__APP_CONFIG__`, so no
  build-time value can configure it.
- **Two shared settings are validated but ignored here.** This app's
  `config.ts` honours no consent mode and reads no handoff, so a valid
  `ANALYTICS_CONSENT_MODE` (`off` included) or `ANALYTICS_HANDOFF_ORIGINS`
  changes nothing; an invalid one still stops the container. Analytics is off
  only when no PostHog key is set.
- **Every value is public.** Each browser fetches `/runtime-config.js`, so
  nothing secret goes in it. The PostHog project key may come from a secret
  store, but it is not a secret.
- **`API_UPSTREAM` is checked too.** `docker/05-prepare.sh` refuses anything
  but `http(s)://host[:port]` with no path, and envsubst substitutes only
  that variable into `nginx.conf`, so a value can neither rewrite the
  proxied URI nor inject nginx syntax or variables.

## Analytics privacy

posthog-js loads only when a PostHog key is set, through a dynamic `import()`
kept out of the first-visit chunks (`pnpm check:bundle`). Without it every
call is a no-op.

The analytics module is shared with react-boilerplate; the per-app constants at
the top of `src/observability/analytics/config.ts` set this app's side of it. Consent
modes are not honoured (`SUPPORTS_CONSENT_MODES` is `false`), so capture
always runs in `opt_out` mode and there is no consent banner. No website's
anonymous id is handed off (`SUPPORTS_HANDOFF` is `false`). The identity
cookie is `ph_apex` (`ANALYTICS_PERSISTENCE_NAME`) and is not shared across
subdomains (`ANALYTICS_CROSS_SUBDOMAIN_COOKIE` is `false`). The query-key
allowlist is set there too.

- **Typed events carry no free text.** Every event and its properties are
  declared in `src/observability/analytics/events.ts`. A property typed as
  any string fails `REGISTRY_HAS_NO_FREE_STRINGS` at compile time, and a key
  passed to `analyticsKey` must be a lowercase literal without a space, `@`,
  `.`, `/`, `:`, `?`, `=`, `&` or `#`. A free string is how a name, an
  address or a search term reaches an event; do not widen it.
- **The browser never sets person or group properties.** `identify` takes
  the user id alone, and this app sets no tenant group; staff status, roles
  and tenant names are set by the server, where a user cannot forge them
  from devtools.
- **Rendered personal data is masked.** Every rendered person name, email
  address, avatar initial and invitation address, and any free text staff
  typed (a reason, a maintenance message), is wrapped in `<Pii>`
  (`src/components/shared/pii.tsx`), whose `ph-sensitive ph-mask` class keeps
  the text out of autocapture's `$el_text` and masks it in replay. Wrap the
  value, not the sentence. Inputs are masked in replay, and autocapture
  masks every element attribute.
- **Replay masks attributes by name** (`mask-attribute.ts`): `aria-label`,
  `title`, `alt`, `placeholder`, `srcdoc`, every `data-*`, an `href` with a
  query or a `mailto:`/`tel:` scheme, and a `src` or `srcset` with a query
  become `***`. That is why an accessible name may carry an address; an
  attribute outside the list may not. Replay records no request headers,
  bodies or JSON-LD, and each recorded request URL is sanitised.
- **Captured URLs keep only allowlisted query keys.**
  `ANALYTICS_URL_QUERY_ALLOWLIST` (`src/observability/analytics/config.ts`)
  is the whole list: `range`, `tab`, `state` and `status`, the enums the
  staff lists put in the URL. The sanitizer
  (`src/observability/analytics/url-sanitizer.ts`) runs as `before_send` and
  rewrites every absolute http(s) string in an event's properties, `$set` and
  `$set_once`, to eight levels deep, plus the hrefs in `$elements` and
  `$elements_chain` and the keys of `$heatmap_data`. The fragment goes, and
  a `mailto:` or `tel:` URL keeps only its scheme. posthog-js's own
  personal-data masking also covers `token`, `email`, `redirect`,
  `invitation`, `q`, `search`, `ph_did` and `ph_sid`. Add a key to the
  allowlist only when its values can never be a token, an address, a search
  term or a redirect.
- **Page titles are fixed words.** Replay records the `<title>` and a page
  view sends it, both unmasked, so every route's title is a literal
  (`pageTitle` in `src/constants/app.ts`), never a record's name or address.
- **Events never cross people** (`guardEvent` in
  `src/observability/analytics/analytics.ts`). posthog-js adopts the
  identity cookie before every event, and this app's other tabs share that
  cookie, so while a user is signed in, any event under another distinct id
  is dropped. If another tab of this app identified that person (announced
  on the `analytics-identity` channel or written to a 60-second
  `localStorage` registry), this tab is superseded: it drops its events and
  refreshes its session to settle who is signed in. Otherwise the user is
  identified again after 250 ms. Never loosen the guard to log-and-send. A
  sign-out resets the SDK but keeps the browser's opt-out answer.
- **The session header never links another person.** `X-POSTHOG-SESSION-ID`
  is sent only while capture is on and PostHog holds either nobody or the
  signed-in user.
- **Opting out.** Capture runs until the user turns analytics off. The
  switch is on the profile in the customer app; this app reads the profile's
  `analyticsOptOut` and applies it before the user is identified
  (`installAnalyticsIdentity` in `src/http/session.ts`), so an opted-out
  user's identify is never captured. The opt-out holds back the SDK's own
  events and replay only: exception reports and flag exposure are sent
  whatever the answer (see below).
- **No handoff.** A website's `?ph_did=&ph_sid=` link parameters are never
  read, so a website visitor's id never merges into a staff person; both
  parameters still leave the address bar on every load (`handoff.ts`).
- **Guards.** `e2e/fixtures/pii.test.ts` checks that every harness person's
  name and every address on the staff pages sits inside `<Pii>`;
  `e2e/nginx/analytics.test.ts` searches everything that reached a fake
  PostHog, decoded, after signed-out pages opened with token-carrying URLs
  and a staff route walk.
- **Flag exposure ignores the opt-out.** The flag hooks report experiment
  keys, never values, to the API's exposure endpoint whatever the analytics
  answer (`src/observability/flags/exposure.ts`); the API re-evaluates each
  key and records the exposure in PostHog for a user who matched a release
  condition or is in the holdout.

## Error-tracking privacy

Browser exceptions go to PostHog Error Tracking through the API's
`/api/v1/collect/batch/` proxy whenever a PostHog key is set
(`src/observability/errors/report.ts`). The opt-out does not stop them: after
a profile opt-out, an exception is still sent, anonymous. Only the SDK's own
events and replay stop for it.

- **What is dropped before anything is built:** API and network failures
  (the API reports its own 5xx), aborts, ResizeObserver noise, a
  cross-origin `Script error.` with no stack, and any error with no frame
  from this app's own files (an extension's), except a failed chunk load.
- **What is scrubbed:** every exception's type and value, and every frame's
  file name and function name, through `scrubText`
  (`src/observability/errors/scrub.ts`). The page URL is reduced to the
  analytics allowlist's query keys, then its path is scrubbed. No request,
  header or form data is attached.
- **Identity follows the opt-out.** An exception carries PostHog's
  distinct id and session only when the user has not opted out, the tab is
  not superseded, and PostHog's person is this tab's signed-in user (or,
  while nobody is signed in, whoever PostHog holds, normally anonymous).
  Otherwise it is anonymous: a fresh distinct id per event and no person
  profile. An error noted more than 10 seconds before the lazy reporter
  received it, or noted before the user or the tab's standing changed, is
  sent anonymous, so it is never attributed to the next person.
- **Volume is capped:** 5 events per fingerprint and 30 per page life.

### The scrubber

`scrub.ts` is express-boilerplate's
`express-boilerplate/src/services/errors/error-scrubber.service.ts` byte for
byte, tested against the same `tests/fixtures/error-scrub-vectors.json`, so a
rule changes in express first and is copied here, never edited here alone.
It replaces Postgres key details and echoed input, URL credentials, query
strings, fragments other than line or heading anchors, the token segment
after `/reset/`, `/verify/`, `/invite/` or `/accept/`, Bearer, Basic and
other Authorization credentials, Cookie values, secret-named keys' values,
JWTs, emails, PostHog and other vendor keys, IP addresses, `+`-prefixed phone
numbers, and long hex and base64 runs, then cuts each text to 1024
characters.

### What it does not catch

Regex scrubbing is best-effort: keep secrets and personal data out of error
messages. Among what it leaves in place:

- names and other free text;
- ids, UUIDs included, kept on purpose for debugging;
- phone numbers in national format, without a leading `+`;
- a bare opaque word with no key in front of it;
- a `code` value outside a query, a form body or an OAuth context, and a
  `key` value written with `:`, so `code: 'ECONNREFUSED'` stays readable;
- a camelCase `pin` (`userPin=1234`);
- vendor tokens with no rule, such as `ya29.` and `glpat-`;
- the text after a Bearer credential on an Authorization line
  (`Bearer [token] extra` keeps `extra`).

The comments in `src/observability/errors/scrub.ts` list what each rule
catches and what it misses.

## Staff-only access

Every page under the signed-in shell is for platform staff: a user holding
any role in the platform tenant. The API decides; the client only keeps
people out of pages that would fail.

- **The shell's guard is presentation.** `beforeLoad` in `src/pages/_app.tsx`
  sends a signed-out visitor to `/login` and a signed-in user without a
  platform role (`isStaff` in `src/constants/roles.ts`) to `/no-access`,
  which names the signed-in address inside `<Pii>` and offers only a sign-out.
- **The API refuses with a 404.** `/platform/*` answers 404, not 403, to a
  user who is not staff and to staff below a route's role, so a refused
  route looks the same as a missing one. `isRoleDenied`
  (`src/queries/platform.queries.ts`) reads any 404 there as "not available
  to you": the page renders `RoleDenied`, queries do not retry it, and the
  maintenance poll stops on it.
- **A 404 is never a sign-out.** It is not an auth verdict
  ([Sign-out rules](#sign-out-rules)). `RoleDenied` offers a reload, which
  re-runs the guard and sends a user who lost their platform role to
  `/no-access`. Do not turn the 404 into a sign-out or a retry loop.
- **Role tiers are mirrored, not enforced.** `platformRoleAtLeast` hides what
  a role cannot use rather than showing it disabled: navigation items
  (`src/constants/navigation.ts`), a tenant's Timeline, Errors and Flags tabs
  (admins, `src/constants/tenant-tabs.ts`), the activity log (admins) and the
  maintenance controls (owners). `canPlatformActorModifyTarget` mirrors the
  API's rule for acting on other staff: an owner may act on any other staff
  member, an admin only on staff below admin, and nobody on themselves. A
  rule changed here and not in express offers actions the API refuses, or
  hides ones it allows.
- **Links into this app name it.** The Google sign-in link sends `app=apex`
  (`GOOGLE_OAUTH_PATH` in `src/constants/routes.ts`), and registration,
  forgot-password and resend-verification send `app: 'apex'`
  (`src/queries/auth.queries.ts`), so the API returns the user, and the
  links it mails, to this app.

## Step-up re-authentication

Some writes need a recent sign-in. Which ones, and how recent, is the API's
decision (`requireRecentAuth` in express-boilerplate). It refuses a stale one
with a 401 whose code is `REAUTH_REQUIRED`.

- **`REAUTH_REQUIRED` is not a verdict.** The 401 interceptor rejects it
  untouched (`src/http/interceptors.ts`), so it neither refreshes nor signs
  out; `isReauthRequired` (`src/lib/step-up.ts`) recognises it.
- **One dialog for the whole shell.** `StepUpProvider`
  (`src/components/features/step-up/step-up-provider.tsx`) wraps the
  signed-in layout once. A write that may need a recent sign-in runs through
  `useStepUp().run`. Every write refused while the dialog is open waits on
  the same confirmation, so two refusals never stack two dialogs and one
  confirmation retries both. `useStepUp` throws outside the provider, where a
  destructive action would have no way to ask.
- **A retry happens once.** After a confirmation the write runs once more; a
  second `REAUTH_REQUIRED` rejects instead of reopening the dialog. A refusal
  whose request carried an older token than the store now holds (another
  write's confirmation landed meanwhile) retries at once, without asking
  (`sentWithCurrentToken`). A dismissal rejects with the original refusal.
  After a dismissal, or a second refusal of the retry, the reason dialog
  asks the user to confirm it's them to continue.
- **The confirmation is a password.** The dialog posts it to
  `POST /auth/reauthenticate` and puts the access token it returns, which
  carries a fresh `auth_time`, in the auth store (`useReauthenticate`). A
  wrong password is a 400 shown on the field, never a 401, so it cannot be
  read as a verdict on the session. The account's sign-in methods are read
  when the dialog opens, from a cache at most 30 seconds old.
- **An account without a password cannot step up here.** The dialog says so
  and links to the user's own page, where an admin or owner can mail
  themselves a set-password link. Setting the password ends every session
  the account has, so the action is repeated after signing in again.
- **A dialog waiting on step-up holds still.** The reason and maintenance
  dialogs ignore Escape and the backdrop while their action runs, so those
  keys reach the step-up dialog on top instead of closing the one beneath.

## Reason prompts

Every staff action the API records a reason for asks for one, which the
API stores in the audit log with the actor's name. `ReasonDialog`
(`src/components/features/reason-dialog.tsx`) asks for suspending,
reactivating, archiving and deleting a tenant; signing a user out
everywhere, deactivating, reactivating and deleting a user; lifting a
suppression; resending an email; marking an onboarding step complete and
sending an onboarding reminder; and member and invitation writes through
platform access. Reissuing a tenant's owner invitation asks in its own
dialog, with the same `reasonSchema`. Other staff writes take no reason:
creating a user or a tenant, renaming a user, editing a tenant's details,
mailing a set-password
or verification link, and removing a member of, or leaving, the platform
tenant. Maintenance changes have their own dialogs
([Maintenance controls](#maintenance-controls)).

- **The reason is bounded safe text.** `reasonSchema`
  (`src/schemas/reason.schemas.ts`) mirrors express's: trimmed, 1 to 500
  characters, multi-line safe text. The dialog renders its description, and
  the value to type, inside `<Pii>`.
- **Irreversible actions need the target typed.** Archiving or deleting a
  tenant asks for its slug; deleting or permanently deleting a user asks for
  their email address (`confirmText`).
- **Reasons on customer tenants follow the access path.** When staff reach a
  customer tenant through platform access (`access: 'platform'` from
  `useMyRole` in `src/queries/tenant.queries.ts`), member and invitation
  writes carry `reason`, in the JSON body, DELETE included, and the API also
  needs a recent sign-in for them. A member of the tenant, the platform
  tenant's own Staff page included, sends none.
- **`REASON_REQUIRED` is a 400.** The API sends it when a write through
  platform access has no valid reason. The dialog puts its message on the
  Reason field; when the page showed member controls (the caller's
  membership went while the page was open), the tenant's detail refetches
  and the staff controls, which ask for a reason, replace them
  (`src/queries/tenant-writes.queries.ts`).
- **Refusals stay in the dialog.** A 403 or 409 shows the API's sentence,
  or the page's own wording of it; a 404 that carries a code shows the API's
  sentence, and one without a code is the role gate, worded as "your role
  can't do this any more". None of them signs anyone out.

## Maintenance controls

Platform owners put customers into read-only or full maintenance from the
Maintenance page; every staff role can read it.

- **The controls are the owner's; the API is the gate.** The page shows the
  change and switch-off buttons only to a platform owner
  (`src/pages/_app/maintenance.tsx`). The change is
  `PUT /platform/maintenance-mode`, run through step-up
  (`useChangeMaintenanceMode` in `src/queries/maintenance-mode.queries.ts`).
- **Switching on or escalating asks the most.** Going from off to any mode,
  or from read-only to full (`isSwitchOn` in `src/lib/maintenance-mode.ts`),
  needs a reason and the API's environment name typed exactly
  (`src/schemas/maintenance-mode.schemas.ts`). The name comes from the
  platform state the API returns, never from a client setting, because one
  image runs in every environment and only the API knows which one it is.
  A mismatch the API catches is `CONFIRMATION_MISMATCH`, shown on that
  field.
- **A change never overwrites one it has not seen.** Each change sends the
  version its dialog opened on as `expectedVersion`. A 409
  `MAINTENANCE_MODE_CONFLICT` cancels any read in flight and reads the state
  again; the dialog shows what someone else saved only when that read is
  newer than the version sent, and otherwise keeps the old version, so the
  next try conflicts again instead of overwriting.
- **Staff read the platform state, not the customer header.** The banner on
  every staff page and the Maintenance page poll
  `GET /platform/maintenance-mode`, every 30 seconds while a mode is on and
  every 60 while it is off, and stop on a 404. The `Maintenance-Mode`
  response header describes what customers get; the API lets staff routes
  through whatever it says.
- **The message and the reason are bounded safe text.** The customer
  message is always 1 to 500 characters of multi-line safe text. The reason
  is optional, up to 500 characters, and required (1 to 500) only when
  switching on or escalating; emptying a pre-filled reason sends
  `reason: null`, which clears the stored one
  (`src/schemas/maintenance-mode.schemas.ts`).
- **Where they render.** Both render as text inside `<Pii>` on the
  Maintenance page (`src/pages/_app/maintenance.tsx`), and the message also
  in the change dialog's customer preview
  (`src/components/features/maintenance/maintenance-preview.tsx`). The
  banner on every staff page and the conflict sentence show neither: they
  state the mode, since when and who changed it, inside `<Pii>` because they
  name that person (`src/lib/maintenance-mode.ts`).

## Untrusted content

Some of what staff see comes from someone the API does not vouch for.

- **A rendered email runs nothing.** The email preview
  (`src/components/features/emails/email-preview.tsx`) puts the message's
  HTML in an `<iframe sandbox="" srcdoc>`: no script runs in it, no form
  submits and it cannot navigate this page, and it inherits this page's CSP.
  The empty `sandbox` also gives the frame an opaque origin, which keeps
  session replay from reading its document; the frame also carries
  `ph-no-capture`. Never add `allow-same-origin`. The preview is re-rendered
  from the message's template, and its token links are masked, since the
  one-time token is never stored.
- **Browser-reported rows are attacker text.** Anyone holding the public
  project key can send an `$exception` or an event. On the Errors pages an
  exception's type and value render as text inside `<Pii>`, and a row that
  claims to come from the server without express's signature carries an
  **Unverified** badge (`src/components/features/errors/errors-panel.tsx`).
  On the timelines only a row express signed is badged Server or Email;
  every other row is badged Browser, "not confirmed by the server"
  (`src/components/features/timeline/timeline-event-row.tsx`).
- **Links out leak no referrer.** Every link that opens a new tab (to
  PostHog, or to the email-tracking docs) carries `rel="noreferrer"`, which
  also withholds `window.opener`.

## Known gaps

- **The container trusts its front.** nginx appends to the client's
  `X-Forwarded-For` and passes on an `X-Forwarded-Proto` of `http` or `https` as
  received, and sets no per-IP connection limit, since every request arrives
  from the TLS terminator's address (`docker/nginx.main.conf`). Expose the
  container only through that terminator.
- **The error log can hold query strings.** An upstream error under
  `location /api/` writes the full request line to the error log at the
  `notice` level. That includes the term (`q`) of every staff search sent as
  a query string, often an email address: the users and tenants directories
  (the command palette's searches among them), the emails list and the
  suppressions list. Where express's `APP_URL` is this container's host, it
  also includes the Google OAuth callback, which the API serves under
  `/api/` with its `code` and `state` in the query; the `code` is
  single-use and short-lived, but it is a credential written to disk. No
  location lowers its error log level.
- **HSTS is the edge's job.** See [CSP and headers](#csp-and-headers).
- **Inline styles are allowed** (`style-src 'unsafe-inline'`), for sonner,
  recharts and `ChartStyle`.
  An injected `<style>` cannot run script, but it can restyle the page.
- **The in-memory token is reachable by an injected script.** Memory-only
  storage stops persistence, not same-origin code; the CSP and React's
  escaping are what keep such code out.
- **Without Web Locks** (an insecure context or an old browser), refreshes
  in different tabs are not serialised, and the API's 10-second reuse grace
  window is the only cover for concurrent rotations.
- **The cross-tab identity registry narrows a race; it does not close it.**
  A tab whose event loop stalls past the 250 ms repair delay can still read
  another tab's storage write late.
- **The opt-out answer outlives a sign-out.** A sign-out keeps the
  browser's opt-out state until the next user signs in and their own
  profile's answer is applied, so the signed-out pages in between follow
  the last user's answer.
- **Record ids and tenant slugs are not masked.** A page path, which every
  page view carries, holds the id of the tenant, user or email it shows.
  Where the PostHog project records network requests in replay, the paths of
  tenant-scoped API calls (`/tenants/:slug/…`) carry the tenant's slug. Page
  titles are fixed words.
- **Canvas recording** in the PostHog project's replay settings would break
  replay under the CSP; it is a project setting, not enforced by this repo.
- **Error scrubbing is regex-based** and misses free text; see
  [What it does not catch](#what-it-does-not-catch).

## Reporting a vulnerability

Report a security problem privately through GitHub's private vulnerability
reporting on this repository: the **Security** tab, then **Report a
vulnerability**. Do not open a public issue for a security problem.
