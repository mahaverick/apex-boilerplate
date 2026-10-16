# Architecture

How the staff console is put together: what runs at boot, how a route gets
its data, where state lives, and how the HTTP layer, the staff pages,
observability and the container fit around it. What each part defends
against is in [SECURITY.md](SECURITY.md); how to run, configure and deploy it
is in [README.md](README.md).

The HTTP layer, analytics, feature flags, error tracking and most of the
container are shared with react-boilerplate, the customer app
([Sibling sync](#sibling-sync-with-react-boilerplate)). Their sections
describe the shared code; what only this app has sits in sections and
subsections marked _this app only_.

## Layout of `src/`

```
src/
  components/
    dev/        TanStack devtools, development builds only
    features/   composed, app-specific pieces: one folder per staff area, plus the shell's own
    layouts/    the signed-out shell (AuthLayout, AuthCard) and the staff shell (AppLayout, NavMain)
    shared/     app-wide pieces that are not shadcn output (<Pii>, <AppMark>, the lazy <ToastHost>)
    ui/         vendored shadcn output (toast.tsx with local edits), plus the hand-written form.tsx and command.tsx
  configs/      the run-time configuration (getRuntimeConfig)
  constants/    routes and the API prefix, roles, the staff navigation, tenant tabs, per-area constants
  hooks/        use-* hooks, the step-up runner among them
  http/         the axios client, its interceptors, the session, trace ids
  lib/          small helpers: step-up checks, maintenance-mode sentences
  observability/
    errors/     error tracking: the entry-chunk listener and the lazy reporter
    flags/      flag reads, gating, exposure and $feature/* registration
    telemetry/  the PostHog facade: lazy posthog-js, typed events, masking, handoff
  pages/        TanStack Router file routes
  queries/      TanStack Query options and mutations, one file per resource
  schemas/      Zod schemas that mirror the API's validators, and URL search schemas
  states/       Zustand stores
  styles/       globals.css and the design tokens
  types/        API envelope and shared response types
```

The UI kit is shadcn's `base-vega` style on Base UI, with Inter Variable
(`@fontsource-variable/inter`, imported by `globals.css`) and Tabler icons
(`@tabler/icons-react`; Tabler adds no `aria-hidden`, so each decorative icon in
app code carries it). `components.json` records the preset; the colour tokens in
`globals.css` are this app's own indigo-tinted set, not the preset's neutral
greys. The signed-out pages follow shadcn's login-03 block: `AuthCard` puts the
app's mark and name over a centred card, and the sign-in page's social buttons
come from `SOCIAL_PROVIDERS` in `src/constants/auth-providers.ts`, since the API
publishes no list of configured providers. There is no sign-up link and no
terms line: Apex has no public sign-up and is an internal tool. The staff shell
follows sidebar-07 ([The staff shell](#the-staff-shell-this-app-only)).

`src/routeTree.gen.ts` is generated from `src/pages/` by the TanStack Router
plugin in `vite.config.ts`, which also splits each route's component into
its own chunk (`autoCodeSplitting`).

A lazy route with its own `errorComponent` keeps that screen in the route
module, with `codeSplitGroupings: [['component']]`, as the settings leaves do.
A split error screen would need a fetch exactly when chunk loading fails, and
the plugin's default split pulls the error listener out of the entry chunk.
For the same reason such a route's page component must not import `Route`
back from its route module: it uses `useSearch({ from })`, `useNavigate({ from })`
and `useParams({ from })` instead of `Route.useSearch()` and the like. Either
mistake fails `pnpm check:bundle` ([Error tracking](#error-tracking)).

## Boot

`index.html` loads two blocking scripts in its `<head>`, then the bundle:

1. `public/theme-init.js` sets the `dark` class from `localStorage` before
   the first paint.
2. `/runtime-config.js` sets `window.__APP_CONFIG__`
   ([run-time config](#the-container-and-run-time-config)).
3. `src/main.tsx`, the module entry. `#root` holds a static splash until
   React's first commit replaces it.

`src/main.tsx` runs in this order:

- **`@/lib/zod-jitless` is the first import**, before any module builds a
  Zod schema ([CSP and headers](SECURITY.md#csp-and-headers) says why).
  `tests/setup.ts` and
  `e2e/harness/harness.tsx` import it first for the same reason.
- **`@/observability/errors/install` is the second**, so the window `error`
  and `unhandledrejection` listeners exist before the rest of the app's
  modules evaluate.
- **Importing `@/router` builds the app.** At module evaluation,
  `src/router.tsx` creates the `QueryClient` (queries fresh for 30 seconds,
  one retry), creates the router and subscribes page-view analytics, the
  `$feature/*` sync and the error reporter's route source to it
  ([Router hooks](#router-hooks-this-app-only)).
- **`router.load()` runs before React mounts.** The root route's
  `beforeLoad` awaits `bootstrapSession()`, so the first match is resolved
  against a settled session. React mounts in the load's `finally`, whether
  it resolved or rejected: mounting earlier would blank the splash, because
  `createRoot().render()` clears `#root` and the router renders nothing until
  it has a match.
- **`initAnalytics()` runs after that first load**, so the identity the
  session restore queued is applied before posthog-js sends anything.

`bootstrapSession()` runs once per page load. It installs the cross-tab
logout listener and the analytics identity subscription, then calls
`ensureSession()`. Whether the refresh succeeds or fails, the store is
marked bootstrapped. A load that ends with no user drops any person
posthog-js still holds from an earlier visit, and the `$feature/*`
properties with it, unless the refresh failed without an auth verdict and
another open tab answers that it is signed in as that person. The access
token is memory-only, so every page load starts signed out and restores the
session this way ([Token storage and refresh](SECURITY.md#token-storage-and-refresh)).

The root route's component renders the page's head tags, the page and the
toast host. The toast UI (`src/components/ui/toast.tsx`) is a lazy chunk that
`ToastHost` fetches when the root route first renders. `toast.*` from
`src/lib/toast.ts` is small and outside that chunk; it queues the newest ten
toasts raised before the UI has mounted, and those raised in its first 100 ms,
and replays them in order once the empty live region has been in the document
for that long, so they are not inserted together with the region, which screen
readers often skip. A failed chunk load is reported as a `chunk_load` error and
leaves the page without toasts. Beside the router, `src/main.tsx` mounts the TanStack Query and
Router devtools, which load only in development; a production build drops
them.

## Routing and data loading (this app only)

Routes are files under `src/pages/`. Route files prefixed `__`, `_` or `$`
(`__root.tsx`, `_app.tsx`, `$tenantId.members.tsx`) follow TanStack Router's
naming, not the kebab-case rule the rest of `src/` follows.

| Route group                                                                 | Guard                                                                                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/_app` (every staff page)                                                  | Not signed in: redirect to `/login?redirect=<href>`. Signed in without a platform role: redirect to `/no-access`. Its loader reads the app's flags first. |
| `/_auth` (login, register, forgot-password)                                 | Signed in: redirect to Overview. Register also sends a visitor without `?invitation=` to `/login`: there is no public sign-up.                            |
| `/`                                                                         | Redirects in `beforeLoad`: signed in to Overview, anyone else to `/login`.                                                                                |
| `/no-access`                                                                | Not signed in: redirect to `/login`. Staff: redirect to Overview.                                                                                         |
| `/auth/callback`, `/reset-password`, `/verify-email`, `/invitations/accept` | None. The OAuth callback sits outside `_auth`, whose guard would bounce the visitor it has just signed in.                                                |
| `/$`                                                                        | None. The splat route renders `RouteNotFound` inside its own `<main>`.                                                                                    |

The Settings area is `/settings` and its pages under `/_app`, so the staff
guard covers them: `/settings` (a landing page listing every section),
`/settings/account/profile`, `/settings/account/security`,
`/settings/platform/staff`, `/settings/platform/flags` and
`/settings/platform/maintenance`. The layout, `src/pages/_app/settings.tsx`,
renders each page's one `h1` from the active section, so the pages render
`h2`s only. Each platform page keeps its own role gate; none is hidden by role.
The old paths redirect in `beforeLoad` with
`redirect({ to, search: true, hash: true, replace: true })`, so a bookmark
keeps its query and hash (a flags evaluation's `?userId=` included): `/profile`,
`/staff`, `/flags` and `/maintenance` go to their settings page,
`/settings/account` to Profile and `/settings/platform` to Staff.

The guards read the auth store directly, and that is sound because the root
route's `beforeLoad` has already awaited the session restore; a guard in a
`useEffect` would see an empty store on every reload and redirect wrongly.
What the staff guard does and does not protect is in
[Staff-only access](SECURITY.md#staff-only-access).

The Google sign-in button on `/login` is a plain anchor to
`GOOGLE_OAUTH_PATH`, which `src/constants/routes.ts` derives from
`API_PREFIX`, so moving the prefix moves it too. It is the one entry in
`SOCIAL_PROVIDERS`; a deployment without Google OAuth empties that list, and
the page then draws neither the button nor the "Or continue with" divider.

**Loaders start a fetch; components wait for it.** A page's loader calls
`queryClient.prefetchQuery(...)` with the same options its component's
`useQuery` uses and does not await it, so the page renders its skeleton at
once and fills in from the cache. Only the `/_app` loader awaits: it reads
the flags before the shell renders, so a flagged navigation item never
flashes, and `ensureFlags` never rejects, so a failed read renders the shell
with fallbacks.

Links preload on intent (`defaultPreload: 'intent'`). The pending component
waits 300 ms before it shows and then stays at least 300 ms. The error,
not-found and pending components are imported statically in
`src/router.tsx`: when a chunk cannot be fetched, a lazy error screen could
not load either. `RouteError` recognises a failed chunk load
(`src/lib/chunk-load-error.ts`) and offers a reload, the only way to pick up
a new deploy's file names; any other error offers a retry that re-runs the
loaders.

**Breadcrumbs** come from each route's `staticData.crumb`, a string or a
component given the match's params, so a record page names itself once its
record has loaded. A record page whose list is a sibling route rather than
a parent declares that list as `crumbParent`. The types are the module
augmentation in `src/router.tsx`, and `AppLayout` builds the trail from the
matches.

**Page titles** are set per route through `head` and `pageTitle`
(`src/constants/app.ts`), always fixed words
([Analytics privacy](SECURITY.md#analytics-privacy) says why).

**Queries** live in `src/queries/`, one file per resource. Most export a key
factory and their options or hooks, and the rest reuse another file's keys;
`unwrap` (`src/http/client.ts`)
returns the `data` of the API's success envelope. Failed requests are read
with the helpers in `src/lib/api-error.ts`, and a form maps the API's field
errors onto its inputs through `useServerErrors`.

- **A 404 under `/platform/*` is a refusal, not a miss.** Staff queries test
  it with `isRoleDenied` (`src/queries/platform.queries.ts`); what follows is
  in [Staff-only access](SECURITY.md#staff-only-access).
- **Lists and details are keyed apart.** A list key sits under its plural
  prefix (`['platform', 'tenants']`, `['platform', 'users']`) and a record
  under the singular one (`['platform', 'tenant', id]`), so refreshing a list
  never refetches an open record. `invalidateDirectory` marks both stale
  after a staff write, with every tenant's own routes, the platform audit
  log, onboarding and the email queries, since a write may change what any
  of them show.
- **A tenant's own routes are keyed by slug and id.** `/tenants/:slug/*`
  answers what the tenant's members see, and a tenant opened from its
  staff page adds its id to the key (`tenantKeys` in
  `src/queries/tenant.queries.ts`): archiving frees a slug for reuse, and a
  new tenant with that slug must never be shown the archived one's cached
  members. `useMyRole` reads the caller's role and access path off that
  detail, and every role-gated control on a tenant reads it.
- **Lists page by cursor.** The tenant, user, email, suppression and
  onboarding lists keep their filters and keyset cursor in the URL,
  validated by each page's search schema, so a filtered page can be shared
  and reloaded.

## State

| What                                  | Where                                 | Persisted                                                     |
| ------------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Access token, user, bootstrapped flag | `src/states/auth.store.ts`            | No: memory only                                               |
| Command palette open                  | `src/states/command-palette.store.ts` | No                                                            |
| Sidebar collapsed                     | `src/states/sidebar.store.ts`         | No                                                            |
| Theme (`light`, `dark`, `system`)     | `src/states/theme.store.ts`           | `localStorage` key `theme`, read pre-paint by `theme-init.js` |
| Everything the API returns            | The TanStack Query cache              | No                                                            |
| Form state                            | TanStack Form, per form               | No                                                            |

Code outside React reads and writes the stores through `getState()`, as the
interceptors and route guards do, or subscribes to them: the session module
follows the auth store's user to keep analytics and the flag caches in step.
The auth store's user is the profile the session restore or the sign-in
loaded, and its `platformRole` is what the staff guard, the navigation and
the tenant tabs read.

## The HTTP layer and session

Every REST call goes through `apiClient` (`src/http/client.ts`): an axios
instance whose base is the relative `API_PREFIX`, `/api/v1`, with
credentials sent and a 30-second timeout. The timeout exists because axios
has none by default, and a request that never answers would leave its
mutation pending and its button disabled.

**The prefix is fixed and same-origin.** It is written once, as
`API_PREFIX` in `src/constants/routes.ts`; the axios base derives from it
and the analytics proxy path repeats it. The development server proxies
`/api` to the API (`vite.config.ts`) and the container's nginx does the
same, so the app only ever calls the origin that served it. nginx's
`location /api/v1/collect/` hardcodes `/api/v1`, so moving the prefix means
changing `API_PREFIX` and `nginx.conf` in one change, plus the `/api/`
location and the Vite proxy for a prefix outside `/api`. There is no
environment variable for it: one that moved only the axios base would leave
every path that repeats or hardcodes the prefix on the old one. This app's
own user of the prefix is the Google sign-in anchor
([Routing](#routing-and-data-loading-this-app-only)).

**Interceptors**, installed by `installInterceptors`. The two request
interceptors are independent of each other; the response interceptors run
in the order they are registered:

| Direction | Order | Interceptor                   | Does                                                                                                                                                                |
| --------- | ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request   | –     | Bearer token                  | Adds `Authorization: Bearer` from the auth store when the request has none.                                                                                         |
| Request   | –     | Trace headers                 | On a same-origin request under the prefix: a `traceparent` when the request has none (a replay keeps its own), and the analytics session id when one may be linked. |
| Response  | 1     | 401 handling                  | Refreshes and replays once on an expired token; signs out on a verdict; leaves `REAUTH_REQUIRED` to the caller.                                                     |
| Response  | 2     | `rejectMalformedJsonResponse` | Rejects a 2xx whose body is not a JSON object, such as an HTML page from a misrouted proxy.                                                                         |

A replay goes through the whole chain again. The rules each step enforces,
and why, are in [Sign-out rules](SECURITY.md#sign-out-rules).

`traceparent` values come from `src/http/traceparent.ts`: random ids from
`crypto.getRandomValues`, flagged sampled. There is no tracing SDK in the
browser; the header only lets the API's span join a trace the browser chose.

**The session** (`src/http/session.ts`):

- `ensureSession()` is the single entry to a refresh. Callers in a tab share
  one in-flight promise, and tabs queue on the `auth-refresh` Web Lock.
- `refreshSession()` posts `/auth/refresh`, then loads `/profile` with the
  new token, since the refresh returns only a token. A profile whose id
  differs from the tab's user fails the refresh with
  `SessionIdentityChangedError`.
- `isAuthVerdict()` is the one test of whether a failure may end a session.
- `redirectToLogin()` is the one place a dead session navigates, to
  `/login?redirect=…`.
- The `auth` BroadcastChannel carries sign-outs between tabs.
- `installAnalyticsIdentity()` subscribes to the auth store: a change of
  user resets analytics and drops every cached flag value and exposure mark
  before the next user is identified.

Why each of these holds, and what breaks if it does not, is in
[Token storage and refresh](SECURITY.md#token-storage-and-refresh) and
[Sign-out rules](SECURITY.md#sign-out-rules).

## The staff shell (this app only)

`AppLayout` (`src/components/layouts/app-layout.tsx`) is the signed-in
layout every staff page renders in, after shadcn's sidebar-07 block: a sidebar
that collapses to icons, with a rail to toggle it, holding the Apex brand (a
link to Overview, not a switcher: staff have no tenant to switch), the
navigation and the account menu; and a header with the sidebar trigger, the
breadcrumbs, the ⌘K search and, from `md` up, the theme toggle. It holds:

- **The navigation**, from `src/constants/navigation.ts`: one typed list of
  pages, each with its sidebar group, the least platform role that sees it
  and an optional boolean flag. The sidebar groups it (`navGroupsFor`) and
  the command palette lists it (`navItemsFor`), so a new main-nav page is an
  entry there, a `ROUTES` entry (`src/constants/routes.ts`), a member of the
  `NavPath` union and a file under `src/pages/_app/`. An item above the
  user's role, or behind a flag that is off, is absent rather than disabled.
  `NavMain` (`src/components/layouts/nav-main.tsx`) renders each section with
  a label that folds it away. Every section starts open, the one holding the
  current page cannot be folded, and collapsed to icons every item shows.
  Below it, the bottom group (`NavSecondary`) holds one item, Settings.
- **The settings nav.** `src/constants/settings.ts` is the source of truth
  for the settings pages: `SETTINGS_GROUPS` (Account, Platform) and
  `SETTINGS_SECTIONS` (each page's path, label, description and icon). It
  drives the settings nav, the `/settings` landing page, the settings
  layout's `h1` and the palette's settings pages, so a new settings page is
  an entry there, a member of the `SettingsPath` union and a route under
  `src/pages/_app/settings/`. On `/settings/*` the sidebar's content swaps
  from `NavMain` and the bottom group to `NavSettings`
  (`src/components/layouts/nav-settings.tsx`): Back to console, then each
  group's sections, listed for every staff role. The brand header and the
  account menu stay. Every sidebar link, in any of the three navs, closes
  the phone drawer.
- **The command palette** (`src/components/features/command-palette.tsx`),
  opened by ⌘K or Ctrl+K or the header's search button through
  `command-palette.store.ts`. Its pages are the visible nav items and, for
  staff, every settings section. It filters them itself and asks
  the API for customer tenants and users once typing stops for 250 ms,
  showing each result list only for the term it was fetched for, so Enter
  never acts on an older term's list. `ui/command.tsx` builds it on Base
  UI's Autocomplete.
- **One step-up dialog.** `StepUpProvider` wraps the shell, so every staff
  page's writes share it. A write that may need a recent sign-in runs
  through `useStepUp().run` (`src/hooks/use-step-up.ts`), which retries it
  once after the user confirms; the rules are in
  [Step-up re-authentication](SECURITY.md#step-up-re-authentication).
- **The maintenance banner** under the header
  ([Maintenance admin](#maintenance-admin-this-app-only)).
- **The `$feature/*` sync**, mounted once here
  ([Feature flags](#feature-flags)).

The palette, the flag sync and the theme listener live in the layout, not the
sidebar, because below the `md` breakpoint the sidebar renders into a sheet
whose content unmounts while it is closed. Below `md` the theme toggle itself
moves from the header into that sheet's footer, since the header has no room
for it beside a full breadcrumb trail at 390px.

Destructive and audited writes ask for a reason in `ReasonDialog`
(`src/components/features/reason-dialog.tsx`); which ones do, and the
bounds on the text, are in [Reason prompts](SECURITY.md#reason-prompts). A
widget that may throw while rendering, such as an Overview chart, sits in a
`WidgetBoundary`, so its failure replaces that widget alone.

## The directory (this app only)

The Directory pages are Tenants and Users, with Staff under Settings ›
Platform; a tenant and a user each have a detail page with their own
sub-pages.

- **Tenants and Users** are keyset-paged lists from `GET /platform/tenants`
  and `GET /platform/users`, searched with `?q=` and filtered by state or
  status. Their reads and staff writes are in
  `src/queries/tenant-admin.queries.ts` and
  `src/queries/user-admin.queries.ts`.
- **A tenant's page** (`src/pages/_app/tenants/$tenantId.tsx`) reads
  `GET /platform/tenants/:id`, which answers in every lifecycle state, and
  renders a tab per child route. `src/constants/tenant-tabs.ts` lists the
  tabs and the least platform role each needs. The Members, Invitations,
  Activity and Flags tabs read the tenant's own routes, which answer only
  while it is active.
- **A user's page** (`src/pages/_app/users/$userId.tsx`) reads
  `GET /platform/users/:id`, with a Flags link beside it.
- **Staff** (`src/pages/_app/settings/platform.staff.tsx`) is the platform tenant's own
  members and invitations, managed through the same `/tenants/platform/*`
  routes and the same components a tenant's Members and Invitations tabs
  use. `useMyRole` there reads the viewer's platform role.

Who may act on whom is mirrored from the API in `src/constants/roles.ts`;
the rules and their limits are in
[Staff-only access](SECURITY.md#staff-only-access).

## Onboarding (this app only)

The Onboarding page shows the activation funnel for a window and the tracked
tenants in each state; a tenant's Onboarding tab shows its steps, members
and reminders. The queries (`src/queries/onboarding.queries.ts`) all sit
under `['platform', 'onboarding']`, so one prefix refreshes them, and
`invalidateDirectory` reaches it.

The two staff writes, marking a step complete and sending a reminder, carry
a reason and refresh in `onSettled`, not `onSuccess`: a 409 such as
`already_complete` or `reminded_recently` means the cached detail was stale,
so it refreshes either way. Each refreshes the onboarding queries, the
Overview's figures (whose stuck count it can change) and both audit logs; a
reminder sends tracked email, so the email queries refresh too.

## Feature flags admin (this app only)

The Feature flags page is an inspector over the API's registry, and is
read-only: rollouts are edited in PostHog. Its queries
(`src/queries/flag-inspector.queries.ts`) sit under `['platform', 'flags']`,
apart from the app's own flag values ([Feature flags](#feature-flags)).

- **The list** (`GET /platform/flags`, every staff role) holds each
  registered flag with its live state, PostHog's unregistered flags and the
  trait reference.
- **An evaluation** (`GET /platform/flags/evaluate`, admins and up) answers
  one user's value for every registered flag, optionally in one of their
  tenants, as one app's client, with the traits the API used. It is an
  audited read, so it has no retry, no refetch on focus or reconnect, and
  its cache is dropped when the page is left.
- **Who is evaluated** is in the URL (`?userId=`, `?tenantId=`, `?app=`;
  `src/schemas/flags.schemas.ts`), so an evaluation can be shared. A
  tenant's Flags tab evaluates one of its members in that tenant, as the
  customer app sees it.

## Analytics, flags and errors

Analytics and error tracking share one transport, the API's `/api/v1/collect`
proxy, which forwards to PostHog. Flags are read from, and exposures reported
to, the API's own flag endpoints. In every case the browser never talks to
PostHog. What each sends,
masks and withholds is in [Analytics privacy](SECURITY.md#analytics-privacy)
and [Error-tracking privacy](SECURITY.md#error-tracking-privacy).

### Analytics

`src/observability/telemetry/` is the only code that imports posthog-js,
and `telemetry.ts`, the facade, is the only module that imports it as a
value, through a dynamic `import()`. The rest of the app imports the barrel,
`index.ts`.

- **Lazy load with a queue.** `initAnalytics()` loads posthog-js once, after
  the first route load. Calls made before it has loaded queue and replay in
  order when it does, before any event is sent, so queued identity is
  applied first. The queue holds 100 commands; past
  that the oldest queued event capture is shed, and identity, reset, group
  and consent calls never are. With no PostHog key the facade turns inert
  and every call is a no-op; this app honours no consent mode
  ([Analytics privacy](SECURITY.md#analytics-privacy)). A throwing SDK call
  is swallowed: analytics never fails a user action.
- **Page views come from the app, not the SDK.** posthog-js's own history
  page views are off; the app captures `$pageview` with `capturePageview()`
  (this app's router hook: [Router hooks](#router-hooks-this-app-only)).
- **Identity follows the auth store**, through `installAnalyticsIdentity` in
  `src/http/session.ts` ([The HTTP layer and session](#the-http-layer-and-session)).
- **Per-app constants** sit at the top of
  `src/observability/telemetry/config.ts`: the `app` property, the query-key
  allowlist, whether consent modes and the cross-domain handoff are
  supported, and how the identity cookie is shared. The registry of typed
  events is `event-registry.ts`. Everything else in the folder is shared with the
  sibling app ([Sibling sync](#sibling-sync-with-react-boilerplate)).
- `src/observability/identity-epoch.ts` is a counter of the calls that change
  who an event belongs to. It is a module of its own, importing nothing, so
  the entry-chunk error listener can read it without importing the facade.

### Feature flags

The API is the only evaluator; posthog-js does no flag work. Values are read
per scope, and `src/observability/flags/flag-scope.ts`, which each app owns,
says which scope a page reads and which endpoint answers it. This app has one
scope, `platform`: staff are evaluated with no tenant, from
`/platform/me/flags`, and the `/_app` loader reads it before the shell
renders.

- **The registry slice** is `CLIENT_FLAGS` in `flag-keys.ts`, also per app:
  the API registry's entries the app reads, mirrored by hand, each with its kind,
  variants, fallback and whether it is an experiment. A value the server
  sends for a key the slice lacks is dropped, and a missing or invalid value
  becomes that flag's fallback (`normalizeFlags`). This app's slice is
  empty, so every flag key type is `never` until an entry is added.
- **Reads.** One query per scope (`flag-query.ts`): fresh for five minutes,
  refetched every ten and on focus once stale, never retried. `ensureFlags`
  never rejects, so a failed read renders the page with fallbacks. Pages
  read values with `useFlagValues()` and `useVariant(key)`
  (`flag-hooks.ts`), which show the fallback while loading and after a
  failure.
- **A change of user** drops every scope's values and the exposure marks
  ([The HTTP layer and session](#the-http-layer-and-session)).
- **Exposure.** `useVariant` on an experiment flag, once its value came from
  the server, reports the key, never the value, to the scope's
  `/exposures` endpoint (`exposure.ts`): batched for 50 ms, at most 10 keys
  per request, once per scope, key and value in a tab session. The API
  re-evaluates and records the exposure.
- **`$feature/*` super properties** carry each flag's value on every browser
  event. `useFeaturePropertiesSync`, mounted once in the signed-in layout,
  syncs them in a layout effect, never from a query or loader: a loader also
  runs for a hover preload, whose scope is not the page's. The app's router
  syncs them too before each page view.

### Router hooks (this app only)

`src/router.tsx` subscribes three hooks to the router. The two that touch
analytics run on committed navigations, never in a loader, because a loader
also runs for a hover preload.

- **Page views.** On `onResolved`, the router captures `$pageview` when the
  path changed; a search or filter change is not a page view. The hook is
  installed before the first load, so the landing page is counted. This app
  sets no tenant group.
- **`$feature/*` before each page view.** `installRouteFeatureProperties`
  (`flag-scope.ts`) syncs them on `onLoad`, which fires before `onResolved`
  captures the page view and never for a preload, to the platform scope's
  cached values. It is what gives the first page view its properties, since
  that load runs before React mounts. With nothing cached, such as a first
  load outside the staff shell, it unregisters them all.
- **The error reporter's route source**, registered with
  `setErrorRouteSource` ([Error tracking](#error-tracking)).

### Error tracking

Error tracking is split so that every page pays almost nothing for it:

- **`listen.ts`**, in the entry chunk, notes raw errors and nothing else:
  the window listeners, React's root `onUncaughtError` and `onCaughtError`
  (`rootErrorOptions`, passed to `createRoot`), and `noteError` for an error
  the app catches that those hooks never see (this app's callers are
  `RouteError` and the members card's Leave action, whose failed navigation
  it catches). It drops repeats, buffers a few errors, and loads the
  reporter on the first error or when the browser is idle. It imports only
  `identity-epoch.ts`.
  `pnpm check:bundle` caps it at 1 KB gzipped and keeps `@posthog/core` and
  posthog-js out of the first-visit chunks.
- **`report.ts`**, lazy, filters each error, builds a `$exception` with
  `@posthog/core`, and scrubs, caps and attributes it as
  [Error-tracking privacy](SECURITY.md#error-tracking-privacy) describes.
  It posts batches to `/api/v1/collect/batch/`, retries a failed batch once,
  and on `pagehide` sends whatever is left by `sendBeacon`. The batch,
  retry and cap constants are at the top of the file.
- **The reporter never imports the router.** `src/router.tsx` registers a
  route-id reader with `setErrorRouteSource`, so a crash in the router's own
  module can still be reported.
- **Releases.** `vite.config.ts` bakes `GIT_SHA` into the bundle as the
  release (`dev` when unset). The image build injects chunk ids into every
  chunk with `posthog-cli sourcemap inject`, offline and with no release, so
  an unchanged chunk keeps its bytes under its hashed name; it then uploads
  the hidden source maps and deletes them
  ([The container and run-time config](#the-container-and-run-time-config)).

## Maintenance admin (this app only)

Customer maintenance mode is the API's; this app shows its state to staff
and lets platform owners change it. Staff pages are not gated by it: the API
lets `/platform/*` and the session routes through in both modes, and lets
platform staff through on the customer routes this app calls (express's
`MAINTENANCE_STAFF_ROUTES`). So this app keeps no maintenance store, lets no
mode replace its routes and reads no `Maintenance-Mode` response header.

- **One query, two readers.** `maintenanceModeQueryOptions`
  (`src/queries/maintenance-mode.queries.ts`) reads
  `GET /platform/maintenance-mode` under one key, which the banner in
  `AppLayout` and the Maintenance page share, so one poll serves both. The
  banner shows nothing while the mode is `off` or not yet known.
- **Changes run through step-up.** The owner's change and switch-off dialogs
  (`src/components/features/maintenance/`) call `useChangeMaintenanceMode`
  inside `useStepUp().run`. A success cancels any read in flight, puts the
  answer in the cache, and marks the Overview's status card and the platform
  audit log stale. A 409 conflict cancels any read in flight, reads the
  state once more and rejects with a `MaintenanceModeConflict` that carries
  that read, so the dialog can say what someone else saved.
- **Rules and sentences outside React** are in `src/lib/maintenance-mode.ts`:
  which change switches maintenance on (`isSwitchOn`), the banner's and the
  conflict's wording, and each queue's pause line, which the Maintenance page
  and the Overview's status card both list.

The poll intervals, what a switch-on asks for, how a conflict avoids an
overwrite and where the message and reason render are in
[Maintenance controls](SECURITY.md#maintenance-controls).

The Overview's **System status** card ("The API over the last 15 minutes")
shows the API's release and error tracking (enabled or not, events sent,
events dropped by reason and the last failed send), and, when the API sends
them, a **Feature flags** section and a **Maintenance mode** section. Each
section gets a **Needs attention** badge when something is wrong: for flags,
a missing or stale definitions snapshot, a failed fetch, a property matching
version other than 1, or a flag that is missing, unsupported or answered an
unknown variant; for maintenance, a state the API has not read, a failed
reload, queues that disagree with the mode, or change notices still waiting.

## The container and run-time config

The `Dockerfile` has two stages.

**Build stage** (`node:24-alpine`, pinned by digest):

1. Installs Corepack, then the pnpm version named by `packageManager` in
   `package.json`, then the dependencies from the frozen lockfile.
2. Downloads the `posthog-cli` binary and checks its SHA-256 against
   `docker/posthog-cli.sha256` before it first runs.
3. Copies the source and refuses a `.git` in the build context.
4. `pnpm build`, with `GIT_SHA` as the only build argument the bundle reads.
5. Injects chunk ids, release-less (see [Error tracking](#error-tracking)).
6. Uploads the source maps to each project in `POSTHOG_SOURCEMAP_PROJECTS`
   (`docker/upload-sourcemaps.sh`), with the token as a BuildKit secret, then
   deletes every `.map`.

**Serve stage** (`nginxinc/nginx-unprivileged`, pinned by digest) runs as
uid 101 on port 8080 and is built for a read-only root filesystem:
everything it writes is under `/tmp`, which must be a writable tmpfs.

- `docker/nginx.main.conf` replaces the image's `nginx.conf`: the pid file
  and temp paths under `/tmp`, connection limits (its comments give the
  sizing), and an include of `/tmp/nginx/conf.d/*.conf`.
- `nginx.conf` is the server block, installed as a template. At start, the
  image's entrypoint runs `/docker-entrypoint.d/` in name order:
  `docker/05-prepare.sh` creates the render directory and validates
  `API_UPSTREAM`; `docker/10-runtime-config.sh` validates the run-time
  settings and writes `/tmp/runtime/runtime-config.js`; the stock envsubst
  script then renders `nginx.conf`, substituting `API_UPSTREAM` and nothing
  else, so nginx's own variables survive. A failing script stops the
  container before nginx starts.

`nginx.conf` proxies `/api/` to `API_UPSTREAM`, gives
`/api/v1/collect/` a larger request body that streams to the API for replay
batches, serves `/runtime-config.js` from where the entrypoint wrote it,
answers a missing file under `/assets/` with a real 404 rather than
`index.html`, and falls back to `index.html` for every other path. Each
location's comment in `nginx.conf` gives its reason; the source map
location is covered in [CSP and headers](SECURITY.md#csp-and-headers).

Cache-Control is chosen by a `map` on the URI, not per location: hashed
assets are immutable for a year, and `index.html`, `theme-init.js`, the
favicon and `runtime-config.js` are `no-store`, so a deploy never leaves a
browser asking for asset names it removed. The security headers, the reason
no location declares an `add_header`, and the logging choices are in
[CSP and headers](SECURITY.md#csp-and-headers).

**Nothing is configured at build time.** One image digest is promoted
through every environment, so a setting that differs between environments
is a container environment variable read at start, never a `VITE_*` value
or a build argument. The flow:

1. `docker/10-runtime-config.sh` checks each value against its pattern and
   writes `window.__APP_CONFIG__ = Object.freeze({...})`.
2. `index.html` loads `/runtime-config.js` before the bundle.
3. `getRuntimeConfig()` (`src/configs/runtime-config.ts`), the app's only
   reader, applies the same patterns again. A production bundle, the one
   `pnpm preview` serves included, reads only `window.__APP_CONFIG__`. The
   dev server and the unit tests read the same names with a `VITE_` prefix
   from `import.meta.env`. On the dev and preview servers,
   `scripts/runtime-config-plugin.mjs` renders `/runtime-config.js` from
   those `VITE_` names.

A new setting goes into `RUNTIME_CONFIG_KEYS` and `RUNTIME_CONFIG_PATTERNS`,
the entrypoint script with the same pattern, `RUNTIME_CONFIG_NAMES` in
`scripts/runtime-config-plugin.mjs`, `docker/check-image.sh`, `.env.example`
and the README's table, in one change. The variables and their defaults are
in the [README's run-time configuration table](README.md#run-time-configuration),
and why the values are safe to write unescaped is in
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

`docker/check-image.sh` checks a built image from outside. Its checks on the
user, the root filesystem, the headers, the source maps, the refused run-time
settings and the release are listed in
[CSP and headers](SECURITY.md#csp-and-headers); the script also checks that
`docker/05-prepare.sh` accepts good `API_UPSTREAM` values and refuses bad
ones, and the content type of the JavaScript the image serves.

## Sibling sync with react-boilerplate

`react-boilerplate`, the customer app, shares these paths with this app.
A change to one here means checking the other app in the same pull
request, and the description says what happened there.

| Path                                                                                                                                                                                                                                                               | Why it must stay in step                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `src/http/*` (react also has `sse.ts`, its own)                                                                                                                                                                                                                    | Session refresh single-flight, 401-verdict sign-out, trace headers, analytics identity order                           |
| `src/lib/api-error.ts`                                                                                                                                                                                                                                             | Error envelope parsing                                                                                                 |
| `src/schemas/auth.schemas.ts`, `src/schemas/safe-text.schemas.ts`                                                                                                                                                                                                  | Mirror the API's validators                                                                                            |
| `src/schemas/profile.schemas.ts`, `src/schemas/invitation.schemas.ts`, `src/schemas/email-domain.schemas.ts` and their tests in `tests/unit/schemas/`                                                                                                              | Mirror the API's validators                                                                                            |
| `src/components/ui/form.tsx`, `src/components/ui/toast.tsx`, `src/lib/toast.ts`, `src/components/shared/toast-host.tsx`                                                                                                                                            | Shared behaviour; form.tsx is hand-written, toast.tsx is vendored with local edits.                                    |
| `nginx.conf` security headers and CSP, `location /api/v1/collect/` and `location ~* ^/api/v1/auth/google/callback/?$`, `tests/unit/docker/nginx-conf.test.ts` (react's also covers the stream location)                                                            | Same threat model; same replay batch size                                                                              |
| `src/observability/telemetry/*`, except `config.ts`'s per-app constants and `event-registry.ts`'s registry                                                                                                                                                         | One PII, consent, handoff and identity contract                                                                        |
| `src/components/shared/pii.tsx`, `e2e/helpers/fake-posthog.ts`, `tests/mocks/posthog.ts`                                                                                                                                                                           | The masking class, the egress guard's fake PostHog, and the posthog-js stand-in the unit tests share                   |
| `src/observability/flags/**`, except `flag-keys.ts` (each app's registry slice) and `flag-scope.ts` (each app's scope); `tests/unit/observability/flags/**`, except `flag-scope.test.ts` and this app's `flag-keys.test.ts`; `tests/fixtures/test-client-flags.ts` | One flag read, exposure and `$feature/*` contract; the tests mock `flag-keys` with test keys so they pass in both apps |
| `docker/10-runtime-config.sh`, `src/configs/runtime-config.ts`, `scripts/runtime-config-plugin.mjs`, `nginx.conf`'s `location = /runtime-config.js`                                                                                                                | One run-time configuration contract: the same variable names, patterns and file in both images                         |
| `docker/05-prepare.sh`, `tests/unit/docker/prepare-script.test.ts`                                                                                                                                                                                                 | Validates `API_UPSTREAM`, the other half of the container contract                                                     |
| `public/theme-init.js`, `src/lib/zod-jitless.ts`                                                                                                                                                                                                                   | CSP compatibility                                                                                                      |
| `src/observability/errors/**`, `src/observability/identity-epoch.ts`, `tests/fixtures/error-scrub-vectors.json`                                                                                                                                                    | One capture, filter, scrub and consent contract; the vectors are express-boilerplate's, byte for byte                  |
| `src/main.tsx`, `src/components/features/route-error.tsx`, the `setErrorRouteSource` line in `src/router.tsx`                                                                                                                                                      | The same boot order, and router and React root errors reported with their route the same way                           |
| `docker/upload-sourcemaps.sh`, `docker/check-image.sh`, `docker/posthog-cli.sha256`, `.github/workflows/deploy.yml`                                                                                                                                                | One source map pipeline                                                                                                |
| `nginx.conf`'s `.map` location                                                                                                                                                                                                                                     | No source map is ever served                                                                                           |
| `docker/nginx.main.conf`, `pnpm-workspace.yaml`, `tests/unit/docker/check-image-script.test.ts`, `tests/unit/docker/nginx-main-conf.test.ts`, `tests/unit/docker/dockerfile.test.ts`                                                                               | Same container limits, dependency overrides and script tests                                                           |
| `e2e/nginx/cors.test.ts`                                                                                                                                                                                                                                           | The CORS seam through nginx; react adds a preflight for its stream                                                     |
| `src/components/features/profile/security-section.tsx` and its test                                                                                                                                                                                                | One sign-out-other-sessions section                                                                                    |
| `src/schemas/changed-fields.schemas.ts`, `src/hooks/use-changed-fields.ts`, `tests/unit/hooks/use-changed-fields.test.tsx`                                                                                                                                         | Changed-field edit forms; each app keeps its own schema test                                                           |
| `src/hooks/use-now.ts`, `tests/unit/hooks/use-now.test.ts`                                                                                                                                                                                                         | One shared ticking clock, so every relative time moves on while a page stays open; byte for byte                       |
| `scripts/check-bundle.mjs`, except `ENTRY_BUDGET_BYTES` (each app's measured budget)                                                                                                                                                                               | One first-visit budget check; the budgets differ                                                                       |
| `eslint.config.js`'s shared conventions                                                                                                                                                                                                                            | Same conventions; each app adds its own import restrictions and file lists                                             |
| `e2e/capture/*`, except `seed.ts`, `manifest.ts` and `boot.test.ts` (each app's own); `tests/unit/capture-endpoint.test.ts`, `tests/unit/docs-pages.test.ts`                                                                                                       | One page-inventory capture harness and docs check                                                                      |
| `src/components/ui/{alert,spinner,item}.tsx`, the `*` section of `docs/ui-local-edits.md`, `scripts/ui-drift.mjs`, `scripts/ui-drift.d.mts`, `tests/unit/ui-drift.test.ts`                                                                                         | Byte-identical vendored components and the one drift check over them                                                   |
| `src/components/shared/{empty-state,note,busy-button}.tsx`, `src/components/features/load-error.tsx`, `tests/unit/components/shared/*.test.tsx`, `tests/unit/components/features/load-error.test.tsx`                                                              | Byte-identical shared empty, note, busy and load-error components                                                      |

The error scrubber is also held in step with express-boilerplate; see
[The scrubber](SECURITY.md#the-scrubber).

## Deploy

`.github/workflows/deploy.yml` is the pipeline:

- **A push to `main`** runs `ci.yml` as a gate, then the `image` job builds
  the image once and pushes it to GHCR as `sha-<commit>` and `main`, with an
  SBOM and a provenance attestation, then runs the `deploy` job, bound to the
  `production` environment. That job is a placeholder until a deployment
  target is chosen.
- **A `vX.Y.Z` tag**, pushed by the release workflow, builds nothing: the
  `promote` job waits for `main`'s `sha-<commit>` image and adds `X.Y.Z`,
  `X.Y` and `X` to that same digest.
- **A manual dispatch from another branch** pushes the sha-tagged image
  only; the `main` tag and the `deploy` job run only from `main`.

A release promotes a digest rather than rebuilding, so source maps are
uploaded only when an image is built; the consequence is in the README's
[Source maps](README.md#source-maps). The one-time repository setup, the release
flow and the one-origin rule for deployments are in the README's
[Deploying](README.md#deploying) and [Releases](README.md#releases) sections.
