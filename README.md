# Apex

Apex is the staff console: a React 19 and TypeScript single-page app (SPA) for
the people who run a product, not the people who use it. Its sibling,
`react-boilerplate`, is the customer app. Both call the `express-boilerplate`
API.

Apex ships:

- a sign-in page;
- a sidebar shell with collapsible sections, and a ⌘K command palette;
- ten staff pages: Overview, Tenants, Users, Emails, Deliverability,
  Suppressions, Billing alerts, Onboarding, Plans and the Activity log;
- a Settings area: Profile and Security for your own account, and Staff,
  Feature flags and Maintenance for the platform.

Only platform staff get in. A signed-in user with no platform role lands on
`/no-access`. The API answers `/platform/*` with **404** to anyone below the
role a route needs. Apex renders that 404 as "your role can't see this", never
as a sign-out ([Staff-only access](SECURITY.md#staff-only-access)).

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
| Tests   | Vitest, Testing Library, Mock Service Worker (MSW), jest-axe, Playwright                        |

This file covers running, configuring, testing and shipping the app. The other
documents:

| Document                           | Covers                             |
| ---------------------------------- | ---------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the code is organised, and why |
| [SECURITY.md](SECURITY.md)         | The threat model and the defences  |
| [CLAUDE.md](CLAUDE.md)             | The rules for changing code        |
| [STYLESEED.md](STYLESEED.md)       | The design language                |

## Prerequisites

- **Node 26 or later** and **pnpm** at the version that `packageManager` in
  `package.json` names. Install Corepack with
  `npm i -g corepack@0.36.0 && corepack enable`; pnpm then comes from
  `packageManager`. `pnpm install` refuses a Node older than 26.
- **Docker**, for express's Postgres, Redis and Mailpit containers, or for the
  whole stack ([Getting started](#getting-started)).
- **express-boilerplate 1.0.0 or later**, running on `:4040` with `APEX_URL`
  set. Express restarted its version numbers at 1.0.0 on 28 October 2026. What
  Apex needs from each release:

  | express | What Apex needs from it                                                                                                                                                                                                                                                                                                                                                                                                                        |
  | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1.0.0   | Passwordless auth: sign-in by emailed link or Google, step-up by an emailed link with `{ app: 'apex' }` (`/auth/link/*`, `/auth/step-up/link/*`), staff invitations confirmed by a mailed link (`/invitations/verify`, `/invitations/confirm`), `POST /platform/users/:id/sign-in-link`, the Users page's `signedIn` filter, passkeys (`/auth/passkeys/*`), and the staff no-access copy and claim audit row. Apex sends no password anywhere. |
  | 2.1.0   | The server's settings in staff copy: `stuckAfterDays`, `errorTracking.retryLimit` and the email 404's `details.retentionDays`, plus the link lifetimes from `GET /status/client-settings` and the step-up link's `expiresAt`. Against an older express, that copy names the setting and states no number.                                                                                                                                      |

- **Deploy express first when an invitation or sign-in rule changes.** Apex
  expects `POST /invitations/verify` to answer only `202`, which express answers
  for every staff invitation. Apex refuses a sign-in link with no `email`.
- **Optional express settings** switch features on. Without one, the page says
  the feature is not set up:
  - `POSTHOG_FEATURE_FLAGS_KEY`: the Feature flags page's evaluation. Without it,
    every flag serves its fallback.

## Getting started

These steps take a new developer from a clean machine to signed in as staff.
There are two ways to run the stack: on the host, or in containers with
express's `docker compose --profile dev up`. Both need the same layout, the same
express `.env` and a staff account.

### Clone the repos side by side

Clone express and Apex into one parent folder. express's compose file mounts
`../apex-boilerplate` by default (`APEX_DIR` overrides it).

```bash
git clone <express-boilerplate-url> express-boilerplate
git clone <apex-boilerplate-url> apex-boilerplate
```

On the host, Apex runs without `react-boilerplate`. The Docker dev profile also
starts the customer app from `../react-boilerplate`, so clone it beside them for
that path.

### Configure express for Apex

In `express-boilerplate`, create `.env` from `.env.example` and fill in the
blank required values that express's README lists under "Quickstart"
(`APP_URL`, `WEB_URL`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET` and
`SESSION_SECRET`). Then set Apex's origin. `.env.example` ships the line
commented out (`# APEX_URL=`), so uncomment it:

```bash
# express-boilerplate/.env
APEX_URL=http://localhost:5174
```

`APEX_URL` makes express's emailed links and the Google sign-in callback point
at Apex instead of the customer app: the sign-in link, the Confirm it's you
(step-up) link and the invitation link. Apex asks for this by sending
`app: "apex"`, a fixed enum (`web` or `apex`). The API never accepts a URL from
a client. Without `APEX_URL`, every link opens the customer app on `:5173`.

Apex itself needs no `.env`. Its only `VITE_*` variables are the optional
analytics settings in `.env.example`. The dev server serves them as
`/runtime-config.js` (see [Run-time configuration](#run-time-configuration)).

### On the host

1. In `express-boilerplate`, start the infrastructure, migrate and run the API.
   This is express's Quickstart:

   ```bash
   pnpm install
   docker compose up -d --wait
   pnpm db:migrate
   pnpm dev
   ```

2. In `apex-boilerplate`:

   ```bash
   pnpm install
   pnpm dev
   ```

3. Open <http://localhost:5174>. The dev server listens on port 5174, so it runs
   beside react-boilerplate on port 5173.
4. Make yourself staff and sign in: [Becoming staff locally](#becoming-staff-locally).

### With express's Docker dev profile

The `dev` profile runs the API, react-boilerplate and Apex in containers, with
each repo's source bind-mounted and hot reload on. Your editor and git stay on
the host; nothing in Apex needs a change.

1. Stop any `pnpm dev` on the host. The profile publishes ports 4040, 5173 and
   5174 on `127.0.0.1`, and a host dev server on one of them blocks it.
2. In `express-boilerplate`, with `.env` configured as above:

   ```bash
   docker compose --profile dev up
   ```

   `api-dev` runs the migrations, then the API. `apex-dev` runs Apex's Vite dev
   server. The first run installs every dependency into named volumes; express's
   README puts that at "a minute or two". Later runs reuse the volumes.

3. Open <http://localhost:5174>.
4. Make yourself staff and sign in: [Becoming staff locally](#becoming-staff-locally).

Stop with `docker compose --profile dev down`. `down -v` also deletes the
database. The rest of the profile, including the `prod` profile with the real
images, is in express's README section "Run everything with Docker".

### Becoming staff locally

Staff are the members of express's platform tenant. A sign-in never makes anyone
staff, and there is no domain auto-join. **Grant the role before you ask for a
link:** a link request from Apex for an address with no platform role answers
`202` and mails nothing.

To make the first staff account, which is also the first platform owner:

1. In `express-boilerplate`, on the host, run:

   ```bash
   pnpm platform:grant -- you@example.com owner
   ```

   The form is `pnpm platform:grant -- <email> <role>`. The role is one of
   `owner`, `admin`, `manager`, `editor` or `viewer`; use
   `owner` to reach every page and action. The script creates a verified
   account when the address has none. It is the only way to make the first
   owner, since nobody can invite before one exists. It reads `DATABASE_URL` from
   express's `.env` (`localhost:5433`), which is the compose Postgres in both
   setups, so it works with the Docker dev profile too. With the Docker dev
   profile, run `pnpm install` in `express-boilerplate` on the host once first:
   the containers keep their `node_modules` in a volume, not in your checkout.

2. Open <http://localhost:5174/login> and ask for an emailed link.
3. Open the mail in Mailpit (<http://localhost:8025>) and select the link. It
   opens Apex and signs you in.

If no mail arrives, check that the grant printed
`Granted owner in the platform tenant to you@example.com.` and that `APEX_URL`
is set. express mails one address at most one sign-in link a minute, so wait 60
seconds before you ask again.

Everyone after the first owner joins by **an invitation** from the Staff page.
With `APEX_URL` set, the invitation email links to Apex's
`/invitations/accept`, which mails a sign-in link that adds the invitee as
staff. How the roles gate the pages and the actions is in
[Staff-only access](SECURITY.md#staff-only-access).

### The API must be running on :4040

The dev server proxies `/api` to `http://localhost:4040` (`vite.config.ts`), or to
`E2E_API_ORIGIN` when that is set. Without the API, everything that touches the
backend fails at once: sign-in, the session bootstrap on page load and every
staff page.

The proxy is not a convenience. The SPA and the API are served from one origin,
which is the only topology this app supports (see [Deploying](#deploying)). In
development that origin is the Vite proxy; in the container it is nginx. Because
`/api` is same-origin, express needs no cross-origin resource sharing (CORS)
entry for Apex.

### The API prefix is fixed

`/api/v1` is not configurable, and no environment variable moves it. It is written
once, as `API_PREFIX` in `src/constants/routes.ts`, and `nginx.conf` hardcodes it
too. What has to change together if it ever moves is in
[The HTTP layer and session](ARCHITECTURE.md#the-http-layer-and-session).

### Adding a page

The main navigation is one list, `NAV_ITEMS` in `src/constants/navigation.ts`.
The sidebar and the ⌘K palette both read it. A settings page is instead an entry
in `SETTINGS_SECTIONS` (`src/constants/settings.ts`) and a route under
`src/pages/_app/settings/`. What each needs is in
[The staff shell](ARCHITECTURE.md#the-staff-shell-this-app-only).

## Run-time configuration

This section lists the settings that differ between environments, and how to
pass them to the image.

One image, built once per commit, is promoted unchanged through every environment.
No setting is a `VITE_*` value in the production bundle. Every setting arrives
when the container **starts**, as a plain environment variable, wherever the
container runs. Changing one means restarting the container, not rebuilding the
image. The flow from variable to bundle is in
[The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config).
Why the values are safe to write unescaped is in
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
| `IOS_APP_IDS`               | none                             | comma-separated `TEAMID10CH.bundle.id`        | empty                    | iOS app IDs for `/.well-known/apple-app-site-association` ([how](#app-association-files)).                              |
| `ANDROID_APP_LINKS`         | none                             | comma-separated `package:SHA-256 fingerprint` | empty                    | Android apps for `/.well-known/assetlinks.json` ([how](#app-association-files)).                                        |

- `docker/10-runtime-config.sh` checks every value against its pattern at start.
  An invalid value **stops the container**, so a typo fails the rollout instead
  of switching analytics off without an error.
- `docker/15-app-links.sh` checks `IOS_APP_IDS` and `ANDROID_APP_LINKS` the same
  way, and stops the container with
  `15-app-links.sh: <NAME> must be ...; the value given does not match (not shown)`.
- `docker/05-prepare.sh` checks `API_UPSTREAM`. A path, even a trailing `/`,
  stops the container with
  `05-prepare.sh: API_UPSTREAM must be scheme://host[:port] with no path; the value given does not match (not shown)`.
- `getRuntimeConfig()` (`src/configs/runtime-config.ts`) applies the patterns
  again and treats an invalid value as unset.
- Apex has no consent banner and no handoff (`SUPPORTS_CONSENT_MODES` and
  `SUPPORTS_HANDOFF` are false in `src/observability/telemetry/config.ts`), so it
  always runs `opt_out` ([Analytics privacy](SECURITY.md#analytics-privacy)).
- Every value is public: each browser receives `/runtime-config.js`
  ([why that is safe](SECURITY.md#run-time-config-injection-safety)).

### App-association files

`IOS_APP_IDS` and `ANDROID_APP_LINKS` are read by no browser code. The
container turns them into the two files that iOS and Android fetch to trust
this site for universal links, app links and password autofill. The script is
react-boilerplate's, copied byte for byte; leave both unset unless a mobile app
needs this site's links.

- `IOS_APP_IDS` is a comma-separated list of `<team id>.<bundle id>`, where the
  team id is ten uppercase letters or digits. It becomes
  `/.well-known/apple-app-site-association`.
- `ANDROID_APP_LINKS` is a comma-separated list of
  `<package>:<SHA-256 certificate fingerprint>`, the fingerprint being 32
  uppercase hex pairs joined by colons. It becomes `/.well-known/assetlinks.json`,
  with one statement per entry.
- A variable that is unset or empty writes no file, so nginx answers `404` for
  its path.
- Both files are served as `application/json`, with no redirect and `no-store`.
- Apple's content delivery network (CDN) caches the
  `apple-app-site-association` file, and iOS reads it from there rather than
  from this site. A change to `IOS_APP_IDS` can therefore take a while to reach
  devices, even after the container serves the new file at once.

The dev server and `pnpm preview` serve neither file.

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

From Google Secret Manager, either:

- sync the secret into that Kubernetes Secret with External Secrets or the
  Secret Manager Container Storage Interface (CSI) driver; the `secretKeyRef`
  stays as it is; or
- on Cloud Run, map it straight to the variable
  (`--set-secrets=POSTHOG_KEY=posthog-key:latest`).

The container only ever sees an environment variable.

## Scripts

The `pnpm` scripts in `package.json`. "CI" is continuous integration, the
`ci.yml` workflow that runs on each pull request (PR).

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
| `pnpm test:shard`       | One coverage shard with the blob reporter (`COVERAGE_SHARD=1`, so no thresholds); CI passes `--shard=<n>/6`                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm test:merge`       | Merges the shards' blob reports and enforces the coverage thresholds on the result                                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm test:watch`       | Vitest in watch mode                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test:e2e`         | Playwright `fixtures` project against the MSW harness; no backend needed. CI runs it                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test:e2e:live`    | Playwright `live` project; needs express at `E2E_API_ORIGIN` (default :4040), mailpit and `APEX_URL` set                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm test:e2e:nginx`   | Builds the production image and runs the Playwright `nginx` project against it on :8088, started with the run-time settings CI uses; all but the `@no-api` tests need a live API                                                                                                                                                                                                                                                                               |
| `pnpm test:contrast`    | axe colour contrast in a real browser, both themes; no backend needed                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm capture:pages`    | Playwright `capture` project: the page inventory's screenshots into `docs/pages/img/`. Needs the dev stack up (apex :5174, API :4040, Mailpit :8025) and `E2E_API_DIR` set; starts nothing; `CAPTURE_ONLY=auth,tenants` limits it to those areas, or a route key such as `'/tenants/$tenantId/members'` (quote it, or the shell expands `$tenantId`); `E2E_BASE_URL` runs it (and `pnpm test:contrast`) against a dev server already running on another origin |
| `pnpm check:bundle`     | Builds in memory; fails on one JS chunk, first-visit JS over budget or holding posthog-js, `@posthog/core`, `@simplewebauthn/browser` or `billing-admin.queries.ts`, the error listener over 1 KB gzipped, or devtools in a chunk. CI runs it                                                                                                                                                                                                                  |
| `pnpm ui:drift`         | Compares each vendored `src/components/ui/` file with its registry snapshot in `scripts/ui-registry/`; fails on a change `docs/ui-local-edits.md` does not record. CI runs it                                                                                                                                                                                                                                                                                  |
| `pnpm ui:drift:refresh` | Retakes the registry snapshot through the installed `shadcn` devDependency; needs the network. Review its diff                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm sync:check`       | Compares every react-boilerplate `shared-core.json` row naming `apex` with react's copy, byte for byte, then runs the expo-row `check-shared` rules. Reads `REACT_BOILERPLATE_DIR` or `../react-boilerplate`, on whatever branch it has. CI's `sync` job runs it                                                                                                                                                                                               |
| `pnpm gate`             | CI's lint job plus the unit suite: `check`, `typecheck`, `lint:docs`, `sync:check`, `ui:drift`, `knip`, `test`. pre-push runs it                                                                                                                                                                                                                                                                                                                               |
| `pnpm push`             | Runs `pnpm gate`, then `git push --no-verify` with your arguments; nothing is pushed if the gate fails                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm prepare`          | Installs the `.vite-hooks/` git hooks (`vp config --hooks`); `pnpm install` runs it                                                                                                                                                                                                                                                                                                                                                                            |

Git hooks live in `.vite-hooks/`:

| Hook       | Runs                                |
| ---------- | ----------------------------------- |
| pre-commit | Checks staged files and their tests |
| commit-msg | commitlint                          |
| pre-push   | `pnpm gate`                         |

Existing clone? After `pnpm install`, run `git config --unset core.hooksPath && pnpm prepare` once, or no hook runs.

CI holds the gate to **zero warnings** as well as zero errors. Run
`pnpm check` before you push.

Oxlint runs the type-aware rules. ESLint runs the 17 leftover rules without types.
The vendored `src/components/ui/` files are exempt from some rules. How to check
which rules apply to one file is in
[`src/components/ui/`](CLAUDE.md#srccomponentsui).

## Testing

This section covers the unit tests, the five Playwright end-to-end (e2e)
projects, and what each needs to run.

```bash
pnpm test
```

Unit tests live under `tests/unit/`, mirroring `src/`
([CLAUDE.md](CLAUDE.md#conventions-the-linter-enforces)).

`tests/unit/a11y.test.tsx` is an **accessibility gate** over every routed page; its
rules are in [CLAUDE.md](CLAUDE.md#accessibility).

The `fixtures` project covers passkeys in Chrome with a virtual authenticator
(`e2e/helpers/virtual-authenticator.ts`, over the Chrome DevTools Protocol). The
harness answers the contract's calls (`?passkeys=off|optional|required`,
`?passkeylist=none|one|two`, `?stepup=once`, `?setup=1`), and the browser builds
and signs the credential. The private keys are generated at run time.
`e2e/live/passkeys.test.ts` runs the same flows against an express 1.0.0 or later
with passkeys on.

How `fixtures` is served:

- `pnpm test:e2e` builds the harness in development mode and serves it with
  `vp preview`. A bare `playwright test --project=fixtures` without
  `E2E_BUNDLED` uses the dev server instead.
- `pnpm test:e2e` serves the harness on :5174, the port `pnpm dev` uses, and
  refuses to start while `pnpm dev` holds it. Stop `pnpm dev`, or set
  `APEX_E2E_PORT` to a free port.
- `E2E_BASE_URL` points a run at a dev server on another port, such as one
  started with `pnpm exec vp dev --port 5197 --strictPort`.

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

The `live` project needs, on the express under test:

- express 1.0.0 or later;
- `APEX_URL=http://localhost:5174` and `WEB_URL=http://localhost:5173`;
- an email worker that delivers to Mailpit;
- `APP_ENV=local`, for the emails suite;
- `RATE_LIMIT_SCALE` set (the nightly uses 10). Every sign-in is by emailed link,
  read from Mailpit, so the run sends every link request from one IP address.
  Without it, a 429 from `/auth/link/request` stops the run with a message
  naming `RATE_LIMIT_SCALE`.

The harness's traps are in [CLAUDE.md](CLAUDE.md#end-to-end-tests).

### Nightly live and nginx run

`.github/workflows/e2e-nightly.yml` runs the `live` and `nginx` projects every
night at 02:47 Coordinated Universal Time (UTC), and on demand from the Actions
tab. It needs no secrets, and the opt-in analytics tests stay skipped. Its steps:

1. Check out this repo into `app/` and express-boilerplate's `main` into
   `express/`.
2. Start Postgres, Redis and Mailpit from express's compose file, as project
   `e2e`. The step-up backdating's `docker compose exec` reaches that project
   from `E2E_API_DIR`.
3. Start express on :4040 with `APP_ENV=local` and `RATE_LIMIT_SCALE=10`, since
   one runner IP address sends every request.
4. Run `pnpm test:e2e:live`, then `pnpm test:e2e:nginx`. Both run even when the
   first fails.

A red run on `main` opens an issue labelled `e2e-nightly`, or comments on the
open one. The issue holds the run link, the failed steps and the express commit
under test. The next green run closes it. A run on `main` that is cancelled by
hand or times out counts as a failure too. Each run of the suites uploads an
`e2e-nightly` artifact, kept 7 days, with both Playwright reports, the test
results and express's `api.log`.

A manual run on another branch never touches issues, unless its
`exercise_issue` input is `fail` or `pass`. Then the stack and suites are
skipped, the outcome is forced to that value, and the issue step runs:

```bash
gh workflow run e2e-nightly.yml --ref <branch> -f exercise_issue=fail
```

## Analytics (PostHog)

Set `POSTHOG_KEY` to turn analytics on ([Run-time configuration](#run-time-configuration)).
Events go through the API's `/api/v1/collect` proxy, never to PostHog directly.
The browser's analytics go to the same PostHog project as express's server-side
events: the one express's `POSTHOG_PROJECT_KEY` names.

Apex takes no handoff from a website. `ANALYTICS_HANDOFF_ORIGINS` is validated
but ignored, and a `?ph_did=&ph_sid=` is only stripped from the address bar. A
website visitor's anonymous id therefore never joins a staff person. The mechanism is in
[Analytics](ARCHITECTURE.md#analytics) and the privacy rules are in
[Analytics privacy](SECURITY.md#analytics-privacy).

`e2e/nginx/analytics.test.ts` runs against the production image started with the
settings CI uses (`POSTHOG_KEY=phc_test_key_not_real`, `APP_ENVIRONMENT=ci`,
`ANALYTICS_HANDOFF_ORIGINS=https://www.example.test`). Its `@no-api` tests run in
CI with a fake PostHog answering `/api/v1/collect` through Playwright. The live
half needs an express started with:

- `POSTHOG_PROJECT_KEY=phc_test_key_not_real`;
- `POSTHOG_HOST` and `POSTHOG_ASSETS_HOST` both `http://127.0.0.1:4063`;
- `ANALYTICS_DRAIN_INTERVAL_MS=1000`.

Then:

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
and the rules are in [CLAUDE.md](CLAUDE.md#feature-flags).

`src/observability/flags/` is react-boilerplate's module, held in step with it
except `flag-keys.ts` and `flag-scope.ts`
([Sibling sync with react-boilerplate](ARCHITECTURE.md#sibling-sync-with-react-boilerplate)).
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

A platform owner switches customer maintenance mode from the **Maintenance** page.
Every staff role can read it. The mechanism is in
[Maintenance admin](ARCHITECTURE.md#maintenance-admin-this-app-only), and the
controls on a change are in
[Maintenance controls](SECURITY.md#maintenance-controls).

The full runbook is express-boilerplate's README section "Maintenance mode". It
covers the API's side: read-only versus full, restoring a database, clock sync
and notice jobs. The steps that happen in Apex:

1. **Confirm staff can sign in before `full`.** In `full` customers cannot sign in
   and whoever will turn it off must be able to sign in to Apex.
2. **Before database work, check that every queue says "0 jobs running"** on the
   Maintenance page. Full maintenance pauses every queue but `auth-email`, which
   keeps sending sign-in and invitation emails, and jobs already running finish
   first.
3. **Staff pages keep working** during maintenance, so a staff change lands
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
nginx image, as user id (uid) 101 on port **8080**. It proxies `/api` to
`API_UPSTREAM`, `http://api:4040` unless you set it. By default the container
therefore expects an **`api` host** on the same network.

nginx resolves the upstream's host when it loads its config, so without one the
container exits with `host not found in upstream`. `--add-host` above lets a
standalone smoke test start; the proxy answers 502 until a real API is there.
Under compose, name the API service `api` and nothing else is needed. To point it
elsewhere:

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
- **Headers and Content Security Policy (CSP).** What nginx sends, and why no location may declare its own
  `add_header`, is in [CSP and headers](SECURITY.md#csp-and-headers). Check
  headers with `curl -I` against a real asset, not by reading the config.

### Source maps

The build writes hidden source maps. The image's build stage then injects chunk
ids, uploads the maps to every project in `POSTHOG_SOURCEMAP_PROJECTS` and deletes
every `.map` so none ships ([Error tracking](ARCHITECTURE.md#error-tracking)).
The build fails when:

- there are no `.map` files under `dist/`;
- the command-line interface (CLI) skipped a chunk as too large;
- nothing was uploaded, unless the same output line gives a non-zero "already
  uploaded" or existing count;
- an upload fails.

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

| `POSTHOG_SOURCEMAP_PROJECTS` | `POSTHOG_CLI_TOKEN` | Result                                                                                              |
| ---------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| unset                        | any                 | `deploy.yml` warns `sourcemaps not uploaded`; the image builds and exceptions arrive unsymbolicated |
| set                          | missing             | The build fails                                                                                     |
| set                          | set                 | The maps upload                                                                                     |

Maps are uploaded only when an image is built. A release tag promotes the same
digest and uploads nothing. **Adding an environment's project after the build
means rebuilding** the image (re-run `deploy.yml` on `main`) before that
environment shows symbolicated frames.

## Deploying

A push to `main` runs [`deploy.yml`](.github/workflows/deploy.yml): the CI gate,
then an image build and push to the GitHub Container Registry (GHCR), then a
`deploy` job. That job is a placeholder, because no deployment target has been
chosen. The pipeline is in
[Deploy](ARCHITECTURE.md#deploy).

**Add protection rules to the `production` GitHub Environment** (Settings →
Environments → `production`), at minimum required reviewers, before replacing the
placeholder `deploy` step with a real deployment target. Until then, anything
merged to `main` would deploy unreviewed the moment that step does something real.

**Serve Apex and the API from one origin.** The image's nginx proxies `/api` to
`API_UPSTREAM`, so the browser only ever calls the origin that served the page. A
split-origin deployment, with Apex on one host calling the API on another, is not
supported, for three reasons:

- the API client uses relative URLs;
- the CSP allows `connect-src 'self'` only;
- the refresh cookie is set on whichever origin answers `/api`.

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
  The image passes the Transport Layer Security (TLS) terminator's
  `X-Forwarded-Proto` through, but without
  `TRUST_PROXY` express-session sees plain HTTP and never sends the Open Authorization (OAuth) session
  cookie (`__Secure-oauth.sid` or `__Host-oauth.sid`), so Google sign-in fails.
  express only warns about this at boot.

## Releases

Releases are automatic:

1. On every push to `main`,
   [release-please](https://github.com/googleapis/release-please) opens a release
   PR from the conventional commits since the last release.
2. `.github/workflows/release.yml` queues it with `--auto`, or merges it directly
   if GitHub refuses auto-merge. With the `main` ruleset below, either way it
   merges only once the required checks pass.
3. The next run tags `vX.Y.Z` and publishes the GitHub Release.
4. The tag push promotes the image `main` already built and tested, without
   rebuilding ([Deploy](ARCHITECTURE.md#deploy)).

Only `feat`, `fix` and breaking commits cut a release; `chore`, `docs`, `ci` and
the like do not. These are release-please's defaults, which
`release-please-config.json` does not change.

Releases use a GitHub App token, from the repo variable
**`RELEASE_APP_CLIENT_ID`** and the secret **`RELEASE_APP_PRIVATE_KEY`**. The App
needs Contents and Pull requests read/write. Do not fall back to `GITHUB_TOKEN`:
GitHub never starts workflows from events it creates, so its release PRs would
get no CI and its tags no image promotion.

### One-time setup

Three manual steps, once:

- **Create and install the release GitHub App** on this repository, then set its
  client ID as the `RELEASE_APP_CLIENT_ID` variable and its private key as the
  `RELEASE_APP_PRIVATE_KEY` secret. Without them `release.yml` fails.
- **Install the [Renovate GitHub App](https://github.com/apps/renovate).**
  `renovate.json` is inert without it: nothing schedules or opens Renovate PRs
  until the app is installed.
- **Set the merge rules** (Settings → General, then Settings → Rules):
  - Enable "Allow auto-merge".
  - Allow squash merging only, with the commit title set to the PR title and the
    commit message left blank. Without the blank message, each squash body
    carries the branch's commit list, which release-please reads as extra
    conventional commits.
  - Enable "Automatically delete head branches".
  - Add a ruleset on `main`, with no bypass list, requiring the checks `lint`,
    `test`, `e2e`, `docker`, `gitleaks` and `pr-title`. Without it,
    `release.yml`'s fallback merges the release PR without waiting for CI.

With those rules, the squashed commit on `main` is the PR's title alone, so PR
titles must themselves be conventional commits for release-please to read them
correctly. The source-map upload has its own one-time setup, in
[Source maps](#source-maps).

A fresh copy of this template that wants its first release to be 1.0.0 sets
`"release-as": "1.0.0"` in `release-please-config.json` for that release, then
removes it.
