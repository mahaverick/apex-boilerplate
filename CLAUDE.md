# CLAUDE.md

Guidance for Claude Code (and any other agent) working in this repository.

This file is not a tour of the codebase — the code says what it does, and the
comments in it say why. What follows is the set of decisions that look wrong
until you know the reason. Changing one
of these is a deliberate act, not a tidy-up.

## What this is

Apex: the staff admin dashboard, a React 19 + TypeScript SPA that talks to the
`express-boilerplate` API: express 2.0.1 or newer for Apex 1.9.0 and later
(2.0.0 added the reasoned staff writes to customer tenants, Leave for every
role and Sign out other sessions; clearing a maintenance reason sends
`reason: null`, which express accepts from 2.0.1), and 2.1.0 for the members page's `member_not_found` code
and the platform tenant's `user.active`, which an older 2.x falls back from as
the README says. Run it with `APEX_URL` set to this app's origin,
`http://localhost:5174` locally. Older Apex releases needed less: 1.4.0 for the
base pages, 1.6.0 for the user and tenant timelines, 1.7.0 for the Errors pages
and the system status card, 1.8.0 for the flags pages and 1.9.0 for maintenance
mode, so Apex 1.8.x works with express 1.9.0. `react-boilerplate`, the customer app,
is its sibling. Vite, TanStack Router (file-based), TanStack Query, TanStack
Form, TanStack Table 9, Zustand, Tailwind v4, Base UI via shadcn, recharts,
axios, Zod v4, Vitest + Testing Library + MSW.

The staff navigation is one typed list, `src/constants/navigation.ts`; the
sidebar and the ⌘K palette both read it, so a new page is an entry there plus a
file under `src/pages/_app/`.

## Sibling sync

`react-boilerplate` (the customer app) and this repo share a starting point.
These paths hold the same behaviour in both; a change to one here means
checking the other in the same PR, and the PR description says what happened
there ("ported in react#N", or "not applicable because …").

| Path                                                                                                                                                                                                                                    | Why it must stay in step                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/http/*`                                                                                                                                                                                                                            | Session refresh single-flight, 401-verdict sign-out, trace headers, analytics identity order            |
| `src/lib/api-error.ts`                                                                                                                                                                                                                  | Error envelope parsing                                                                                  |
| `src/schemas/auth.schemas.ts`, `src/schemas/safe-text.schemas.ts`                                                                                                                                                                       | Mirror the backend validators                                                                           |
| `src/components/ui/form.tsx`, `src/components/ui/sonner.tsx`                                                                                                                                                                            | Hand-written, shared behaviour                                                                          |
| `src/schemas/changed-fields.schemas.ts`, `src/hooks/use-changed-fields.ts` and their tests                                                                                                                                              | Changed-field edit forms; byte for byte, except that the schema test drops react's settings-form case   |
| `nginx.conf` security headers and CSP, and `location /api/v1/collect/`                                                                                                                                                                  | Same threat model; same replay batch size                                                               |
| `e2e/nginx/cors.test.ts`                                                                                                                                                                                                                | The multi-frontend CORS seam through nginx, byte for byte except react's stream preflight               |
| `src/observability/analytics/*`, except `config.ts`'s per-app constants and `events.ts`'s registry                                                                                                                                      | One PII, consent, handoff and identity contract for both apps                                           |
| `src/components/shared/pii.tsx`, `e2e/helpers/fake-posthog.ts`                                                                                                                                                                          | The masking class and the egress guard's fake PostHog                                                   |
| `docker/10-runtime-config.sh`, `src/configs/runtime-config.ts`, `scripts/runtime-config-plugin.mjs`, `nginx.conf`'s `location = /runtime-config.js`                                                                                     | One run-time configuration contract: the same variable names, patterns and file in both images          |
| `public/theme-init.js`, `src/lib/zod-jitless.ts`                                                                                                                                                                                        | CSP compatibility                                                                                       |
| `eslint.config.js` rule set (not its file lists)                                                                                                                                                                                        | Same conventions                                                                                        |
| `src/observability/errors/**`, `src/observability/identity-epoch.ts`, `tests/fixtures/error-scrub-vectors.json`                                                                                                                         | One capture, filter, scrub and consent contract; the vectors are express-boilerplate's, byte for byte   |
| `docker/nginx.main.conf`, `pnpm-workspace.yaml`, `tests/unit/docker/{check-image-script,nginx-main-conf,dockerfile}.test.ts`                                                                                                            | Same container limits, dependency overrides and script tests                                            |
| `src/observability/flags/**`, `tests/unit/observability/flags/**` and `tests/fixtures/test-client-flags.ts`, except each app's `flag-keys.ts` and `flag-scope.ts` and their app-owned tests (`flag-keys.test.ts`, `flag-scope.test.ts`) | One flag read, refetch, exposure and `$feature/*` contract; react's is canonical, copied here by script |
| `tests/mocks/posthog.ts`                                                                                                                                                                                                                | The posthog-js stand-in the analytics and error tests share                                             |
| `src/components/features/route-error.tsx`, `src/main.tsx`, the `setErrorRouteSource` line in `src/router.tsx`                                                                                                                           | Both report router and React root errors, and the route they happened on, the same way                  |
| `docker/upload-sourcemaps.sh`, `docker/check-image.sh`, `docker/posthog-cli.sha256`, the Dockerfile's build stage, `.github/workflows/deploy.yml` (byte-identical in all three repos)                                                   | One sourcemap pipeline: inject, upload per project, delete the maps                                     |
| `nginx.conf`'s `.map` location                                                                                                                                                                                                          | No source map is ever served                                                                            |

Apex is the home of staff screens; the customer app keeps only the staff paths
that live on tenant pages.

## Commands

| Command              | What it does                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Dev server on :5174, proxying `/api` to `:4040` (or `E2E_API_ORIGIN`)                              |
| `pnpm build`         | `tsc -b` then `vite build`                                                                         |
| `pnpm lint`          | eslint **and** `prettier --check` — both must be clean                                             |
| `pnpm typecheck`     | `tsc --noEmit` over `tsconfig.app.json`, then `e2e/tsconfig.json`                                  |
| `pnpm test`          | Vitest, one pass                                                                                   |
| `pnpm test:coverage` | Vitest with coverage; fails under 88/82/86/89 (statements/branches/functions/lines), as CI runs it |
| `pnpm format`        | prettier --write                                                                                   |

The gate is **0 errors and 0 warnings**: verify with
`pnpm exec eslint . --max-warnings 0`, not with a bare `pnpm lint`, whose
eslint half exits 0 on warnings.

## Git hooks

- **Tracked in `.husky/`, executable.** pre-commit: lockfile drift, lint-staged
  (eslint `--fix --max-warnings 0` + prettier on staged files), `vitest --changed`.
  commit-msg: commitlint (conventional commits). pre-push: the full lint gate,
  typecheck and unit tests — **no e2e**, on purpose: a long pre-push hook can
  outlast the SSH connection and drop the push. CI runs e2e.
- **Hooks call `pnpm exec`, never `npx`** — `npx` on a fresh machine downloads
  whatever version is newest, not the one this repo tested against.
- **The hooks must stay committed.** `prepare` generates only husky's `_/`
  directory, so if `git ls-files .husky` is ever empty, no hook runs locally.

## CI and deploy

`ci.yml` runs on PRs and is called by `deploy.yml` on push to `main` as the
gate; then `deploy.yml` builds and pushes `ghcr.io/<repo>:sha-<commit>` and
`:main` with SBOM and provenance attestations, then runs a placeholder
`deploy` job bound to the `production` environment. Keep CI's concurrency
group keyed on `github.event_name`, not `github.workflow`: when `deploy.yml`
calls `ci.yml`, `github.workflow` is the caller's name. Non-PR runs are grouped
per commit so a newer push never drops a pending one. A manual
`workflow_dispatch` from a non-`main` branch pushes an sha-tagged image
only — `:main` and the `deploy` job both run only from `main`.

- `gitleaks.yml` scans each PR's commits and each push to `main` for secrets.
- `pr-title` — the PR title must be a conventional commit; it becomes the squash commit release-please reads.
- `ci.yml`'s `test` job runs `pnpm audit --prod --audit-level moderate`: a moderate or worse advisory in a production dependency fails CI.
  A second, non-blocking step runs `pnpm audit --audit-level critical` over dev dependencies too, so a critical advisory in build or test tooling shows on every run.
  Because `test` is a required check, an advisory with no fixed version blocks every PR. Prefer an `overrides` entry in `pnpm-workspace.yaml` that forces the patched version (one GHSA comment per entry).
  When no patched version exists, the escape hatch is `pnpm audit --ignore <GHSA>`,
  which writes that one ID under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`; add a comment there by hand giving the reason and a date to revisit.

**Releases merge themselves.** `release.yml` queues release-please's PR with
`--auto`, falling back to a direct merge if `--auto` is refused; the `main`
ruleset (README, one-time setup) keeps either from skipping required checks.
Its token is a GitHub App's (variable `RELEASE_APP_CLIENT_ID`, secret `RELEASE_APP_PRIVATE_KEY`; Contents
and Pull requests read/write), not `GITHUB_TOKEN`, whose events start no
workflow. The `vX.Y.Z` tag re-runs `deploy.yml`, whose `promote` job builds
nothing: it waits for `:sha-<commit>` from `main`'s run and adds `:X.Y.Z`,
`:X.Y` and `:X` to that same digest. Tag runs skip `ci`, `image` and `deploy`.

## Auth — the rules that break silently when broken

- **The API prefix is fixed and relative** (`/api/v1`), written once as
  `API_PREFIX` in `src/constants/routes.ts`. This SPA's own traffic is same-origin
  by design — the dev server proxies `/api`, and the container's nginx does the
  same — so an absolute URL fails at runtime in a way no test catches, and
  express needs no CORS entry for Apex. Do not add an environment variable for
  it: one that moves only the axios base leaves the Google OAuth anchor and
  nginx's `location /api/v1/collect/` on the old prefix.
  Moving the prefix means changing `API_PREFIX` and that `nginx.conf`
  `location` together; `vite.config.ts` proxies all of `/api`, so it changes
  only for a prefix outside `/api`. **The backend is not actually CORS-blind** — its
  `src/configs/cors.config.ts` (express-boilerplate) answers a cross-origin
  caller; same-origin is simply what this particular SPA ships as.
- **The staff guard lives in `src/pages/_app.tsx`.** Its `beforeLoad` sends a
  signed-out visitor to `/login` and a signed-in user with no platform role to
  `/no-access`. The API is the real gate: `/platform/*` answers **404**, not
  403, to non-staff and to staff below a route's role. `isRoleDenied`
  (`src/queries/platform.queries.ts`) recognises that 404 and each staff page
  renders `RoleDenied` instead of an error, without signing the user out (a
  404 is not an auth verdict); a reload re-runs the guard and lands a demoted
  user on `/no-access`. Do not turn that 404 into a sign-out or a retry loop.
- **Google sign-in and `COOKIE_DOMAIN`.** The Google anchor
  (`GOOGLE_OAUTH_PATH`) sends `app=apex`, so express returns the callback to
  `APEX_URL`. When that host differs from express's `APP_URL` host, express
  refuses to boot unless `COOKIE_DOMAIN` covers both.
- **The access token is memory-only.** It lives in `auth.store` and nowhere
  else. Never write it to `localStorage`, `sessionStorage`, a cookie or a query
  string, and never add a `persist` middleware to that store. The refresh token
  is an httpOnly cookie the browser owns; the client never reads it.
- **`ensureSession()` is the only caller of `/auth/refresh`.** That single-flight
  wrapper is what makes N concurrent 401s produce exactly one refresh. A second
  call site anywhere — an interceptor, a retry, a bootstrap path — reintroduces
  the thundering herd it exists to prevent, and the existing tests will not see
  it.
- **A user is signed out only by a 401 verdict**: a 401 on a request made by
  `refreshSession()`, or a 401 WITHOUT `ACCESS_TOKEN_EXPIRED` or `REAUTH_REQUIRED` on any request
  that carried a bearer token and no `skipAuthRetry` (interceptors.ts). Not
  "the refresh failed", not "the server answered". A 502
  during a rolling restart, a timeout, a dropped connection: none of those sign
  anyone out. Widening this to any error is the single easiest way to log every
  user out during a deploy.
- **A staff write to a customer tenant carries a reason.** Through platform
  access (`useMyRole`'s `access: 'platform'`), changing a member's role,
  removing a member, and sending, resending or revoking an invitation go
  through `ReasonDialog` and send `reason` (in the body, DELETE included);
  express needs it and a recent sign-in. A member (`access: 'member'`, the
  Staff page included) sends none. Resending an invitation from the Emails
  pages needs a recent sign-in on any tenant, and its reason is audited on
  the invitation too.

## Analytics — the rules that leak data when broken

- **Every person's name, email address, avatar initial and invitation
  address, and any free text staff typed, renders inside `<Pii>`**
  (`src/components/shared/pii.tsx`: `ph-sensitive ph-mask`). When the value
  sits in a sentence, wrap the whole sentence string (a toast, a dialog
  description): the text stays one node, so a test's `getByText` still finds
  it. `e2e/fixtures/pii.test.ts` fails on any address or harness name
  rendered outside it. `ReasonDialog` wraps its description and confirm text
  itself. Not `ph-no-capture`, which blanks the element in replay.
- **Attributes are not `Pii`'s job.** `aria-label="Account menu for Ada"`
  is masked by posthog-js (`mask_all_element_attributes`, and
  `maskReplayAttribute` in replay); do not move names out of labels to
  "fix" a guard. Replay masks attributes by name: `maskReplayAttribute`
  (`mask-attribute.ts`, passed as `session_recording.maskAttributeFn`) turns
  `aria-label`, `title`, `alt`, `placeholder`, `srcdoc`, every `data-*`, an
  `href` with a query or a `mailto:`/`tel:` scheme, and a `src` or `srcset`
  with a query into `***`, and rrweb applies it to the full snapshot and to
  added nodes and attribute changes alike. That is why an accessible name may
  carry an address ("Resend invitation to …"); an attribute outside that list
  may not. `e2e/nginx/analytics.test.ts` pins `aria-label` on all three paths.
- **Only `src/observability/analytics/` imports posthog-js**, and only
  `analytics.ts` imports it as a value, through `import()`. `pnpm check:bundle`
  fails if it reaches the first-visit chunks.
- **Only `src/observability/errors/` builds `$exception` events, and only its
  lazy `report.ts` imports `@posthog/core`.** `listen.ts` is in the entry
  chunk and stays under 1 KB gzipped; `pnpm check:bundle` fails if
  `@posthog/core` reaches the entry or the listener grows past that. An error
  is scrubbed before it leaves the browser and is anonymous unless analytics
  capture is on for the signed-in person. Render errors reach it through
  `createRoot`'s `onUncaughtError`/`onCaughtError` in `main.tsx`, so an error
  boundary needs no reporting code of its own; `WidgetBoundary` keeps its
  `console.error`, which names the widget and its component stack.
- **An exception message on the Errors pages is untrusted text.** A browser
  can send any `$exception` with the public project key, so its `type` and
  `value` render as text inside `Pii` (so does the PostHog link's
  screen-reader name, which repeats the type), never as markup, and only a
  row express signed is trusted as the server's (the Unverified badge).
- **`track()` takes no free text.** Properties are `AnalyticsKey` (a string
  literal through `analyticsKey`), numbers or booleans; `table_filtered`
  names the list, never the filter's value. A free `string` property fails
  `REGISTRY_HAS_NO_FREE_STRINGS` at compile time.
- **Identity follows the auth store, nowhere else.** `installAnalyticsIdentity`
  (`src/http/session.ts`, started by `bootstrapSession`) identifies on sign-in
  and restore and resets on a sign-out, except in a superseded tab (below);
  `identifyUser` also resets a browser still identified as someone else, and
  `forgetStaleIdentity` drops a person a failed restore left behind (kept after
  a non-verdict failure if another tab answers it is signed in as them). Never
  `$set` person properties from the browser: express owns them. Apex sets no
  tenant group.
- **The guard drops any event under another distinct id, and that supersedes
  the tab.** Apex tabs share one `ph_apex` identity (no website shares it), so
  this matters only between apex tabs: the tab whose events were dropped is
  superseded, never identifies, registers or resets over the other tab (its
  `resetAnalytics` clears facade state only), and signs out if its refresh
  returns the other user. If its refresh returns its own user it resumes
  (`confirmSignedInUser`); a failed refresh is retried every
  `SUPERSEDED_RECHECK_MS`. A person another tab announced on the
  `analytics-identity` channel is also written first to a short-lived
  `localStorage` registry, which narrows the race a stalled event loop opens
  between the repair timer and the channel's message.
- **`posthog.reset()` drops the super properties and the consent answer.**
  `resetAnalytics` and `identifyUser` go through `resetKeepingConsent`, which
  registers `app` and `environment` again and re-applies the consent; never
  call the SDK's `reset()` around it.
- **Page titles stay static.** Session replay records the `<title>` text and
  `$pageview` sends `document.title`, both unmasked, so a title never carries
  a name, an address or other user data; today every title is a static
  string (`pageTitle('<literal>')` on each route, `APP_NAME` at the root).
  If one ever must, mask both paths:
  `session_recording.maskTextSelector: '.ph-mask, .ph-sensitive, title'` and a
  `before_send` that drops `properties.title`. `slimDOMOptions.headTitleMutations`
  alone is not enough: a full snapshot still records the current title.
  `posthog-options.ts` is shared, so that change starts in react.
- **The URL allowlist is `range`, `tab`, `state`, `status`.** A new query
  key carrying a token, an address or a search term stays off it.
- **posthog-js minors wait for a human** (`renovate.json`). Before taking
  one, run the tests that pin its internals: `url-sanitizer.test.ts`,
  `handoff.test.ts` and `analytics.sdk.test.ts` (all run the real SDK) and
  `e2e/nginx/analytics.test.ts`.

## Maintenance mode — the rules that mislead when broken

- **Apex reads the platform state, never the `Maintenance-Mode` header.**
  The banner and the Maintenance page both use `maintenanceModeQueryOptions`
  (`GET /platform/maintenance-mode`), polled every 30 s while the mode is on
  and every 60 s while it is off (visible tab only; a 404 stops it). The header describes what customers get; staff routes are let
  through whatever it says.
- **The typed confirmation compares with the API's `environment`,** from that
  same GET, never a client setting: the image is promoted unchanged through
  every environment, so only the API knows which one it is.
- **A change sends the version its dialog opened on,** not the latest poll:
  a state that moved meanwhile must conflict, not be overwritten. A 409
  cancels any read in flight and reads the state again before it rejects
  (`useChangeMaintenanceMode`), so the dialog says what someone else saved and
  the next submit carries the fresh version. An untouched pre-filled message
  or reason follows the state just read, and one the owner typed is kept; the
  conflict sentence says which. When that read fails, or answers a version no
  newer than the one sent, the dialog says the state could not be loaded and
  keeps the version it had, never the cached state passed off as the other
  change; trying again conflicts again and reads again, keeping what was typed.
- **Message, reason and actor are text inside `Pii`,** in the banner, the
  page, the dialog's preview and the conflict sentence, like every other
  name and free text staff typed.

## Feature flags — the rules that leak or mislead when broken

- **express is the only evaluator.** Apex reads its values from
  `GET /platform/me/flags`; it never calls posthog-js's `getFeatureFlag`,
  `isFeatureEnabled` or `onFeatureFlags`, and `advanced_disable_feature_flags`
  stays set (not `advanced_disable_flags`, which also stops session replay).
- **`flag-keys.ts` mirrors express by hand.** Apex's slice is every express
  entry with `client: true` and `apex` in `apps`; it is empty today, so every
  key type is `never` and reading a flag fails typecheck until one is added.
  The module's other files are react's: fix them there, then copy. The
  react-to-apex copy and verify scripts (`sync-from-react.sh`, and
  `verify-sync.sh` with its optional `resolutions.tsv`) are kept in the docs
  repo at `~/Mahaverick/docs/.sp5d-lanes/apex-sync/`.
- **`$feature/*` is synced from the router as well as the shell.**
  `main.tsx` runs the first load before React mounts, so the landing
  `$pageview` (`onResolved`) comes before `useFeaturePropertiesSync` can run;
  `installRouteFeatureProperties` syncs from the cached platform values on
  `onLoad`, which fires before `onResolved` and never for a preload.
- **The inspector is read-only.** Rollouts are edited in PostHog. An
  evaluation is an audited read: `flagsEvaluateQueryOptions` never retries or
  refetches on focus, like the timelines, and its traits are shown to admins
  only.

## The container

- **nginx enforces a Content-Security-Policy with `script-src 'self'`.** There
  is no inline script anywhere, and there must not be one: the pre-paint theme
  script is `public/theme-init.js`, loaded by a blocking `<script src>`. A new
  origin for scripts, styles, images, fonts or `fetch` means changing the policy
  in `nginx.conf` in the same commit. The README's CSP section has the reasons
  for each directive.
- **`src/lib/zod-jitless.ts` is the first import in `main.tsx`, `tests/setup.ts`
  and `e2e/harness/harness.tsx`**, because Zod's JIT probe trips `script-src 'self'`;
  never fix that by adding `'unsafe-eval'` instead.
- **It listens on 8080 as uid 101 and is built for a read-only root.** Everything
  it writes is under `/tmp`, so it needs a writable `/tmp` (a tmpfs);
  `docker/check-image.sh` checks all of this from outside.
- **No `location` declares `add_header`.** One that did would silently drop
  every security header — `nginx.conf`'s map comment says why.
- **Nothing is configured at build time.** One image digest is promoted
  through every environment, so a setting that differs between environments
  is a container environment variable read at start, never a `VITE_*` value
  or a build ARG. `docker/10-runtime-config.sh` validates each one and writes
  `/runtime-config.js`; the app reads only `getRuntimeConfig()`
  (`src/configs/runtime-config.ts`). A new setting goes into
  `RUNTIME_CONFIG_KEYS` and `RUNTIME_CONFIG_PATTERNS`, the script (same
  pattern), `RUNTIME_CONFIG_NAMES` in `scripts/runtime-config-plugin.mjs`,
  `docker/check-image.sh`, `.env.example` and the README's table, in one
  change. A pattern admits no quote, backslash, `<` or newline (the script
  writes values unescaped), and the script's error names the variable,
  never the value. The build ARGs the image does take (`GIT_SHA`,
  `POSTHOG_SOURCEMAP_PROJECTS`, `POSTHOG_CLI_HOST`) are the same for every
  environment: which commit it is, and every project its maps go to.

## Error tracking — the rules that leak or go blind when broken

- **`listen.ts` stays tiny and imports only `identity-epoch.ts`**, which
  imports nothing. It is in every page's entry chunk (`pnpm check:bundle` caps it at 1 KB gzipped and keeps
  `@posthog/core` out of first-visit chunks). Everything else is in the lazy
  `report.ts`, which never imports the router: the router registers its
  route source (`setErrorRouteSource`), so a crash in the router's own
  module can still be reported.
- **Inject stays release-less.** `posthog-cli sourcemap inject` in the
  Dockerfile runs with a placeholder token, no `--release-*` flag and no
  `.git` in the context (the Dockerfile refuses one). A release makes it
  call PostHog and write a release id into every chunk, so an unchanged lazy
  chunk would ship new bytes under its old hashed name.
- **An upload failure fails the build.** `docker/upload-sourcemaps.sh` has no
  `|| true` and the CLI gets no `--no-fail`; projects set with no token
  fails too. Never soften either: an image with no uploaded maps reports
  unreadable frames, silently.
- **A `@posthog/cli` version bump updates `docker/posthog-cli.sha256`.** The
  Dockerfile checks the downloaded binary against those per-architecture
  hashes before it runs with the upload token; package.json cannot hold the
  reminder, so it is here and in that file.
- **No source map is served.** The image deletes them and `nginx.conf`'s
  `.map` location answers 404 regardless; any deploy of `dist/` outside the
  image must delete `*.map` first.
- **Scrub rules change in express first.** `scrub.ts` is express's
  `error-scrubber.service.ts` byte for byte (`cmp`), and both test the same
  vector file; copy the file, never edit it here alone. The module itself is
  react's: fix it there, then copy it here.

## Never install

`react-hook-form`, `@hookform/resolvers`, `next-themes`,
`@tanstack/zod-form-adapter`, `clsx`, `tailwind-merge`, any `@radix-ui/*`, `cmdk`
(it depends on four `@radix-ui/*` packages; the palette is `ui/command.tsx` on
Base UI Autocomplete).

Each has an in-repo replacement: TanStack Form with a Zod validator (no
adapter package is needed in v1), `theme.store` plus the pre-paint script
`public/theme-init.js`, the `cn` package, and Base UI through shadcn. Adding one of these
back gives the project two ways to do the same thing, which is how the
inconsistency starts.

## Never run

`shadcn add form` or `shadcn add toast`. The registry's `form.tsx` is built on
react-hook-form and its toast on next-themes; both are on the list above. Ours
are hand-written for this stack.

## The `src/components/ui/**` exception

That directory is **vendored** shadcn output. Edits there are lost the next time
the component is re-added, so it is excluded from the checks that would
otherwise churn the diff on every `shadcn add`:

- **prettier skips it entirely** (`.prettierignore`) — shadcn emits semicolons
  and double quotes, and reformatting them fights the registry on every re-add.
- **eslint excludes only the Tailwind rules, `react-refresh/only-export-components`
  and `local/comment-style`** (`eslint.config.js`, the `src/components/ui/**`
  block and the comment-style block). Everything else still
  applies. Do not read this as "eslint skips the directory" — print the config
  for a file in there and count: 507 rules, 113 of them enabled, including
  type-aware ones like `@typescript-eslint/no-unsafe-call` at **error**. A type
  error in there fails CI like anywhere else. Settle this with
  `eslint --print-config` rather than by reading the config file: the
  `ignores: ['src/components/ui/**']` on the Tailwind _settings_ block is
  exactly what makes it easy to misread.

**`form.tsx`, `sonner.tsx` and `command.tsx` are ours, not upstream's.**
`command.tsx` is hand-written because the registry's is built on cmdk, which
pulls in Radix; ours composes Base UI's Autocomplete. All three are fully linted
and formatted, and all three are named explicitly in four lists: in
`eslint.config.js`, the block that re-enables the Tailwind and
`react-refresh` rules (its `files` list)
and the `ignores` of the `cn` import-restriction and comment-style blocks
(`src/components/ui/!(form|sonner|command).tsx`); and the `!` negations in
`.prettierignore`. If you add another hand-written file to that directory, add
it to all four in the same change or it will sit there unchecked.
`coverage.exclude` in `vitest.config.ts` does not name them: it is the inverse
list, naming the vendored files, so a new vendored one goes there and a
hand-written one stays out.

## Forms

- Frontend Zod schemas in `src/schemas/` **mirror the backend validators**.
  They are one contract in two repos: change both together, or the client will
  accept what the server rejects.
- Parse before posting. TanStack hands `onSubmit` the raw form state, so a
  schema's `.trim()`/`.toLowerCase()` only reaches the wire if the value is
  parsed on the way out.
- **Edit forms send only the fields that changed** (`useChangedFields` in
  `src/hooks/use-changed-fields.ts`; the profile, tenant details and edit user
  name forms). A stored value that today's rules refuse must not block saving
  other fields, so parsing the whole form with the full schema is the wrong
  habit here. Pass `baseline` as `defaultValues`, `changes` as
  `validators.onSubmit` and `listeners` as the form's listeners; post
  `changedBody(value)` unless it is `null`, and call `rebase(value)` after a
  successful save. While the form is pristine the baseline follows refetches;
  it freezes on the first edit, blur or save attempt; it moves only on
  `rebase`. A save with no changes posts nothing and shows the form-level
  message ("Change a field before saving.", "Change a name before saving." on
  profile and edit user name), which clears when a field changes.
- **`<Form>`'s server-error clearing covers native inputs only.** It listens for
  a change event that bubbles out of the form element. A Base UI `Select` does
  not emit one, so a form with a Select must call `serverErrors.clearField()`
  itself — `tests/unit/components/ui/form.test.tsx` pins it. The `Checkbox` case is
  **unverified**: check it before relying on either answer.

## Versions

**TypeScript stays at `~6.0.3`.** typescript-eslint 8.70.1 peers
`typescript: ">=4.8.4 <6.1.0"`, which excludes all of 7.x. Bumping ahead of that breaks the type-aware
lint rules, which are most of the lint config. Re-check that peer range before
assuming the block still holds; it is the whole of the constraint.

**`@types/node` is NOT part of that constraint.** It is on 26.x with
`typescript ~6.0.3`, and eslint (type-aware rules included), `tsc`, the unit
tests, the e2e fixtures and `pnpm build` are green on that pair. Do not pin it
to TypeScript's hold.

**The pnpm version lives in one place: `packageManager` in package.json.** The
Dockerfile runs `corepack install` and CI's `pnpm/action-setup` reads the same
field. pnpm 12 records itself in the lockfile (`packageManagerDependencies`),
so changing the field means regenerating `pnpm-lock.yaml` in the same commit,
or `--frozen-lockfile` fails.

**`devEngines.runtime` (`onFail: "error"`) is what refuses a wrong Node at
install; `.npmrc`'s `engine-strict` does not enforce this root project's own
Node version under pnpm 12.**

**When Node moves to 26, `engines.node` and `devEngines.runtime.version` are
moved by hand alongside the Renovate-held pins** — Renovate does not move a
`>=` range on its own, only the pinned versions it already tracks.

**Renovate opens updates weekly** (grouped, 3-day minimum release age,
actions pinned to SHAs); minor, patch and digest updates auto-merge once
required checks pass, majors and the node/typescript pins wait for a human,
and security fixes open immediately with the `security` label. `renovate.json` holds TypeScript `<6.1.0` and every
Node version pin — the docker `node` image, `.nvmrc` and CI's
`node-version:` — `<25`; lift those rules deliberately. The explicit Corepack
pin in `Dockerfile` and `README.md` is tracked via a custom regex manager.

## Conventions the linter enforces

- **kebab-case** filenames and folders under `src/`, with suffixed files
  confined to their directory: `*.store.ts` → `src/states/`, `*.queries.ts` →
  `src/queries/`, `*.schemas.ts` → `src/schemas/`, `*.types.ts` → `src/types/`,
  `use-*` → `src/hooks/`.
- **`src/pages/**` is exempt** from all of it. TanStack Router's file-based
  routing needs `__root.tsx`, `_app.tsx` and `_auth.tsx`, and `$.tsx` for the
  splat route, which are not kebab-case by design.
- **No test file lives under `src/`.** Vitest suites go in `tests/unit/`,
  mirroring the src/ path of their subject (`src/http/session.ts` →
  `tests/unit/http/session.test.ts`); cross-cutting suites (`a11y.test.tsx`)
  sit at `tests/unit/`, shared support in `tests/mocks/` and `tests/fixtures/`,
  imported as `@/tests/...`. Playwright suites stay in `e2e/`. Linted:
  `check-file/filename-blocklist` rejects any `*.test.*`, `*.spec.*`,
  `__tests__/` or `src/tests/` file under `src/`, `src/pages/` included — so
  TanStack Router never sees a test file in its routes directory.
- Tests are **`.test.ts(x)`**, never `.spec.`, and never in a `__tests__/`
  folder — also linted, under `tests/` as well as `src/`.
- **Comments.** Every comment is one of three kinds: a declaration JSDoc (the
  contract), a `/** @file … */` of 1–3 sentences, or a one-line `//` why, used
  only for security, concurrency, a timing budget or a named external bug. A
  JSX comment is one line and only for those same reasons. No history;
  `local/comment-style` checks the form.

## Test timing rules

Across `tests/` and `e2e/`, eslint catches the common forms of a bare sleep and of
`networkidle`: a `setTimeout` inside `new Promise`, `sleep()`, `waitForTimeout()`,
`setTimeout` from `timers/promises`, and a literal `networkidle`. The only exempt
files are `tests/fixtures/timing.ts` and `e2e/timing.ts`, which implement the
deliberate waits.

1. **Wait on a condition, never on a duration.** `findBy*`, `waitFor` and
   `vi.waitFor` in `tests/`; web-first assertions and `expect.poll` in `e2e/`; fake
   timers when the product's own timer is what the test is about.
2. **A deliberate wait is `settle(ms, reason)`** from `@/tests/fixtures/timing`
   (`e2e/timing.ts` re-exports it). The reason names what can't be observed:
   "absence has no event", "poll interval", "injected latency". A blank reason
   rejects, and an empty literal fails typecheck. Waits inside the page are the
   named helpers in `e2e/timing.ts`.
3. **A wall-clock upper bound is allowed only when the bound is the claim under
   test.** It carries a comment naming what it proves, and either references a
   product constant by name or has at least 10× headroom over the measured p99.
4. **No exact counts of process-wide resources.** Count only what the test created.
5. **A negative check waits on a barrier event where one exists**, and otherwise
   on `settle` with a reason.
6. **Never raise a timeout to fix a flake before its mechanism is known.**
   `asyncUtilTimeout` in `tests/setup.ts` is every `findBy*`/`waitFor` budget; a
   `{ timeout }` that only restates it is noise.

Three fake-timer traps, each read out of the installed versions:

- **Without `shouldAdvanceTime`, `findBy*` and `waitFor` hang.** Testing Library
  ends each one with a `setTimeout(0)` drain and advances fake timers only when a
  `jest` global exists, which Vitest does not define. Under a clock that moves only
  when told, assert with `getBy*` after `await act(() => vi.advanceTimersByTimeAsync(ms))`,
  and restore real timers before the next `findBy*`.
- **React's async `act` flushes on Node's `timers.setImmediate`**, which Vitest's
  default `toFake` fakes too, so `await act(async …)` can stall under a clock nothing
  advances. Fake only what the code under test reads, as `router.test.tsx` does with
  `{ toFake: ['setTimeout', 'clearTimeout', 'Date'] }`.
- **A `userEvent` that types while fake timers are on needs the `advanceTimers`
  option**, as in `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
  user-event waits a `setTimeout(delay)` after every keystroke and calls
  `advanceTimers(delay)` alongside it, so without the option typing waits on a clock
  that never moves.

## End-to-end tests

`pnpm test:e2e` (fixtures) and `pnpm test:e2e:live` (needs a backend). Playwright, four
projects (`fixtures`, `live`, `contrast`, `nginx`), and three conventions that are load-bearing rather than taste:

- **Tests are `*.test.ts`, never Playwright's default `*.spec.ts`** —
  the rest of the repo uses `.test.` (`check-file/filename-blocklist` rejects `.spec.` in
  `src/` and `tests/`). `playwright.config.ts` sets `testMatch` accordingly.
- **`vitest.config.ts` carries an explicit `include` of `tests/**`.** Vitest's default
  `include` is `**/*.{test,spec}.*`, so without it Vitest collects the Playwright specs and
  runs them under jsdom.
- **`e2e/` is typed-linted via its own `tsconfig.json`** and `projectService`, not exempted
  with `disableTypeChecked` the way the root configs are. `playwright.config.ts` itself is a
  root config and is linted with those.

**`fixtures`** drives `e2e/harness/` — the real router and real CSS with MSW answering the
same fixtures `tests/unit/a11y.test.tsx` uses, so it needs no backend. It exists for the
checks jsdom cannot make, because jsdom has no layout: whether the webfont actually resolved,
whether anything overflows the viewport at 390px, whether a state renders as more than a bare
header. `?path=` picks the route; the default is `/overview`, and the harness user is a platform admin —
or, with `?role=none`, a signed-in user with no platform role, which is the only way `/no-access` renders there,
or, with `?role=viewer`, staff below admin, which is how the admin-only timelines' and Errors pages' refusal renders,
or, with `?role=owner`, a platform owner, the only role that gets the Maintenance page's controls.
`?errors=unconfigured` answers the Errors routes as an API without a PostHog personal key does.
`?flags=unconfigured` answers the flags routes as an API without the feature flags key does.
`?maintenance=full` answers the platform maintenance state as full maintenance, so every page shows the banner;
`?maintenance=route` lets `GET /platform/maintenance-mode` through to the test's own `context.route`
(a request the service worker passes through never reaches `page.route`). The harness never answers the `PUT`.

`playwright.config.ts` starts the dev server as `vite --force`, and that is load-bearing:
Vite trusts a dependency cache whose lockfile and config hashes still match, so a source
change that imports a package the cache predates is found mid-run, and Vite re-optimises and
reloads the page. The reload drops the memory-only access token and lands the test on `/login`.
`--force` re-scans every import first. A server that is reused (`reuseExistingServer` outside CI)
is not restarted, so it keeps whatever cache it has.

One harness trap makes a test measure the wrong thing: **any endpoint left unmocked
falls through** (`onUnhandledRequest: 'bypass'`) and 401s. Under Playwright, the `fixtures` and
`contrast` projects take `test` from `e2e/hermetic.ts`, which answers every `/api` request that
would leave the browser with express's 401 envelope, and fails the test at teardown if any `/api`
response came from the proxy instead, or if it answered anything other than a signed-out page's
bootstrap refresh — naming each. A test that fulfills an `/api` route itself stamps its response with
`FALLBACK_HEADER` from that file, or the teardown reports it as an escape. The 401 still
signs the harness user out — any non-expiry 401 on a token-bearing request, `REAUTH_REQUIRED` aside, is a verdict
(interceptors.ts) — so every authed endpoint the page under test calls must be mocked, not
only the one being asserted on. If a fixtures test starts landing on `/login`, that is why,
and the teardown message names the endpoint.

**`live`** is skipped unless `E2E_LIVE=1`, and needs:

- **express-boilerplate 1.4.0 or newer** (the staff directory routes, password step-up,
  message tracking and onboarding), migrated, with its email worker delivering to mailpit, and run with
  `APP_ENV=local`, which registers the fake email webhook `pnpm email:fire-event` posts to;
- that API started with **`APEX_URL=http://localhost:5174`** and **`WEB_URL=http://localhost:5173`**:
  the suites assert which of the two each mailed link opens;
- its docker compose project (postgres, redis, mailpit) reachable from `E2E_API_DIR`, because
  `platform:grant` and the step-up backdating (`docker compose exec postgres psql`) run there;
  `email:fire-event` needs only `E2E_API_DIR`, since it reads that checkout's `.env` and posts to
  the API over HTTP.

The variables, with their defaults: `E2E_API_ORIGIN` (`http://localhost:4040`, which the dev
server's `/api` proxy also follows, so one variable points the browser and the helpers at the
same API; a dev server that is already running keeps the target it started with),
`E2E_API_DIR` (`../express-boilerplate`), `E2E_API_DB` (`boilerplate`, the database the step-up
backdating writes to, for an API that runs on its own), `E2E_MAILPIT_ORIGIN` (`http://localhost:8025`) and
`E2E_WEB_ORIGIN` (`http://localhost:5173`). The directory, emails and onboarding suites' `beforeAll`
(`assertApiServesApex`) fails before any test runs, naming the problem, on an API older than 1.4.0, an email worker
that delivers nothing, or a wrong `APEX_URL`/`WEB_URL`; the emails suite also fails there when the fake
email webhook is missing (`assertFakeEmailWebhook`: an API not run with `APP_ENV=local`).

Accounts are registered and verified through mailpit — login stays 401
until the address is verified, and the link only exists in the email. Each run uses a **fresh
address**, because the login limiter is keyed `ip:email` at five attempts per fifteen minutes
and a fixed address would rate-limit every rerun. Nothing is cleaned up: every run **leaves
its fresh accounts, tenants, invitations and audit entries in the dev database**.

**`nginx`** runs against the PRODUCTION image — `pnpm test:e2e:nginx` builds it, runs it on
:8088 (container port 8080, read-only root) with `--add-host=api:host-gateway`, tests, and
tears it down. The tests tagged `@no-api` (headers, the CSP, the theme script, the asset 404, the boot splash,
`/runtime-config.js`, and posthog-js under the CSP with a fake PostHog answering `/api/v1/collect` through
`routeCollectToFake`) need no backend and also run in CI's `e2e` job, against the image with nothing behind
`/api`, started with `POSTHOG_KEY=phc_test_key_not_real`, `APP_ENVIRONMENT=ci` and
`ANALYTICS_HANDOFF_ORIGINS=https://www.example.test` (the analytics tests expect exactly those);
the rest need a live API and run only locally. `e2e/nginx/errors.test.ts` expects the release the image was built with in `E2E_RELEASE` (default `dev`, the Dockerfile's `GIT_SHA` when none is passed). The project exists first for a reason worth
keeping: **the Vite dev proxy does not propagate an upstream close.**
A `curl -N` at it stays open after the API is killed, so the reading side of a `fetch` body
stream never sees `done: true`; a reconnect path is unreachable from a
dev-server browser. The same curl against nginx
exits on the second the API dies. Anything that depends on noticing a dropped upstream has to
be tested here, not against `pnpm dev`.

**Analytics, live** (`E2E_LIVE=1 E2E_ANALYTICS=1`, the second half of
`e2e/nginx/analytics.test.ts`) needs an express 1.5.0+ behind the image with
`POSTHOG_PROJECT_KEY=phc_test_key_not_real` and `POSTHOG_HOST`/`POSTHOG_ASSETS_HOST` at
the fake PostHog the suite starts on `FAKE_POSTHOG_PORT` (4063); its staff accounts come from
`pnpm platform:grant` in `E2E_API_DIR`, so that checkout's `.env` must name the same database.
posthog-js drops every event from a Playwright browser (`navigator.webdriver`, the
`HeadlessChrome` brand) unless the test uses `HUMAN_USER_AGENT` and `passPosthogBotFilter`,
and holds back the replay of a page nobody has clicked.

**`contrast`** (`pnpm test:contrast`) runs axe's `color-contrast` rule — the one thing jsdom
cannot compute at all — over every surface reachable without a backend, in **both themes**:
the sign-in, register and forgot-password pages, `reset-password`/`verify-email` (both loaded with a `?token=`:
without one, `reset-password` renders its "This link is incomplete" branch instead, while
`verify-email` renders its normal form with an empty token field), and the authenticated pages through the
harness's `?path=`. Every surface asserts a heading it alone renders BEFORE axe runs — a route
that redirects still paints a perfectly legible page, so without that assertion a surface
could report green while measuring something else entirely. It
injects the axe-core already in devDependencies rather than adding a package. It needs no
backend at all: the public pages' session bootstrap is answered by `e2e/hermetic.ts`, so an
express on `:4040` that is restarting or hung cannot stall a run.

**Opt-in and not in CI** — a deliberate cost decision, but do not read "contrast is a property
of the palette, which moves rarely" as the whole risk model. Component composition breaks
contrast too — which token a component puts on which surface decides the ratio, not the palette
alone — and composition changes on every feature, so run this before merging UI work, not only when a
token moves. **Do not eyeball a contrast change — run the script.**

## Accessibility

`tests/unit/a11y.test.tsx` is a gate, not a smoke test: every routed page, plus
the open mobile sheet, the tenant filter, the ⌘K palette and the open menus,
must come back clean. If
something trips a rule, **fix the markup** — no rule is disabled to make it pass.

**Menus are graded at menu scope, not document scope, and that is the one place
the gate narrows.** Base UI portals a menu popup to `document.body`, so at
document scope every open menu trips `region` — "some page content is not
contained by landmarks". That is a page-structure rule, and it does not describe
a barrier in a transient popup that focus has just been moved into; the dialog
and sheet escape it only because axe exempts `role="dialog"`. `expectNoViolationsIn`
therefore runs the **identical rule set** against the popup element. Nothing is
disabled, and the narrowing is pinned the same way the document context is: it
asserts `aria-required-children` is in `results.passes`, which only happens when
axe really evaluated a `role="menu"`. Pages are still graded at document scope.

The alternative — rendering the popups into a container inside a landmark — was
not taken: the triggers live in the sidebar and header, so `<main>` would be the
wrong home for their menus, and dropping the portal risks real clipping and
stacking regressions to satisfy a rule that is not describing a real barrier.

Four details that a "tidy-up" would quietly undo:

- It runs **axe-core over `document`**, not jest-axe's `axe()` over a fragment.
  Axe reports its page-level rules (`page-has-heading-one`, `landmark-one-main`,
  `bypass`, `html-has-lang`, `document-title`) as _inapplicable_ for anything
  smaller than the document, so a fragment run grades far less than it looks
  like it does. The context is **pinned by an assertion**, not by this comment:
  the gate asserts `html-has-lang`, `document-title` and `bypass` are in
  `results.passes`, so narrowing the context back to `document.body` fails the
  gate instead of silently passing it.
- **Every page needs exactly one `<main>` and exactly one `<h1>`**, and the test
  asserts both by hand. It has to: axe's own rules for them query
  `[aria-level=1]`, a selector jsdom rejects outright, so axe files them under
  `incomplete` — which `toHaveNoViolations` does not read. `CardTitle` renders a
  `div`, so a page's `h1` goes _inside_ it.
- **`RouteError`, `RoutePending` and `RouteNotFound` all carry no `<main>`
  of their own.** `defaultErrorComponent`, `defaultPendingComponent` and
  `defaultNotFoundComponent` all render the SAME way: in place of a matched
  route's own component, inside whichever `Outlet` that route sits in — so
  whether the page ends up with a `<main>` depends on that route, not on the
  fallback. For a route nested inside `_app` or `_auth`, the `Outlet` is
  already inside the layout's `<main>`, pending or throwing `notFound()`
  alike, so the page still ends up with exactly one, contributed by the
  layout. For the router's OWN top-level splat route (`src/pages/$.tsx`, matched when nothing else does), there is
  no layout ancestor to contribute one, so `$.tsx` wraps `RouteNotFound` in
  its own `<main>` — the fallback component stays bare specifically so it
  does not double up when it renders as `defaultNotFoundComponent` for a
  route that already has a layout.
- Colour contrast is **not** checked _there_. jest-axe's default — reproduced
  explicitly in that file — switches every `cat.color` rule off under jsdom,
  which has no layout. Contrast is measured separately, in a real browser, by
  `pnpm test:contrast`; viewport overflow at 390px by the `fixtures` e2e
  project. Focus rings are checked only as a `focus-visible:` class (the tab
  panel test in `a11y.test.tsx`), not in a browser.
