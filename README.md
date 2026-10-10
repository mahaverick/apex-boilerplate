# Apex

The staff admin dashboard boilerplate: a React 19 + TypeScript single-page app
for the people who run a product, not the people who use it. Its sibling,
`react-boilerplate`, is the customer app; both are built on the
`express-boilerplate` API. Apex ships a sign-in, a grouped-sidebar shell, a
⌘K command palette and eleven staff pages: Overview (KPI cards and charts),
Tenants (every customer tenant, keyset-paged, each with a detail page for its
overview, members, invitations, activity, timeline, errors, emails, onboarding and flags), Users (every account, each with
a detail page and, for admins, a PostHog timeline and error list), Staff (the platform's own members and invitations), Emails
(every tracked message, with a delivery timeline and preview), Deliverability
(delivery, bounce and complaint rates), Suppressions (addresses mail is held
back from), Feature flags (every registered flag's live state, and any user's evaluation), Maintenance (customer maintenance mode and the queues' pause state), Onboarding (the activation funnel and the tenants stuck in it) and the Activity log (the platform audit log).

Only platform staff get in. A signed-in user with no platform role lands on
`/no-access`, and the API answers `/platform/*` with **404** to anyone below
the role a route needs, which Apex renders as "your role can't see this" rather
than signing anyone out.

## Stack

| Concern | Choice                                                    |
| ------- | --------------------------------------------------------- |
| Build   | Vite 8, React Compiler via Babel                          |
| Routing | TanStack Router, file-based from `src/pages/`             |
| Data    | TanStack Query, axios with a single-flight refresh        |
| Tables  | TanStack Table 9                                          |
| Charts  | recharts 3, through shadcn's `chart` wrapper              |
| Forms   | TanStack Form + Zod v4 schemas                            |
| State   | Zustand (`src/states/`)                                   |
| UI      | Tailwind v4, shadcn components on Base UI, lucide, sonner |
| Tests   | Vitest, Testing Library, MSW, jest-axe, Playwright        |

## Prerequisites

- **Node 24** and **pnpm 12** (`npm i -g corepack@0.36.0 && corepack enable` — pnpm's version comes from `packageManager` in package.json; Node 25+ does not ship Corepack, so this works on 24 and 26 alike). `pnpm install` refuses an older Node.
- **express-boilerplate 2.0.1 or newer** (2.1.0 for the members page, below), running on `:4040` with `APEX_URL` set. Staff writes to a customer tenant's members and invitations (a reason, sent from Apex's reason dialog, and a recent sign-in), Leave (`DELETE /tenants/:slug/membership`) and Sign out other sessions (`POST /auth/sessions/revoke-others`) need express 2.0.0 or newer, and clearing a maintenance reason sends `reason: null`, which only 2.0.1 accepts, so Apex 1.9.0 and later need express 2.0.1; Apex 1.8.x works with express 1.9.0, the release its maintenance pages need. The members page (a tenant's Members tab and the Staff page) reads two things express 2.1.0 added: the `member_not_found` code on a role change or removal whose member is already gone, and `user.active` on the platform tenant's member list, which the last-owner check counts as express does (only active owners on the platform tenant; every owner, deactivated or not, on a customer tenant). Against express 2.0.x it falls back to the 404's `Member not found` message and counts every platform owner as active, and express's 409 still refuses a leave or demotion that would leave the platform tenant with no active owner, or a customer tenant with no owner. A user's and a tenant's Timeline call routes 1.6.0 added (`/platform/users/:id/timeline`, `/platform/tenants/:id/timeline`); on an older express they answer 404, which reads as a role refusal, and without express's PostHog personal key (`POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`) they say timelines are not set up. Their Watch replay and Open in PostHog links open PostHog itself, so staff who follow them need a PostHog seat. The Onboarding page and a tenant's Onboarding tab call routes 1.4.0 added (`/platform/onboarding/*`, `/platform/tenants/:id/onboarding*`), and Overview's Stuck tenants tile reads its `totals.stuckTenants`. On express 1.3.0 those routes answer 404, which reads as a role refusal, and Overview's key figures fail inside their own error boundary. The Emails, Deliverability and Suppressions pages, a user's Emails card and a tenant's Emails tab call routes 1.3.0 added (`/platform/emails*`, `/platform/email-suppressions*`), and Overview reads its `emailMessages` series. On express 1.2.0, Overview still loads (its stats answer 200 without `emailMessages`, so its email widgets fail inside their own error boundary) while the new pages' routes answer 404, which reads as a role refusal. Apex also calls routes 1.2.0 added: `/platform/users`, `/platform/tenants/:id` and the staff actions under both. An older API answers those 404, which Apex reads as a role refusal or a missing record rather than a missing route: the Users page says "your role can't see this", a tenant's or a user's page says it was not found, and the staff actions say your role can't do them. The Tenants list's Previous button also needs the `prevCursor` field 1.2.0 added, and step-up needs its `/auth/reauthenticate`. Analytics (`POSTHOG_KEY`) needs express 1.5.0 or newer; without a key 1.4.0 still works and analytics stays off. Before 1.1.0 there is also no `APEX_URL` and no `/platform/stats`, so Overview and every Apex email link break too.

## Getting started

Start express with Apex's origin in its `.env`:

```bash
# express-boilerplate/.env
APEX_URL=http://localhost:5174
```

Then, here:

```bash
pnpm install
pnpm dev
```

The dev server listens on <http://localhost:5174> (react-boilerplate
uses :5173, so both can run at once). There is no required `.env` step: the
only `VITE_*` variables are the optional analytics settings in `.env.example`,
which the dev server serves as `/runtime-config.js` — see
[Environment](#environment).

`APEX_URL` is what makes the invitation, verification and password-reset links
express emails, and the Google sign-in callback, point at Apex instead of the
customer app. Apex asks for that by sending `app: "apex"` (a fixed enum,
`web` or `apex`; the API never accepts a URL from a client).

### Becoming staff locally

Staff are the members of express's platform tenant. Two ways in:

- **`pnpm platform:grant -- <email> <role>`**, run in `express-boilerplate`,
  gives an existing, verified user a role in the platform tenant. It is how the
  first platform owner is made, since nobody can invite before one exists.
- **`PLATFORM_EMAIL_DOMAINS`** in express's `.env` (for example `example.com`)
  joins every verified address on those domains as a **viewer**. It never
  changes an existing member's role.

Further staff are invited from the Staff page, which manages the platform
tenant's members and invitations; with `APEX_URL` set, the invitation email
links to Apex's `/invitations/accept`. A viewer sees Overview, Tenants, Users,
Staff, Emails, Deliverability, Suppressions and Onboarding, read-only. The Activity log, marking an onboarding step complete, sending an onboarding reminder and every create, edit and soft action
need admin; permanent deletion, acting on another staff owner, changing any
staff member's role and inviting staff as admin or owner need owner.

### The API must be running on :4040

The dev server proxies `/api` to `http://localhost:4040` (`vite.config.ts`).
Nothing that touches the backend works without it — sign-in, the session
bootstrap on page load, and every staff page fail immediately.

That proxy is not a convenience. The API path is a **relative** one
(`/api/v1`) because Apex and the API are served from one origin, which is the
only topology this app supports (see [Deploying](#deploying)). In development
that origin is the Vite proxy; in the container it is nginx. Because `/api` is
same-origin, **no CORS entry is needed** for Apex.

### The API prefix is fixed

`/api/v1` is not configurable, and there is no environment variable that
moves it. It is written once, as `API_PREFIX` in `src/constants/routes.ts`,
and the JavaScript side derives from it: the axios base
(`src/http/client.ts`) and the Google OAuth anchor (`GOOGLE_OAUTH_PATH`).

`nginx.conf` hardcodes it as well, which is why it is fixed rather than a
knob: `location /api/v1/notifications/stream` is an SSE location (buffering
off, a 24h read timeout, a query-stripping log format) that hangs off that
exact prefix. Apex opens no stream today; the location is kept for the
notification stream a later sub-project adds. `nginx.conf`'s `location /api/`
and the Vite dev proxy in `vite.config.ts` match only the `/api` segment.

Moving the API to another prefix under `/api` therefore means changing
`API_PREFIX` and that SSE `location` together, in one change; a prefix outside
`/api` also moves `location /api/` and the Vite proxy.

### Environment

There are no build-time settings that differ by environment: the same image
serves every environment. (Its build arguments name the commit and where its
sourcemaps go; see [Error tracking and sourcemaps](#error-tracking-and-sourcemaps).)
The container reads its settings at **start**, as environment variables —
`API_UPSTREAM`, where nginx proxies `/api`, and the analytics settings —
listed with their patterns in [Run-time configuration](#run-time-configuration).
`API_UPSTREAM` defaults to `http://api:4040` and must be `scheme://host:port`
with no path, not even a trailing `/` (see
[What `nginx.conf` is doing](#what-nginxconf-is-doing)). Changing any of them
means restarting the container, not rebuilding the image. The dev server
ignores `API_UPSTREAM` (`pnpm dev` proxies to `http://localhost:4040`, or
`E2E_API_ORIGIN`) and reads the analytics settings from `.env` under their
`VITE_` names (`.env.example` lists them).

## Adding a page to the navigation

`src/constants/navigation.ts` is the one extension point. The sidebar and the
⌘K palette both read `NAV_ITEMS`, so an entry there shows up in both:

```ts
{ label: 'Tenants', to: ROUTES.tenants, Icon: Building2, minRole: 'viewer', group: 'Directory' }
```

`group` is one of `NAV_GROUPS` (General, Directory, Operations, Growth, Security),
which is the sidebar's section order. `minRole` is the least platform role that
sees the item; an item above the signed-in user's role is hidden, never shown
disabled. The API enforces the same bar, so `minRole` is only about what to
show. An item may also name a boolean `flag` from Apex's slice of the flag
registry (`src/observability/flags/flag-keys.ts`); it shows only while that
flag is `true`, and its route enforces the same flag. A new route also widens
the `NavPath` union in that file, and needs a file under `src/pages/_app/`. The guard for the whole shell lives in
`src/pages/_app.tsx`: signed-out goes to `/login`, signed-in without a platform
role goes to `/no-access`.

## Scripts

| Script                | What it does                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`            | Dev server on :5174 with the `/api` proxy                                                                                                                                        |
| `pnpm build`          | `tsc -b` then `vite build` → `dist/`                                                                                                                                             |
| `pnpm preview`        | Serve the built bundle locally                                                                                                                                                   |
| `pnpm lint`           | eslint **and** `prettier --check` — both must pass                                                                                                                               |
| `pnpm typecheck`      | `tsc --noEmit` on `tsconfig.app.json`, then `e2e/tsconfig.json`                                                                                                                  |
| `pnpm test`           | Vitest, single pass                                                                                                                                                              |
| `pnpm test:coverage`  | Vitest + coverage; fails under 88/82/86/89 % (stmts/branches/funcs/lines). CI runs it                                                                                            |
| `pnpm test:watch`     | Vitest in watch mode                                                                                                                                                             |
| `pnpm format`         | `prettier --write`                                                                                                                                                               |
| `pnpm check:bundle`   | Builds in memory; fails on one JS chunk, first-visit JS over budget or holding posthog-js or `@posthog/core`, the error listener over 1 KB gzipped, or devtools in a chunk       |
| `pnpm lint:docs`      | History phrasing and broken links in markdown and config comments                                                                                                                |
| `pnpm test:e2e`       | Playwright `fixtures` project against the MSW harness; no backend needed. CI runs it                                                                                             |
| `pnpm test:e2e:live`  | Playwright `live` project; needs express-boilerplate on :4040                                                                                                                    |
| `pnpm test:e2e:nginx` | Builds the production image and runs the Playwright `nginx` project against it on :8088, started with the run-time settings CI uses; all but the `@no-api` tests need a live API |
| `pnpm test:contrast`  | axe colour contrast in a real browser, both themes; no backend needed                                                                                                            |

CI holds eslint to **zero warnings** as well as zero errors
(`pnpm exec eslint . --max-warnings 0`).

## Project structure

Where this build departs from its design specs, the specs say so: the shell spec's closing section "Deviations recorded during implementation" (`2026-09-29-apex-sp1-shell-design.md`), and the directory spec's "Deviations decided during planning" and "Revisions after the pre-implementation audit" (`2026-09-29-apex-sp2-directory-design.md`).

```
src/
  components/
    dev/        dev-only tools, mounted from main.tsx
    features/   composed, app-specific pieces (command palette, overview cards, tenants table, …)
    layouts/    the auth shell and the app shell (sidebar, header)
    shared/     app-wide building blocks that are not shadcn output (`<Pii>`)
    ui/         vendored shadcn output — see CLAUDE.md before editing
  configs/      the run-time configuration (`getRuntimeConfig`)
  constants/    routes, roles, navigation, app name
  hooks/        use-* hooks
  http/         axios client, interceptors, the single-flight session refresh
  lib/          small helpers with no app knowledge
  observability/analytics/  the PostHog facade (lazy posthog-js, masking, handoff, typed events)
  pages/        TanStack Router file routes (exempt from the kebab-case rules)
  queries/      TanStack Query options and mutations, one file per resource; a tenant's
                member and invitation writes, which only lazy screens use, have their own
                (tenant-writes.queries.ts)
  schemas/      Zod schemas mirroring the backend validators
  states/       Zustand stores
  styles/       globals.css and the design tokens
  types/        shared API types
scripts/        Node build and lint checks (check-bundle, comment-style, history-patterns, lint-docs), the dev server's /runtime-config.js
docker/         the image's entrypoint scripts and nginx main config, and check-image.sh
tests/
  unit/         Vitest suites, mirroring src/ (plus the accessibility gate)
  mocks/        MSW server and handlers
  fixtures/     shared test data
  setup.ts      Vitest setup
e2e/            Playwright suites and the fixture harness
```

No test file lives under `src/` — eslint rejects one. A test for
`src/http/session.ts` is `tests/unit/http/session.test.ts`.

## Testing

```bash
pnpm test
```

`tests/unit/a11y.test.tsx` is an **accessibility gate**: every routed page — plus
the open mobile sheet, the tenant filter, the ⌘K palette and the open menus,
which a default-state sweep never sees — must come back clean, with no rule
disabled to get there. A violation is fixed in the markup, never suppressed. It
runs axe-core over the whole `document`, because axe treats its page-level
rules as inapplicable to anything smaller, and it asserts the
one-`<main>`/one-`<h1>` invariants by hand, because jsdom's selector engine
stops axe evaluating those two rules at all.

It does **not** check colour contrast. Those rules are switched off under jsdom,
which has no layout and no cascade, so a green run says nothing about them.
Contrast is measured in a real browser by `pnpm test:contrast`, and the
`fixtures` e2e project checks layout jsdom cannot see, such as nothing
overflowing the viewport at 390px. See CLAUDE.md's end-to-end section.

## Docker

```bash
docker build -t apex-boilerplate .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 apex-boilerplate
```

The image builds the bundle with Node and serves `dist/` from the unprivileged
nginx image — as uid 101, on port **8080** — proxying
`/api` to `API_UPSTREAM` — `http://api:4040` unless you set it — so by default
the container expects an **`api` host** on the same network. nginx resolves
the upstream's host when it loads its config, so without it the container
exits with `host not found in upstream`; `--add-host` above is what makes a
standalone smoke test start at all (the proxy itself will answer 502 until a
real API is there). Under compose, name the API service `api` and nothing else
is needed. To point it elsewhere, set the variable at start:

```bash
docker run --rm -p 8080:8080 -e API_UPSTREAM=http://my-api:8080 --read-only --tmpfs /tmp apex-boilerplate
```

`API_UPSTREAM` is checked at start: `http://` or `https://`, a host (or a
bracketed IPv6 address) and an optional port — nothing else, not even a
trailing `/`. Any other value stops the container with
`API_UPSTREAM must be scheme://host[:port] with no path, got: …`.

At start the entrypoint renders `nginx.conf` as a template, and it substitutes
`API_UPSTREAM` and nothing else, so nginx's own `$host`, `$scheme` and the
rest are left alone.

The image is built to run on a **read-only root filesystem**. Everything nginx writes
— the rendered config, its pid file, request and proxy temp files — goes under
`/tmp`, so give it a writable `/tmp`: `--tmpfs /tmp` as above, or an
`emptyDir` in Kubernetes. With `--read-only` and no writable `/tmp`, the
container stops at start rather than serving without its config. Logs go to
stdout and stderr.

Extra server config goes in a template: add it as
`/etc/nginx/templates/*.conf.template`. The entrypoint strips only the
`.template` suffix, so the name before it has to end `.conf`, matching what
`docker/nginx.main.conf` includes from `/tmp/nginx/conf.d` on start. A file
placed directly in `/etc/nginx/conf.d` is ignored: `docker/nginx.main.conf`
replaces `/etc/nginx/nginx.conf` and its only server-config include is
`/tmp/nginx/conf.d/*.conf`.

`RUN` steps in an image derived from this one run as uid 101, not root: the
`Dockerfile` never resets the unprivileged base image's `USER`. A step that needs root
privileges has to `USER root` first and `USER 101` again before `CMD`.

The image takes no environment-specific build arguments: every setting that
differs between environments is read at start
([Run-time configuration](#run-time-configuration)). The three it does take,
`GIT_SHA`, `POSTHOG_SOURCEMAP_PROJECTS` and `POSTHOG_CLI_HOST`, say which
commit it is and where its sourcemaps are uploaded, and the same image still
serves every environment ([Error tracking and sourcemaps](#error-tracking-and-sourcemaps)). The API
prefix is baked in and fixed — see
[The API prefix is fixed](#the-api-prefix-is-fixed) for what has to change
together if it ever moves.

### Run-time configuration

One image, one digest, is built per commit and promoted unchanged through
every environment (`deploy.yml`, then `promote`). Nothing is configured at
build time: no setting is a Vite `VITE_*` value in the production bundle.
Everything that differs between environments arrives when the container
**starts**, as plain environment variables, wherever the container runs —
Kubernetes or not — and whatever secret store the values come from.

| Container env               | Dev `.env`                       | Pattern                                       | Default                  | Meaning                                                                                              |
| --------------------------- | -------------------------------- | --------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `API_UPSTREAM`              | —                                | `scheme://host[:port]`, no path               | `http://api:4040`        | Where nginx proxies `/api` (see [Docker](#docker)).                                                  |
| `POSTHOG_KEY`               | `VITE_POSTHOG_KEY`               | `phc_` and 8–128 of `A-Z a-z 0-9 _ -`         | empty                    | PostHog project key. Empty: no analytics code loads, every call is a no-op.                          |
| `POSTHOG_UI_HOST`           | `VITE_POSTHOG_UI_HOST`           | an `https://` origin, no path                 | `https://us.posthog.com` | PostHog's UI host, for links posthog-js builds.                                                      |
| `ANALYTICS_CONSENT_MODE`    | —                                | `opt_out`, `required` or `off`                | ignored                  | Validated (the entrypoint is shared with react-boilerplate) but ignored: Apex always runs `opt_out`. |
| `ANALYTICS_HANDOFF_ORIGINS` | `VITE_ANALYTICS_HANDOFF_ORIGINS` | comma-separated `https://` origins, no spaces | empty                    | Ignored: Apex takes no handoff ([why](#analytics-posthog)).                                          |
| `APP_ENVIRONMENT`           | `VITE_APP_ENVIRONMENT`           | `[a-z][a-z0-9-]` up to 32                     | `development`            | Sent as `environment` on every browser event.                                                        |

How it reaches the bundle:

- At start, `docker/10-runtime-config.sh` (in `/docker-entrypoint.d/`, after
  `05-prepare.sh`) checks every value against its pattern. An invalid one
  **stops the container** with `10-runtime-config.sh: POSTHOG_KEY must be …`
  — the message names the variable and never prints the value — so a typo
  fails the rollout instead of quietly switching analytics off. Unset or
  empty means the default.
- It writes `/tmp/runtime/runtime-config.js`
  (`window.__APP_CONFIG__ = Object.freeze({...})`); the root filesystem stays
  read-only. nginx serves it as `/runtime-config.js` with
  `Cache-Control: no-store`, and `index.html` loads it before the bundle.
  Same-origin, so `script-src 'self'` holds.
- The app reads it only through `getRuntimeConfig()`
  (`src/configs/runtime-config.ts`), which applies the same patterns again.
  A production bundle reads nothing else; `pnpm dev`, `pnpm preview` and the
  unit tests read the dev `.env` names from `import.meta.env`, and the dev and
  preview servers serve a matching `/runtime-config.js` from them
  (`scripts/runtime-config-plugin.mjs`).
- A change takes effect when the container restarts; nothing is rebuilt.
  Every value is public — each browser receives `/runtime-config.js` — so
  the PostHog key may come from a secret store but is not a secret.

`docker run`, or a GitHub Actions job using repository secrets:

```bash
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 \
  -e POSTHOG_KEY="$POSTHOG_KEY" -e APP_ENVIRONMENT=staging apex-boilerplate
```

Compose:

```yaml
services:
  web:
    image: ghcr.io/<owner>/apex-boilerplate:<version>
    read_only: true
    tmpfs: [/tmp]
    environment:
      API_UPSTREAM: http://api:4040
      POSTHOG_KEY: ${POSTHOG_KEY}
      APP_ENVIRONMENT: staging
```

Kubernetes, with the key in a Secret:

```yaml
containers:
  - name: web
    image: ghcr.io/<owner>/apex-boilerplate@sha256:<digest>
    securityContext:
      readOnlyRootFilesystem: true
    env:
      - name: APP_ENVIRONMENT
        value: production
      - name: POSTHOG_KEY
        valueFrom:
          secretKeyRef:
            name: apex-boilerplate
            key: posthog-key
    volumeMounts:
      - name: tmp
        mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

From Google Secret Manager: sync the secret into that Kubernetes Secret with
External Secrets or the Secret Manager CSI driver (the `secretKeyRef` stays
as it is), or on Cloud Run map it straight to the variable
(`--set-secrets=POSTHOG_KEY=posthog-key:latest`). The container only ever
sees an environment variable.

### What `nginx.conf` is doing

Two things in there are load-bearing and fail **silently** if edited away,
and the SSE location's settings are defence in depth. `nginx.conf` explains each at the line; in
short:

- `proxy_pass ${API_UPSTREAM};` carries **no trailing path**, and
  `API_UPSTREAM` must not bring one, not even `/`. A path there makes nginx
  rewrite the URI (`/api/` becomes that path), so express stops matching its
  routes.
- The TLS terminator's `X-Forwarded-Proto` is passed through to express. express
  needs `TRUST_PROXY` set for express-session to see HTTPS and set the Secure
  `oauth.sid` cookie.
- The SSE location sets `proxy_buffering off`, an empty `Connection` header
  and a 24h read timeout. express already turns buffering off per response
  (`X-Accel-Buffering: no`) and sends a `:ping` every 30s by default, inside
  nginx's default 60s read timeout, so these keep the stream open even if
  either of those changes.
- That same location logs with a `stream_nolog` format that records `$uri`
  instead of `$request`, and raises its `error_log` level to `crit`. The access
  token is not in the query string there: the client sends an
  `Authorization: Bearer` header, which never appears in a logged request line.
  Both lines stay as defence in depth, so that a query parameter added to this
  route later cannot quietly reach the access log, or the **error** log — nginx
  puts the full request line and the full upstream URL into every
  `connect() failed` message, which no log format can change. The cost is that
  `error`-level upstream detail for this one location is dropped; the access log
  still records every request and its status.
- `location /api/v1/collect/` is `location /api/` with a 10 MB body limit,
  streamed to express rather than buffered: posthog-js posts a replay batch
  of up to about 6.3 MB in one request (a third more as base64 when gzip is
  unavailable), and nginx's default 1 MB answers it 413. Every other API
  route keeps the default.
- `location = /runtime-config.js` serves the file the entrypoint writes under
  `/tmp`, `no-store` through the same `map` as `index.html`.

Security headers (`Content-Security-Policy`, `Permissions-Policy`,
`Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Cross-Origin-Opener-Policy`) are set once on the server block with `always`,
and `server_tokens off` drops the nginx version from the `Server` header and
error pages. No location declares an `add_header` of its own, because
one that did would silently drop all of them — `add_header` does not inherit
into a block that sets any header itself. Cache-Control is therefore chosen by
a `map` rather than per-location. **Verify this with `curl -I` against a real
asset, not by reading the config.**

A proxied `/api/` response keeps each of these headers the API already sent
(helmet's own, stricter values, such as its `default-src 'none'` policy and
`X-Frame-Options: SAMEORIGIN`); nginx adds only the ones the API left out, so
none is sent twice. Nginx's own 502 or 504 for an `/api/` request with no
backend carries the full set.

### Content-Security-Policy

nginx sends an **enforced** policy on every response it answers itself:

    default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
    img-src 'self' data:; connect-src 'self'; object-src 'none';
    base-uri 'none'; frame-ancestors 'none'; form-action 'self'

- **No inline script.** The pre-paint theme script — which has to run before
  the bundle, or every dark-mode load flashes light — is the file
  `public/theme-init.js`, loaded by a classic, blocking `<script src>` in
  `index.html`. Keep it a file: an inline `<script>` is blocked by
  `script-src 'self'`, and `'unsafe-inline'` would give away what the policy is
  for. Its name is not content-hashed, so it is served `no-store`, like
  `index.html`.
- **`style-src 'unsafe-inline'`** is there because sonner injects a `<style>`
  element at runtime, and because recharts sets inline styles and shadcn's
  `ChartStyle` renders a `<style>` element for the series colours.
- **`connect-src 'self'`** holds because the API is same-origin: nginx proxies
  `/api`. Calling another origin from the browser means widening it here.
- **Analytics needs nothing added.** posthog-js sends to `/api/v1/collect`
  and loads its replay recorder and extensions from
  `/api/v1/collect/static/…`, both same-origin, and replay starts no worker
  (measured against this image: no `worker` event and no violation). The
  recorder can start a `blob:` worker only to record `<canvas>` content; that
  stays off in the PostHog project's replay settings, because
  `script-src 'self'` (which `worker-src` falls back to) blocks it.
- The `nginx` Playwright project asserts zero violations: on the sign-in page
  and for the theme script in CI (the `@no-api` tests), and on the
  signed-in shell, the Activity page and the Overview charts with real data
  locally (`pnpm test:e2e:nginx`).

### Known gaps

- **No HSTS.** Deliberate: this server listens on `:8080` behind a TLS
  terminator. A `max-age` sent over plain HTTP is ignored by browsers and is
  actively wrong if TLS is ever absent. Set it at the edge that terminates TLS.
- **IPv4 only.** `nginx.conf`'s `server` block declares `listen 8080;`, which
  binds `0.0.0.0:8080` and nothing else. IPv6-only clusters need
  `listen [::]:8080;` added to that block — which fails on hosts with IPv6
  disabled, so it is not a change to make unconditionally.

## Analytics (PostHog)

Browser analytics go to the same PostHog project as express's server-side
events (express 1.5.0 or newer, which forwards them and serves the
`/api/v1/collect` proxy). Without `POSTHOG_KEY` the app ships no PostHog
code in its main bundle and makes no analytics call.

With a key, `src/observability/analytics/` (the same module as
react-boilerplate's) loads posthog-js 1.435.6 in a chunk of its own and turns
on autocapture, pageviews and session replay. Apex captures unless the
signed-in person opted out in the customer app's profile
(`analyticsOptOut`); it has no consent banner and ignores
`ANALYTICS_CONSENT_MODE`. What it does not send:

- **Query strings** outside `range`, `tab`, `state` and `status`, and URL
  hashes: invitation, reset and verification tokens, `?q=` searches and
  `?redirect=` targets never leave the browser.
- **Element attributes** in autocapture, and in replay any `aria-label`,
  `title`, `alt`, `placeholder`, `data-*`, or a `mailto:`/query-carrying
  `href`.
- **Input values** in replay, and the text of anything inside `Pii`
  (`src/components/shared/pii.tsx`), which wraps every person's name, email
  address, avatar initial and invitation address, and free text staff typed;
  every toast is masked too.
- **Person properties.** The browser identifies the signed-in user by id
  only; express sets `is_staff` and the rest. Apex sets no tenant group:
  staff have no active tenant.

Typed events: `command_palette_opened`, `command_palette_action_run`
(`action`: the kind of item chosen) and `table_filtered` (`table`: which
list, never the filter's value). Every same-origin `/api/v1/` axios request
carries a fresh W3C `traceparent` and, only while capture is on and PostHog
holds no identified person other than the signed-in user, `X-POSTHOG-SESSION-ID`,
so a server event links to the trace and the replay that caused it.

Apex keeps its own browser identity: it stores posthog-js's state under
`ph_ph_apex` and scopes the identity cookie to its own host, because the
customer app uses the same project key and, on a sibling subdomain, would
otherwise share the anonymous id, session and user state with it.

Operator steps: set `POSTHOG_KEY` only once the API runs express 1.5.0+ (on an
older API `/api/v1/collect` answers 404 and the user carries no
`analyticsOptOut`). Set the container's `POSTHOG_KEY` (and `POSTHOG_UI_HOST` for
an EU project, `APP_ENVIRONMENT` for the environment's name) to the
environment's project, the one express's `POSTHOG_PROJECT_KEY` names; no
rebuild. Apex takes no handoff from a website: `ANALYTICS_HANDOFF_ORIGINS` is
read but ignored (`SUPPORTS_HANDOFF` is false in
`src/observability/analytics/config.ts`), and a `?ph_did=&ph_sid=` is only
stripped from the address bar, so a website visitor's anonymous id never joins
a staff person.

The `@no-api` half of `e2e/nginx/analytics.test.ts` runs in CI against the
image started with `POSTHOG_KEY=phc_test_key_not_real`, `APP_ENVIRONMENT=ci`
and `ANALYTICS_HANDOFF_ORIGINS=https://www.example.test`, its
`/api/v1/collect` traffic answered by a fake PostHog through Playwright. The
live half needs an express 1.5.0+ behind the image: start express with
`POSTHOG_PROJECT_KEY=phc_test_key_not_real`, `POSTHOG_HOST` and
`POSTHOG_ASSETS_HOST` both `http://127.0.0.1:4063` and
`ANALYTICS_DRAIN_INTERVAL_MS=1000`, run the image with the same three
settings and `API_UPSTREAM` pointing at that express, then
`E2E_LIVE=1 E2E_NGINX=1 E2E_ANALYTICS=1 E2E_NGINX_ORIGIN=<image origin> E2E_API_ORIGIN=<express origin> E2E_API_DIR=<express checkout> pnpm exec playwright test --project=nginx e2e/nginx/analytics.test.ts`.
The suite starts the fake PostHog on :4063 itself (`E2E_FAKE_POSTHOG_PORT`
moves it).

### Error tracking and sourcemaps

Every crash in the browser becomes one `$exception` in PostHog Error
Tracking, in the project `POSTHOG_KEY` names, symbolicated to the `.ts` and
`.tsx` source when the image's build uploaded its source maps
([Source maps](#source-maps)). It is the same module as react-boilerplate's
(`src/observability/errors/`). Without `POSTHOG_KEY` nothing is sent
(`ANALYTICS_CONSENT_MODE` is ignored; Apex always runs `opt_out`).

- **What is caught.** Uncaught errors and unhandled rejections (window
  listeners installed before any other module runs), every error React's
  root sees (`createRoot`'s `onUncaughtError` and `onCaughtError`, so every
  error boundary, `WidgetBoundary` included) and every error screen the
  router shows (`RouteError`). A chunk that fails to load is sent as
  handled, with `origin: chunk_load`: it means a deploy left the page behind.
  Each event's `origin` says where it was noticed: `window` (an uncaught
  error), `rejection` (an unhandled rejection), `react` (an error React's root
  saw, caught by a React error boundary, route render errors included, or
  uncaught), `router` (a loader error the route error screen shows) or
  `chunk_load` (a chunk that failed to load, whichever of these saw it).
- **What is not.** API errors and network failures (the API reports its own
  5xx), aborts, ResizeObserver noise, opaque cross-origin `Script error.`,
  and any error with no frame from this app's own files (an extension's).
- **Where it goes.** `src/observability/errors/listen.ts` is in the entry
  chunk (under 1 KB gzipped) and only notes errors, up to 20 before the
  reporter loads; the reporter and `@posthog/core` load on the first error or
  when the browser is idle, so a crash before posthog-js loads is still
  reported. Events go to the API's `/api/v1/collect/batch/`, batched, and by
  `sendBeacon` when the page is hidden. At most 5 per error and 30 per page
  are sent.
- **Identity.** With analytics consent, an exception carries the signed-in
  user's distinct id and the replay session. Apex sets no tenant group. Without
  consent (opted out on their profile, posthog-js blocked, or analytics
  unsettled after 10 s) it is anonymous: a new distinct
  id per event and no person profile. An earlier anonymous crash is never
  re-attributed.
- **Scrubbing.** Exception types, values, frame file names and function names
  go through the same rules as express-boilerplate's
  (`src/observability/errors/scrub.ts`, tested against the shared
  `tests/fixtures/error-scrub-vectors.json`): Postgres key details and echoed
  values, URL credentials, query strings, fragments other than line or
  heading anchors, the token segment after `/reset/`, `/verify/`, `/invite/`
  or `/accept/`, Bearer and Basic credentials, Authorization and Cookie
  values, secret-named keys' values, JWTs, emails, PostHog and vendor keys,
  IP addresses, `+`-prefixed phone numbers and long hex and base64 runs are
  replaced, and each text is cut to 1024 characters. URLs keep only the
  analytics allowlist's query keys.
- **Release.** Each exception's `release` is the commit the image was built
  from (`GIT_SHA`); its `environment` is `APP_ENVIRONMENT`. Set
  `APP_ENVIRONMENT` to the same value as express's `APP_ENV` (`local`, `dev`,
  `qa` or `prod`), so an issue's `environment` reads the same for browser and
  server errors.

#### What the scrubber does not catch

Regex scrubbing is best-effort; keep secrets out of error messages. The list
is express-boilerplate's (`SECURITY.md`), since the rules are the same. It
does not catch:

- names and other free text;
- ids, UUIDs included: they are identifiers, kept on purpose for debugging;
- national-format phone numbers without a leading `+`;
- a bare opaque word with no key in front of it;
- a `code` value outside a query, a form body or an OAuth or authorization
  context, and a `key` value written with `:`, so `code: 'ECONNREFUSED'` and
  `key: 'user_id'` stay readable (an `oauth` inside any word, `myoauthlib`
  included, counts as OAuth context, so every `code` key in that text goes);
- a bare `response:` followed by unquoted prose (`Unexpected response: 502`);
- an Authorization header on its own, which does not make a `code` on another
  line an authorization code;
- the text after a Bearer or Basic credential on an Authorization line
  (`Bearer [token] extra` keeps `extra`);
- a nested array value past its first `]`;
- a camelCase `pin` (`userPin`);
- a key behind a double-encoded quote or separator (`%2522`, `%253D`) or a
  hex HTML entity (`&#x3D;`), and a `key` after an encoded `&` (`%26key%3D`);
- a URL fragment of lowercase letters and hyphens with no key-like word
  (`#api-key` and `#token-abc` are replaced): under 40 characters, or up to 64
  when each hyphen-joined word has at most 20 letters, which reads as a
  heading, unless another rule would replace part of it (32 or more of the
  letters `a` to `f`, a Slack-style `xoxb-` prefix), when it is replaced whole;
- a kebab- or snake-case run of lowercase words of up to 20 letters each, 40
  or more characters in all, which reads as an identifier;
- vendor tokens with no rule (`ya29.`, `glpat-`, `hf_`, Google `1//` refresh
  tokens);
- a host named like a package ref after `@` (`jane@main`, `jane@npm:`,
  `jane@workspace:`);
- the domain of an email whose local part is a JWT (`[jwt]@example.com`);
- the part before the last `/` of a run joined to an email address's local
  part when the run, with the local part's leading base64 characters, is under
  40 characters or reads as a path rather than base64, counting stopped by a
  `%2F` (`abc/def%2Fghi@example.com` keeps `abc/`), or when it follows an
  address character directly (a letter, digit, `.`, `%`, `+`, `-`, `_`, `/` or
  `@`: `jane@example.com/<secret>@…`, `u.<secret>@…`);
- a quoted value whose key sits inside a URL query that an encoded key's value
  runs into (`secret%3Dhttps://…?a=1/api_key="…"` keeps the quoted value);
- a key name glued to the end of the segment after `/reset/`, `/verify/`,
  `/invite/` or `/accept/`, which goes into `[token]` with the segment and
  leaves the value after it in view (`/app/reset/x.tsrefresh_token = …`
  becomes `/app/reset/[token] = …`);
- the parameters other than secret-named ones of an Authorization or Cookie
  value opened by an escaped quote and a scheme (`\"OAuth username="…",
realm="…"` keeps `username` and `realm`; `oauth_signature`, `oauth_token`,
  `nonce`, `cnonce` and `response` are still redacted);
- the rest of a base64 run that is the domain of an address whose local part
  follows a `/` (`dir/x@wJalr…/K7MDENG/…` keeps `/K7MDENG/…`).

Scrubbing a scrubbed text again changes nothing, except contrived inputs that
glue a phone number, IP address or hex run to one another, put an address with
a quoted local part (`"jane doe"@…`) straight against a URL's or path's query
or fragment, end an address with a `.` straight before a query
(`jane@example.com.?a=1`), or leave a placeholder in quotes straight before an
`@`.

Also unverified by the binary's hash check: the CLI's JavaScript wrapper
(`lib/posthog-api-cli.mjs`), which comes from the npm package, not the download.

#### Source maps

The build always writes hidden source maps (no `sourceMappingURL` in any
chunk), and the image's build stage then:

1. injects chunk ids into every chunk with `posthog-cli sourcemap inject`,
   offline and release-less, whether or not maps are uploaded, so one file
   name never holds two contents across builds;
2. uploads the maps to every project in `POSTHOG_SOURCEMAP_PROJECTS`
   (`docker/upload-sourcemaps.sh`), one run per project. The build fails if there
   are no `.map` files under `dist/`, if the CLI skipped a chunk as too large,
   if nothing was uploaded (unless the same output line gives a non-zero
   "already uploaded" or existing count), or if an upload fails;
3. deletes every `.map`, so none ships (`docker/check-image.sh` checks).

nginx also answers 404 for any `.map` URL outside `/api/` (the `.map`
location in `nginx.conf`), even where a file exists. **Any deploy of `dist/`
outside the image must delete `*.map` first.**

The build downloads the `posthog-cli` binary from releases.posthog.com and
verifies its SHA-256 against `docker/posthog-cli.sha256` (one hash per
architecture) before it first runs. **Bumping `@posthog/cli` means updating
those hashes** (the file says how); a mismatch fails the build.

| Build input                  | Kind                          | Default                  | Meaning                                                                         |
| ---------------------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `GIT_SHA`                    | build argument                | `dev`                    | The commit; `deploy.yml` passes `github.sha`                                    |
| `POSTHOG_SOURCEMAP_PROJECTS` | repo variable → build arg     | unset                    | Comma-separated PostHog project ids, one per environment, that get the maps     |
| `POSTHOG_CLI_HOST`           | repo variable → build arg     | `https://us.posthog.com` | PostHog's app host; `https://eu.posthog.com` for an EU organisation             |
| `POSTHOG_CLI_TOKEN`          | repo secret → BuildKit secret | unset                    | A personal API key with the sourcemap upload scope; never in a layer or history |

With `POSTHOG_SOURCEMAP_PROJECTS` unset the build skips the upload and
`deploy.yml` warns `sourcemaps not uploaded`: exceptions arrive,
unsymbolicated. With it set and the secret empty, or with any upload
failing, the build fails: an image whose errors cannot be read is not shipped.
Maps are uploaded only when an image is built: a promotion re-tags the image
`main` built, so its maps are already in every listed project. **Adding an
environment means adding its project id and rebuilding** (re-run `deploy.yml`
on `main`); images built before that have no maps there. The one-time setup is
under [Deploying](#one-time-setup).

#### The Errors pages and the status card

Staff see the issues in the app: a user's **Errors** page and a tenant's
**Errors** tab (admins and up) list the last 30 days' issues for that person
or tenant, with an **Unverified** badge on a row that claims to come from the
server but carries no valid server signature, and the Overview's **System
status** card shows the API's release and how many server errors it sent or
dropped in the last 15 minutes. Both need express 1.7.0 or newer; the lists
also need its PostHog personal key and project id (`POSTHOG_PERSONAL_API_KEY`,
`POSTHOG_PROJECT_ID`), and say they are not set up when either is missing.

## Feature flags

Flags are declared in express's registry (`src/constants/flags.constants.ts`)
and evaluated there, from a PostHog definitions snapshot, with traits express
supplies. Apex never asks PostHog for a flag: posthog-js's own flag fetching
is off (`advanced_disable_feature_flags`).

- **Reading a flag.** `src/observability/flags/` is react-boilerplate's
  module, copied byte for byte (see CLAUDE.md's sibling-sync table), except
  `flag-keys.ts` and `flag-scope.ts`, which are Apex's own. The `_app`
  layout's loader fetches Apex's values from `GET /platform/me/flags` (staff
  are evaluated with no tenant) before the shell renders; a failed read
  serves each flag's fallback and never blocks a page. `useFlag`,
  `useVariant`, `<Flag>` and `requireClientFlag` read them, and a nav item's
  `flag` hides it while off.
- **Adding an Apex flag.** Declare it in express with `client: true` and
  `apex` in `apps`, run express's `flags:sync` in each environment, then copy
  its key, kind, variants, fallback and `experiment` into `CLIENT_FLAGS` in
  `flag-keys.ts`, and its fallback into `TEST_FLAG_FALLBACKS` in
  `tests/mocks/handlers.ts`, and add it to the `/platform/me/flags` answer in
  `e2e/harness/harness.tsx`, or the harness serves the fallback and hides
  flagged nav items. An unregistered key fails typecheck. Apex has no flag yet.
- **The inspector.** **Feature flags** (Operations, every staff role) lists
  each registered flag with its state in this environment's PostHog
  (active, inactive, missing or unsupported, and the construct that made it
  unsupported), PostHog's flags that no code declares, and the traits a
  release condition may use, with copy buttons. Admins also get **Evaluate**:
  pick a user from the directory, optionally one of their tenants, and the app
  whose browser view to mark; every registered flag shows its value and the
  reason, and a holdout user shows "Sees control, recorded as holdout-…". Each
  evaluation is an audited read, so it is never refetched on its own. A
  tenant's **Flags** tab (admins) evaluates one of its members there, and a
  user's page links to their evaluation. Rollouts are edited in PostHog, never
  here.
- **Status.** The Overview's **System status** card gains a **Feature flags**
  section: whether flags are set up, when the definitions were last checked and
  last changed, the counts, the last
  failed fetch, and **Needs attention** when the snapshot is missing or stale,
  the last fetch failed, PostHog's property matching version is not 1 (or not
  reported), or any
  flag is missing, unsupported or answered an unknown variant.

The flags pages, the tenant tab and the status section need express 1.8.0 or
newer (an older API answers them 404, which reads as "your role can't see
this", and its status has no flags section); evaluation needs express's
`POSTHOG_FEATURE_FLAGS_KEY`, without which every flag serves its fallback and
the page says flags are not set up.

## Maintenance mode

A platform owner can put customers into maintenance from **Maintenance**
(Operations, every staff role reads it): **read-only**, where customers can
read but every change is refused, or **full**, where customers see a
maintenance page, cannot sign in, and every queue pauses. The page shows who
set it, why, the customer message and each queue's pause state with its
running jobs; while the mode is not off, every staff page carries a red
banner. Switching on or escalating to full asks for the message (with a
preview of what customers will see), a reason and the API's environment name
typed out, then a password confirmation if the sign-in is more than 10 minutes
old. Switching off is one confirmation, plus the password prompt if the sign-in is
more than 10 minutes old. Every other owner and admin is told,
in the app and by email. The Overview's **System status** card gains a
**Maintenance mode** section: the mode this API serves, the queues, and
**Needs attention** when the API has not read the state, a reload failed,
the queues disagree with the mode, or change notices are still waiting.

Runbook:

1. Before **full**, confirm every staff member who will need Apex can sign in:
   password resets are refused in full maintenance. Staff actions in Apex,
   including the tenant, member, invitation and Staff pages, keep working and
   writing during maintenance, so a staff change still lands while customers
   are shut out.
2. Use **read-only** for data fixes where reads are safe; jobs keep running.
3. Before database work, check that every queue on the Maintenance page says
   **0 running**.
4. Switch off from Apex when done; paused queues resume and held notices go out.

Maintenance mode needs express 1.9.0 or newer; an older API answers it 404,
which reads as "your role can't see this", and its status has no maintenance
section.

## Deploying

A push to `main` runs [`deploy.yml`](.github/workflows/deploy.yml), which
calls `ci.yml` as a gate and, once it passes, builds and pushes
`ghcr.io/<repo>:sha-<commit>` and `:main` to GHCR with an SBOM and build
provenance attestation. The `deploy` job itself is a placeholder — no
deployment target has been chosen yet. A manual `workflow_dispatch` from
another branch only pushes the sha-tagged image — the `:main` tag and the
`deploy` job both run only from `main`.

**Add protection rules to the `production` GitHub Environment**
(Settings → Environments → `production`) — at minimum, required
reviewers — before replacing the placeholder `deploy` step with a real
deployment target. Until then, anything merged to `main` would deploy
unreviewed the moment that step does something real.

**Serve Apex and the API from one origin.** The image's nginx proxies `/api`
to `API_UPSTREAM`, so the browser only ever calls the origin that served the
page. A split-origin deployment, with Apex on one host calling the API on
another, is not supported: its API client uses relative URLs, its
Content-Security-Policy allows `connect-src 'self'` only, and the refresh
cookie is set on whichever origin answers `/api`. Because the calls are
same-origin, express needs no CORS entry for Apex.

The production topology, then: Apex on **its own origin** (for example
`https://admin.example.com`), the customer app on another, and one express
behind both, each frontend proxying `/api` to it. On express:

- Set **`APEX_URL`** to Apex's public origin. It may carry a path; it may not
  carry a query or a fragment. Unset, every link goes to `WEB_URL`.
- If Google sign-in is on (`GOOGLE_CLIENT_ID`) and Apex's host differs from
  express's `APP_URL` host, set **`COOKIE_DOMAIN`** to a parent domain of both
  hosts. express refuses to boot otherwise: a Google sign-in started in Apex
  would lose its session on the way back.
- `/platform/*` answers **404**, not 403, to a caller below the role a route
  needs, and Apex treats that 404 as "not available to your role".

## Releases

Releases are automatic. On every push to `main`,
[release-please](https://github.com/googleapis/release-please) opens a release
PR from the conventional commits since the last release, and
`.github/workflows/release.yml` queues it with `--auto` (or merges it directly
if GitHub refuses auto-merge). With the `main` ruleset below, either way it
merges only once the required checks pass. The next run tags `vX.Y.Z` and
publishes the GitHub Release, and the tag push makes `deploy.yml` promote the image `main` already built and
tested: it adds `:X.Y.Z`, `:X.Y` and `:X` to that same digest rather than
rebuilding. Only `feat`/`fix`/breaking commits cut a release — `chore`, `docs`, `ci`
and the like do not.

Releases use a GitHub App token, from the repo variable
**`RELEASE_APP_CLIENT_ID`** and the secret **`RELEASE_APP_PRIVATE_KEY`**; the
App needs Contents and Pull requests read/write. GitHub never starts workflows
from events `GITHUB_TOKEN` creates, so its release PRs would get no CI and its
tags no image promotion — don't fall back to it.

### One-time setup

Three manual steps, once, and a fourth for readable stack traces:

- **Create and install the release GitHub App** on this repository, then set
  its client ID as the `RELEASE_APP_CLIENT_ID` variable and its private key as
  the `RELEASE_APP_PRIVATE_KEY` secret. Without them `release.yml` fails.
- **Install the [Renovate GitHub App](https://github.com/apps/renovate).**
  `renovate.json` is inert without it — nothing schedules or opens Renovate
  PRs until the app is installed.
- **Set the merge rules** (Settings → General, then Settings → Rules).
  Enable "Allow auto-merge"; allow squash merging only, with the commit
  title set to the PR title and the commit message left blank; enable
  "Automatically delete head branches"; and add a ruleset on `main`, with no
  bypass list, requiring the checks `lint`, `test`, `e2e`, `docker`,
  `gitleaks` and `pr-title`. Without the ruleset, `release.yml`'s fallback
  merges the release PR without waiting for CI; without the blank squash
  message, each squash body would carry the branch's commit list, which
  release-please reads as extra conventional commits.
- **For symbolicated errors, set the sourcemap upload** (optional): create a
  PostHog **personal API key** with the error-tracking write scope (sourcemap
  upload) for the organisation and store it as the repository **secret
  `POSTHOG_CLI_TOKEN`**; it reaches the build as a BuildKit secret, never in a
  layer, an image or the provenance attestation. Set the repository
  **variable `POSTHOG_SOURCEMAP_PROJECTS`** to a comma-separated list of
  project ids, one per environment (`12345,67890`; they appear in the image's
  provenance and are not secrets), and optionally **`POSTHOG_CLI_HOST`**
  (`https://eu.posthog.com` for EU cloud). Until the variable is set, images
  build without uploading, with a warning; see
  [Error tracking and sourcemaps](#error-tracking-and-sourcemaps).

The first release was pinned with `"release-as": "1.0.0"` in
`release-please-config.json`; that line was removed once v1.0.0 shipped, so
later releases follow the commits. A fresh copy of this template that wants to
restart at 1.0.0 adds it back for one release, then removes it again.

With those rules, the squashed commit on `main` is the PR's title alone, not
any of its individual commit messages — so PR titles must themselves be
conventional commits for release-please to read them correctly.

## Conventions

Read [CLAUDE.md](CLAUDE.md) before changing dependencies or adding files.
