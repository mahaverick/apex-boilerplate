# Security

This file is for developers and reviewers of Apex, the staff console. It
says what the app defends against, how, and where the defences stop. It
covers the browser client and the container that serves it.

The Application Programming Interface (API) that Apex talks to,
express-boilerplate ("express"), owns:

- every authorization decision;
- the refresh cookie;
- rate limits;
- Cross-Origin Resource Sharing (CORS) and cross-site request forgery
  (CSRF) defences.

Express's own `SECURITY.md` covers those, including which routes need a
recent sign-in or a reason.

## Threat model for a browser client

The app is a static bundle served by nginx, on the same origin as the API it
proxies under `/api`. Whoever runs the page can read anything in the bundle,
in `/runtime-config.js` or in browser storage. The rules that follow from
that:

- **The browser enforces nothing.** A hidden button, a route guard or a
  flag-gated page (`src/observability/flags/require-client-flag.ts`) is
  presentation. The API refuses what the user may not do, so a gated page
  must be backed by a gated API route. On `/platform/*` the API refuses with
  a 404, not a 403 ([Staff-only access](#staff-only-access)).
- **A same-origin script is the main threat.** It could read the in-memory
  access token and call the API as a staff member. The defences are React's
  escaping and an enforced Content Security Policy (CSP) that admits no
  inline or third-party script ([CSP and headers](#csp-and-headers)).
  - `src/` has one raw-markup sink: shadcn's `ChartStyle`
    (`src/components/ui/chart.tsx`) writes a `<style>` element through
    `dangerouslySetInnerHTML`. It builds that element only from a chart's
    static colour config and a `useId` value, never from API data.
  - No code uses `innerHTML`.
- **What other people wrote renders as text.** Names, reasons, audit-entry
  metadata and maintenance messages render as text, never markup. A
  rendered email renders only in a sandboxed frame
  ([Untrusted content](#untrusted-content)).
- **Credentials leave the browser only towards the API.** The access token
  travels in an `Authorization` header, never a URL. The refresh token is an
  httpOnly cookie the client never reads.
- **Shared browsers and multiple tabs.** One refresh cookie serves every tab.
  - Where express's `COOKIE_DOMAIN` covers this app's host and the customer
    app's, that cookie is the customer app's too. A sign-in there as someone
    else then ends this tab's session at its next refresh
    (`SessionIdentityChangedError`, below).
  - The analytics identity cookie, `ph_apex`, is scoped to this host. It is
    shared only between this app's tabs, never with a website
    (`src/observability/telemetry/config.ts`).
  - The analytics opt-out state is keyed by the PostHog project key alone.
    Another app served from this host with the same key shares it.
  - A tab must never act as, or attribute events to, anyone other than its
    own signed-in user.
- **Third parties see as little as possible.** Analytics and error tracking
  go to PostHog, the product-analytics service, through the API's
  `/api/v1/collect` proxy, after masking and scrubbing in the browser.

## Token storage and refresh

This section covers where the access and refresh tokens live, which headers
leave the browser, and how a refresh stays single.

- **The access token is memory-only.** It lives in the zustand store
  (`src/states/auth.store.ts`) with the user, and nowhere else: never
  `localStorage`, `sessionStorage`, a cookie or a query string. The store has
  no `persist` middleware. Every page load therefore starts signed out and
  restores the session with one refresh (`bootstrapSession` in
  `src/router.tsx`). This keeps the token out of anything that outlives the
  page. It does not hide the token from a script running in the page.
- **The refresh token is an httpOnly cookie** that the browser sends with
  `withCredentials` (`src/http/client.ts`). It belongs to whichever origin
  answers `/api`. Its attributes are the API's.
- **The store is the only source of the bearer token.** The request
  interceptor (`src/http/interceptors.ts`) adds `Authorization: Bearer …`
  only when a request has none. A default `Authorization` header set
  anywhere would therefore shadow the store's token on every request.
- **Trace and analytics headers go only to this app's API.** `traceparent`
  and `X-POSTHOG-SESSION-ID` are set only on same-origin requests under the
  API prefix. An absolute URL to another origin never carries them.
- **One refresh at a time.** `ensureSession()` in `src/http/session.ts` is
  the only caller of `POST /auth/refresh`.
  - Every caller in a tab awaits the same in-flight promise.
  - Tabs queue behind the `auth-refresh` Web Lock.
  - The reason: each refresh rotates the shared cookie. The API revokes the
    whole session when a rotated token is presented again outside its
    10-second reuse grace window.
  - A second call site anywhere reintroduces that race.
- **A refresh that returns someone else ends this tab's session.** The
  refresh loads `/profile` with the fresh token. The profile's id can differ
  from the tab's user when another tab signed a different person in on the
  shared cookie. The refresh then fails with `SessionIdentityChangedError`.
  This tab signs out without broadcasting, so the other tab stays signed in,
  and nothing this tab started is replayed as the other person.

## Sign-out rules

This section lists what may end a session, how each tab follows a sign-out
or a sign-in, and how a landing stays on this origin.

- **Only an auth verdict signs a user out.** `isAuthVerdict` accepts exactly
  two things: a 401, and `SessionIdentityChangedError`.
  - These judge nobody: a 5xx during a rolling restart, a 429 from the
    rate-limited refresh, a malformed 200, a timeout, a network failure.
  - Treating any of them as a verdict signs out every user during a deploy.
  - Widen the test only with a status the API's refresh returns as a
    judgment on the caller's credentials.
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
- **`skipAuthRetry` opts a request out of both paths.** It is set on:
  - the two requests a refresh makes, because re-entering `ensureSession()`
    there would await itself;
  - `POST /auth/logout`;
  - every request a signed-out visitor makes with a mailed link, each sent
    with no bearer: the link request, the link verify, and the invitation
    preview, verify and confirm;
  - the step-up link verify. It refreshes an expired access token once
    itself, so the token never travels into `/login?redirect=`.
- **Every tab follows a sign-out.** A sign-out posts `logout` on the `auth`
  BroadcastChannel. A tab that hears it while signed in clears its store and
  loads `/login`. A tab that is not signed in ignores it. A refresh that
  fails in such a tab broadcasts nothing, so it cannot sign out a sibling
  tab that just signed in.
- **Choosing to sign out** (`useLogout` in `src/queries/auth.queries.ts`)
  asks the API first.
  - The local session ends when the API confirms, or answers 401 because
    its session is already over.
  - A network error, 5xx or 429 leaves the user signed in, with an error
    toast. A sign-out therefore never only looks done.
- **A sign-out is a full page load.** `redirectToLogin()` and `useLogout`
  use `window.location.assign`, which discards every in-memory cache.
- **Identity follows the user.** When the store's user changes or clears,
  analytics resets and every flag value and exposure mark is dropped
  (`installAnalyticsIdentity` in `src/http/session.ts`). The next person
  therefore never sees or sends the previous person's.
- **A sign-in in one tab reaches only a tab that waits for it.** The page
  that spends a sign-in or invitation-confirm link posts `signed_in`, with no
  data.
  - Only a tab with a link out listens: the sign-in form's "Check your
    inbox" step, and the accept page while its confirmation link is out (its
    Try again panel after a failed Resend included).
  - That tab acts only while it is signed out. It restores the shared
    session through `ensureSession()`, the same refresh as a reload, so the
    message itself grants nothing.
  - A tab that is already signed in ignores it.
- **A link never signs in over another account.** When a sign-in or
  invitation link opens in a tab signed in as someone else, the page asks
  first. "Continue" signs the current account out through the API, and
  every tab hears the logout. The page then reloads signed out before it
  posts the token, so the token never travels with the other account's
  bearer.
- **The page names the address it signs in.** This is the mitigation for
  login CSRF, which any emailed link allows: an attacker's own link would
  sign a victim into the attacker's account. Showing the address lets the
  victim see whose account it is.
  - A link carries its address, and the sign-in page sends it back with the
    token. Express refuses a mismatch without spending the link.
  - While verifying, the page shows the link's address, then the address the
    server signed in.
  - The invitation confirm page does the same with its link's address.
  - The accept page names only the address from the server's preview or
    answer, never one from the URL.
- **A landing cannot leave the origin.** `safeRedirect`
  (`src/lib/safe-redirect.ts`) accepts only a value that meets all of these:
  - it starts with `/`;
  - the URL parser resolves it to this origin;
  - its path does not start with `//`;
  - its resolved path is at most 2,048 characters, the API's limit.

  It refuses `/\t/evil.example` and `/..//evil.example`. Every landing passes
  through it: `/login`'s `?redirect=`, the link's `redirect` hint, the verify
  response's `redirect` and the Google callback's `?redirect=`. `/login`
  drops an unsafe hint instead of sending it.

- **No landing and no carried redirect is ever a token page.** `safeLanding`
  in `src/lib/landing.ts` refuses `/auth/link`, `/auth/confirm`,
  `/invitations/accept` and `/invitations/confirm`.
  - Carried, a token page's token would be mailed again inside the next
    link. Landed on, the page on screen would never act on it.
  - `safeLanding` decodes the path before the check, as the router does
    before it matches. `/auth/%6Cink` therefore counts as `/auth/link`, and
    a path that does not decode is refused.
  - Each landing replaces the token page in history, so Back never returns
    to it.
- **A sign-in link with no address is never posted.** The API compares the
  link's `email` with its token, to stop another person's link signing a
  visitor in. `/auth/link` therefore treats a token with no `email` as no
  token at all.
- **A token is posted once per page load.** `/auth/link`, `/auth/confirm`
  and the invitation pages post their token from a mutation that a
  ref-guarded effect fires. StrictMode's second run and a re-render
  therefore never spend the link twice. A query would post it again on
  refocus or reconnect. The invitation preview is a query because it spends
  nothing.
- **No password anywhere.** Staff sign in by emailed link or Google, and
  confirm it's them the same two ways. No page, form, schema or query takes
  a password. `/register`, `/forgot-password`, `/reset-password` and
  `/verify-email` only redirect to `/login?notice=sign-in-link`, dropping
  their `?token=` before anything renders.

## CSP and headers

This section covers the response headers nginx sends, why each CSP directive
holds, and what the access and error logs keep.

nginx sends these headers on every response it answers itself
(`nginx.conf`):

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

- **`script-src 'self'` holds because no script is inline.**
  - The pre-paint scripts are the files `public/theme-init.js` and
    `public/boot-variant.js`, each loaded by a blocking `<script src>`.
    `/runtime-config.js` is same-origin.
  - Never add an inline script, `'unsafe-inline'` or `'unsafe-eval'` for
    scripts.
  - `src/lib/zod-jitless.ts` turns off Zod's just-in-time (JIT) compiler,
    whose `new Function` probe this policy reports as a violation. It is the
    first import of `src/main.tsx` and of every source file that imports Zod
    as a value.
- **`style-src 'unsafe-inline'`** is there for three reasons:
  1. `ChartStyle` (`src/components/ui/chart.tsx`) writes a `<style>`
     element. `e2e/nginx/charts.test.ts` checks that the Overview's charts
     draw under this policy with no violation.
  2. Base UI's `Select` popup and `ScrollArea` (the command palette) write
     `<style>` elements, to hide their scrollbars.
  3. `index.html` carries the boot shell's inline `<style id="boot-tokens">`
     and `<style id="boot-shell">` blocks, so the first paint needs no
     stylesheet request. A static `index.html` cannot carry a nonce; only a
     hash source per block could stand in for the keyword.

  React applies `style` props through the CSS Object Model (CSSOM), which
  the policy does not govern. The toast's and the sidebar's inline CSS
  variables therefore do not need the keyword. Base UI's `CSPProvider` with
  `disableStyleElements` would drop Base UI's `<style>` elements once their
  rules live in `globals.css`. `ChartStyle` and the boot shell's inline style
  would still need the keyword.

- **`connect-src 'self'`** holds because the API, analytics and error
  tracking are all same-origin. posthog-js sends to `/api/v1/collect` and
  loads its recorder from there, so the browser never talks to PostHog.
  Calling another origin from the browser means widening `connect-src` in
  `nginx.conf` in the same change.
- **Session replay starts no worker.** Recording `<canvas>` content would
  start a `blob:` worker, which `script-src 'self'` blocks (`worker-src`
  falls back to it). The options pin
  `session_recording.captureCanvas.recordCanvas: false`. That pin overrides
  the PostHog project's replay setting, so the project cannot turn canvas
  recording on. `e2e/nginx/analytics.test.ts` asserts that replay records
  under this policy with no worker and no violation.
- **No location declares an `add_header`.** In nginx, a location that sets
  any header of its own inherits none of the server block's. It would
  silently drop every security header. A `map` on the URI therefore chooses
  Cache-Control. The security headers carry `always`, so error responses get
  them too.
- **A proxied API response keeps its own headers.** nginx adds each header
  above only when the upstream response lacks it.
  - Express's stricter API values (`default-src 'none'`,
    `X-Frame-Options: SAMEORIGIN`) pass through.
  - No header is sent twice. Two `Cross-Origin-Opener-Policy` (COOP) lines
    do not parse, and COOP then falls back to `unsafe-none`.
  - nginx's own 502 or 504 for an `/api/` request carries the full set.
- **No HSTS (HTTP Strict Transport Security).** The Transport Layer Security
  (TLS) edge decides whether TLS fronts this container and which hosts the
  policy covers. `Strict-Transport-Security` is therefore set there, not in
  `nginx.conf`.
- **The access log keeps no query string.** Its server-level format records
  `$uri`, not `$request`. The reason: every single-page-app (SPA) route
  falls back to `index.html`, including the token pages, and their tokens
  are credentials mailed to users:
  - `/auth/link?token=…&email=…`
  - `/auth/confirm?token=…`
  - `/invitations/accept?token=…`
  - `/invitations/confirm?token=…&email=…`

  `Referrer-Policy: no-referrer` keeps the page URL out of the logged
  referrer. The invitation preview posts its token in a request body, so the
  token stays out of URLs and logs (`src/queries/invitation.queries.ts`).

- **The error log can keep one.** nginx writes the full request line, query
  string included, into every upstream error message, and no log format
  changes that.
  - The leak happens at every level up to `error`, so the configured level
    (`notice`, `docker/nginx.main.conf`) does not matter. Only `crit` drops
    it.
  - The Google OAuth (Open Authorization) callback's location
    (`location ~* ^/api/v1/auth/google/callback/?$`) sets its error log
    level to `crit`, which silences those messages there. No other location
    does (see [Known gaps](#known-gaps)).
- **No source map is served.** The image deletes every `.map` after the
  upload. `nginx.conf` answers 404 for any `.map` path outside `/api/`, even
  where a file exists. A deploy of `dist/` outside the image must delete
  `*.map` first.
- `server_tokens off` drops the nginx version from the `Server` header and
  error pages.

**Checks.** The `nginx` Playwright project checks the headers and asserts
zero CSP violations (`e2e/nginx/headers.test.ts`, `e2e/nginx/csp.test.ts`,
`e2e/nginx/csp-live.test.ts`). `docker/check-image.sh` checks the built image
from outside:

- user 101 and a read-only root;
- each header sent once, on proxied and unproxied responses;
- no source map in the image;
- a refused run-time setting stops the container without printing its value;
- an upstream error on the Google OAuth callback (exact, with a trailing
  slash, or in mixed case) writes none of its query string to the log, while
  another `/api/` path still logs its request;
- the bundle carries its release, and no release id written by inject.

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
- **The bundle validates again.** `src/configs/runtime-config.ts` applies
  the same patterns.
  - An invalid value counts as unset.
  - The exception is `ANALYTICS_CONSENT_MODE`. It fails closed to `off`, so
    an app whose `config.ts` honours consent modes never falls back to
    capturing.
  - A handoff origin list with one origin that `URL` refuses is dropped
    whole.
  - The console warning names the keys, never the values.
  - A production bundle reads only `window.__APP_CONFIG__`, so no build-time
    value can configure it.
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

This section covers what analytics captures, what it masks, and how events
stay attributed to the right person.

posthog-js, PostHog's browser library, loads only when a PostHog key is set.
It loads through a dynamic `import()` kept out of the first-visit chunks
(`pnpm check:bundle`). Without a key, every call is a no-op.

The analytics module is shared with react-boilerplate. The per-app
constants at the top of `src/observability/telemetry/config.ts` set this
app's side of it:

| Constant                           | Value     | Effect                                                                                                 |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `SUPPORTS_CONSENT_MODES`           | `false`   | Consent modes are not honoured. Capture always runs in `opt_out` mode, and there is no consent banner. |
| `SUPPORTS_HANDOFF`                 | `false`   | No website's anonymous id is handed off.                                                               |
| `ANALYTICS_PERSISTENCE_NAME`       | `ph_apex` | The name of the identity cookie.                                                                       |
| `ANALYTICS_CROSS_SUBDOMAIN_COOKIE` | `false`   | The identity cookie is not shared across subdomains.                                                   |

The query-key allowlist is set there too.

- **Typed events carry no free text.** Every event and its properties are
  declared in `src/observability/telemetry/event-registry.ts`.
  - A property typed as any string fails `REGISTRY_HAS_NO_FREE_STRINGS` at
    compile time.
  - A key passed to `analyticsKey` must be a lowercase literal without a
    space, `@`, `.`, `/`, `:`, `?`, `=`, `&` or `#`.
  - A free string is how a name, an address or a search term reaches an
    event. Do not widen either rule.
- **The browser never sets person or group properties.** `identify` takes
  the user id alone, and this app sets no tenant group. The server sets
  staff status, roles and tenant names, where a user cannot forge them from
  devtools.
- **Rendered personal data is masked.** `<Pii>`
  (`src/components/shared/pii.tsx`) wraps every rendered person name, email
  address, avatar initial and invitation address, and any free text staff
  typed (a reason, a maintenance message). Its `ph-sensitive ph-mask` class
  keeps the text out of autocapture's `$el_text` and masks it in replay.
  - Wrap the value, not the sentence.
  - A sentence a builder returns as a string (`auditSentence`,
    `bannerSentence`, `conflictSentence`, the maintenance preview) is masked
    whole, the safe default. So is a string `ReasonDialog` description.
  - Replay masks inputs, and autocapture masks every element attribute.
- **Replay masks attributes by name** (`mask-attribute.ts`). These become
  `***`: `aria-label`, `title`, `alt`, `placeholder`, `srcdoc`, every
  `data-*`, an `href` with a query or a `mailto:`/`tel:` scheme, and a `src`
  or `srcset` with a query. That is why an accessible name may carry an
  address, and an attribute outside the list may not. Replay records no
  request headers, bodies or JSON-LD (JSON for Linking Data), and each
  recorded request URL is sanitised.
- **Captured URLs keep only allowlisted query keys.**
  `ANALYTICS_URL_QUERY_ALLOWLIST` (`src/observability/telemetry/config.ts`)
  is the whole list:
  - `range`, `tab`, `state` and `status`: the enums the staff lists put in
    the URL;
  - `utm_source`, `utm_medium`, `utm_campaign` and `utm_content`: the
    Urchin Tracking Module (UTM) campaign keys express puts on every link it
    mails. A mailed link's landing page view therefore keeps its campaign,
    while its `token` and `email` go.

  The sanitizer keeps a `utm_*` value only when it matches
  `^[a-z0-9_-]{1,64}$`, the shape of every value express sends. Otherwise it
  drops the key with its value. An `@`, a `.`, uppercase, or a value longer
  than 64 characters never reaches PostHog.

- **What the sanitizer rewrites.** The sanitizer
  (`src/observability/telemetry/url-sanitizer.ts`) runs as `before_send`. It
  rewrites every absolute http(s) string in an event's properties, `$set`
  and `$set_once`, to 8 levels deep. It also rewrites the hrefs in
  `$elements` and `$elements_chain`, and the keys of `$heatmap_data`. The
  fragment goes, and a `mailto:` or `tel:` URL keeps only its scheme.
  posthog-js's own personal-data masking also covers `token`, `email`,
  `redirect`, `invitation`, `q`, `search`, `ph_did` and `ph_sid`.
- **Adding an allowlist key.** Add a key only when its values can never be a
  token, an address, a search term or a redirect. The `utm_*` keys are the
  one exception: their values arrive from the URL, so the sanitizer's value
  check above is what keeps an address or a token out (the UTM rule of
  2026-10-19).
- **Page titles are fixed words.** Replay records the `<title>` and a page
  view sends it, both unmasked. Every route's title is therefore a literal
  (`pageTitle` in `src/constants/app.ts`), never a record's name or address.
- **Events never cross people** (`guardEvent` in
  `src/observability/telemetry/telemetry.ts`). posthog-js adopts the
  identity cookie before every event, and this app's other tabs share that
  cookie.
  - While a user is signed in, any event under another distinct id is
    dropped.
  - Another tab of this app may have identified that other person, by
    announcing it on the `analytics-identity` channel or by writing it to a
    60-second `localStorage` registry. This tab is then superseded: it drops
    its events and refreshes its session to settle who is signed in.
  - Otherwise, the user is identified again after 250 ms.
  - Never loosen the guard to log-and-send.
  - A sign-out resets the SDK but keeps the browser's opt-out answer.
- **The session header never links another person.** `X-POSTHOG-SESSION-ID`
  is sent only while capture is on and PostHog holds either nobody or the
  signed-in user.
- **Opting out.** Capture runs until the user turns analytics off.
  - The switch is on the profile in the customer app. This app reads the
    profile's `analyticsOptOut` and applies it before the user is identified
    (`installAnalyticsIdentity` in `src/http/session.ts`), so an opted-out
    user's identify is never captured.
  - The opt-out holds back only the SDK's own events and replay. Exception
    reports and flag exposure are sent whatever the answer (see below).
- **No handoff.** The app never reads a website's `?ph_did=&ph_sid=` link
  parameters, so a website visitor's id never merges into a staff person.
  Both parameters still leave the address bar on every load (`handoff.ts`).
- **Guards.**
  - `e2e/fixtures/pii.test.ts` checks that every harness person's name and
    every address on the staff pages sits inside `<Pii>`.
  - `e2e/nginx/analytics.test.ts` searches everything that reached a fake
    PostHog, decoded, after signed-out pages opened with token-carrying URLs
    and a staff route walk.
- **Flag exposure ignores the opt-out.** The flag hooks report experiment
  keys, never values, to the API's exposure endpoint, whatever the analytics
  answer (`src/observability/flags/exposure.ts`). The API re-evaluates each
  key. It records the exposure in PostHog for a user who matched a release
  condition or is in the holdout.

## Error-tracking privacy

This section covers what the app sends to PostHog Error Tracking, what it
drops and scrubs first, and when a report is anonymous.

Browser exceptions go to PostHog Error Tracking through the API's
`/api/v1/collect/batch/` proxy whenever a PostHog key is set
(`src/observability/errors/report.ts`). The opt-out does not stop them:
after a profile opt-out, an exception is still sent, anonymous. Only the
SDK's own events and replay stop for the opt-out.

- **What is dropped before anything is built:**
  - API and network failures (the API reports its own 5xx);
  - aborts;
  - ResizeObserver noise;
  - a cross-origin `Script error.` with no stack;
  - any error with no frame from this app's own files (an extension's),
    except a failed chunk load.
- **What is scrubbed:** every exception's type and value, and every frame's
  file name and function name, through `scrubText`
  (`src/observability/errors/scrub.ts`). The page URL is reduced to the
  analytics allowlist's query keys, then its path is scrubbed. No request,
  header or form data is attached.
- **Identity follows the opt-out.** An exception carries PostHog's distinct
  id and session only when all three hold:
  - the user has not opted out;
  - the tab is not superseded;
  - PostHog's person is this tab's signed-in user. While nobody is signed
    in, it is whoever PostHog holds, normally anonymous.

  Otherwise the exception is anonymous: a fresh distinct id per event and no
  person profile. Two more cases are sent anonymous, so they are never
  attributed to the next person: an error noted more than 10 seconds before
  the lazy reporter received it, and an error noted before the user or the
  tab's standing changed.

- **Volume is capped:** 5 events per fingerprint and 30 per page life.

### The scrubber

`scrub.ts` is a byte-for-byte copy of express-boilerplate's
`express-boilerplate/src/services/errors/error-scrubber.service.ts`, tested
against the same `tests/fixtures/error-scrub-vectors.json`. A rule therefore
changes in express first and is copied here, never edited here alone.

It replaces:

- Postgres key details and echoed input;
- URL credentials, query strings, and fragments other than line or heading
  anchors;
- the token segment after `/reset/`, `/verify/`, `/invite/` or `/accept/`;
- Bearer, Basic and other Authorization credentials (Bearer and Basic with
  the unquoted or quoted `,key=value` or `;key=value` pairs glued to them);
- Cookie values and secret-named keys' values;
- JSON Web Tokens (JWTs), emails, and PostHog and other vendor keys;
- Internet Protocol (IP) addresses and `+`-prefixed phone numbers;
- long hex and base64 runs.

It then cuts each text to 1,024 characters.

### What it does not catch

Regex scrubbing is best-effort: keep secrets and personal data out of error
messages. Among what it leaves in place:

- names and other free text;
- ids, universally unique identifiers (UUIDs) included, kept on purpose for
  debugging;
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

This section covers how the client keeps non-staff out of staff pages, how
it reads the API's refusals, and how it mirrors the role tiers.

Every page under the signed-in shell is for platform staff: a user holding
any role in the platform tenant. The API decides. The client only keeps
people out of pages that would fail.

- **The shell's guard is presentation.** `beforeLoad` in
  `src/pages/_app.tsx` sends:
  - a signed-out visitor to `/login`;
  - a signed-in user without a platform role (`isStaff` in
    `src/constants/roles.ts`) to `/no-access`. That page names the signed-in
    address inside `<Pii>` and offers only a sign-out.
- **The API refuses with a 404.** `/platform/*` answers 404, not 403, to a
  user who is not staff and to staff below a route's role. A refused route
  therefore looks the same as a missing one. `isRoleDenied`
  (`src/lib/role-denied.ts`) reads any 404 there as "not available to you":
  - the page renders `RoleDenied`. `QueryState` treats every 404 it renders
    as a role refusal, `GET /auth/providers` and `GET /profile` included;
  - queries do not retry it;
  - the maintenance poll stops on it.
- **A 404 is never a sign-out.** It is not an auth verdict
  ([Sign-out rules](#sign-out-rules)). `RoleDenied` offers a reload, which
  re-runs the guard and sends a user who lost their platform role to
  `/no-access`. Do not turn the 404 into a sign-out or a retry loop.
- **Role tiers are mirrored, not enforced.** `platformRoleAtLeast` hides
  what a role cannot use, instead of showing it disabled:

  | Hidden below the role                                 | Least role | Where                                                                 |
  | ----------------------------------------------------- | ---------- | --------------------------------------------------------------------- |
  | Navigation items                                      | Per item   | `src/constants/navigation.ts`                                         |
  | A tenant's Flags tab                                  | Admin      | `src/constants/tenant-tabs.ts`                                        |
  | The activity log                                      | Admin      | –                                                                     |
  | The maintenance controls                              | Owner      | –                                                                     |
  | A tenant's Resync, Extend trial, Add grant and Revoke | Manager    | `billingActionsFor` (`src/lib/billing-actions.ts`)                    |
  | A tenant's Cancel subscription                        | Admin      | `billingActionsFor` (`src/lib/billing-actions.ts`)                    |
  | The Plans page's edit controls                        | Admin      | `src/pages/_app/plans.tsx`                                            |
  | The billing alerts card and the Billing alerts page   | Admin      | `src/pages/_app/overview.tsx` and `src/pages/_app/billing-alerts.tsx` |

  `canPlatformActorModifyTarget` mirrors the API's rule for acting on other
  staff: an owner may act on any other staff member, an admin only on staff
  below admin, and nobody on themselves. A rule changed here and not in
  express offers actions the API refuses, or hides ones it allows.

- **Links into this app name it.** The API returns the user, and the links
  it mails, to this app because each entry point names Apex:
  - the Google sign-in link sends `app=apex` (`GOOGLE_OAUTH_PATH` in
    `src/constants/routes.ts`);
  - the sign-in link request, the passkey calls and the step-up link request
    send `app: 'apex'` (`FRONTEND_APP` in `src/constants/frontend-app.ts`).

  Without it, express defaults to the customer app, and staff would get a
  customer-app link.

- **A non-staff passkey is refused, and no session starts.** The API answers
  a passkey sign-in from an account with no platform role with 403
  `PASSKEY_NO_ACCESS`. The page toasts express's message, stays on `/login`,
  and sends no `signalUnknownCredential`. The passkey is valid for the
  customer app, so the browser keeps it.
- **A sign-in never makes staff.**
  - Express mails an Apex sign-in link only to existing, active staff.
  - Outside `full` maintenance, an address with a pending staff invitation
    is mailed the invitation's confirmation link. It opens
    `/invitations/confirm` and joins in one click.
  - Any other address gets no mail.
  - Every address gets the same "Check your inbox" answer, so the page never
    says who is staff.
  - An Apex link or Google sign-in never creates an account. A non-staff
    Google profile comes back as the one generic `google_auth_failed`
    refusal on `/login`.
  - There is no domain auto-join. Staff join only by invitation, which
    confirms by an emailed link, or by `pnpm platform:grant` on the server.

## Step-up re-authentication

This section covers the "Confirm it's you" flow: how a write that needs a
recent sign-in asks for one, and why each step holds.

Some writes need a recent sign-in. The API decides which ones, and how
recent (`requireRecentAuth` in express-boilerplate). It refuses a stale one
with a 401 whose code is `REAUTH_REQUIRED`.

- **`REAUTH_REQUIRED` is not a verdict.** The 401 interceptor rejects it
  untouched (`src/http/interceptors.ts`), so it neither refreshes nor signs
  out. `isReauthRequired` (`src/lib/step-up.ts`) recognises it.
- **One dialog for the whole shell.** `StepUpProvider`
  (`src/components/features/step-up/step-up-provider.tsx`) wraps the
  signed-in layout once. A write that may need a recent sign-in runs through
  `useStepUp().run`.
  - Every write refused while the dialog is open waits on the same
    confirmation. Two refusals therefore never stack two dialogs, and one
    confirmation retries both.
  - `useStepUp` throws outside the provider, where a destructive action
    would have no way to ask.
- **A retry happens once.**
  - After a confirmation, the write runs once more. A second
    `REAUTH_REQUIRED` rejects instead of reopening the dialog.
  - A refusal whose request carried an older token than the store holds
    retries at once, without asking (`sentWithCurrentToken`). That happens
    when another write's confirmation landed meanwhile.
  - A dismissal rejects with the original refusal.
  - After a dismissal, or a second refusal of the retry, the reason dialog
    asks the user to confirm it's them to continue.
- **The confirmation is a passkey or an emailed link.** The dialog
  ("Confirm it's you") asks for a passkey first when the account has one
  (`/auth/passkeys/step-up/*`, with `userVerification: 'required'` set and
  checked by the server).
  - It offers "Use another method", Email me a link
    (`POST /auth/step-up/link/request`, which sends `{ app: 'apex' }`). From
    the link view, "Use your passkey instead" returns.
  - An account with no passkey goes straight to the link (`NO_PASSKEY`).
  - Either way, the result swaps the access token and nothing else
    (`setToken` keeps the user).
  - There is no Google step-up. Google honours neither `max_age` nor
    `prompt=login`, and documents no account reauthentication. A Google round
    trip therefore cannot prove a fresh sign-in, and a person at an
    unattended signed-in device would pass it. Google sign-in is unaffected.
  - **The link is bound to the session that asked.** It opens
    `/auth/confirm`, which posts it with that browser's bearer
    (`POST /auth/step-up/link/verify`).
    - Signed out, the page posts nothing and says where the link works.
    - In another browser or session, the API answers the one 400 it gives
      an expired or used link, and nothing is elevated.
    - A 404 is the role gate: a caller demoted since the request is refused,
      and the link stays unspent.
    - The link lasts 15 minutes from the last send, express's default for
      `STEP_UP_LINK_TTL`. Resend waits out express's cooldown
      (`STEP_UP_LINK_COOLDOWN`, 1 minute by default).
  - **The waiting tab learns by message, then refreshes.** `/auth/confirm`
    posts `step_up_confirmed`. The dialog then calls `ensureSession()`,
    whose refresh carries the session's fresh `auth_time`, and retries the
    action once.
    - A refresh that fails is offered again, never resolved anyway, and a
      verdict signs the tab out.
    - A message is not proof: any same-origin script can post
      `step_up_confirmed`. The dialog therefore retries only when the
      refreshed token's `auth_time` moved past the one it held when the wait
      began. Otherwise it keeps waiting.
  - **A Web Lock says whether a tab is waiting.** The dialog holds the shared
    `step-up-wait` lock (`STEP_UP_WAIT_LOCK`) from the first send until
    `confirm()` settles. `/auth/confirm` reads `navigator.locks.query()`
    before it posts, so it can say "You can close this tab" or "try the
    action again". A session revoked on the server while a tab waits leaves
    that tab waiting until Cancel or the end of the link's 15 minutes. Its
    next request is the verdict.
  - **The sign-in stays recent for 10 minutes.** That is express's window,
    so a second write within it needs no second confirmation.
- **Only Cancel dismisses a waiting dialog.** While the dialog waits on a
  link, Escape and the backdrop do nothing, so the pending action stays
  pending. Cancel rejects it, and the action's dialog shows "Confirm it's
  you to continue." Meanwhile, the action's own dialog reads "Waiting for
  you to confirm…" (`useStepUpWaiting`).
- **A dialog waiting on step-up holds still.** The reason and maintenance
  dialogs ignore Escape and the backdrop while their action runs, so those
  keys reach the step-up dialog on top instead of closing the one beneath.

## Passkeys

This section lists the passkey rules and why each holds. Express is the
WebAuthn relying party; this app runs the browser half.

- **The relying-party ID (RP ID) comes from the API.**
  `GET /auth/passkeys/config` returns `rpId`, and the options the API signs
  carry it. The browser refuses a ceremony for an RP ID outside the page's
  own origin, so a wrong value fails closed. The app never builds an RP ID,
  challenge or credential parameter of its own.
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
- **Signals tell the browser what the server knows, and nothing else.** The
  app calls three browser signal methods:

  | After                                    | Signal                         |
  | ---------------------------------------- | ------------------------------ |
  | A refused credential (`PASSKEY_UNKNOWN`) | `signalUnknownCredential`      |
  | A delete                                 | `signalAllAcceptedCredentials` |
  | A create or rename                       | `signalCurrentUserDetails`     |
  - The data is the credential ids the account already holds, its user
    handle, and its name and address. It goes to the browser's own passkey
    store, not the network.
  - Each call is feature-detected and fire-and-forget. `PASSKEY_SIGNALS` in
    `src/lib/webauthn.ts` turns each off for a browser that misbehaves.
  - A 403 `PASSKEY_NO_ACCESS` sends no signal.

- **Passkey names are personal data.** A name is whatever the person typed,
  or the device's name. The list and both dialogs therefore wrap it in
  `<Pii>`, and `mask-attribute.ts` masks the row buttons' `aria-label`
  (`e2e/fixtures/pii.test.ts` scans them).
- **Analytics sees the ceremony, not the passkey.**
  `passkey_prompt_cancelled` carries `sign_in`, `create` or `confirm` and
  nothing else. `sign_in_completed.method` has `'passkey'` among its values.
- **Required mode is enforced by the API.** The setup screen is a convenience:
  the API answers 403 `PASSKEY_SETUP_REQUIRED` to every other authenticated
  route until the account holds a passkey, whatever the page shows.

## Reason prompts

This section lists which staff writes ask for a reason, how the reason is
bounded, and how the dialog handles refusals.

Every staff action that the API records a reason for asks for one. The API
stores the reason in the audit log with the actor's name.

**`ReasonDialog`** (`src/components/features/reason-dialog.tsx`) asks for a
reason when staff:

- suspend, reactivate, archive or delete a tenant;
- sign a user out everywhere, or deactivate, reactivate, delete or
  permanently delete a user;
- lift a suppression;
- resend an email;
- mark an onboarding step complete, or send an onboarding reminder;
- resync a tenant's billing, or revoke a grant;
- save a plan that lowers nothing;
- save the trial and grace rules;
- write members and invitations through platform access.

**Their own dialogs**, with the same `reasonSchema`, ask for a reason when
staff reissue a tenant's owner invitation, extend a trial, add a grant,
cancel a subscription, save a plan that lowers a limit or turns a feature
off, or add a price.

**Every billing write goes through step-up:** resync, extend trial, add
grant, revoke grant, cancel, plan edit, new price and billing settings. The
plan preview writes nothing and takes neither a reason nor step-up.

**These staff writes take no reason:**

- creating a user or a tenant;
- renaming a user;
- editing a tenant's details;
- sending a user a sign-in link (a confirm dialog with no reason and no
  step-up);
- removing a member of, or leaving, the platform tenant.

Maintenance changes have their own dialogs
([Maintenance controls](#maintenance-controls)).

- **The reason is bounded safe text.** `reasonSchema`
  (`src/schemas/reason.schemas.ts`) mirrors express's: trimmed, 1 to 500
  characters, multi-line safe text.
  - The dialog masks the value the user must type to confirm
    (`confirmText`, below).
  - It masks a description that is a plain string, whole.
  - A description passed as a node renders as given, so a caller with a
    person's value in it wraps only that value in `<Pii>`.
- **Irreversible actions need the target typed** (`confirmText`).
  - Archiving or deleting a tenant, and cancelling its subscription now,
    ask for the tenant's slug.
  - Deleting or permanently deleting a user asks for their email address.
- **Reasons on customer tenants follow the access path.** Staff can reach a
  customer tenant through platform access (`access: 'platform'` from
  `useMyRole` in `src/queries/tenant.queries.ts`). Their member and
  invitation writes then carry `reason` in the JSON body, DELETE included.
  The API also needs a recent sign-in for them. A member of the tenant sends
  no reason, and that includes the platform tenant's own Staff page.
- **`REASON_REQUIRED` is a 400.** The API sends it when a write through
  platform access has no valid reason. The dialog puts its message on the
  Reason field. The page may have shown member controls, because the
  caller's membership ended while the page was open. The tenant's detail
  then refetches, and the staff controls, which ask for a reason, replace
  them (`src/queries/tenant-writes.queries.ts`).
- **Refusals stay in the dialog.** None of them signs anyone out.
  - A 403 or 409 shows the API's sentence, or the page's own wording of it.
  - A 404 with the route code `not_found`, or with no code, is the role
    gate. The dialog words it as "your role no longer allows this action".
  - A 404 with any other code shows the API's sentence.
  - A member already gone (`member_not_found`) is reported in a toast, and
    the dialog closes.

## Maintenance controls

This section covers how platform owners change customer maintenance mode,
and the checks on each change.

Platform owners put customers into read-only or full maintenance from the
Maintenance page. Every staff role can read the page.

- **The controls are the owner's; the API is the gate.** The page shows the
  change and switch-off buttons only to a platform owner
  (`src/pages/_app/settings/platform.maintenance.tsx`). The change is
  `PUT /platform/maintenance-mode`, run through step-up
  (`useChangeMaintenanceMode` in `src/queries/maintenance-mode.queries.ts`).
- **Switching on or escalating asks the most.** Going from off to any mode,
  or from read-only to full (`isSwitchOn` in `src/lib/maintenance-mode.ts`),
  needs a reason and the API's environment name typed exactly
  (`src/schemas/maintenance-mode.schemas.ts`).
  - The name comes from the platform state the API returns, never from a
    client setting. One image runs in every environment, and only the API
    knows which one it is.
  - A mismatch the API catches is `CONFIRMATION_MISMATCH`, shown on that
    field.
- **A change never overwrites one it has not seen.** Each change sends the
  version its dialog opened on as `expectedVersion`. A 409
  `MAINTENANCE_MODE_CONFLICT` cancels any read in flight and reads the state
  again.
  - The dialog shows what someone else saved only when that read is newer
    than the version sent.
  - Otherwise it keeps the version it opened on, so the next try conflicts
    again instead of overwriting.
- **Staff read the platform state, not the customer header.** The banner on
  every staff page and the Maintenance page poll
  `GET /platform/maintenance-mode`:
  - every 30 seconds while a mode is on;
  - every 60 seconds while it is off;
  - not at all after a 404.

  The `Maintenance-Mode` response header describes what customers get. The
  API lets staff routes through whatever it says.

- **The message and the reason are bounded safe text**
  (`src/schemas/maintenance-mode.schemas.ts`).
  - The customer message is always 1 to 500 characters of multi-line safe
    text.
  - The reason is optional, up to 500 characters. It is required (1 to 500)
    only when switching on or escalating.
  - Emptying a pre-filled reason sends `reason: null`, which clears the
    stored one.
- **Where they render.**
  - Both render as text inside `<Pii>` on the Maintenance page
    (`src/pages/_app/settings/platform.maintenance.tsx`).
  - The message also renders in the change dialog's customer preview
    (`src/components/features/maintenance/maintenance-preview.tsx`).
  - The banner on every staff page and the conflict sentence show neither.
    They state the mode, since when, and who changed it, inside `<Pii>`
    because they name that person (`src/lib/maintenance-mode.ts`).

## Untrusted content

This section covers content from someone the API does not vouch for, and
how the app renders it.

- **A rendered email runs nothing.** The email preview
  (`src/components/features/emails/email-preview.tsx`) puts the message's
  HTML in an `<iframe sandbox="" srcdoc>`.
  - No script runs in it, no form submits, and it cannot navigate this page.
    It inherits this page's CSP.
  - The empty `sandbox` also gives the frame an opaque origin, which keeps
    session replay from reading its document. The frame also carries
    `ph-no-capture`.
  - Never add `allow-same-origin`.
  - The preview is re-rendered from the message's template. Its token links
    are masked, because the one-time token is never stored.
- **Links out leak no referrer.** Every link that opens a new tab (to
  PostHog, or to the email-tracking docs) carries `rel="noreferrer"`, which
  also withholds `window.opener`.

## Known gaps

This section lists the risks the app accepts, and where the defences above
stop.

- **The container trusts its front.** nginx does three things that are safe
  only behind a TLS terminator (`docker/nginx.main.conf`):
  - it appends to the client's `X-Forwarded-For`;
  - it passes on a client-supplied `X-Forwarded-Proto` of `http` or `https`
    in any letter case, lowercased. Any other value becomes `http`;
  - it sets no per-IP connection limit, because every request arrives from
    the TLS terminator's address.

  Expose the container only through that terminator.

- **The error log can hold query strings.** nginx writes the full request
  line into every upstream error message, at the `error` level.
  - Lowering the log level from `notice` therefore changes nothing. Only
    `crit` silences it, and with it the reason for the upstream failure.
  - The Google OAuth callback
    (`location ~* ^/api/v1/auth/google/callback/?$`, whose `code` and
    `state` are credentials) sets its error log to `crit`.
  - Every other path under `/api/` still writes its query string on an
    upstream error. That includes the term of every staff search sent as a
    query string (`search`, or the prefixed `invitationsSearch`,
    `historySearch` and `unregisteredSearch`), which can be an email
    address. Those searches are the users and tenants directories (the
    command palette's searches among them), the emails list and the
    suppressions list.
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
