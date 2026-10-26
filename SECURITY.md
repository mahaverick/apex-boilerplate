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
- **What other people wrote renders as text.** Names, reasons, audit-entry
  metadata and maintenance messages render as text, never markup, and a
  rendered email renders only in a sandboxed frame ([Untrusted content](#untrusted-content)).
- **Credentials leave the browser only towards the API.** The access token
  travels in an `Authorization` header, never a URL; the refresh token is an
  httpOnly cookie the client never reads.
- **Shared browsers and multiple tabs.** One refresh cookie serves every tab.
  Where express's `COOKIE_DOMAIN` covers this app's host and the customer
  app's, that cookie is the customer app's too, so a sign-in there as someone
  else ends this tab's session at its next refresh
  (`SessionIdentityChangedError`, below). The analytics identity cookie,
  `ph_apex`, is scoped to this host and shared only between this app's tabs,
  never with a website (`src/observability/telemetry/config.ts`). The
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
  - a 401 on a request with no token (a link request or a token page's
    verify): an answer about that request, not a session verdict.
- **`skipAuthRetry` opts a request out of both paths.** It is set on the two
  requests a refresh makes (re-entering `ensureSession()` there would await
  itself), on `POST /auth/logout`, on every request a signed-out visitor
  makes with a mailed link (the link request, the link verify, and the
  invitation preview, verify and confirm, each sent with no bearer), and on
  the step-up link verify, which refreshes an expired access token once
  itself so the token never travels into `/login?redirect=`.
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
- **A sign-in in one tab reaches only a tab that waits for it.** The page
  that spends a sign-in or invitation-confirm link posts `signed_in`, with no
  data. Only a tab with a link out listens: the sign-in form's "Check your
  inbox" step, and the accept page while its confirmation link is out (its
  Try again panel after a failed Resend included). It acts only while it is
  signed out; it restores the shared session through `ensureSession()`, the
  same refresh as a reload, so the message itself grants nothing. A tab that
  is already signed in ignores it.
- **A link never signs in over another account.** When a sign-in or
  invitation link opens in a tab signed in as someone else, the page asks
  first. "Continue" signs the current account out through the API (every
  tab hears the logout) and reloads the page signed out before it posts the
  token, so the token never travels with the other account's bearer.
- **The page names the address it signs in.** A link carries its address,
  and the sign-in page sends it back with the token; express refuses a
  mismatch without spending the link. While verifying, the page shows the
  link's address, then the address the server signed in. The invitation
  confirm page does the same with its link's address. The accept page names
  only the address from the server's preview or answer, never one from the
  URL. This is the mitigation for login CSRF, which any emailed link allows:
  an attacker's own link would sign a victim into the attacker's account, so
  the victim sees whose account it is.
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
- **A landing cannot leave the origin.** `safeRedirect`
  (`src/lib/safe-redirect.ts`) accepts only a value starting with `/` that the
  URL parser resolves to this origin, whose path does not start with `//`,
  and whose resolved path is at most 2048 characters, the API's limit. It
  refuses `/\t/evil.example` and `/..//evil.example`. Every landing passes
  through it: `/login`'s `?redirect=`, the link's `redirect` hint, the verify
  response's `redirect` and the Google callback's `?redirect=`. `/login` drops
  an unsafe hint rather than sending it. No landing and no carried redirect
  is ever a token page (`safeLanding` in `src/lib/landing.ts`: `/auth/link`,
  `/auth/confirm`, `/invitations/accept`, `/invitations/confirm`): carried,
  its token would be mailed again inside the new link; landed on, the page
  on screen would never act on it. `safeLanding` decodes the path before the
  check, as the router does before it matches, so `/auth/%6Cink` counts as
  `/auth/link`, and a path that does not decode is refused. Each landing
  replaces the token page in history, so Back never returns to it.
- **A token is posted once per page load.** `/auth/link`, `/auth/confirm`
  and the invitation pages post their token from a mutation that a
  ref-guarded effect fires, so StrictMode's second run and a re-render never
  spend the link twice. A query would post it again on refocus or reconnect.
  The invitation preview is a query because it spends nothing.
- **No password anywhere.** Staff sign in by emailed link or Google, and
  confirm it's them the same two ways. No page, form, schema or query takes
  a password, and `/register`, `/forgot-password`, `/reset-password` and
  `/verify-email` only redirect to `/login?notice=sign-in-link`, dropping
  their `?token=` before anything renders.

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
  scripts are the files `public/theme-init.js` and `public/boot-variant.js`,
  each loaded by a blocking `<script src>`, and `/runtime-config.js` is same-origin. Never add an
  inline script, `'unsafe-inline'` or `'unsafe-eval'` for scripts.
  `src/lib/zod-jitless.ts` turns off Zod's JIT, whose `new Function` probe
  this policy reports as a violation; it is the first import of
  `src/main.tsx` and of every source file that imports Zod as a value.
- **`style-src 'unsafe-inline'`** is there for three reasons. `ChartStyle`
  (`src/components/ui/chart.tsx`) writes a `<style>` element, and so do Base
  UI's `Select` popup and `ScrollArea` (the command palette), to hide their
  scrollbars; `e2e/nginx/charts.test.ts` checks the Overview's charts draw
  under this policy with no violation. And `index.html` carries the boot
  shell's inline `<style id="boot-tokens">` and `<style id="boot-shell">`
  blocks, so the first paint needs no stylesheet request; a static
  `index.html` cannot carry a nonce, and only a hash source per block could
  stand in for the keyword. React applies `style` props through the
  CSSOM, which the policy does not govern, so the toast's and the sidebar's
  inline CSS variables do not need it. Base UI's `CSPProvider` with
  `disableStyleElements` would drop Base UI's `<style>` elements, once their
  rules live in `globals.css`, but `ChartStyle` and the boot shell's inline style would still need it.
- **`connect-src 'self'`** holds because the API, analytics and error
  tracking are all same-origin: posthog-js sends to `/api/v1/collect` and
  loads its recorder from there, so the browser never talks to PostHog.
  Calling another origin from the browser means widening it in `nginx.conf`
  in the same change.
- **Session replay starts no worker.** Recording `<canvas>` content would
  start a `blob:` worker, which `script-src 'self'` blocks (`worker-src`
  falls back to it). The options pin
  `session_recording.captureCanvas.recordCanvas: false`, which overrides the
  PostHog project's replay setting, so the project cannot turn canvas
  recording on. `e2e/nginx/analytics.test.ts` asserts replay records under
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
  `index.html`, including the token pages: `/auth/link?token=…&email=…`,
  `/auth/confirm?token=…`, `/invitations/accept?token=…` and
  `/invitations/confirm?token=…&email=…`, whose tokens are credentials
  mailed to users.
  `Referrer-Policy: no-referrer` keeps the page URL out of the logged
  referrer. The invitation preview posts its token in a request body, so it
  stays out of URLs and logs (`src/queries/invitation.queries.ts`).
- **The error log can keep one.** nginx writes the full request line, query
  string included, into every upstream error message, and no log format
  changes that. A request-line leak happens at every level up to `error`, so
  the level (`notice`, `docker/nginx.main.conf`) does not matter; only `crit`
  drops it. The Google OAuth callback's location
  (`location ~* ^/api/v1/auth/google/callback/?$`) sets its error log level
  to `crit`, which silences those messages there; no other location does
  (see [Known gaps](#known-gaps)).
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
  value, an upstream error on the Google OAuth callback (exact, with a
  trailing slash, or in mixed case) that writes none of its query string to
  the log while another `/api/` path still logs its request, and a bundle
  that carries its release and no release id written by inject.

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
  proxied URI nor inject nginx syntax or variables. Its refusal message
  never shows the value.

## Analytics privacy

posthog-js loads only when a PostHog key is set, through a dynamic `import()`
kept out of the first-visit chunks (`pnpm check:bundle`). Without it every
call is a no-op.

The analytics module is shared with react-boilerplate; the per-app constants at
the top of `src/observability/telemetry/config.ts` set this app's side of it. Consent
modes are not honoured (`SUPPORTS_CONSENT_MODES` is `false`), so capture
always runs in `opt_out` mode and there is no consent banner. No website's
anonymous id is handed off (`SUPPORTS_HANDOFF` is `false`). The identity
cookie is `ph_apex` (`ANALYTICS_PERSISTENCE_NAME`) and is not shared across
subdomains (`ANALYTICS_CROSS_SUBDOMAIN_COOKIE` is `false`). The query-key
allowlist is set there too.

- **Typed events carry no free text.** Every event and its properties are
  declared in `src/observability/telemetry/event-registry.ts`. A property typed as
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
  value, not the sentence. A sentence a builder returns as a string
  (`auditSentence`, `bannerSentence`, `conflictSentence`,
  the maintenance preview) is masked whole, the safe default, as is a string
  `ReasonDialog` description. Inputs are masked in replay, and autocapture masks
  every element attribute.
- **Replay masks attributes by name** (`mask-attribute.ts`): `aria-label`,
  `title`, `alt`, `placeholder`, `srcdoc`, every `data-*`, an `href` with a
  query or a `mailto:`/`tel:` scheme, and a `src` or `srcset` with a query
  become `***`. That is why an accessible name may carry an address; an
  attribute outside the list may not. Replay records no request headers,
  bodies or JSON-LD, and each recorded request URL is sanitised.
- **Captured URLs keep only allowlisted query keys.**
  `ANALYTICS_URL_QUERY_ALLOWLIST` (`src/observability/telemetry/config.ts`)
  is the whole list: `range`, `tab`, `state` and `status`, the enums the
  staff lists put in the URL, and the campaign keys express puts on every
  link it mails (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`),
  so a mailed link's landing page view keeps its campaign while its `token`
  and `email` go. The sanitizer keeps a `utm_*` value only when it matches
  `^[a-z0-9_-]{1,64}$`, the shape of every value express sends, and otherwise
  drops the key with its value; an `@`, a `.`, uppercase, or a value longer
  than 64 characters never reaches PostHog. The sanitizer
  (`src/observability/telemetry/url-sanitizer.ts`) runs as `before_send` and
  rewrites every absolute http(s) string in an event's properties, `$set` and
  `$set_once`, to eight levels deep, plus the hrefs in `$elements` and
  `$elements_chain` and the keys of `$heatmap_data`. The fragment goes, and
  a `mailto:` or `tel:` URL keeps only its scheme. posthog-js's own
  personal-data masking also covers `token`, `email`, `redirect`,
  `invitation`, `q`, `search`, `ph_did` and `ph_sid`. Add a key to the
  allowlist only when its values can never be a token, an address, a search
  term or a redirect. The `utm_*` keys are the one exception: their values
  arrive from the URL, so the sanitizer's value check above is what keeps an
  address or a token out (the UTM rule of 2026-10-19).
- **Page titles are fixed words.** Replay records the `<title>` and a page
  view sends it, both unmasked, so every route's title is a literal
  (`pageTitle` in `src/constants/app.ts`), never a record's name or address.
- **Events never cross people** (`guardEvent` in
  `src/observability/telemetry/telemetry.ts`). posthog-js adopts the
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
other Authorization credentials (Bearer and Basic with the unquoted or
quoted `,key=value` or `;key=value` pairs glued to them), Cookie values,
secret-named keys' values, JWTs, emails, PostHog and other vendor keys, IP
addresses, `+`-prefixed phone numbers, and long hex and base64 runs, then cuts
each text to 1024 characters.

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
  (`Bearer [token] extra` keeps `extra`);
- a `Bearer` or `Basic` glued to a letter from `g` to `z` or a `_`
  (`xBearer abc`, `_Bearer abc`), and a fully URL-encoded header
  (`Bearer%20abc%2Crefresh%3Dxyz`);
- pairs after a credential that a secret key's value took
  (`token=Bearer abc,refresh=xyz`), and a quoted pair value glued to more
  text or split by a line break.

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
  (`src/lib/role-denied.ts`) reads any 404 there as "not available
  to you": the page renders `RoleDenied` (`QueryState` treats every 404 it
  renders as a role refusal, `GET /auth/providers` and `GET /profile` included), queries do not retry it, and the
  maintenance poll stops on it.
- **A 404 is never a sign-out.** It is not an auth verdict
  ([Sign-out rules](#sign-out-rules)). `RoleDenied` offers a reload, which
  re-runs the guard and sends a user who lost their platform role to
  `/no-access`. Do not turn the 404 into a sign-out or a retry loop.
- **Role tiers are mirrored, not enforced.** `platformRoleAtLeast` hides what
  a role cannot use rather than showing it disabled: navigation items
  (`src/constants/navigation.ts`), a tenant's Flags tab
  (admins, `src/constants/tenant-tabs.ts`), the activity log (admins) and the
  maintenance controls (owners). `canPlatformActorModifyTarget` mirrors the
  API's rule for acting on other staff: an owner may act on any other staff
  member, an admin only on staff below admin, and nobody on themselves. A
  rule changed here and not in express offers actions the API refuses, or
  hides ones it allows.
- **Links into this app name it.** The Google sign-in link sends `app=apex`
  (`GOOGLE_OAUTH_PATH` in `src/constants/routes.ts`), and the sign-in link
  request, the passkey calls and the step-up link request send `app: 'apex'`
  (`FRONTEND_APP` in `src/constants/frontend-app.ts`), so the API
  returns the user, and the links it mails, to this app. Without it express
  defaults to the customer app, and staff would get a customer-app link.
- **A non-staff passkey is refused, and no session starts.** The API answers
  a passkey sign-in from an account with no platform role with 403
  `PASSKEY_NO_ACCESS`. The page toasts express's message, stays on `/login`,
  and sends no `signalUnknownCredential`: the passkey is valid for the
  customer app, so the browser keeps it.
- **A sign-in never makes staff.** Express mails an Apex sign-in link only to
  existing, active staff. Outside `full` maintenance, an address with a
  pending staff invitation is mailed the invitation's confirmation link,
  which opens `/invitations/confirm` and joins in one click. Any other
  address gets no mail. Every address gets
  the same "Check your inbox" answer, so the page never says who is staff.
  An Apex link or Google sign-in never creates an account, and a non-staff
  Google profile comes back as the one generic `google_auth_failed` refusal
  on `/login`. There is no domain auto-join: staff join only by invitation,
  which confirms by an emailed link, or by `pnpm platform:grant` on the
  server.

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
- **The confirmation is a passkey or an emailed link.** The dialog
  ("Confirm it's you") asks for a passkey first when the account has one
  (`/auth/passkeys/step-up/*`, with `userVerification: 'required'` set and
  checked by the server) and offers "Use another method", Email me a link
  (`POST /auth/step-up/link/request`, which sends `{ app: 'apex' }`). From the
  link view, "Use your passkey instead" returns. An account with no passkey
  goes straight to the link (`NO_PASSKEY`). Either way the result swaps the
  access token and nothing else (`setToken` keeps the user). There is no Google step-up: Google
  honours neither `max_age` nor `prompt=login` and documents no account
  reauth, so a Google round trip cannot prove a fresh sign-in, and a person
  at an unattended signed-in device would pass it. Google sign-in is
  unaffected.
  - **The link is bound to the session that asked.** It opens
    `/auth/confirm`, which posts it with that browser's bearer
    (`POST /auth/step-up/link/verify`). Signed out, the page posts nothing
    and says where the link works; in another browser or session the API
    answers the one 400 it gives an expired or used link, and nothing is
    elevated. A 404 is the role gate: a caller demoted since the request is
    refused and the link stays unspent. The link lasts 15 minutes from the
    last send (`STEP_UP_LINK_TTL_MS`), and Resend waits out express's
    one-minute cooldown.
  - **The waiting tab learns by message, then refreshes.** `/auth/confirm`
    posts `step_up_confirmed`. The dialog then calls `ensureSession()`, whose
    refresh carries the session's new `auth_time`, and retries the action
    once; a refresh that fails is offered again, never resolved anyway, and
    a verdict signs the tab out. A message is not proof: any same-origin
    script can post `step_up_confirmed`, so the dialog retries only when the
    refreshed token's `auth_time` moved past the one it held when the wait
    began, and otherwise keeps waiting.
  - **A Web Lock says whether a tab is waiting.** The dialog holds the shared
    `step-up-wait` lock (`STEP_UP_WAIT_LOCK`) from the first send
    until `confirm()` settles, and `/auth/confirm` reads
    `navigator.locks.query()` before it posts, so it can say "You can close
    this tab" or "try the action again". A session revoked on the server
    while a tab waits leaves that tab waiting until Cancel or the link's 15
    minutes; its next request is the verdict.
  - **The sign-in stays recent for 10 minutes.** Express's window, so a
    second write soon after needs no second confirmation.
- **Only Cancel dismisses a waiting dialog.** While it waits on a link,
  Escape and the backdrop do nothing, so the pending action stays
  pending; Cancel rejects it, and the action's dialog shows "Confirm it's you
  to continue." The action's own dialog reads "Waiting for you to confirm…"
  meanwhile (`useStepUpWaiting`).
- **A dialog waiting on step-up holds still.** The reason and maintenance
  dialogs ignore Escape and the backdrop while their action runs, so those
  keys reach the step-up dialog on top instead of closing the one beneath.

## Passkeys

Express is the relying party; this app runs the browser half. Why each rule
holds:

- **The relying-party ID comes from the API.** `GET /auth/passkeys/config`
  returns `rpId`, and the options the API signs carry it. The browser refuses
  a ceremony for an RP ID outside the page's own origin, so a wrong value
  fails closed. The app never builds an RP ID, challenge or credential
  parameter of its own.
- **User verification is the server's to require.** The options set
  `userVerification: 'required'` and express checks the verified flag on
  every answer. Nothing in the browser can lower it.
- **A passkey is checked by the server, never by the app.** The app posts
  the browser's response with its `challengeId` and trusts only the API's
  answer.
- **The WebAuthn package loads on demand.** `src/lib/webauthn.ts` is the only
  importer of `@simplewebauthn/browser`, through one cached `import()`.
  `pnpm check:bundle` fails if it reaches a first-visit chunk. A failed import
  surfaces as a prompt failure, never as a hang.
- **Signals tell the browser what the server knows, and nothing else.** After
  a refused credential (`PASSKEY_UNKNOWN`), a delete, and a create or rename,
  the app calls the browser's `signalUnknownCredential`,
  `signalAllAcceptedCredentials` and `signalCurrentUserDetails`. The data is
  the credential ids the account already holds, its user handle and its name
  and address, sent to the browser's own passkey store, not the network. Each
  is feature-detected and fire-and-forget, and `PASSKEY_SIGNALS` in
  `src/lib/webauthn.ts` turns each off for a browser that misbehaves. A 403
  `PASSKEY_NO_ACCESS` sends no signal.
- **Passkey names are personal data.** A name is whatever the person typed
  (or the device's name), so the list and both dialogs wrap it in `<Pii>`, and
  the row buttons' `aria-label` is masked by `mask-attribute.ts`
  (`e2e/fixtures/pii.test.ts` scans them).
- **Analytics sees the ceremony, not the passkey.** `passkey_prompt_cancelled`
  carries `sign_in`, `create` or `confirm` and nothing else;
  `sign_in_completed.method` gains `'passkey'`.
- **Required mode is enforced by the API.** The setup screen is a convenience:
  the API answers 403 `PASSKEY_SETUP_REQUIRED` to every other authenticated
  route until the account holds a passkey, whatever the page shows.

## Reason prompts

Every staff action the API records a reason for asks for one, which the
API stores in the audit log with the actor's name. `ReasonDialog`
(`src/components/features/reason-dialog.tsx`) asks for suspending,
reactivating, archiving and deleting a tenant; signing a user out
everywhere, deactivating, reactivating, deleting and permanently deleting a
user; lifting a suppression; resending an email; marking an onboarding step complete and
sending an onboarding reminder; resyncing a tenant's billing and revoking a
grant; saving a plan that lowers nothing; and member and invitation writes
through platform access. Reissuing a tenant's owner invitation, extending a
trial, adding a grant, cancelling a subscription, saving a plan that lowers
a limit or turns a feature off, and adding a price ask in their own
dialogs, with the same `reasonSchema`, and every billing write (resync,
extend trial, add grant, revoke grant, cancel, plan edit, new price) goes
through step-up. The plan preview writes nothing and takes neither. Other staff writes take no reason:
creating a user or a tenant, renaming a user, editing a tenant's details,
sending a user a sign-in link (a confirm dialog with no reason and no step-up), and removing a member of, or
leaving, the platform tenant. Maintenance changes have their own dialogs
([Maintenance controls](#maintenance-controls)).

- **The reason is bounded safe text.** `reasonSchema`
  (`src/schemas/reason.schemas.ts`) mirrors express's: trimmed, 1 to 500
  characters, multi-line safe text. The dialog masks the value to type, and a
  description that is a plain string whole; a description passed as a node
  renders as given, so a caller with a person's value in it wraps only that
  value in `<Pii>`.
- **Irreversible actions need the target typed.** Archiving or deleting a
  tenant, and cancelling its subscription now, asks for its slug; deleting or permanently deleting a user asks for
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
  or the page's own wording of it. A 404 with the route code `not_found`, or
  no code, is the role gate, worded as "your role no longer allows this
  action"; one with any other code shows the API's sentence. A member
  already gone (`member_not_found`) is said in a toast and the dialog
  closes. None of them signs anyone out.

## Maintenance controls

Platform owners put customers into read-only or full maintenance from the
Maintenance page; every staff role can read it.

- **The controls are the owner's; the API is the gate.** The page shows the
  change and switch-off buttons only to a platform owner
  (`src/pages/_app/settings/platform.maintenance.tsx`). The change is
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
  Maintenance page (`src/pages/_app/settings/platform.maintenance.tsx`), and the message also
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
- **Links out leak no referrer.** Every link that opens a new tab (to
  PostHog, or to the email-tracking docs) carries `rel="noreferrer"`, which
  also withholds `window.opener`.

## Known gaps

- **The container trusts its front.** nginx appends to the client's
  `X-Forwarded-For` and passes on a client-supplied `X-Forwarded-Proto` of
  `http` or `https` in any letter case, lowercased (any other value becomes
  `http`), and sets no per-IP connection limit, since every request arrives
  from the TLS terminator's address (`docker/nginx.main.conf`). Expose the
  container only through that terminator.
- **The error log can hold query strings.** nginx writes the full request
  line into every upstream error message, at the `error` level, so lowering
  the log level from `notice` changes nothing; only `crit` silences it, and
  with it the reason for the upstream failure. The Google OAuth callback
  (`location ~* ^/api/v1/auth/google/callback/?$`, whose `code` and `state`
  are credentials) sets its error log to `crit`. Every other path under
  `/api/` still writes its query string on an upstream error, including the
  term (`search`, or the prefixed `invitationsSearch`,
  `historySearch` and `unregisteredSearch`) of every staff search sent as a query string, often an email
  address: the users and tenants directories (the command palette's searches
  among them), the emails list and the suppressions list.
- **HSTS is the edge's job.** See [CSP and headers](#csp-and-headers).
- **Inline styles are allowed** (`style-src 'unsafe-inline'`), for
  `ChartStyle`, Base UI's `Select` popup and `ScrollArea`, and the boot
  shell's inline `<style>` blocks. An injected `<style>` cannot run script,
  but it can restyle the page.
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
- **Error scrubbing is regex-based** and misses free text; see
  [What it does not catch](#what-it-does-not-catch).

## Reporting a vulnerability

Report a security problem privately through GitHub's private vulnerability
reporting on this repository: the **Security** tab, then **Report a
vulnerability**. Do not open a public issue for a security problem.
