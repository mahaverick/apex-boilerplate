# Apex

A React 19 + TypeScript single-page app for the people who run a product, not
the people who use it: the staff console. Its sibling, `react-boilerplate`, is
the customer app, and both are built on the `express-boilerplate` API. Apex ships
a sign-in, a sectioned, collapsible sidebar shell, a ⌘K command palette, eight staff pages
(Overview, Tenants, Users, Emails, Deliverability, Suppressions, Onboarding and the
Activity log) and a Settings area: Profile and Security for your own account, and
Staff, Feature flags and Maintenance for the platform.

Only platform staff get in. A signed-in user with no platform role lands on
`/no-access`, and the API answers `/platform/*` with **404** to anyone below the
role a route needs, which Apex renders as "your role can't see this" and never as
a sign-out ([Staff-only access](SECURITY.md#staff-only-access)).

| Concern | Choice                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------- |
| Build   | Vite 8, React Compiler via Babel                                                                |
| Routing | TanStack Router, file-based from `src/pages/`                                                   |
| Data    | TanStack Query, axios with a single-flight refresh                                              |
| Tables  | TanStack Table 9                                                                                |
| Charts  | recharts 3, through shadcn's `chart` wrapper                                                    |
| Forms   | TanStack Form + Zod v4 schemas                                                                  |
| State   | Zustand (`src/states/`)                                                                         |
| UI      | Tailwind v4, shadcn components on Base UI (base-vega style, Inter), Tabler icons, Base UI toast |
| Tests   | Vitest, Testing Library, MSW, jest-axe, Playwright                                              |

How the code is organised, and why, is in [ARCHITECTURE.md](ARCHITECTURE.md).
The threat model and the defences are in [SECURITY.md](SECURITY.md). The rules
for changing code are in [CLAUDE.md](CLAUDE.md), and the design language is in
[STYLESEED.md](STYLESEED.md). This file covers running, configuring, testing and
shipping the app.

## Prerequisites

- **Node 24 or later** and **pnpm** at the version `packageManager` in
  `package.json` names. Install Corepack with
  `npm i -g corepack@0.36.0 && corepack enable`; pnpm then comes from
  `packageManager`. `pnpm install` refuses a Node older than 24.
- **The API running on `:4040`, with `APEX_URL` set.** See
  [Getting started](#getting-started).
- **express-boilerplate 8.0.1 or later.** Passkeys need 8.0.0, and the staff
  no-access copy and the claim audit row need 8.0.1. Apex's step-up link request
  sends `{ app: 'apex' }`, which an older express refuses with 400. 6.0.0 is
  passwordless: sign-in by emailed link, Google or (when the API turns passkeys
  on) a passkey, step-up by a passkey or an emailed link (`/auth/link/*`,
  `/auth/step-up/link/*`, `/auth/passkeys/*`), staff
  invitations confirmed by a mailed link (`/invitations/verify`,
  `/invitations/confirm`) and `POST /platform/users/:id/sign-in-link`. 6.1.0
  adds the `signedIn` filter the Users page's Signed in facet sends. An older
  express has none of these, and Apex no longer sends a password anywhere.
- **Optional express settings** that switch features on. Without them the page
  says the feature is not set up:
  - `POSTHOG_FEATURE_FLAGS_KEY`: the Feature flags page's evaluation. Without it
    every flag serves its fallback.

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

The dev server listens on <http://localhost:5174>, so it runs beside
react-boilerplate on :5173. No `.env` is required: the only `VITE_*` variables are
the optional analytics settings in `.env.example`, which the dev server serves as
`/runtime-config.js` (see [Run-time configuration](#run-time-configuration)).

`APEX_URL` makes the sign-in, Confirm it's you (step-up) and invitation links
express emails, and the Google sign-in callback, point at Apex
instead of the customer app. Apex asks for that by sending `app: "apex"`, a fixed enum (`web` or `apex`):
the API never accepts a URL from a client.

### Becoming staff locally

Staff are the members of express's platform tenant. Two ways in:

- **`pnpm platform:grant -- <email> <role>`**, run in `express-boilerplate`, gives
  an address a role in the platform tenant, creating the account when there is
  none. It is how the first platform owner is made, since nobody can invite
  before one exists. Then sign in at `/login` with an emailed link; locally the
  mail lands in Mailpit (<http://localhost:8025>).
- **An invitation** from the Staff page. With `APEX_URL` set the invitation
  email links to Apex's `/invitations/accept`, which mails a sign-in link that
  adds the invitee as staff.

There is no domain auto-join, and a sign-in never makes anyone staff. How the roles gate the
pages and the actions is in [Staff-only access](SECURITY.md#staff-only-access).

### The API must be running on :4040

The dev server proxies `/api` to `http://localhost:4040` (`vite.config.ts`), or to
`E2E_API_ORIGIN` when that is set. Nothing that touches the backend works without
the API: sign-in, the session bootstrap on page load and every staff page fail at
once. The proxy is not a convenience. The SPA and the API are served from one
origin, which is the only topology this app supports (see
[Deploying](#deploying)). In development that origin is the Vite proxy, and in the
container it is nginx. Because `/api` is same-origin, express needs no CORS entry
for Apex.

### The API prefix is fixed

`/api/v1` is not configurable, and no environment variable moves it. It is written
once, as `API_PREFIX` in `src/constants/routes.ts`, and `nginx.conf` hardcodes it
too. What has to change together if it ever moves is in
[The HTTP layer and session](ARCHITECTURE.md#the-http-layer-and-session).

### Adding a page

The main navigation is one list, `NAV_ITEMS` in `src/constants/navigation.ts`, which
the sidebar and the ⌘K palette both read. A settings page is instead an entry in
`SETTINGS_SECTIONS` (`src/constants/settings.ts`) and a route under
`src/pages/_app/settings/`. What each needs is in
[The staff shell](ARCHITECTURE.md#the-staff-shell-this-app-only).

## Run-time configuration

One image, built once per commit, is promoted unchanged through every environment.
No setting is a `VITE_*` value in the production bundle. Everything that differs
between environments arrives when the container **starts**, as plain environment
variables, wherever the container runs. Changing one means restarting the
container, not rebuilding the image. The flow from variable to bundle is in
[The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config),
and why the values are safe to write unescaped is in
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

Every variable is optional. When one is unset, its default applies. An empty value
means the default too, except `API_UPSTREAM`: the container refuses an empty one.

| Container env               | Dev `.env`                       | Pattern                                       | Default                  | Meaning                                                                                                                 |
| --------------------------- | -------------------------------- | --------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `API_UPSTREAM`              | none                             | `scheme://host[:port]`, no path               | `http://api:4040`        | Where nginx proxies `/api`. The dev server proxies to `http://localhost:4040`, or to `E2E_API_ORIGIN` when that is set. |
| `POSTHOG_KEY`               | `VITE_POSTHOG_KEY`               | `phc_` and 8–128 of `A-Z a-z 0-9 _ -`         | empty                    | PostHog project key. Empty: no analytics code loads, every call is a no-op.                                             |
| `POSTHOG_UI_HOST`           | `VITE_POSTHOG_UI_HOST`           | an `https://` origin, no path                 | `https://us.posthog.com` | PostHog's UI host, for links posthog-js builds.                                                                         |
| `ANALYTICS_CONSENT_MODE`    | `VITE_ANALYTICS_CONSENT_MODE`    | `opt_out`, `required` or `off`                | `opt_out`                | No effect in Apex. The entrypoint validates it and the parser reads it, then `analyticsConfigFrom` ignores it.          |
| `ANALYTICS_HANDOFF_ORIGINS` | `VITE_ANALYTICS_HANDOFF_ORIGINS` | comma-separated `https://` origins, no spaces | empty                    | No effect in Apex, which takes no handoff from a website.                                                               |
| `APP_ENVIRONMENT`           | `VITE_APP_ENVIRONMENT`           | `[a-z][a-z0-9-]` up to 32                     | `development`            | Sent as `environment` on every browser event and exception. Set it to express's `APP_ENV` value.                        |

- `docker/10-runtime-config.sh` checks every value against its pattern at start.
  An invalid value **stops the container**, so a typo fails the rollout instead
  of quietly switching analytics off.
  `API_UPSTREAM` is checked by `docker/05-prepare.sh`: no path, not even a
  trailing `/`, or the container stops with
  `05-prepare.sh: API_UPSTREAM must be scheme://host[:port] with no path; the value given does not match (not shown)`.
- `getRuntimeConfig()` (`src/configs/runtime-config.ts`) applies the patterns
  again and treats an invalid value as unset.
- Apex has no consent banner and no handoff (`SUPPORTS_CONSENT_MODES` and
  `SUPPORTS_HANDOFF` are false in `src/observability/telemetry/config.ts`), so it
  always runs `opt_out` ([Analytics privacy](SECURITY.md#analytics-privacy)).
- Every value is public: each browser receives `/runtime-config.js`
  ([why that is safe](SECURITY.md#run-time-config-injection-safety)).

The dev server, `pnpm preview` and the unit tests read the `VITE_` names from
`.env`; `.env.example` lists them all.

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
External Secrets or the Secret Manager CSI driver (the `secretKeyRef` stays as it
is), or on Cloud Run map it straight to the variable
(`--set-secrets=POSTHOG_KEY=posthog-key:latest`). The container only ever sees an
environment variable.

## Scripts

| Script                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Dev server on :5174 with the `/api` proxy                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm build`            | `tsc -b` then `vp build` into `dist/`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm preview`          | Serve the built bundle locally                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm check`            | The static gate: `vp check` (Oxlint with type-aware rules, Oxfmt check), then ESLint for the 17 rules Oxlint lacks, untyped, at zero warnings                                                                                                                                                                                                                                                                                                                  |
| `pnpm lint`             | `vp lint`, ESLint and `vp fmt --check`; all three must pass                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm lint:docs`        | History phrasing and broken links in markdown and config comments. CI runs it                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm knip`             | Unused files, exports, types and dependencies (`knip.jsonc` lists the ignores and why). CI runs it                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm typecheck`        | `tsc --noEmit` on `tsconfig.app.json`, then `typecheck:e2e`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm typecheck:e2e`    | `tsc --noEmit` on `e2e/tsconfig.json`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm format`           | `vp fmt` (Oxfmt)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test`             | Vitest, single pass                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm test:coverage`    | Vitest with coverage; fails under 88/82/86/89 % (statements/branches/functions/lines). CI runs `test:shard` in six `unit` jobs, then `test:merge` in `test`                                                                                                                                                                                                                                                                                                    |
| `pnpm test:watch`       | Vitest in watch mode                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test:e2e`         | Playwright `fixtures` project against the MSW harness; no backend needed. CI runs it                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test:e2e:live`    | Playwright `live` project; needs express at `E2E_API_ORIGIN` (default :4040), mailpit and `APEX_URL` set                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm test:e2e:nginx`   | Builds the production image and runs the Playwright `nginx` project against it on :8088, started with the run-time settings CI uses; all but the `@no-api` tests need a live API                                                                                                                                                                                                                                                                               |
| `pnpm test:contrast`    | axe colour contrast in a real browser, both themes; no backend needed                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm capture:pages`    | Playwright `capture` project: the page inventory's screenshots into `docs/pages/img/`. Needs the dev stack up (apex :5174, API :4040, Mailpit :8025) and `E2E_API_DIR` set; starts nothing; `CAPTURE_ONLY=auth,tenants` limits it to those areas, or a route key such as `'/tenants/$tenantId/members'` (quote it, or the shell expands `$tenantId`); `E2E_BASE_URL` runs it (and `pnpm test:contrast`) against a dev server already running on another origin |
| `pnpm check:bundle`     | Builds in memory; fails on one JS chunk, first-visit JS over budget or holding posthog-js or `@posthog/core`, the error listener over 1 KB gzipped, or devtools in a chunk. CI runs it                                                                                                                                                                                                                                                                         |
| `pnpm ui:drift`         | Compares each vendored `src/components/ui/` file with its registry snapshot in `scripts/ui-registry/`; fails on a change `docs/ui-local-edits.md` does not record. CI runs it                                                                                                                                                                                                                                                                                  |
| `pnpm ui:drift:refresh` | Retakes the registry snapshot through the installed `shadcn` devDependency; needs the network. Review its diff                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm gate`             | CI's lint job plus the unit suite: `check`, `typecheck`, `lint:docs`, `ui:drift`, `knip`, `test`. pre-push runs it                                                                                                                                                                                                                                                                                                                                             |
| `pnpm push`             | Runs `pnpm gate`, then `git push --no-verify` with your arguments; nothing is pushed if the gate fails                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm prepare`          | Installs the `.vite-hooks/` git hooks (`vp config --hooks`); `pnpm install` runs it                                                                                                                                                                                                                                                                                                                                                                            |

Git hooks live in `.vite-hooks/`: pre-commit checks staged files and their tests,
commit-msg runs commitlint, and pre-push runs `pnpm gate`.
Existing clone? After `pnpm install`, run `git config --unset core.hooksPath && pnpm prepare` once, or no hook runs.

CI holds the gate to **zero warnings** as well as zero errors. Run
`pnpm check` before you push.

Oxlint runs the type-aware rules. ESLint runs the 17 leftover rules without types.
The vendored `src/components/ui/` exemptions live in the `vite.config.ts`
overrides and in `eslint.config.js`. To check one for Oxlint, lint a probe file
under that glob (seed it with `import { cn as seededCn } from 'cn'`), because
`oxlint --print-config` prints the whole config, not a file's. `form.tsx` and
`command.tsx` match by exact filename, so seed the real file in a scratch copy;
`tests/unit/eslint-ui-imports.test.ts` covers the vendored side. To check one for ESLint, run `pnpm exec eslint --print-config <file>`.

## Testing

```bash
pnpm test
```

Unit tests live under `tests/unit/`, mirroring `src/`
([CLAUDE.md](CLAUDE.md#conventions-the-linter-enforces)).

`tests/unit/a11y.test.tsx` is an **accessibility gate** over every routed page; its
rules are in [CLAUDE.md](CLAUDE.md#accessibility).

The `fixtures` project covers passkeys in Chrome with a virtual authenticator
(`e2e/helpers/virtual-authenticator.ts`, over CDP): the harness answers the
contract's calls (`?passkeys=off|optional|required`, `?passkeylist=none|one|two`,
`?stepup=once`, `?setup=1`), while the browser builds and signs the credential.
The private keys are generated at run time. `pnpm test:e2e` builds the harness
in development mode and serves it with `vp preview`; a bare `playwright test
--project=fixtures` without `E2E_BUNDLED` uses the dev server instead.
`E2E_BASE_URL` points a run at a dev server on another port, such as one started
with `pnpm exec vp dev --port 5197 --strictPort`. `pnpm test:e2e` serves the
harness on :5174, the port `pnpm dev` uses, and refuses to start while `pnpm dev`
holds it. Stop `pnpm dev`, or set `APEX_E2E_PORT` to a free port.
`e2e/live/passkeys.test.ts` runs the same flows against an express 8.0.1 or later
with passkeys on.

Playwright has five projects in `e2e/`:

| Project    | Command               | Runs against                                        | In CI                         |
| ---------- | --------------------- | --------------------------------------------------- | ----------------------------- |
| `fixtures` | `pnpm test:e2e`       | A bundle of the harness, with MSW answering; no API | Yes                           |
| `live`     | `pnpm test:e2e:live`  | A real express and its services, with `E2E_LIVE=1`  | Nightly                       |
| `nginx`    | `pnpm test:e2e:nginx` | The production image on :8088                       | `@no-api` on PRs; all nightly |
| `contrast` | `pnpm test:contrast`  | The harness, in both themes; no API                 | No                            |
| `capture`  | `pnpm capture:pages`  | An already-running dev stack; starts nothing        | No                            |

The `live` and `nginx` projects read these variables (defaults in
`playwright.config.ts` and the helpers):

- `E2E_API_ORIGIN`: the express under test (default `http://localhost:4040`). The
  dev server's `/api` proxy follows it too.
- `E2E_NGINX_ORIGIN`: the image under test (default `http://localhost:8088`).
- `E2E_API_DIR` (no default) and `E2E_API_DB` (default `boilerplate`): the express
  checkout where `pnpm platform:grant`, `pnpm email:fire-event` and the step-up
  backdating run, and the database the backdating writes to. Set `E2E_API_DIR` to
  the checkout whose database the API under test uses; it may be the main
  `../express-boilerplate`. A helper throws when it is unset, is not an existing
  directory, or its `package.json` lacks the script the helper runs.
- `E2E_MAILPIT_ORIGIN` (default `http://localhost:8025`) and `E2E_WEB_ORIGIN`
  (default `http://localhost:5173`): the mailpit the helpers read, and the
  customer app's origin in mailed links.
- `E2E_RELEASE` (default `dev`): the release the error reports carry.

The `live` project needs express 6.1.0 or later under test, run with
`APEX_URL=http://localhost:5174` and `WEB_URL=http://localhost:5173`, an email
worker that delivers to mailpit, and `APP_ENV=local` for the emails suite.
Every sign-in is by emailed link, read from Mailpit, so the run sends many link
requests from one IP: set `RATE_LIMIT_SCALE` on the API (the nightly uses 10),
or a 429 from `/auth/link/request` stops the run with a message naming it. The
harness's traps are in [CLAUDE.md](CLAUDE.md#end-to-end-tests).

### Nightly live and nginx run

`.github/workflows/e2e-nightly.yml` runs the `live` and `nginx` projects every
night at 02:47 UTC, and on demand from the Actions tab. It checks out this repo
into `app/` and express-boilerplate's `main` into `express/`, starts Postgres,
Redis and Mailpit from express's compose file (project `e2e`, which the step-up
backdating's `docker compose exec` reaches from `E2E_API_DIR`), and express on
:4040 with `APP_ENV=local` and `RATE_LIMIT_SCALE=10` (one runner IP sends every
request), then runs `pnpm test:e2e:live` and `pnpm test:e2e:nginx`. Both run
even when the first fails. It needs no secrets, and the opt-in analytics tests
stay skipped.

A red run on `main` opens an issue labelled `e2e-nightly`, or comments on the
open one, with the run link, the failed steps and the express commit under
test; the next green run closes it. A run on `main` that is cancelled by hand or
times out counts as a failure too, and opens or comments on the issue. Each run of
the suites uploads an `e2e-nightly` artifact, kept 7 days, with both Playwright reports,
the test results and express's `api.log`.

A manual run on another branch never touches issues, unless its
`exercise_issue` input is `fail` or `pass`: then the stack and suites are
skipped, the outcome is forced to that value, and the issue step runs:

```bash
gh workflow run e2e-nightly.yml --ref <branch> -f exercise_issue=fail
```

## Analytics (PostHog)

Set `POSTHOG_KEY` to turn analytics on ([Run-time configuration](#run-time-configuration)).
Events go through the API's `/api/v1/collect` proxy, never to PostHog directly.
The browser's analytics go to the same PostHog project as express's server-side
events, the one express's `POSTHOG_PROJECT_KEY` names. Apex takes no handoff from
a website: `ANALYTICS_HANDOFF_ORIGINS` is validated but ignored, and a
`?ph_did=&ph_sid=` is only stripped from the address bar, so a website visitor's
anonymous id never joins a staff person. The mechanism is in
[Analytics](ARCHITECTURE.md#analytics) and the privacy rules are in
[Analytics privacy](SECURITY.md#analytics-privacy).

`e2e/nginx/analytics.test.ts` runs against the production image started with the
settings CI uses (`POSTHOG_KEY=phc_test_key_not_real`, `APP_ENVIRONMENT=ci`,
`ANALYTICS_HANDOFF_ORIGINS=https://www.example.test`). Its `@no-api` tests run in
CI with a fake PostHog answering `/api/v1/collect` through Playwright. The live
half needs an express started with `POSTHOG_PROJECT_KEY=phc_test_key_not_real`,
`POSTHOG_HOST` and `POSTHOG_ASSETS_HOST` both `http://127.0.0.1:4063`, and
`ANALYTICS_DRAIN_INTERVAL_MS=1000`. Then:

```bash
E2E_ANALYTICS=1 pnpm test:e2e:nginx
```

The script builds the image with the settings above, sets `E2E_LIVE` and
`E2E_NGINX` itself, and reaches the express on the host through
`--add-host=api:host-gateway`. The suite starts the fake PostHog on :4063
(`E2E_FAKE_POSTHOG_PORT` moves it). For an express elsewhere, run the image
yourself with `API_UPSTREAM` pointing at it and set `E2E_NGINX_ORIGIN` and
`E2E_API_ORIGIN`.

## Feature flags

express evaluates every flag; this app only reads the values, from
`GET /platform/me/flags`. How is in [Feature flags](ARCHITECTURE.md#feature-flags),
and the rules are in [CLAUDE.md](CLAUDE.md#feature-flags). `src/observability/flags/`
is react-boilerplate's module, held in step with it except `flag-keys.ts` and
`flag-scope.ts` ([Sibling sync with react-boilerplate](ARCHITECTURE.md#sibling-sync-with-react-boilerplate)).
Apex declares no flag of its own. To add one:

1. Add it to express's flag registry
   (`express-boilerplate/src/constants/flags.constants.ts`) with `client: true`
   and `apex` in `apps`, and run `flags:sync` there in each environment. Without
   both, express never sends the flag to this app.
2. Copy its key, kind, variants, fallback and `experiment` into `CLIENT_FLAGS` in
   `src/observability/flags/flag-keys.ts`.
3. Copy its fallback into `TEST_FLAG_FALLBACKS` (`tests/mocks/handlers.ts`) and
   into the `/platform/me/flags` answer in `e2e/harness/harness.tsx`. Without it
   the harness serves the fallback and hides a flagged navigation item.

The Feature flags page inspects the registry and evaluates any user's values; it is
described in
[Feature flags admin](ARCHITECTURE.md#feature-flags-admin-this-app-only).

## Maintenance mode

A platform owner switches customer maintenance mode from the **Maintenance** page
(every staff role can read it). The mechanism is in
[Maintenance admin](ARCHITECTURE.md#maintenance-admin-this-app-only) and the
controls on a change are in
[Maintenance controls](SECURITY.md#maintenance-controls). The full runbook is
express-boilerplate's README section "Maintenance mode", which covers the API's side
(read-only versus full, restoring a database, clock sync, notice jobs). The steps
that happen in Apex:

1. **Confirm staff can sign in before `full`.** In `full` customers cannot sign in
   and whoever will turn it off must be able to sign in to Apex.
2. **Before database work, check that every queue says "0 jobs running"** on the
   Maintenance page. Full maintenance pauses every queue but `auth-email`, which
   keeps sending sign-in and invitation emails, and jobs already running finish
   first.
3. **Staff pages keep working** during maintenance, so a staff change still lands
   while customers are shut out.
4. **Turn it off from Apex**, as an owner, with the page's **Turn off…** button.

Before and during a change, watch the Overview's **System status** card
([Maintenance admin](ARCHITECTURE.md#maintenance-admin-this-app-only)).

## Docker

```bash
docker build -t apex-boilerplate .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 apex-boilerplate
```

The image builds the bundle with Node and serves `dist/` from the unprivileged
nginx image, as uid 101 on port **8080**. It proxies `/api` to `API_UPSTREAM`,
`http://api:4040` unless you set it, so by default the container expects an **`api`
host** on the same network. nginx resolves the upstream's host when it loads its
config, so without one the container exits with `host not found in upstream`.
`--add-host` above is what lets a standalone smoke test start; the proxy answers
502 until a real API is there. Under compose, name the API service `api` and
nothing else is needed. To point it elsewhere:

```bash
docker run --rm -p 8080:8080 -e API_UPSTREAM=http://my-api:8080 --read-only --tmpfs /tmp apex-boilerplate
```

The image is built to run on a **read-only root filesystem**. Everything nginx
writes goes under `/tmp`, so give it a writable one: `--tmpfs /tmp` as above, or an
`emptyDir` in Kubernetes. With `--read-only` and no writable `/tmp` the container
stops at start. The stages, the entrypoint order and
the nginx locations are in
[The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config).

- **Extra server config** goes in a template: add it as
  `/etc/nginx/templates/*.conf.template`. The entrypoint strips only the
  `.template` suffix, so the name before it has to end `.conf`. A file placed
  directly in `/etc/nginx/conf.d` is ignored, because `docker/nginx.main.conf`
  includes only `/tmp/nginx/conf.d/*.conf`.
- **Derived images.** `RUN` steps in an image derived from this one run as uid 101,
  not root: the `Dockerfile` never resets the base image's `USER`. A step that
  needs root has to `USER root` first and `USER 101` again before `CMD`.
- **Build arguments** are per commit, not per environment: `GIT_SHA` (the release
  the bundle reports, `dev` when unset or empty), `POSTHOG_SOURCEMAP_PROJECTS` and
  `POSTHOG_CLI_HOST` (where the source maps go; see [Source maps](#source-maps)).
- **IPv4 only.** The `server` block in `nginx.conf` declares `listen 8080;`, which
  binds `0.0.0.0:8080`. An IPv6-only cluster needs `listen [::]:8080;` added to
  that block, which fails on hosts with IPv6 disabled, so it is not a change to
  make unconditionally.
- **Headers and CSP.** What nginx sends, and why no location may declare its own
  `add_header`, is in [CSP and headers](SECURITY.md#csp-and-headers). Check
  headers with `curl -I` against a real asset, not by reading the config.

### Source maps

The build writes hidden source maps, and the image's build stage injects chunk ids,
uploads the maps to every project in `POSTHOG_SOURCEMAP_PROJECTS` and deletes
every `.map` so none ships ([Error tracking](ARCHITECTURE.md#error-tracking)). The
build fails if there are no `.map` files under `dist/`, if the CLI skipped a chunk
as too large, if nothing was uploaded (unless the same output line gives a
non-zero "already uploaded" or existing count), or if an upload fails.

**Any deploy of `dist/` outside the image must delete `*.map` first**
([CSP and headers](SECURITY.md#csp-and-headers)).

The build downloads the `posthog-cli` binary from releases.posthog.com and
verifies its SHA-256 against `docker/posthog-cli.sha256` (one hash per
architecture) before it first runs. **Bumping `@posthog/cli` means updating those
hashes** (the file says how); a mismatch fails the build. The hash check does not
cover the CLI's JavaScript wrapper (`lib/posthog-api-cli.mjs`), which comes from
the npm package, not the download.

**One-time setup, per repository:**

- Create a PostHog **personal API key** that can upload source maps for the
  organisation, and store it as the repository **secret `POSTHOG_CLI_TOKEN`**. It
  reaches the build as a BuildKit secret: never in a layer, an image or the
  provenance attestation.
- Set the repository **variable `POSTHOG_SOURCEMAP_PROJECTS`** to a
  comma-separated list of project ids, one per environment (`12345,67890`).
  Project ids appear in the image's provenance; they are not secrets.
- Optionally set the **variable `POSTHOG_CLI_HOST`** (default
  `https://us.posthog.com`; `https://eu.posthog.com` for EU cloud).

Until the variable is set, `deploy.yml` warns `sourcemaps not uploaded` and the
image builds without uploading: exceptions arrive unsymbolicated. With the variable
set and the secret missing, the build fails. Maps are uploaded only when an image
is built: a release tag promotes the same digest and uploads nothing, so **adding
an environment's project later means rebuilding** the image (re-run `deploy.yml`
on `main`) before that environment shows symbolicated frames.

## Deploying

A push to `main` runs [`deploy.yml`](.github/workflows/deploy.yml): the CI gate,
then an image build and push to GHCR, then a `deploy` job that is a placeholder
because no deployment target has been chosen. The pipeline is in
[Deploy](ARCHITECTURE.md#deploy).

**Add protection rules to the `production` GitHub Environment** (Settings →
Environments → `production`), at minimum required reviewers, before replacing the
placeholder `deploy` step with a real deployment target. Until then, anything
merged to `main` would deploy unreviewed the moment that step does something real.

**Serve Apex and the API from one origin.** The image's nginx proxies `/api` to
`API_UPSTREAM`, so the browser only ever calls the origin that served the page. A
split-origin deployment, with Apex on one host calling the API on another, is not
supported: its API client uses relative URLs, its Content-Security-Policy allows
`connect-src 'self'` only, and the refresh cookie is set on whichever origin
answers `/api`.

The production topology is Apex on **its own origin** (for example
`https://admin.example.com`), the customer app on another, and one express behind
both, each frontend proxying `/api` to it. On express:

- Set **`APEX_URL`** to Apex's public origin. It may carry a path; it may not carry
  a query or a fragment. Unset, every link goes to `WEB_URL`.
- If Google sign-in is on (`GOOGLE_CLIENT_ID`) and Apex's host differs from
  express's `APP_URL` host, set **`COOKIE_DOMAIN`** to a parent domain of both
  hosts. express refuses to boot otherwise: a Google sign-in started in Apex would
  lose its session on the way back.
- With Google sign-in on and Secure auth cookies (`COOKIE_SECURE`, on by default
  outside local), set `TRUST_PROXY` to the number of proxies in front of express.
  The image passes the TLS terminator's `X-Forwarded-Proto` through, but without
  `TRUST_PROXY` express-session sees plain HTTP and never sends the OAuth session
  cookie (`__Secure-oauth.sid` or `__Host-oauth.sid`), so Google sign-in fails.
  express only warns about this at boot.

## Releases

Releases are automatic. On every push to `main`,
[release-please](https://github.com/googleapis/release-please) opens a release PR
from the conventional commits since the last release, and
`.github/workflows/release.yml` queues it with `--auto` (or merges it directly if
GitHub refuses auto-merge). With the `main` ruleset below, either way it merges
only once the required checks pass. The next run tags `vX.Y.Z` and publishes the
GitHub Release, and the tag push promotes the image `main` already built and tested,
without rebuilding ([Deploy](ARCHITECTURE.md#deploy)). By release-please's defaults, which
`release-please-config.json` does not change, only `feat`, `fix` and breaking
commits cut a release; `chore`, `docs`, `ci` and the like do not.

Releases use a GitHub App token, from the repo variable
**`RELEASE_APP_CLIENT_ID`** and the secret **`RELEASE_APP_PRIVATE_KEY`**; the App
needs Contents and Pull requests read/write. GitHub never starts workflows from
events `GITHUB_TOKEN` creates, so its release PRs would get no CI and its tags no
image promotion. Do not fall back to it.

### One-time setup

Three manual steps, once:

- **Create and install the release GitHub App** on this repository, then set its
  client ID as the `RELEASE_APP_CLIENT_ID` variable and its private key as the
  `RELEASE_APP_PRIVATE_KEY` secret. Without them `release.yml` fails.
- **Install the [Renovate GitHub App](https://github.com/apps/renovate).**
  `renovate.json` is inert without it: nothing schedules or opens Renovate PRs
  until the app is installed.
- **Set the merge rules** (Settings → General, then Settings → Rules). Enable
  "Allow auto-merge"; allow squash merging only, with the commit title set to the
  PR title and the commit message left blank; enable "Automatically delete head
  branches"; and add a ruleset on `main`, with no bypass list, requiring the
  checks `lint`, `test`, `e2e`, `docker`, `gitleaks` and `pr-title`. Without the
  ruleset, `release.yml`'s fallback merges the release PR without waiting for CI;
  without the blank squash message, each squash body would carry the branch's
  commit list, which release-please reads as extra conventional commits.

With those rules, the squashed commit on `main` is the PR's title alone, so PR
titles must themselves be conventional commits for release-please to read them
correctly. The source-map upload has its own one-time setup, in
[Source maps](#source-maps).

A fresh copy of this template that wants its first release to be 1.0.0 sets
`"release-as": "1.0.0"` in `release-please-config.json` for that release, then
removes it.
