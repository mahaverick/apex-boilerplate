# Apex

The staff admin dashboard boilerplate: a React 19 + TypeScript single-page app
for the people who run a product, not the people who use it. Its sibling,
`react-boilerplate`, is the customer app; both are built on the
`express-boilerplate` API. Apex ships a sign-in, a grouped-sidebar shell, a
⌘K command palette and eight staff pages: Overview (KPI cards and charts),
Tenants (every customer tenant, keyset-paged, each with a detail page for its
overview, members, invitations and activity), Users (every account, each with
a detail page), Staff (the platform's own members and invitations), Emails
(every tracked message, with a delivery timeline and preview), Deliverability
(delivery, bounce and complaint rates), Suppressions (addresses mail is held
back from) and the Activity log (the platform audit log).

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
- **express-boilerplate 1.4.0 or newer**, running on `:4040` with `APEX_URL` set. The Onboarding page and a tenant's Onboarding tab call routes 1.4.0 added (`/platform/onboarding/*`, `/platform/tenants/:id/onboarding*`), and Overview's Stuck tenants tile reads its `totals.stuckTenants`. On express 1.3.0 those routes answer 404, which reads as a role refusal, and Overview's key figures fail inside their own error boundary. The Emails, Deliverability and Suppressions pages, a user's Emails card and a tenant's Emails tab call routes 1.3.0 added (`/platform/emails*`, `/platform/email-suppressions*`), and Overview reads its `emailMessages` series. On express 1.2.0, Overview still loads (its stats answer 200 without `emailMessages`, so its email widgets fail inside their own error boundary) while the new pages' routes answer 404, which reads as a role refusal. Apex also calls routes 1.2.0 added: `/platform/users`, `/platform/tenants/:id` and the staff actions under both. An older API answers those 404, which Apex reads as a role refusal or a missing record rather than a missing route: the Users page says "your role can't see this", a tenant's or a user's page says it was not found, and the staff actions say your role can't do them. The Tenants list's Previous button also needs the `prevCursor` field 1.2.0 added, and step-up needs its `/auth/reauthenticate`. Before 1.1.0 there is also no `APEX_URL` and no `/platform/stats`, so Overview and every Apex email link break too.

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
uses :5173, so both can run at once). There is no `.env` step:
nothing in the app reads a `VITE_*` variable, and `.env.example` holds only the
comments explaining why — see [Environment](#environment).

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
Staff, Emails, Deliverability and Suppressions, read-only. The Activity log and every create, edit and soft action
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

There are no build-time variables. `.env` would be read at **build** time —
Vite inlines `VITE_*` values into the bundle — but nothing in the app reads
one, so the same image serves every environment.

The container reads one variable at **start**: `API_UPSTREAM`, where nginx
proxies `/api`. It defaults to `http://api:4040` and must be
`scheme://host:port` with no path, not even a trailing `/` (see
[What `nginx.conf` is doing](#what-nginxconf-is-doing)). Changing it means
restarting the container, not rebuilding the image. The dev server ignores
it: `pnpm dev` always proxies to `http://localhost:4040`.

## Adding a page to the navigation

`src/constants/navigation.ts` is the one extension point. The sidebar and the
⌘K palette both read `NAV_ITEMS`, so an entry there shows up in both:

```ts
{ label: 'Tenants', to: ROUTES.tenants, Icon: Building2, minRole: 'viewer', group: 'Directory' }
```

`group` is one of `NAV_GROUPS` (General, Directory, Operations, Security),
which is the sidebar's section order. `minRole` is the least platform role that
sees the item; an item above the signed-in user's role is hidden, never shown
disabled. The API enforces the same bar, so `minRole` is only about what to
show. A new route also widens the `NavPath` union in that file, and needs a
file under `src/pages/_app/`. The guard for the whole shell lives in
`src/pages/_app.tsx`: signed-out goes to `/login`, signed-in without a platform
role goes to `/no-access`.

## Scripts

| Script                | What it does                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`            | Dev server on :5174 with the `/api` proxy                                                                                            |
| `pnpm build`          | `tsc -b` then `vite build` → `dist/`                                                                                                 |
| `pnpm preview`        | Serve the built bundle locally                                                                                                       |
| `pnpm lint`           | eslint **and** `prettier --check` — both must pass                                                                                   |
| `pnpm typecheck`      | `tsc --noEmit` on `tsconfig.app.json`, then `e2e/tsconfig.json`                                                                      |
| `pnpm test`           | Vitest, single pass                                                                                                                  |
| `pnpm test:coverage`  | Vitest + coverage; fails under 88/82/86/89 % (stmts/branches/funcs/lines). CI runs it                                                |
| `pnpm test:watch`     | Vitest in watch mode                                                                                                                 |
| `pnpm format`         | `prettier --write`                                                                                                                   |
| `pnpm check:bundle`   | Builds in memory; fails on one JS chunk, first-visit JS over budget, or devtools in a chunk                                          |
| `pnpm lint:docs`      | History phrasing and broken links in markdown and config comments                                                                    |
| `pnpm test:e2e`       | Playwright `fixtures` project against the MSW harness; no backend needed. CI runs it                                                 |
| `pnpm test:e2e:live`  | Playwright `live` project; needs express-boilerplate on :4040                                                                        |
| `pnpm test:e2e:nginx` | Builds the production image and runs the Playwright `nginx` project against it on :8088; all but the `@no-api` tests need a live API |
| `pnpm test:contrast`  | axe colour contrast in a real browser, both themes; no backend needed                                                                |

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
    ui/         vendored shadcn output — see CLAUDE.md before editing
  constants/    routes, roles, navigation, app name
  hooks/        use-* hooks
  http/         axios client, interceptors, the single-flight session refresh
  lib/          small helpers with no app knowledge
  pages/        TanStack Router file routes (exempt from the kebab-case rules)
  queries/      TanStack Query options and mutations, one file per resource
  schemas/      Zod schemas mirroring the backend validators
  states/       Zustand stores
  styles/       globals.css and the design tokens
  types/        shared API types
scripts/        Node build and lint checks (check-bundle, comment-style, history-patterns, lint-docs)
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

The image takes no build arguments. The API prefix is baked in and fixed —
see [The API prefix is fixed](#the-api-prefix-is-fixed) for what has to change
together if it ever moves.

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

Security headers (`Content-Security-Policy`, `Permissions-Policy`,
`Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Cross-Origin-Opener-Policy`) are set once on the server block with `always`,
and `server_tokens off` drops the nginx version from the `Server` header and
error pages. No location declares an `add_header` of its own, because
one that did would silently drop all of them — `add_header` does not inherit
into a block that sets any header itself. Cache-Control is therefore chosen by
a `map` rather than per-location. **Verify this with `curl -I` against a real
asset, not by reading the config.**

### Content-Security-Policy

nginx sends an **enforced** policy on every response:

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

Three manual steps, once:

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

The first release was pinned with `"release-as": "1.0.0"` in
`release-please-config.json`; that line was removed once v1.0.0 shipped, so
later releases follow the commits. A fresh copy of this template that wants to
restart at 1.0.0 adds it back for one release, then removes it again.

With those rules, the squashed commit on `main` is the PR's title alone, not
any of its individual commit messages — so PR titles must themselves be
conventional commits for release-please to read them correctly.

## Conventions

Read [CLAUDE.md](CLAUDE.md) before changing dependencies or adding files.
