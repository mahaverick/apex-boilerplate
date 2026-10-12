# CLAUDE.md

Rules and gotchas for changing code in this repository. The decisions here look
wrong until you know the reason; changing one is a deliberate act, not a tidy-up.
How the app fits together is in [ARCHITECTURE.md](ARCHITECTURE.md), what it
defends against is in [SECURITY.md](SECURITY.md), and how to run, configure and
deploy it is in [README.md](README.md).

## Sibling sync

`react-boilerplate`, the customer app, shares the HTTP layer, analytics, flags,
error tracking, most of the container and several components with this app. When
you change a shared path, change react in the same PR, and say in the description
what happened there ("ported in react#N", or "not applicable because …"). For a
file the two apps hold byte for byte, change react's copy first and copy it here,
except `scrub.ts`, whose rules change in express first.
The paths are listed in
[Sibling sync with react-boilerplate](ARCHITECTURE.md#sibling-sync-with-react-boilerplate).

## Staff access

Every signed-in page is for platform staff, and the API decides what each role
may do. The reasons are in [Staff-only access](SECURITY.md#staff-only-access),
[Step-up re-authentication](SECURITY.md#step-up-re-authentication) and
[Reason prompts](SECURITY.md#reason-prompts).

- **A 404 under `/platform/*` is a refusal, not a miss.** The API answers 404 to
  non-staff and to staff below a route's role. `isRoleDenied` recognises it and
  the page renders `RoleDenied`. Never turn that 404 into a sign-out or a retry
  loop: it is not an auth verdict.
- **A write that may need a recent sign-in runs through `useStepUp().run`.** The
  API refuses a stale sign-in with `REAUTH_REQUIRED`, which is not a verdict, and
  the step-up dialog retries the write once after the user confirms.
- **A member or invitation write through platform access carries a reason.** When
  `useMyRole` reports `access: 'platform'`, the write goes through `ReasonDialog`
  and sends `reason` in the body, DELETE included. A member of the tenant, the
  Staff page included, sends none.
- **`src/constants/roles.ts` mirrors express's role rules.** Change both repos
  together, or the app offers actions the API refuses, or hides ones it allows.
- **A new page is an entry in `src/constants/navigation.ts`** plus the pieces
  [The staff shell](ARCHITECTURE.md#the-staff-shell-this-app-only) lists. The
  sidebar and the command palette both read that list.
- **An audited read never fetches on its own.** The timelines, the Errors pages
  and a flag evaluation set no retry, no refetch on focus or reconnect, and
  `gcTime: 0`. The API audits each read and may spend PostHog query budget on it
  ([Timelines and errors](ARCHITECTURE.md#timelines-and-errors-this-app-only)).
- **Text another party wrote renders as text.** An exception's type and value,
  and a timeline event's properties, are attacker text. A rendered email stays in
  its `<iframe sandbox="">`: never add `allow-same-origin`
  ([Untrusted content](SECURITY.md#untrusted-content)).

## The gate

- **0 errors and 0 warnings.** Check with `pnpm exec eslint . --max-warnings 0`,
  as CI and the pre-push hook do. `pnpm lint`'s eslint half exits 0 on warnings.
- `pnpm lint` also runs `prettier --check`, and CI runs `pnpm lint:docs`,
  `pnpm knip`, `pnpm typecheck`, `pnpm test:coverage` (thresholds in
  `vitest.config.ts`), `pnpm check:bundle` and the `e2e` and `docker` jobs. The scripts
  are in [README.md](README.md).

## Dead code (knip)

`pnpm knip` fails CI on an unused file, export, type or dependency. knip is pinned
exactly, because a release can add new kinds of finding. Every ignore in
`knip.jsonc` carries its reason beside it, which is why the file is `.jsonc`. An
ignore without a reason does not go in.

When it reports something:

- An export used only in its own file loses `export`. A symbol used nowhere is
  deleted, and a re-export nobody imports leaves its barrel.
- An export a test imports counts as used, so a test seam stays exported.
  `pnpm knip --production` (not in CI) lists the exports only tests import.
- A `.mjs` export is removed from its `.d.mts` in the same change.
- A vendored file under `src/components/ui/` that nothing imports still fails:
  delete it. Only its export and type findings are ignored. The hand-written
  `command.tsx` keeps shadcn's export names, so the same ignore covers it.
- In a file shared with react, change both apps when react's knip reports the same
  finding. When only this app's knip reports it, add an ignore that names react's
  use, as the `src/observability/analytics/index.ts` ignore does.

## Git hooks

- **The hooks live in `.husky/` and must stay committed.** `prepare` generates only
  husky's `_/` directory, so if `git ls-files .husky` is empty, no hook runs.
- **pre-push runs no e2e.** A long pre-push hook can outlast the SSH connection and
  drop the push. CI runs e2e.
- **Hooks call `pnpm exec`, never `npx`.** On a fresh machine `npx` downloads the
  newest version, not the one this repo tested against.

## CI

- **Key CI's concurrency group on `github.event_name`, not `github.workflow`.**
  When `deploy.yml` calls `ci.yml`, `github.workflow` is the caller's name.
  Non-PR runs are grouped per commit, so a newer push never drops a pending gate.
- **A moderate advisory in a production dependency fails CI**
  (`pnpm audit --prod --audit-level moderate`). `test` is one of the checks the
  `main` ruleset requires ([README](README.md#releases)), so the advisory blocks
  every PR. Prefer an `overrides` entry in `pnpm-workspace.yaml` that forces the
  patched version, with a comment naming the advisory. When no patched version
  exists, list the ID under `auditConfig.ignoreGhsas` there, with a comment giving
  the reason and a date to revisit.
- The PR title must be a conventional commit: it becomes the squash commit that
  release-please reads. How releases and images flow is in
  [Deploy](ARCHITECTURE.md#deploy) and the [README](README.md#releases).

## Auth

Each rule's reason is in [Token storage and refresh](SECURITY.md#token-storage-and-refresh)
and [Sign-out rules](SECURITY.md#sign-out-rules).

- **The API prefix is fixed and relative.** It is `API_PREFIX` in
  `src/constants/routes.ts`. Add no environment variable for it, and never call an
  absolute API URL ([The HTTP layer and session](ARCHITECTURE.md#the-http-layer-and-session)
  lists everything that moves with it).
- **The access token is memory-only.** It lives only in `auth.store`, and that
  store never gets a `persist` middleware.
- **`ensureSession()` is the only caller of `/auth/refresh`.** A second call site
  brings back the refresh race, and the existing tests will not see it.
- **Only an auth verdict signs a user out** (`isAuthVerdict`). If you widen it to
  any error, every user is signed out during a deploy.

## Analytics

Each rule's reason is in [Analytics privacy](SECURITY.md#analytics-privacy).

- **Wrap every rendered person name, email address, avatar initial and invitation
  address, and any free text staff typed, in `<Pii>`.** Wrap the value, not the
  sentence. A sentence a builder returns as a string (`auditSentence`, `timelineSentence`, `bannerSentence`, the maintenance preview) is masked whole, the safe default, as is a string `ReasonDialog` description. Use `<Pii>`, not `ph-no-capture`, which blanks the element in replay.
  A staff page that renders person data goes
  into the page list in `e2e/fixtures/pii.test.ts`, and a new harness person into
  its `NAMES`. Without them the guard cannot see it.
- **An attribute may carry personal data only if `mask-attribute.ts` masks it.**
  `e2e/nginx/analytics.test.ts` pins `aria-label` masking in the full snapshot
  and in later mutations.
- **Only `src/observability/analytics/` imports posthog-js**, and only
  `analytics.ts` imports it as a value, through `import()`. `pnpm check:bundle`
  fails if it reaches a first-visit chunk.
- **Never widen the privacy guards**: the free-string ban in `events.ts`, the
  browser's ban on person and group properties, `ANALYTICS_URL_QUERY_ALLOWLIST`
  and `guardEvent`. What each one stops is in SECURITY.md.
- **Never call the SDK's `reset()` directly.** It drops the super properties and
  the consent answer. `resetKeepingConsent` restores both.
- **Page views come from the router, not posthog-js.** The router captures
  `$pageview` once the route has resolved (`onResolved`), so a page view never
  precedes the state it describes. `installRouteFeatureProperties` syncs the
  `$feature/*` properties on `onLoad`, which fires first, so each page view, the
  first one included, carries its flag values
  ([Router hooks](ARCHITECTURE.md#router-hooks-this-app-only)).
- **Page titles are fixed words**, never a record's or a person's name.
- **posthog-js minors and majors wait for a human** (`renovate.json`). Before
  taking one, run the suites that pin its internals: `url-sanitizer.test.ts`,
  `handoff.test.ts` and `analytics.sdk.test.ts` (in
  `tests/unit/observability/analytics/`, against the real SDK), and
  `e2e/nginx/analytics.test.ts`.

## Feature flags

How flags are read is in [Feature flags](ARCHITECTURE.md#feature-flags).

- **The API is the only evaluator.** Nothing calls posthog-js's `getFeatureFlag`,
  `isFeatureEnabled` or `onFeatureFlags`. Keep `advanced_disable_feature_flags`.
  Never switch to `advanced_disable_flags`: it also stops remote config, so replay
  never starts. Never pass `bootstrap.featureFlags`: posthog-js would put those
  values on every event, over the server's.
- **A flag is a key in `flag-keys.ts` first**, mirroring express's registry entry.
  A value the server sends for a key the slice lacks is dropped. This app's slice
  is empty, so every flag key type is `never` until an entry is added.
- **A gated page has a gated API route.** `requireClientFlag` only hides the page.
  Express's `requireFlag` is what refuses.
- **Register `$feature/*` from a layout effect or a router hook, never from a
  query or loader.** A loader also runs for a hover preload, whose scope is not the
  page's.

## Maintenance mode

Customer maintenance mode is the API's; this app shows it to staff and lets
platform owners change it. How it works is in
[Maintenance admin](ARCHITECTURE.md#maintenance-admin-this-app-only), and the
change rules are in [Maintenance controls](SECURITY.md#maintenance-controls).

- **Staff pages are not gated by the mode.** Express lets `/platform/*`,
  `POST /auth/refresh` and `GET /profile` through in both modes, so a page loaded
  during `full` maintenance restores its session as usual. Add no maintenance
  store, gate or redirect here.
- **Read the platform state, never the `Maintenance-Mode` header.**
- **A new call to a customer route that express blocks in maintenance needs
  express's staff list.** Express lets staff through on such a route only when it
  is in `MAINTENANCE_STAFF_ROUTES`
  (`express-boilerplate/src/constants/maintenance-mode.constants.ts`), checked
  against `express-boilerplate/tests/fixtures/apex-api-calls.json`. Add the route
  to both in the same change, or staff get a 503 on it during maintenance.

## The container

The mechanism is in [The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config).
The reasons are in [CSP and headers](SECURITY.md#csp-and-headers) and
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

- **No inline script, ever.** The CSP is `script-src 'self'`. A new origin for
  scripts, styles, images, fonts or `fetch` means changing the policy in
  `nginx.conf` in the same commit.
- **`src/lib/zod-jitless.ts` is the first import** in `main.tsx`, `tests/setup.ts`
  and `e2e/harness/harness.tsx`. Never fix Zod's JIT probe by adding
  `'unsafe-eval'`.
- **No `location` declares `add_header`.** One that did would drop every security
  header.
- **The image runs as uid 101 on a read-only root.** Everything it writes goes
  under `/tmp`. `docker/check-image.sh` checks this from outside.
- **Nothing is configured at build time.** A setting that differs between
  environments is a run-time variable, never a `VITE_*` value or a build ARG. A new
  setting touches every file
  [The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config)
  lists, in one change, and its pattern follows
  [Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

## Error tracking

How it works is in [Error tracking](ARCHITECTURE.md#error-tracking). What it sends
is in [Error-tracking privacy](SECURITY.md#error-tracking-privacy).

- **`listen.ts` imports only `identity-epoch.ts`**, which imports nothing. It is in
  every entry chunk, and `pnpm check:bundle` caps it at 1 KB gzipped.
- **`report.ts` never imports the router.** The router registers its route source
  (`setErrorRouteSource`), so a crash in the router's own module can still be
  reported.
- **Inject stays release-less.** `posthog-cli sourcemap inject` in the Dockerfile
  runs with a placeholder token, no `--release-*` flag and no `.git` in the context.
  A release makes it call PostHog and write a release id into every chunk, so an
  unchanged chunk would ship new bytes under its old hashed name.
- **Never soften `docker/upload-sourcemaps.sh`.** Every failure it detects fails
  the build ([README](README.md#source-maps) lists them). Never add `|| true` or
  `--no-fail`: without the maps, the image reports unreadable frames, silently.
- **A `@posthog/cli` bump updates both hashes in `docker/posthog-cli.sha256`** in
  the same change. The Dockerfile checks the binary against them before it runs it
  with the upload token.
- **Change a scrub rule in express first** ([The scrubber](SECURITY.md#the-scrubber)).
  `scrub.ts` is a byte-for-byte copy, so never edit it here alone.

## Never install

`react-hook-form`, `@hookform/resolvers`, `next-themes`,
`@tanstack/zod-form-adapter`, `clsx`, `tailwind-merge`, any `@radix-ui/*`, `cmdk`.

Each has an in-repo replacement:

- TanStack Form with a Zod validator, which needs no adapter package;
- `theme.store` with `public/theme-init.js`;
- the `cn` package;
- Base UI through shadcn;
- `src/components/ui/command.tsx` on Base UI's Autocomplete, for `cmdk`, which
  pulls in Radix.

Adding one back gives the project two ways to do the same thing. eslint refuses an
import of `cmdk` or `@radix-ui/*` anywhere under `src/`, `tests/` and `e2e/`,
except in `src/lib/utils.ts` and the vendored files under `src/components/ui/`.

**Never run `shadcn add form` or `shadcn add toast`.** The registry's `form.tsx` is
built on react-hook-form and its toast on next-themes. Ours are hand-written.

## `src/components/ui/`

The directory holds vendored shadcn output. An edit there is lost the next time
the component is added again.

- **prettier skips the vendored files** (`.prettierignore`).
- **eslint relaxes only some rules for them**: the Tailwind rules,
  `react-refresh/only-export-components`, `local/comment-style`, the JSDoc
  requirement and the import restrictions. Every other rule, type-aware rules at
  error included, still applies, so a type error there fails CI. The one
  exception is `chart.tsx`, which turns off five type-aware rules its Recharts
  typing trips. Settle a doubt with `pnpm exec eslint --print-config <file>`, not
  by reading the config.
- **`form.tsx`, `sonner.tsx` and `command.tsx` are ours**, fully linted and
  formatted. They are named in five places: four `eslint.config.js` blocks (the
  block that re-enables the Tailwind and `react-refresh` rules, plus the
  `!(form|sonner|command)` globs of the import restriction, comment-style and
  JSDoc blocks), and the `!` negations in `.prettierignore`. A fourth hand-written
  file there goes into all five in the same change.
- **The vitest config's coverage `exclude` is the inverse list.** It names the
  vendored files, so a new vendored file goes there and a hand-written one stays
  out.

## Forms

- **The Zod schemas in `src/schemas/` mirror the API's validators.** Change both
  repos together, or the client accepts what the server rejects.
- **Parse before posting.** TanStack hands `onSubmit` the raw form state, so a
  schema's `.trim()` or `.toLowerCase()` reaches the wire only if the value is
  parsed on the way out.
- **Edit forms send only the changed fields** (`useChangedFields` in
  `src/hooks/use-changed-fields.ts`, whose JSDoc gives the wiring). A stored value
  that today's rules refuse must not block saving other fields, so do not parse
  the whole form with the full schema.
- **`<Form>` clears a server error only on a native change event.** A Base UI
  `Select` emits none, so its change handler calls `serverErrors.clearField()`
  itself, as `src/components/features/tenant/invite-member-form.tsx` does. Base
  UI's `Checkbox` is unverified: check it before relying on either answer.

## Versions

- **TypeScript stays below 6.1.** typescript-eslint 8.70.1 peers
  `typescript >=4.8.4 <6.1.0`, and the type-aware rules are most of the lint
  config. `renovate.json` holds it. Re-check that peer range before lifting the
  hold. `@types/node` is not part of this constraint.
- **The pnpm version lives only in `packageManager`.** The Dockerfile and CI read
  it. pnpm records itself in `pnpm-lock.yaml` (`packageManagerDependencies`), so
  changing the field means regenerating the lockfile in the same commit, or
  `--frozen-lockfile` fails.
- **`devEngines.runtime` (`onFail: "error"`) refuses a wrong Node at install.**
- **Renovate holds every Node pin below 25.** It covers the Docker `node` image,
  `.nvmrc` and CI's `node-version:`. Renovate does not move `engines.node` or
  `devEngines.runtime.version`, so a Node major moves those by hand alongside the
  pins.
- Renovate's schedule and automerge policy are in `renovate.json`. Majors and the
  Node and TypeScript pins always wait for a human.

## Conventions the linter enforces

- **kebab-case** file and folder names under `src/`. `src/pages/**` is exempt,
  because TanStack Router's file routes need `__root.tsx`, `_app.tsx`, `_auth.tsx`
  and `$tenantId.members.tsx`.
- **Suffixed files live in their directory:** `*.store.ts` in `src/states/`,
  `*.queries.ts` in `src/queries/`, `*.schemas.ts` in `src/schemas/`, `*.types.ts`
  in `src/types/`. A file in `src/hooks/` is named `use-*`.
- **No test file lives under `src/`**, `src/pages/` included, so the router never
  sees a test in its routes directory. Unit suites go in `tests/unit/`, mirroring
  their subject's path (`src/http/session.ts` → `tests/unit/http/session.test.ts`).
  Shared support goes in `tests/mocks/` and `tests/fixtures/`, imported as
  `@/tests/...`. Playwright suites go in `e2e/`.
- **Tests are `.test.ts(x)`**, never `.spec.`, and never in a `__tests__/` folder.
- **Import `cn` from `@/lib/utils`**, not from the package.
- **Comments.** Each comment is a JSDoc block, a directive, a one-line JSX comment
  or a single `//` line, and none narrates history (`local/comment-style`). By
  convention, a `//` line gives a why: security, concurrency, a timing budget or a
  named external bug. Every named function, method, class, interface, type alias
  and exported const carries a JSDoc description (`jsdoc/require-jsdoc`).

## Test timing

Across `tests/` and `e2e/`, eslint rejects the common forms of a bare sleep:

- a `setTimeout` inside `new Promise`;
- `sleep()`;
- `waitForTimeout()`;
- `setTimeout` from `timers/promises`.

It also rejects `networkidle`. Only `tests/fixtures/timing.ts` and `e2e/timing.ts`
are exempt, because they implement the deliberate waits.

1. **Wait on a condition, never on a duration.** In `tests/`, use `findBy*`,
   `waitFor` and `vi.waitFor`. In `e2e/`, use web-first assertions and
   `expect.poll`. Use fake timers when the product's own timer is under test.
2. **A deliberate wait is `settle(ms, reason)`** from `@/tests/fixtures/timing`
   (`e2e/timing.ts` re-exports it). The reason names what cannot be observed. A
   blank reason rejects, and an empty literal fails typecheck.
3. **A wall-clock upper bound is allowed only when the bound is the claim under
   test.** It gets a comment naming what it proves, and either references a product
   constant or has at least 10× headroom over the measured p99.
4. **Count only what the test created**, never a process-wide resource.
5. **A negative check waits on a barrier event where one exists**, and otherwise on
   `settle` with a reason.
6. **Never raise a timeout to fix a flake before its mechanism is known.**
   `asyncUtilTimeout` in `tests/setup.ts` is every `findBy*` and `waitFor` budget,
   so a `{ timeout }` that restates it is noise.

Three fake-timer traps:

- **Without `shouldAdvanceTime`, `findBy*` and `waitFor` hang.** Testing Library
  advances fake timers only when a `jest` global exists, and Vitest defines none.
  Under a clock that moves only when told, assert with `getBy*` after
  `await act(() => vi.advanceTimersByTimeAsync(ms))`. Restore real timers before
  the next `findBy*`.
- **React's async `act` flushes on `setImmediate`**, which Vitest's default
  `toFake` fakes too. Fake only what the code under test reads, as
  `router.test.tsx` does with `{ toFake: ['setTimeout', 'clearTimeout', 'Date'] }`.
- **`userEvent` typing under fake timers needs `advanceTimers`**, as in
  `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. Without it, typing
  waits on a clock that never moves.

## End-to-end tests

Playwright has four projects: `fixtures`, `live`, `contrast` and `nginx`.

- **Name e2e files `*.test.ts`.** `playwright.config.ts` sets `testMatch` to
  match. `vitest.config.ts` keeps an explicit `include` of `tests/**`, or Vitest
  would collect the Playwright files and run them under jsdom.
- **`e2e/` is type-linted through its own `tsconfig.json`.** It is not exempted
  like the root configs.
- **The dev server starts as `vite --force`.** Without it, Vite trusts a stale
  dependency cache, finds a new import mid-run, re-optimises and reloads the page.
  The reload drops the memory-only token and lands the test on `/login`. Outside
  CI, a server that is already running is reused, with whatever cache it has.

**`fixtures`** drives `e2e/harness/`: the real router and CSS, with MSW answering
the fixtures. It needs no backend. It exists for what jsdom cannot see, because
jsdom has no layout. `?path=` picks the route, and the harness's other query
parameters shape the fixtures: `?role=none|viewer|owner` (the default is a
platform admin), `?member=`, `?errors=`, `?flags=`, `?maintenance=full|route` and
`?onboarding=`. The harness's comments give each one's meaning.

**An endpoint the harness leaves unmocked falls through**
(`onUnhandledRequest: 'bypass'`). `fixtures` and `contrast` take `test` from
`e2e/hermetic.ts`, which answers such a request with express's 401 envelope. That
401 on a token-bearing request is a verdict, so it signs the harness user out. At
teardown it fails the test and names the endpoint. A test that fulfills an `/api`
route itself stamps the response with `FALLBACK_HEADER`, or teardown reports it as
an escape. If a fixtures test lands on `/login`, look for an unmocked endpoint.

**`live`** needs a real express and its services, and runs only with `E2E_LIVE=1`.
Its accounts are registered and verified through mailpit. Each run registers a
fresh address (`freshEmail`), because express rate-limits sign-in per address.
Nothing is cleaned up: every run leaves its accounts, tenants, invitations and
audit entries in that API's database. What the express under test needs is in
the [README](README.md#testing).

`assertApiServesApex` and `assertFakeEmailWebhook` fail before any test runs and
name what is wrong. The variables, with their defaults, are in the
[README](README.md#testing).

**posthog-js drops every event from a Playwright browser** (`navigator.webdriver`,
a headless user agent). An analytics e2e test uses `HUMAN_USER_AGENT` and calls
`passPosthogBotFilter` before its first navigation (`e2e/helpers/fake-posthog.ts`).

**`nginx`** runs against the production image (`pnpm test:e2e:nginx`), because the
headers and the CSP are only real there. The `@no-api` tests also run in CI with
nothing behind `/api`. The rest need a live API and run locally.
The variables are in the [README](README.md#testing), and the live half of
`e2e/nginx/analytics.test.ts` has its setup in the README's
[Analytics](README.md#analytics-posthog) section.

**`contrast`** (`pnpm test:contrast`) runs axe's `color-contrast` rule in a real
browser, in both themes, over every surface reachable without a backend. Each
surface asserts a heading only it renders before axe runs, because a redirected
route still paints a legible page. It is opt-in and not in CI. Component
composition changes contrast as much as the palette does, so run it before merging
UI work. Never judge a contrast change by eye.

## Accessibility

`tests/unit/a11y.test.tsx` is a gate. Every routed page and every open overlay it
covers (the dialogs, the mobile sheet, the command palette, the filters and the
menus) must come back clean. If something trips a rule, fix the markup. No rule
is disabled to make it pass.

- **axe runs over `document`, not a fragment.** Axe's page-level rules come back
  inapplicable for any smaller context. The gate pins this by asserting that
  `html-has-lang`, `document-title` and `bypass` are in `results.passes`.
- **Every page needs exactly one `<main>` and one `<h1>`, and the test asserts both
  by hand.** Under jsdom, axe cannot evaluate `page-has-heading-one` or
  `landmark-one-main`. Both use axe's `passForModal` check, which looks for a
  modal. When no dialog is open, the check calls `document.elementsFromPoint`,
  which axe polyfills over `document.elementFromPoint`; jsdom has neither, so axe
  files both rules under `incomplete`. `toHaveNoViolations` does not read that
  list. When a dialog is open, both rules pass without looking at the page.
  `CardTitle` renders a `div`, so a page's `h1` goes inside it.
- **`incomplete` is pinned.** `KNOWN_INCOMPLETE` lists the rules jsdom cannot
  decide, each with its reason, and the gate fails on any other rule filed there.
  `aria-valid-attr-value` is accepted only when every check on it is
  `controlsWithinPopup`, so a dangling reference still fails. A page holding an
  iframe, such as the email preview, runs with `frames: 'skip'`.
- **Menus are graded at menu scope.** Base UI portals a menu popup to
  `document.body`, so at document scope every open menu trips `region`.
  `expectNoViolationsIn` runs the same rule set against the popup. It asserts that
  `aria-required-children` passed, which happens only when axe evaluated a
  `role="menu"`.
- **`RouteError`, `RoutePending` and `RouteNotFound` render no `<main>`.** They
  render inside the matched route's `Outlet`, which a layout's `<main>` already
  wraps. The top-level splat route `src/pages/$.tsx` has no layout, so it wraps
  `RouteNotFound` in its own `<main>`.
- **Colour contrast is not checked here.** Every `cat.color` rule is off under
  jsdom, which has no layout. The `contrast` e2e project measures contrast, and the
  `fixtures` project checks overflow at 390px. Focus rings are checked only as a
  `focus-visible:` class, not in a browser.
