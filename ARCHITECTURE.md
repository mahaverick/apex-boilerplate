# Architecture

This file is for developers who change Apex, the staff console. It covers
what runs at boot, how a route gets its data, where state lives, and how the
HTTP layer, the staff pages, observability and the container fit around
them. Apex is a browser client of express-boilerplate's Application
Programming Interface (API), which this file calls "the API" or "express".

- What each part defends against: [SECURITY.md](SECURITY.md).
- How to run, configure and deploy the app: [README.md](README.md).

Apex shares the HTTP layer, analytics, feature flags, error tracking and most
of the container with react-boilerplate, the customer app
([Sibling sync](#sibling-sync-with-react-boilerplate)). Sections on that code
describe the shared behaviour. Sections and subsections marked _this app
only_ cover what only Apex has.

## Layout of `src/`

This section maps the source folders, the UI kit and how routes split into
chunks.

```
src/
  components/
    dev/        TanStack devtools, development builds only
    features/   composed, app-specific pieces: one folder per staff area, plus the shell's own
    layouts/    the signed-out shell (AuthLayout, AuthCard) and the staff shell (AppLayout, NavMain)
    shared/     app-wide pieces that are not shadcn output (<Pii>, <AppMark>, the lazy <ToastHost>, the loading templates)
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

**The user interface (UI) kit** is shadcn's `base-vega` style on Base UI.

- The font is Inter Variable (`@fontsource-variable/inter`, imported by
  `globals.css`).
- The icons are Tabler (`@tabler/icons-react`). Tabler adds no `aria-hidden`,
  so each decorative icon in app code carries it.
- `components.json` records the preset. The colour tokens in `globals.css`
  are this app's own indigo-tinted set, not the preset's neutral greys.

**The vendored files in `src/components/ui/` are held to the shadcn
registry.**

- `scripts/ui-registry/` is a committed snapshot of the registry's files as
  the `shadcn` devDependency renders them.
- `docs/ui-local-edits.md` records each local edit: line rewrites, or exact
  hunks with a reason.
- `pnpm ui:drift`, a step of the continuous integration (CI) `lint` job,
  fails on any other difference. It also fails when the `shadcn` version or
  `components.json`'s style or icon library no longer matches the snapshot's
  manifest.
- `pnpm ui:drift:refresh` retakes the snapshot over the network, as a
  reviewed change. Renovate leaves `shadcn` bumps for a human, and
  CODEOWNERS covers the directory.

**The signed-out pages follow shadcn's login-03 block.** `AuthCard` puts the
app's mark and name over a centred card. The sign-in page's social buttons
come from `SOCIAL_PROVIDERS` in `src/constants/auth-providers.ts`, because the
API publishes no list of configured providers. There is no sign-up link and no
terms line: Apex has no public sign-up and is an internal tool. The staff
shell follows shadcn's sidebar-07 block
([The staff shell](#the-staff-shell-this-app-only)).

**Route code splitting.** The TanStack Router plugin in `vite.config.ts`
generates `src/routeTree.gen.ts` from `src/pages/`. It also splits each
route's component into its own chunk (`autoCodeSplitting`). A route's pending
template is not split with it. Instead, a route names one of the lazy wrappers
in `src/components/shared/pending-templates.ts`. The app fetches that chunk at
startup (`templatesReady`, which `main.tsx` waits for, with a cap). A template
therefore renders without suspending, and the page templates stay out of the
entry chunk.

A lazy route with its own `errorComponent` keeps that screen in the route
module, with `codeSplitGroupings: [['component']]`, as the settings leaves do.
Two reasons:

- A split error screen would need a fetch at the moment chunk loading fails.
- The plugin's default split pulls the error listener out of the entry chunk.

For the same reason, such a route's page component must not import `Route`
back from its route module. It uses `useSearch({ from })`,
`useNavigate({ from })` and `useParams({ from })` instead of
`Route.useSearch()` and the like. Either mistake fails `pnpm check:bundle`
([Error tracking](#error-tracking)).

## Boot

This section is the start-up sequence, from the first byte of `index.html`
to the first rendered page.

`index.html` loads three blocking scripts in its `<head>`, then the bundle:

1. `public/theme-init.js` sets the `dark` class from `localStorage` before
   the first paint.
2. `public/boot-variant.js` sets `data-boot="auth"` on `<html>` for an auth
   path, so the boot shell draws the centred card instead of the app frame.
3. `/runtime-config.js` sets `window.__APP_CONFIG__`
   ([run-time config](#the-container-and-run-time-config)).
4. `src/main.tsx` is the module entry. Until React's first commit replaces
   it, `#root` holds a static boot shell, styled by inline CSS in
   `index.html`.

`src/main.tsx` runs in this order:

- **`@/lib/zod-jitless` is the first import**, before any module builds a
  Zod schema. [CSP and headers](SECURITY.md#csp-and-headers) explains why,
  in terms of the Content Security Policy (CSP). `tests/setup.ts` and
  `e2e/harness/harness.tsx` import it first for the same reason. So does
  every source file that imports Zod as a value, because the entry's own body
  runs after every chunk it imports: its first import alone does not run
  before a schema built in one of those chunks.
  `tests/unit/lib/zod-jitless.test.ts` and `pnpm check:bundle` fail when a
  file or a chunk misses it.
- **`@/observability/errors/install` is the second import**, so the window
  `error` and `unhandledrejection` listeners exist before the rest of the
  app's modules evaluate.
- **Importing `@/router` builds the app.** At module evaluation,
  `src/router.tsx` creates the `QueryClient` (queries fresh for 30 seconds,
  one retry) and the router. It subscribes three hooks to the router:
  page-view analytics, the `$feature/*` sync and the error reporter's route
  source ([Router hooks](#router-hooks-this-app-only)).
- **`router.load()` runs before React mounts.** The root route's
  `beforeLoad` awaits `bootstrapSession()`, so the router resolves the first
  match against a settled session. `_app`'s loader waits for the flags, for
  at most 10 seconds. React mounts once two things have settled:
  - the load, whether it resolved or rejected;
  - the pending templates' chunks, or 3 seconds, whichever comes first.

  Mounting earlier would blank the boot shell: `createRoot().render()` clears
  `#root`, and the router renders nothing until it has a match. The boot
  waits for nothing else; the page shows its template while its reads load
  ([boot.md](docs/pages/boot.md)).

- **`initAnalytics()` runs after that first load**, so the identity that the
  session restore queued is applied before posthog-js sends anything.
  PostHog is the product-analytics and error-tracking service; posthog-js is
  its browser library.

**`bootstrapSession()` runs once per page load.**

1. It installs the cross-tab logout listener and the analytics identity
   subscription.
2. It calls `ensureSession()`. Whether the refresh succeeds or fails, the
   store is marked bootstrapped.
3. When the load ends with no user, it drops any person posthog-js still
   holds from an earlier visit, and the `$feature/*` properties with it. The
   one exception: the refresh failed without an auth verdict, and another
   open tab answers that it is signed in as that person.

The access token is memory-only, so every page load starts signed out and
restores the session this way
([Token storage and refresh](SECURITY.md#token-storage-and-refresh)).

**The root route** renders the page's head tags, the page and the toast host.

- The toast UI (`src/components/ui/toast.tsx`) is a lazy chunk.
  `ToastHost` fetches it when the root route first renders.
- `toast.*` from `src/lib/toast.ts` is small and sits outside that chunk. It
  queues the newest 10 toasts raised before the UI has mounted, plus those
  raised in the UI's first 100 ms. It replays them in order once the empty
  live region has been in the document for 100 ms. Screen readers can skip
  toasts inserted together with their live region; the delay avoids that.
- A failed chunk load is reported as a `chunk_load` error and leaves the page
  without toasts.

Beside the router, `src/main.tsx` mounts the TanStack Query and Router
devtools. They load only in development; a production build drops them.

## Routing and data loading (this app only)

This section covers how a URL becomes a page: the route groups and their
guards, the settings paths, sign-in landings, and how loaders, queries and
page states fit together.

Routes are files under `src/pages/`. Route files prefixed `__`, `_` or `$`
(`__root.tsx`, `_app.tsx`, `$tenantId.members.tsx`) follow TanStack Router's
naming, not the kebab-case rule the rest of `src/` follows.

| Route group                                                                                    | Guard                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/_app` (every staff page)                                                                     | Not signed in: redirect to `/login?redirect=<href>`. Signed in without a platform role: redirect to `/no-access`. Its loader reads the app's flags first.                                                                                                                                   |
| `/_auth` (login)                                                                               | Signed in: redirect to Overview. There is no public sign-up.                                                                                                                                                                                                                                |
| `/`                                                                                            | Redirects in `beforeLoad`: signed in to Overview, anyone else to `/login`.                                                                                                                                                                                                                  |
| `/no-access`                                                                                   | Not signed in: redirect to `/login`. Staff: redirect to Overview.                                                                                                                                                                                                                           |
| `/auth/callback`, `/auth/link`, `/auth/confirm`, `/invitations/accept`, `/invitations/confirm` | None. These open from Google or from a mailed link, often in a tab that is already signed in, so each page decides for itself; `_auth`'s guard would bounce a visitor the page has just signed in. `/auth/confirm` needs the session that asked for the link, and posts nothing signed out. |
| `/register`, `/forgot-password`, `/reset-password`, `/verify-email`                            | Redirect in `beforeLoad` to `/login?notice=sign-in-link`, dropping any `?token=`. Old mailed links and bookmarks still reach them.                                                                                                                                                          |
| `/$`                                                                                           | None. The splat route renders `RouteNotFound` inside its own `<main>`.                                                                                                                                                                                                                      |

**The Settings area** is `/settings` and its pages, all under `/_app`, so the
staff guard covers them:

- `/settings`, a landing page that lists every section;
- `/settings/account/profile` and `/settings/account/security`;
- `/settings/platform/staff`, `/settings/platform/flags` and
  `/settings/platform/maintenance`.

The layout, `src/pages/_app/settings.tsx`, renders each page's one `h1` from
the active section, so the pages render `h2`s only. Each platform page keeps
its own role gate; the navigation hides none of them by role.

Six other paths redirect into Settings in `beforeLoad`, with
`redirect({ to, search: true, hash: true, replace: true })`. A bookmark
therefore keeps its query and hash, a flags evaluation's `?userId=` included:

| From                                           | To                  |
| ---------------------------------------------- | ------------------- |
| `/profile`, `/staff`, `/flags`, `/maintenance` | Their settings page |
| `/settings/account`                            | Profile             |
| `/settings/platform`                           | Staff               |

**The guards read the auth store directly.** That is sound because the root
route's `beforeLoad` has already awaited the session restore. A guard in a
`useEffect` would see an empty store on every reload and redirect wrongly.
What the staff guard does and does not protect is in
[Staff-only access](SECURITY.md#staff-only-access).

**Sign-in on `/login`.**

- The Google sign-in button is a plain anchor to `GOOGLE_OAUTH_PATH`.
  `src/constants/routes.ts` derives it from `API_PREFIX`, so moving the
  prefix moves it too.
- That button is the one entry in `SOCIAL_PROVIDERS`. A deployment without
  Google OAuth (Open Authorization) empties the list, and the page then draws
  neither the button nor the "or" divider.
- The rest of `/login` is the shared `SignInLinkForm`. It posts
  `POST /auth/link/request` with `app: 'apex'`, and the mailed link opens
  `/auth/link`.
- Every landing after a sign-in goes through `safeLanding`
  (`src/lib/landing.ts`). It returns `safeRedirect`'s answer, unless the
  decoded path is a token page (`/auth/link`, `/auth/confirm`,
  `/invitations/accept`, `/invitations/confirm`).

**Loaders start a fetch; components wait for it.** A page's loader calls
`queryClient.prefetchQuery(...)` with the same options its component's
`useQuery` uses, and does not await it. The page renders its skeleton at once
and fills in from the cache. Only the `/_app` loader awaits. It reads the
flags before the shell renders, so a flagged navigation item never flashes.
`ensureFlags` never rejects, so a failed read renders the shell with
fallbacks.

**Preloading, pending and error screens.**

- Links preload on intent (`defaultPreload: 'intent'`).
- The pending component waits 300 ms before it shows, then stays for at
  least 300 ms.
- `src/router.tsx` imports the error and not-found components statically.
  When a chunk cannot be fetched, a lazy error screen could not load either.
- The pending templates are lazy wrappers fetched at startup, and fetched
  once more if that fails (`templatesReady`), because the router preloads
  none of them.
- `RouteError` recognises a failed chunk load (`src/lib/chunk-load-error.ts`)
  and offers a reload, the only way to pick up a new deploy's file names. Any
  other error offers a retry that re-runs the loaders.

**`QueryState`** (`components/shared/query-state.tsx`) renders the
query-backed sections in one of five states: skeleton, role refusal,
retryable error, empty, or content in a `SectionBoundary`. Every list reaches
it through `DataTable`. It reads a refusal through `isRoleDenied`
(`src/lib/role-denied.ts`), which in this app is a 404, because `/platform/*`
answers 404 to a caller below the route's role. These read a query without
`QueryState`, each with its own states:

- the Overview's `SystemStatusCard`, which keeps its last answer up when a
  refresh fails;
- the detail pages' headers (a tenant's, an email's) and a tenant's Flags tab,
  which replace the page with a `LoadError`, or sit above the content;
- the Feature flags page's meta read, which gates the page, and its evaluate
  panel, evaluation and user picker;
- the owners read behind the members list, which shows a `LoadError` beside
  it, and the command palette's two searches;
- the Overview's billing alerts card, which hides itself on a 404, as the
  status card does, and shows a `LoadError` for any other failure;
- `MaintenanceBanner`, which renders nothing until it has an answer.

**Breadcrumbs** come from each route's `staticData.crumb`: a string, or a
component given the match's params, so a record page names itself once its
record has loaded. A record page whose list is a sibling route, not a parent,
declares that list as `crumbParent`. The types are the module augmentation
in `src/router.tsx`. `AppLayout` builds the trail from the matches.

**Page titles** are set per route through `head` and `pageTitle`
(`src/constants/app.ts`), and are always fixed words
([Analytics privacy](SECURITY.md#analytics-privacy) says why).

**Queries** live in `src/queries/`, one file per resource. Most files export a
key factory and their options or hooks; the rest reuse another file's keys.

- `unwrap` (`src/http/client.ts`) returns the `data` of the API's success
  envelope.
- The helpers in `src/lib/api-error.ts` read failed requests.
- A form maps the API's field errors onto its inputs through
  `useServerErrors`.

Four rules shape the reads and their cache keys:

- **A 404 under `/platform/*` is a refusal, not a miss.** Staff queries test
  it with `isRoleDenied` (`src/lib/role-denied.ts`). What follows from that is
  in [Staff-only access](SECURITY.md#staff-only-access).
- **Lists and details are keyed apart.** A list key sits under its plural
  prefix (`['platform', 'tenants']`, `['platform', 'users']`), and a record
  under the singular one (`['platform', 'tenant', id]`). Refreshing a list
  therefore never refetches an open record. After a staff write,
  `invalidateDirectory` marks both stale, together with every tenant's own
  routes, the platform audit log, onboarding, the plans' tenant counts and
  the email queries, because a write may change what any of them show.
- **A tenant's own routes are keyed by slug and id.** `/tenants/:slug/*`
  answers what the tenant's members see. A tenant opened from its staff page
  adds its id to the key (`tenantKeys` in `src/queries/tenant.queries.ts`).
  The reason: archiving frees a slug for reuse, and a later tenant with that
  slug must never be shown the archived one's cached members. `useMyRole`
  reads the caller's role and access path off that detail, and every
  role-gated control on a tenant reads `useMyRole`.
- **Lists page by cursor.** Every list keeps its search, filters, sort,
  cursor and column choice in the URL, validated by its route's search
  schema, so a reader can share and reload a view. [Lists](#lists) has the
  contract.

## Lists

This section is the contract every list page follows, and the steps to add a
list. Every list page renders through one table, `DataTable`
(`components/shared/data-table/`), over one URL contract and one query shape.
The code is shared with react-boilerplate
([Sibling sync](#sibling-sync-with-react-boilerplate)).

Lists use the API's list contract:

- **In:** `?search`, `sort` (a leading `-` is descending), `cursor`,
  `direction`, `limit` and each list's filters.
- **Out:** `{ items, page, total? }`, where `page` is `{ nextCursor,
  prevCursor, hasNext, hasPrev, limit }`.

**The URL contract.** A list is declared once, at module scope, with
`defineList` (`schemas/list.schemas.ts`). The declaration holds:

- its sort whitelist (the first key is the default);
- its filters: `listFilter` for a comma list of known values,
  `booleanFilter`, `idFilter` and `dayFilter`;
- the `table` name its analytics events carry;
- optionally, `extra`: the route's own params.

The result's `schema` is the route's `validateSearch`. The shared fields are
`search`, `sort`, `cursor`, `direction` (`prev` only), `limit` (20, 50 or 100)
and `hidden` (column ids, a comma list).

- Every field is `.optional().catch(undefined)`: the schema drops a malformed
  value and never shows an error page.
- Defaults are left out of the URL and the request, so a default view's URL
  has no list params. A route whose `extra` params have defaults strips them
  with `stripSearchParams`.
- A second list on one route sets a `prefix` (`invitationsSearch`,
  `invitationsSort`). The first list names it in `also`, so the route's one
  schema keeps both lists' params.

**The request.** `listValues` reads a validated search into a list's values,
and `listRequest` turns them into the API request. Both live in
`schemas/list-request.schemas.ts`, which only the table loads, so a route's
schema stays small. `listQueryOptions` (`queries/list.queries.ts`) is the one
query shape:

- The key is `[...key, 'list', request]`.
- The first page (no cursor) also asks for `total=1`. The API caps the total
  at 1,000 (`capped: true` reads "1,000+ results").
- `placeholderData: keepPreviousData` keeps the previous rows up, marked
  busy, while the next view loads.
- `total: false` leaves `total=1` off, for a read that never uses the total,
  such as the bell's preview. It is part of the cache key (`'no-total'`), so
  that page never stands in for one with a total.
- `retryList` is the default retry: once, except that a 4xx other than 408
  and 429 is final (a refused param, cursor or role, or a missing route). A
  list passes no `retry` of its own.

**`useListSearch(definition)`** is one list's URL state and its writes.

- Any write except paging and column choice drops the cursor and direction,
  because a cursor belongs to the view it was cut from. Hiding a column keeps
  the page.
- Typing a search replaces the history entry. Every other write (a filter, a
  sort, a page size, a page) pushes one.
- A default is written as no key.
- It fires `table_filtered`, `table_sorted` and `table_paged`, naming the
  list and never a value.
- "Showing 21-40" counts from a page index this tab recorded as the reader
  paged. `resetListPositions` forgets the indexes; `tests/setup.ts` calls it
  after each test.
- A page the API answers with no previous page is index 0, whatever was
  recorded.
- A `prev` page with no next page has no known position, so "Showing" is
  left out rather than wrong. The API gives that last-page answer to a
  cursor whose page came back empty.

**`useListQuery(list, options, { enabled })`** is the page: `items`, `page`,
the query, and the view's `total`.

- A later page keeps the first page's total through a disabled observer on
  the first page's cache entry. While a different view's first page loads,
  the total is absent, never the previous view's.
- A 400 with `code: 'CURSOR_INVALID'` on a page with a cursor means the API
  refused the cursor: tampered with, made under a rotated key, or cut from
  another view. The list drops `cursor` and `direction`, replacing the
  refused history entry, and reloads its first page. The query reads as
  pending meanwhile, so the refusal never shows as an error.
- Any other 400 is an error the table shows.

**`DataTable`** takes five required props: the columns, the query state, a
`label`, a `getRowId` and the `empty` state. The rest are optional:
`search`, `filters`, `toolbar`, `card`, `layout`, `landmark`, `rowTarget` and
`errorMessage`.

- _States_ come from `QueryState`:
  - a table-shaped skeleton inside `role="status"`;
  - a role refusal;
  - a load error with Try again, worded by the list's own `errorMessage` or
    by `{label} didn’t load. Select Try again.`;
  - the empty state;
  - the rows.

  An empty list under a search or filter says "Nothing matches these
  filters." with Reset. An empty page behind a cursor says "Nothing on this
  page." with First page. While the page on screen is the previous view's
  placeholder, an empty one shows the skeleton, never "nothing matches", and
  "Showing" is hidden.

- _Columns_ are built with `createColumnHelper<DataTableFeatures, Row>()` and
  passed as a stable array (module-level or memoized). A column's `meta`
  carries:
  - `sorts`: the API keys its header steps through;
  - `sortName`: its name in `table_sorted`;
  - `sortWords`: picks "A to Z", "oldest first" or "lowest first";
  - `label`: names a column whose header is not a string;
  - `actions: true`: marks the actions column.

  Two columns can never be hidden: the actions column and the first column
  (`canHideColumn`). A stale `?hidden=` id for such a column is ignored.
  Sorting and paging are server-side (`manualSorting`, `manualPagination`).

- _The toolbar_ holds the search box, the faceted filters with their chips,
  the Columns menu, the list's own controls (`toolbar`) and the total. The
  search box follows changes to `?search` made elsewhere (the command
  palette, a history pop). When the change is its own echo, it keeps the
  newer keystrokes. A page therefore never adds its own sync.
- _Phone cards._ Below 768 px wide, or with `layout="cards"`, the rows render
  as cards built from the visible columns. The first column is the title, and
  actions sit at the bottom.
  - A custom `card(row, { target })` replaces the card. It renders one
    `role="listitem"` and puts `target` on it as the row's focus landmark.
  - Card layout gets a "Sort by" menu in the toolbar row when any column is
    sortable. The menu offers "Default order" when no column owns the list's
    default sort, reported as `table_sorted` with `sort: 'default'`.
  - With a custom card, the Columns menu is hidden in card layout.
- _Names._ The table sits in `<section aria-label={label}>`, and its paging
  landmark is `{label} pagination`, so a page with two lists passes the axe
  accessibility checker's `landmark-unique` rule.
  - Each toolbar control is named with what it shows, then the list
    (`controlName`): "Filter by role, Members", "Columns, Members", "Reset,
    Members", "Rows per page, Members" and "Sort by, Members".
  - The name starts with the visible words, as Web Content Accessibility
    Guidelines (WCAG) success criterion 2.5.3 asks. A buttons list never
    shows two of one name.
  - "Previous page" and "Next page" keep their names, because the
    `{label} pagination` landmark names the list.
  - A parent that is already the list's named region passes
    `landmark={false}`.

**Adding a list.**

1. Define the URL contract with `defineList` next to the list's query
   options. A filter's values come from a constants module
   (`audit-action-names.ts`), not from the module that holds the labels
   (`audit-actions.ts`). That way a route's `validateSearch` does not pull
   the wording into the entry chunk.
2. Write the page's options: `(request) => listQueryOptions<Row>({ key, path,
   request })` under the resource's key prefix, so a write's invalidation
   reaches every page.
3. Write the columns with `createColumnHelper`, at module scope.
4. Set `validateSearch: list.schema` on the route (with `search: {
   middlewares: [stripSearchParams(...)] }` when `extra` has defaults).
5. In the page: `const list = useListSearch(def)`, `const query =
   useListQuery(list, options)`, then `<DataTable columns query label
   getRowId empty ... />`. Pass `errorMessage` when the list has load-error
   copy of its own.
6. Test it through `tests/unit/components/shared/data-table/list-harness.tsx`
   (`renderTestList`, `serveTestItems`, `testColumns`, `atPhoneWidth`) and
   answer in `listPage(items, page?, total?)` from `tests/fixtures/list-page.ts`.

**Bundle cost of lists.**

- Zod ships as one shared first-visit chunk, trimmed to the types used
  anywhere in the app. A Zod type therefore costs first-visit bytes once,
  wherever it is used.
- `z.number` and `z.boolean` load on the first visit, because the staff
  billing forms mirror express with them. A route's search schema may use
  them freely.
- No code uses `z.literal`. Where it would be the first use, keep `z.custom`,
  as `list.schemas.ts` does for `limit` and the yes/no filter, or measure the
  cost with `pnpm check:bundle` first.
- Keep `components/shared/data-table/**` (and TanStack Table) out of anything
  the entry imports. The switcher, the bell, `nav-secondary` and the guard
  never import from it.

The entry chunk measured 594,895 bytes before the lists adopted `DataTable`
and 589,247 bytes after, so the lists did not raise the budget. The shared
schemas' `z.custom` took bytes off. The 13 list definitions' schemas, which
every list route's `validateSearch` reaches, added 4,370 bytes. Deleting each
page's own schema, options and hooks, in the commit that adopted the table,
took the rest off. The staff billing forms raised the budget to 608,000 bytes.
`ENTRY_BUDGET_BYTES` in `scripts/check-bundle.mjs` holds the current budget
and its dated history.

### Apex's lists

This table lists every list in Apex: its definition, route and page
component.

| List                        | Definition (`src/queries/`)                                                     | Route                                   | Page                                                               |
| --------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| Tenants                     | `tenantsList`, `tenant-admin.queries.ts`                                        | `/tenants`                              | `tenants/tenants-table.tsx`                                        |
| Users                       | `usersList`, `user-admin.queries.ts`                                            | `/users`                                | `users/users-table.tsx`                                            |
| Emails                      | `emailsList`, `email.queries.ts`                                                | `/emails`                               | `emails/emails-table.tsx`                                          |
| A tenant's Emails           | `tenantEmailsList`, `email.queries.ts`                                          | `/tenants/$tenantId/emails`             | `emails/emails-table.tsx`, the tenant fixed by the page            |
| Suppressions                | `suppressionsList`, `email.queries.ts`                                          | `/suppressions`                         | `suppressions/suppressions-table.tsx`                              |
| Onboarding tenants          | `onboardingTenantsList`                                                         | `/onboarding`                           | `onboarding/onboarding-tenants-table.tsx`                          |
| Activity                    | `platformActivityList`, `audit.queries.ts`                                      | `/activity`                             | `activity/activity-table.tsx`                                      |
| A tenant's Activity         | `tenantActivityList`, `audit.queries.ts`                                        | `/tenants/$tenantId/activity`           | `activity/activity-table.tsx`                                      |
| History cards               | `historyList` (prefix `history`)                                                | `/tenants/$tenantId`, `/users/$userId`  | `history-card.tsx`, over `activity-table.tsx`                      |
| Members                     | `membersList`, `tenant.queries.ts`                                              | `/tenants/$tenantId/members`, Staff     | `tenant/members-card.tsx`                                          |
| Pending invitations         | `invitationsList` (prefix `invitations`)                                        | `/tenants/$tenantId/invitations`, Staff | `tenant/pending-invitations.tsx`                                   |
| Registered flags            | `flagsList`, `flag-inspector.queries.ts`                                        | `/settings/platform/flags`              | `flags/flag-registry-table.tsx`                                    |
| Unregistered flags          | `unregisteredFlagsList` (prefix)                                                | `/settings/platform/flags`              | `flags/unregistered-flags-table.tsx`                               |
| A tenant's state history    | `billingHistoryList` (prefix `history`), `billing-reads.queries.ts`             | `/tenants/$tenantId/billing`            | `billing/billing-history-card.tsx`                                 |
| A tenant's provider events  | `billingEventsList` (prefix `events`), `billing-reads.queries.ts`               | `/tenants/$tenantId/billing`            | `billing/billing-events-card.tsx`                                  |
| A tenant's subscriptions    | `billingSubscriptionsList` (prefix `subscriptions`), `billing-reads.queries.ts` | `/tenants/$tenantId/billing`            | `billing/billing-subscriptions-card.tsx`                           |
| Billing alerts              | `billingAlertsList`, `billing-reads.queries.ts`                                 | `/billing-alerts`                       | `billing/billing-alerts-list.tsx`, over `billing-alerts-table.tsx` |
| A tenant's tax documents    | `taxDocumentsList` (prefix `tax`), `billing-reads.queries.ts`                   | `/tenants/$tenantId/billing`            | `billing/tax-documents-card.tsx`                                   |
| A tenant's held SEZ charges | `taxHeldChargesList` (prefix `held`), `billing-reads.queries.ts`                | `/tenants/$tenantId/billing`            | `billing/held-charges-card.tsx`                                    |

Staff (`/settings/platform/staff`) is the platform tenant's Members and
Pending invitations lists, under the keys they have on a tenant's own tabs.

**A tenant's Billing tab** holds five lists, so each takes a prefix, and
`billingHistoryList` names the other four in `also`.

- The Invoices card is not a list query. Express reads invoices from the
  payment provider, forward only, with a Status filter and no search, sort or
  total. The card therefore pages with Load more and keeps the filter in
  component state.
- The billing list definitions and reads live in `billing-reads.queries.ts`,
  because a route's `validateSearch` and loader land in the entry chunk.
- The writes and the list options live in `billing-admin.queries.ts`, which
  only the billing components import. `pnpm check:bundle` fails if that
  module reaches a first-visit chunk.

**The Goods and Services Tax (GST) cards** on that tab are Tax details, Tax
documents and Held SEZ charges (SEZ: Special Economic Zone).

- They show only when the billing view says GST registration is on or the
  tenant has documents (`taxDocumentsEnabled`, `hasTaxDocuments`,
  `openHeldCharges`). They never show because a read answered 404.
- They read on mount, after the billing view. Express audits every billing
  read, so the app prefetches none of them.
- A 404 `tax_documents_disabled` on a list shows express's sentence in a
  note, never `RoleDenied`.
- A PDF, and the Plans page's GSTR-1 export (the GST return of outward
  supplies), come through react's shared `downloadFile` behind the
  Bearer token. They download on click only, because express counts a
  download as a read.
- Document, credit note, held charge and export period dates are in India
  Standard Time, as the documents print them. The rest of the tab keeps the
  tenant's time zone.

What is particular to this app:

- **Two lists on one route.** Staff and the flags page each hold two lists.
  The second takes a `prefix` (`invitations…`, `unregistered…`), and the
  first names it in `also`. The flags route's `extra` is who is evaluated
  (`userId`, `tenantId`, `app`), and `app` is stripped at its default. A
  History card prefixes with `history`, because a tenant's or a user's page
  holds other lists. The page fixes the card's own filter (`target`, or
  `tenant` and `access`), and that filter is never in the URL.
- **Onboarding's tab and window are route params, not filters.** `range` and
  `state` are the list's `extra`, stripped at their defaults (`30d`,
  `stuck`). A tab sits in the request, so each tab has its own cache entry,
  and choosing one drops the cursor.
- **Activity's `action` accepts the stored names.** The URL schema keeps
  every name the API accepts (`STORED_AUDIT_ACTIONS`, the retired ones
  included), so a link that names a retired action filters. The facet offers
  only the actions the app writes.
- **Emails' day range.** `emailsSearchSchema` drops an inverted `from`/`to`
  pair, which the API refuses with a 400.
- **Suppressions list active rows by default**, as the API does. The State
  facet shows nothing picked until the reader picks `active`, `lifted` or
  both. Any picked state is a filter, so an empty page then reads "Nothing
  matches these filters."
- **Reads that show no total** pass `total: false`:
  - the command palette and the user and tenant pickers
    (`tenantsListOptions`, `usersListOptions`). The palette also sets
    `placeholderData: undefined`, because a stale page is not its results;
  - a user's Emails card;
  - the flag registry read behind the user evaluation.

  The owners read is not a list query and asks for no total.

- **The last-owner rule under paging.** A members page holds one page, so the
  owners come from their own read (`ownersQueryOptions`: `role=owner`,
  `limit=100`, no total).
  - `ownersBesides` counts the owners other than the caller (on the platform
    tenant, only active ones), and adds one when that page has a next page.
  - While the read is pending, the last owner's controls stay locked.
  - A failed read shows its own `LoadError` with Try again.
  - The API enforces the rule regardless.
- **The flags page refuses once.** The meta read gates the page. When a list
  is refused after the page loaded (the role changed), one `RoleDenied`
  replaces the page, not one per list.
- **Search words.** Each table's placeholder promises only what express
  5.0.0's `search` matches (Tenants: name or slug; Flags: key or
  description).

## State

This table lists where each kind of client state lives and whether it
outlives the page.

| What                                              | Where                                                   | Persisted                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token, user, bootstrapped flag             | `src/states/auth.store.ts`                              | No: memory only                                                                                                                                                                                                                     |
| Command palette open, and the typed query         | `src/states/command-palette.store.ts`                   | No                                                                                                                                                                                                                                  |
| Recent tenants and users in the palette, per user | `src/components/shared/command-palette/recent-items.ts` | `localStorage` key `palette.recent.v1:<userId>`, when storage allows: kind, id, the name or email and slug the pages show, a time; at most 5 of each kind; cleared when the session ends, expiry and a dead session cookie included |
| Sidebar collapsed                                 | `src/states/sidebar.store.ts`                           | No                                                                                                                                                                                                                                  |
| Theme (`light`, `dark`, `system`)                 | `src/states/theme.store.ts`                             | `localStorage` key `theme`, read pre-paint by `theme-init.js`                                                                                                                                                                       |
| Everything the API returns                        | The TanStack Query cache                                | No                                                                                                                                                                                                                                  |
| Form state                                        | TanStack Form, per form                                 | No                                                                                                                                                                                                                                  |

Code outside React reads and writes the stores through `getState()`, as the
interceptors and route guards do, or subscribes to them. For example, the
session module follows the auth store's user to keep analytics and the flag
caches in step. The auth store's user is the profile that the session
restore or the sign-in loaded. Its `platformRole` is what the staff guard,
the navigation and the tenant tabs read.

Every `queryFn` hands TanStack Query's `signal` to `apiClient`. A cancelled
query (`cancelQueries`, or a read no observer wants any more) therefore
aborts its request on the wire. Three tests pin this:
`maintenance-mode.queries.test.tsx` and `auth.queries.test.tsx` for their
reads, and `list.queries.test.ts` for the list pages.

## The HTTP layer and session

This section covers the one HTTP client, its interceptors, and the session
module that refreshes and ends sessions.

Every REST (Representational State Transfer) call goes through `apiClient`
(`src/http/client.ts`). It is an axios instance with these settings:

- base: the relative `API_PREFIX`, `/api/v1`;
- credentials: sent;
- timeout: 30 seconds. Axios has no timeout by default, and a request that
  never answers would leave its mutation pending and its button disabled.

**The prefix is fixed and same-origin.** It is written once, as `API_PREFIX`
in `src/constants/routes.ts`. The axios base derives from it, and the
analytics proxy path repeats it. The development server proxies `/api` to
the API (`vite.config.ts`) and the container's nginx does the same, so the
app only ever calls the origin that served it.

Moving the prefix takes one change that updates:

1. `API_PREFIX`;
2. `nginx.conf`, whose `location /api/v1/collect/` hardcodes `/api/v1`;
3. for a prefix outside `/api`, also the `/api/` location and the Vite
   proxy.

There is no environment variable for the prefix. One that moved only the
axios base would leave every path that repeats or hardcodes the prefix on
the former value. This app's own user of the prefix is the Google sign-in
anchor ([Routing](#routing-and-data-loading-this-app-only)).

**Interceptors** are installed by `installInterceptors`. The two request
interceptors are independent of each other. The response interceptors run
in the order they are registered:

| Direction | Order | Interceptor                   | Does                                                                                                                                                                |
| --------- | ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request   | –     | Bearer token                  | Adds `Authorization: Bearer` from the auth store when the request has none.                                                                                         |
| Request   | –     | Trace headers                 | On a same-origin request under the prefix: a `traceparent` when the request has none (a replay keeps its own), and the analytics session id when one may be linked. |
| Response  | 1     | 401 handling                  | Refreshes and replays once on an expired token; signs out on a verdict; leaves `REAUTH_REQUIRED` to the caller.                                                     |
| Response  | 2     | `rejectMalformedJsonResponse` | Rejects a 2xx whose body is not a JSON object, such as an HTML page from a misrouted proxy.                                                                         |
| Response  | 3     | Passkey setup                 | Raises the setup flag on a 403 `PASSKEY_SETUP_REQUIRED` and rejects with the same error (`installPasskeySetupInterceptor`, `src/lib/passkey-setup.ts`).             |

`src/router.tsx` installs the passkey-setup interceptor, not
`installInterceptors`, so `src/http/` stays shared with react. The same file
gives the query client a retry predicate: a query retries once, except after
a 403 `PASSKEY_SETUP_REQUIRED` (`isPasskeySetupRequired`), which a retry
cannot change. That 403 is not a 404, so `isRoleDenied` stays false for it.

A replay goes through the whole chain again. The rules each step enforces,
and why, are in [Sign-out rules](SECURITY.md#sign-out-rules).

`traceparent` values come from `src/http/traceparent.ts`: random ids from
`crypto.getRandomValues`, flagged sampled. The browser runs no tracing
software development kit (SDK). The header only lets the API's span join a
trace the browser chose.

**The session** (`src/http/session.ts`):

- `ensureSession()` is the single entry to a refresh. Callers in a tab share
  one in-flight promise, and tabs queue on the `auth-refresh` Web Lock.
- `refreshSession()` posts `/auth/refresh`, then loads `/profile` with the
  fresh token, because the refresh returns only a token. A profile whose id
  differs from the tab's user fails the refresh with
  `SessionIdentityChangedError`.
- `useAuthStore.setToken()` swaps the access token and keeps the user. It is
  the only token swap that is not a sign-in. A "Confirm it's you" result (by
  passkey or email link, `src/queries/step-up.queries.ts`) calls it, so the
  next write carries a recent sign-in.
- `isAuthVerdict()` is the one test of whether a failure may end a session.
- `redirectToLogin()` is the one place a dead session navigates, to
  `/login?redirect=…`.
- `installAnalyticsIdentity()` subscribes to the auth store. A change of
  user resets analytics and drops every cached flag value and exposure mark
  before the next user is identified.

The `auth` BroadcastChannel carries three messages between tabs, none with
data (`broadcastAuthMessage`, `subscribeAuthMessage`):

| Message             | Posted by                                                | What a listening tab does                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logout`            | A sign-out                                               | Every tab signs out.                                                                                                                                                                                                      |
| `signed_in`         | The page that spent a sign-in or invitation-confirm link | A tab with a link out (the sign-in form's "Check your inbox", or the accept page while its confirmation link is out) restores the shared session with `ensureSession()` and moves on. A tab already signed in ignores it. |
| `step_up_confirmed` | `/auth/confirm`, after a confirmed link                  | The "Confirm it's you" dialog waiting in another tab refreshes the session, which carries the fresh `auth_time`, and retries its action once.                                                                             |

A passkey confirmation posts no message: the dialog that asked holds the
fresh token.

Why each of these holds, and what breaks if it does not, is in
[Token storage and refresh](SECURITY.md#token-storage-and-refresh) and
[Sign-out rules](SECURITY.md#sign-out-rules).

## Passkeys

This section covers the browser half of passkeys (WebAuthn credentials), the
"Confirm it's you" step-up, and the client settings that word link
lifetimes. The security rules behind them are in
[SECURITY.md](SECURITY.md#passkeys).

Express runs passkeys in one of three modes: `off`, `optional` and
`required`. The app reads the mode from the public `GET /auth/passkeys/config`
(`{ mode, rpId }`).

- `usePasskeyConfig` (`src/queries/passkey.queries.ts`) reads it without a
  bearer token. It treats any failure as `off`, including a 404 from an API
  without passkey routes.
- In `off`, the app shows no passkey button and no Passkeys section, and
  makes no other passkey request.
- Every passkey request sends `app: 'apex'` (`FRONTEND_APP`,
  `src/constants/frontend-app.ts`).

How the app handles passkeys:

- **WebAuthn code is lazy.** `src/lib/webauthn.ts` is the only importer of
  `@simplewebauthn/browser`, through one cached `import()`.
  `pnpm check:bundle` fails if the package reaches a first-visit chunk, and
  fails if no chunk holds it. The package adds nothing to the entry chunk, so
  `ENTRY_BUDGET_BYTES` does not account for it.
- **Sign-in.** `/login` shows "Sign in with a passkey" when the mode is not
  `off` and the browser supports WebAuthn.
  - The page also starts a conditional (autofill) request on the email field
    (`use-passkey-autofill.ts`). Clicking the button, sending a link or
    leaving the page cancels that request first.
  - Nobody asked for the autofill request, so a failure before a pick ends
    quietly. Such failures are the options request failing, or the browser
    refusing the request, as headless Chrome does with `NotSupportedError`.
    The button reports its own failures.
  - Express refuses a customer's passkey with 403 `PASSKEY_NO_ACCESS`. The
    page toasts express's message, stays on `/login`, starts no session and
    sends no signal to the browser.
- **Settings.** Settings › Security shows the Passkeys section
  (`passkeys-section.tsx`, `passkey-dialogs.tsx`) between Sign-in methods and
  Other sessions. It offers list, Create, Rename and Delete.
  - The section and its dialogs load on demand. A failed chunk leaves the
    rest of the page alone (`SectionBoundary` and `LazyBoundary`).
  - Create and Delete run through `useStepUp().run`.
- **Required mode.** A 403 `PASSKEY_SETUP_REQUIRED` raises
  `passkey-setup.store`, and `AppShell` swaps `AppLayout` for Create your
  passkey (`passkey-setup-screen.tsx`).
  - `finishPasskeySetup` clears the flag and re-runs the loaders, so the page
    the user opened renders without a reload.
  - The flag resets on sign-out or a switch of user, not on sign-in.
  - Apex has no notification stream, so no stream needs to stop.

### Confirm it's you

"Confirm it's you" is the step-up re-authentication dialog. `StepUpProvider`
and `useStepUp().run(action)` wrap each write that express may refuse with
401 `REAUTH_REQUIRED`: invitations and members, maintenance, and creating
and deleting a passkey.

1. The refusal opens `StepUpDialog`. An explicit cached import loads it on
   first use. A failed import rejects every waiter and closes.
2. The dialog tries the passkey first when the user has one. `NO_PASSKEY`
   goes straight to the link view.
3. It offers "Use another method": an emailed link to open in this browser,
   which lands on `/auth/confirm`. From the link view, it offers "Use your
   passkey instead".
4. Either path ends in `setToken`, and then the action runs again.

`src/lib/step-up.ts`, `step-up-presence.ts` (the `step-up-wait` lock) and
`src/hooks/use-step-up.ts` hold the shared mechanics. The link request sends
`{ app: 'apex' }`. Express answers a non-staff caller 404 `not_found`, which
`actionMessageFrom` (`src/lib/action-message.ts`) words as staff copy.

The link view states the link's expiry from the request's own answer
(`expiresAt`, written by `formatExpiry` with the time zone named). It says
the link expired when that time passes. Two answers name no expiry: a 429
`STEP_UP_LINK_COOLDOWN`, and an answer from an API older than the field. The
view then states no expiry and never says the link expired.

### Client settings

Copy that states a link's lifetime reads it from express's public
`GET /status/client-settings` (`useClientSettings`,
`src/queries/client-settings.queries.ts`, shared with react). A deployment
that changes `SIGN_IN_LINK_TTL`, `STEP_UP_LINK_TTL` or `INVITATION_TTL`
(TTL: time to live) therefore changes the copy.

- The read is public (no bearer, no refresh retry) and fresh for 1 hour.
- A 404 (an API older than the route) or a body of another shape reads as
  no settings. Any other failure rejects, and the next reader asks again.
- While there are no settings, the copy leaves the figure out ("The link
  works once.", "We email them an invitation."). It never writes a default
  into the copy.
- `src/lib/link-lifetime.ts` writes the figures as express's mail does:
  links in minutes, invitations in whole days rounded up.

Seven places read it: the sign-in form, the dead-link page, the invitation's
"Check your inbox", the confirm page's dead link, the invite cards
(`InvitationsSection`), New user and Send sign-in link.

## The staff shell (this app only)

`AppLayout` (`src/components/layouts/app-layout.tsx`) is the signed-in
layout every staff page renders in. It follows shadcn's sidebar-07 block:

- **A sidebar** that collapses to icons, with a rail to toggle it. It holds
  the Apex brand, the navigation and the account menu. The brand is a link to
  Overview, not a switcher, because staff have no tenant to switch.
- **A header** with the sidebar trigger, the breadcrumbs, the ⌘K search and,
  from the `md` breakpoint up, the theme toggle.

The layout holds these parts:

- **The navigation** comes from `src/constants/navigation.ts`: one typed list
  of pages. Each page has its sidebar group, the least platform role that
  sees it, and an optional boolean flag.
  - The sidebar groups the list (`navGroupsFor`), and the command palette
    lists it (`navItemsFor`).
  - Adding a main-nav page therefore takes four things: an entry in that list,
    a `ROUTES` entry (`src/constants/routes.ts`), a member of the `NavPath`
    union, and a file under `src/pages/_app/`.
  - An item above the user's role, or behind a flag that is off, is absent,
    not disabled.
  - `NavMain` (`src/components/layouts/nav-main.tsx`) renders each section
    with a label that folds it away. Every section starts open. The section
    holding the current page cannot be folded. Collapsed to icons, every
    item shows.
  - Below it, the bottom group (`NavSecondary`) holds one item, Settings.
- **The settings nav.** `src/constants/settings.ts` is the source of truth
  for the settings pages: `SETTINGS_GROUPS` (Account, Platform) and
  `SETTINGS_SECTIONS` (each page's path, label, description and icon).
  - It drives the settings nav, the `/settings` landing page, the settings
    layout's `h1` and the palette's settings pages.
  - Adding a settings page therefore takes three things: an entry there, a
    member of the `SettingsPath` union, and a route under
    `src/pages/_app/settings/`.
  - On `/settings/*`, the sidebar's content swaps from `NavMain` and the
    bottom group to `NavSettings` (`src/components/layouts/nav-settings.tsx`):
    Back to console, then each group's sections, listed for every staff role.
    The brand header and the account menu stay.
  - Every sidebar link, in any of the three navs, closes the phone drawer.
- **The command palette** lives in `src/components/shared/command-palette/`,
  shared with react. Apex's commands are in
  `src/components/features/command-palette.tsx`.
  - It opens with ⌘K on Apple platforms, Ctrl+K elsewhere, or the header's
    Search… button, through `command-palette.store.ts`.
  - `CommandPaletteHost`, mounted once in the layout, holds the shortcut. It
    fetches the palette's code (`palette-loader.ts`, one `import()`) at the
    first of: browser idle, the Search… button's hover or focus, or the first
    open. The entry chunk carries none of the palette's code.
  - An open that beats the fetch shows a "Loading search…" overlay. Its field
    is bound to the store's `query`, so keys typed right after the shortcut
    are kept.
  - A failed fetch closes the palette and shows a toast with a Reload action.
    Chromium keeps a failed `import()` for the page's lifetime, so there is
    no in-page retry.
  - `pnpm check:bundle` fails when a chunk with the palette's code is
    statically reachable from the entry or the host.

  The palette lists these groups:
  - **Recent**: the tenants and users whose pages were opened most recently,
    at most 5 of each. The detail pages record them
    (`src/hooks/use-record-recent.ts`), and a page that answers 404 forgets
    its entry. They live per user in `localStorage`.
    - `logout()` in `auth.store.ts` removes every `palette.recent.v1:` key
      (`clearAllRecents` in `recent-keys.ts`). It runs on sign-out, on a 401
      verdict at the cold-load restore or a refresh, and on another tab's
      logout, so recents are cleared on every session end.
    - `installRecentItems` also deletes a user's list when the signed-in
      user changes away from them.
  - **This page**: what the open page's own controls register with
    `usePaletteCommands`, in this order: the tenant actions, the user
    actions, Resend on an email, the tenant tabs, then Copy ID.
    - Each command is listed under its control's role rule and opens that
      control's dialog.
    - A dialog opened from the palette returns focus to the page heading on
      close. Resend's dialog returns focus to the Resend button when it is
      cancelled; after a resend, focus goes wherever the page sends it.
    - Each page registers its tabs and Copy ID through
      `src/components/features/page-palette-commands.tsx`, in its loaded
      branch, after its actions. The order therefore holds on a cold load,
      and nothing is registered on a 404.
  - **Go to**: the visible nav items, then Settings and every settings
    section.
  - **Tenants** and **Users**: the API's results, asked for once typing
    stops for 250 ms (`LIST_SEARCH_DEBOUNCE_MS`). Each list shows only for
    the term it was fetched for, so Enter never acts on an older term's list.
    A failed search offers Try again in place of "No results.".
  - **Theme** and **Account**: New tenant (for admins and up) and Sign out.
    - New tenant returns focus to the page's heading, or to the main
      landmark where the heading takes none.
    - A create, a New user and a Delete permanently instead ask the
      destination's `h1` to take focus (`requestArrivalFocus` in
      `src/lib/arrival-focus.ts`; `useArrivalFocus` and
      `useLeavingFinalFocus` in `src/hooks/use-arrival-focus.ts`), and that
      dialog's close restores nothing.
    - The request is a one-shot module flag, not router state, so Back
      never refocuses.

  Every choice sends `command_palette_action_run` with a fixed `action` key
  and nothing else. `ui/command.tsx` builds the palette on Base UI's
  Autocomplete.

- **One step-up dialog.** `AppShell` (below) mounts `StepUpProvider` around
  the layout, so every staff page's writes share one dialog.
  - A write that may need a recent sign-in runs through `useStepUp().run`
    (`src/hooks/use-step-up.ts`), which retries it once after the user
    confirms.
  - "Confirm it's you" asks for a passkey when the account has one. It also
    offers "Use another method", Email me a link
    (`POST /auth/step-up/link/request`, opened on `/auth/confirm`)
    ([Passkeys](#passkeys)).
  - While it waits, the action's own dialog reads "Waiting for you to
    confirm…" (`useStepUpWaiting`). The dialog holds the `step-up-wait` Web
    Lock, so the confirm page can tell whether a tab is waiting.
  - The rules are in
    [Step-up re-authentication](SECURITY.md#step-up-re-authentication).
- **The maintenance banner** under the header
  ([Maintenance admin](#maintenance-admin-this-app-only)).
- **The `$feature/*` sync**, mounted once here
  ([Feature flags](#feature-flags)).

The palette's host, the flag sync and the theme listener live in the layout,
not the sidebar. Below the `md` breakpoint the sidebar renders into a sheet
whose content unmounts while it is closed. Below `md` the theme toggle itself
moves from the header into that sheet's footer, because at 390 px wide the
header has no room for it beside a full breadcrumb trail.

**`AppShell`** (`src/components/layouts/app-shell.tsx`) is the `/_app`
route's component.

- It wraps `AppLayout` in `StepUpProvider`, which owns the "Confirm it's you"
  dialog.
- In required mode, while the setup flag is raised, it renders the lazy
  Create your passkey screen in place of `AppLayout`
  ([Passkeys](#passkeys)). The URL stays the page the user opened, so after
  the passkey is created the same route renders with no reload.
- `_app`'s loader still runs its flags read. That read's 403 raises the flag
  instead of rendering an error.

Destructive and audited writes ask for a reason in `ReasonDialog`
(`src/components/features/reason-dialog.tsx`). Which writes ask, and the
bounds on the text, are in [Reason prompts](SECURITY.md#reason-prompts). A
section that may throw while rendering, such as an Overview chart, sits in a
`SectionBoundary`, so its failure replaces that section alone.

## The directory (this app only)

The Directory pages are Tenants and Users, with Staff under Settings ›
Platform. A tenant and a user each have a detail page with its own
sub-pages.

- **Tenants and Users** are lists from `GET /platform/tenants` and
  `GET /platform/users`, searched with `?search=` and filtered by state or
  status ([Lists](#lists)). Their reads and staff writes are in
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

The Onboarding page shows the activation funnel for a time window and the
tracked tenants in each state. A tenant's Onboarding tab shows its steps,
members and reminders. The queries (`src/queries/onboarding.queries.ts`) all
sit under `['platform', 'onboarding']`, so one prefix refreshes them, and
`invalidateDirectory` reaches that prefix.

The two staff writes are marking a step complete and sending a reminder.

- Each carries a reason.
- Each refreshes in `onSettled`, not `onSuccess`. A 409 such as
  `already_complete` or `reminded_recently` means the cached detail was
  stale, so the write refreshes either way.
- Each refreshes the onboarding queries, the Overview's figures (whose stuck
  count it can change) and both audit logs.
- A reminder sends tracked email, so it refreshes the email queries too.

## Feature flags admin (this app only)

The Feature flags page is a read-only inspector over the API's flag
registry; staff edit rollouts in PostHog. Its queries
(`src/queries/flag-inspector.queries.ts`) sit under `['platform', 'flags']`,
apart from the app's own flag values ([Feature flags](#feature-flags)).

- **The lists** (every staff role) are two list reads through the shared
  table:
  - `GET /platform/flags` holds each registered flag with its live state,
    with search, a Kind and a State filter, and cursor paging;
  - `GET /platform/flags/unregistered` holds the flags PostHog has that the
    registry lacks.
- **The meta read**, `GET /platform/flags/meta`, answers the trait reference
  and the flag snapshot's age, and gates the page.
- **An evaluation** (`GET /platform/flags/evaluate`, admins and up) answers
  one user's value for every registered flag, with the traits the API used.
  It can evaluate in one of the user's tenants and as one app's client. It
  is an audited read, so it has no retry and no refetch on focus or
  reconnect, and its cache is dropped when the page is left.
- **Who is evaluated** is in the URL (`?userId=`, `?tenantId=`, `?app=`;
  `src/schemas/flags.schemas.ts`), so an evaluation can be shared. A
  tenant's Flags tab evaluates one of its members in that tenant, as the
  customer app sees it.

## Analytics, flags and errors

This section covers the three observability parts: analytics, feature flags
and error tracking.

- Analytics and error tracking share one transport: the API's
  `/api/v1/collect` proxy, which forwards to PostHog.
- The app reads flags from, and reports exposures to, the API's own flag
  endpoints.
- In every case the browser never talks to PostHog.

What each part sends, masks and withholds is in
[Analytics privacy](SECURITY.md#analytics-privacy) and
[Error-tracking privacy](SECURITY.md#error-tracking-privacy).

### Analytics

`src/observability/telemetry/` is the only code that imports posthog-js,
and `telemetry.ts`, the facade, is the only module that imports it as a
value, through a dynamic `import()`. The rest of the app imports the barrel,
`index.ts`.

- **Lazy load with a queue.** `initAnalytics()` loads posthog-js once, after
  the first route load.
  - Calls made before it has loaded queue up. They replay in order when it
    loads, before any event is sent, so queued identity is applied first.
  - The queue holds 100 commands. Past that, the oldest queued event capture
    is shed. Identity, reset, group and consent calls are never shed.
  - With no PostHog key, the facade turns inert and every call is a no-op.
    This app honours no consent mode
    ([Analytics privacy](SECURITY.md#analytics-privacy)).
  - The facade swallows a throwing SDK call: analytics never fails a user
    action.
- **Page views come from the app, not the SDK.** posthog-js's own history
  page views are off. The app captures `$pageview` with `capturePageview()`,
  from this app's router hook
  ([Router hooks](#router-hooks-this-app-only)).
- **Identity follows the auth store**, through `installAnalyticsIdentity` in
  `src/http/session.ts` ([The HTTP layer and session](#the-http-layer-and-session)).
- **Passkey events.** `sign_in_completed.method` is `'link'`, `'google'` or
  `'passkey'`. `passkey_prompt_cancelled` carries only the ceremony
  (`sign_in`, `create` or `confirm`), never a passkey or its name.
- **Per-app constants** sit at the top of
  `src/observability/telemetry/config.ts`: the `app` property, the query-key
  allowlist, whether consent modes and the cross-domain handoff are
  supported, and how the identity cookie is shared. The registry of typed
  events is `event-registry.ts`. Everything else in the folder is shared
  with the sibling app ([Sibling sync](#sibling-sync-with-react-boilerplate)).
- `src/observability/identity-epoch.ts` is a counter of the calls that change
  who an event belongs to. It is a module of its own and imports nothing, so
  the entry-chunk error listener can read it without importing the facade.

### Feature flags

The API is the only flag evaluator; posthog-js does no flag work. The app
reads values per scope. `src/observability/flags/flag-scope.ts`, which each
app owns, says which scope a page reads and which endpoint answers it. This
app has one scope, `platform`: staff are evaluated with no tenant, from
`/platform/me/flags`. The `/_app` loader reads it before the shell renders.

- **The registry slice** is `CLIENT_FLAGS` in `flag-keys.ts`, also owned per
  app. It holds the API registry's entries that the app reads, mirrored by
  hand, each with its kind, variants, fallback and whether it is an
  experiment.
  - A value the server sends for a key the slice lacks is dropped.
  - A missing or invalid value becomes that flag's fallback
    (`normalizeFlags`).
  - This app's slice is empty, so every flag key type is `never` until an
    entry is added.
- **Reads.** There is one query per scope (`flag-query.ts`). It is fresh for
  5 minutes, refetched every 10 minutes and on focus once stale, and never
  retried. `ensureFlags` never rejects, so a failed read renders the page
  with fallbacks. Pages read values with `useFlagValues()` and
  `useVariant(key)` (`flag-hooks.ts`), which show the fallback while loading
  and after a failure.
- **A change of user** drops every scope's values and the exposure marks
  ([The HTTP layer and session](#the-http-layer-and-session)).
- **Exposure.** Once an experiment flag's value came from the server,
  `useVariant` on that flag reports the key, never the value, to the scope's
  `/exposures` endpoint (`exposure.ts`). Reports are batched for 50 ms, hold
  at most 10 keys per request, and go once per scope, key and value in a tab
  session. The API re-evaluates and records the exposure.
- **`$feature/*` super properties** carry each flag's value on every browser
  event. `useFeaturePropertiesSync`, mounted once in the signed-in layout,
  syncs them in a layout effect, never from a query or loader. A loader also
  runs for a hover preload, whose scope is not the page's. The app's router
  also syncs them before each page view.

### Router hooks (this app only)

`src/router.tsx` subscribes three hooks to the router. The two that touch
analytics run on committed navigations, never in a loader, because a loader
also runs for a hover preload.

- **Page views.** On `onResolved`, the router captures `$pageview` when the
  path changed; a search or filter change is not a page view. The hook is
  installed before the first load, so the landing page is counted. This app
  sets no tenant group.
- **`$feature/*` before each page view.** `installRouteFeatureProperties`
  (`flag-scope.ts`) syncs them to the platform scope's cached values on
  `onLoad`. `onLoad` fires before `onResolved` captures the page view, and
  never for a preload. This hook gives the first page view its properties,
  because that load runs before React mounts. With nothing cached, such as
  on a first load outside the staff shell, it unregisters them all.
- **The error reporter's route source**, registered with
  `setErrorRouteSource` ([Error tracking](#error-tracking)).

### Error tracking

Error tracking is split in two, so that every page pays almost nothing for
it:

- **`listen.ts`**, in the entry chunk, notes raw errors and nothing else.
  - Its sources are the window listeners, React's root `onUncaughtError` and
    `onCaughtError` (`rootErrorOptions`, passed to `createRoot`), and
    `noteError`. `noteError` takes an error the app catches that those hooks
    never see. This app has two callers: `RouteError`, and the members
    card's Leave action, which catches its failed navigation.
  - It drops repeats and buffers up to 20 errors (`ERROR_BUFFER_LIMIT`). It
    loads the reporter on the first error or when the browser is idle.
  - It imports only `identity-epoch.ts`.
  - `pnpm check:bundle` caps it at 1,024 bytes gzipped, and keeps
    `@posthog/core` and posthog-js out of the first-visit chunks.
- **`report.ts`** is lazy. It filters each error, builds a `$exception` with
  `@posthog/core`, then scrubs, caps and attributes it as
  [Error-tracking privacy](SECURITY.md#error-tracking-privacy) describes.
  - It posts batches to `/api/v1/collect/batch/` and retries a failed batch
    once.
  - On `pagehide`, it sends whatever is left by `sendBeacon`.
  - The batch, retry and cap constants are at the top of the file.
- **The reporter never imports the router.** `src/router.tsx` registers a
  route-id reader with `setErrorRouteSource`, so a crash in the router's own
  module can still be reported.
- **Releases.** `vite.config.ts` bakes `GIT_SHA` into the bundle as the
  release (`dev` when unset). The image build then:
  1. injects chunk ids into every chunk with `posthog-cli sourcemap inject`,
     offline and with no release, so an unchanged chunk keeps its bytes under
     its hashed name;
  2. uploads the hidden source maps and deletes them
     ([The container and run-time config](#the-container-and-run-time-config)).

## Maintenance admin (this app only)

Customer maintenance mode belongs to the API. This app shows its state to
staff and lets platform owners change it.

Maintenance mode does not gate staff pages. The API lets `/platform/*` and
the session routes through in both modes. It also lets platform staff
through on the customer routes this app calls (express's
`MAINTENANCE_STAFF_ROUTES`). This app therefore keeps no maintenance store,
lets no mode replace its routes, and reads no `Maintenance-Mode` response
header.

- **One query, two readers.** `maintenanceModeQueryOptions`
  (`src/queries/maintenance-mode.queries.ts`) reads
  `GET /platform/maintenance-mode` under one key. The banner in `AppLayout`
  and the Maintenance page share that key, so one poll serves both. The
  banner shows nothing while the mode is `off` or not yet known.
- **Changes run through step-up.** The owner's change and switch-off dialogs
  (`src/components/features/maintenance/`) call `useChangeMaintenanceMode`
  inside `useStepUp().run`.
  - A success cancels any read in flight and puts the answer in the cache.
    It marks the Overview's status card and the platform audit log stale.
  - A 409 conflict cancels any read in flight and reads the state once more.
    It then rejects with a `MaintenanceModeConflict` that carries that read,
    so the dialog can say what someone else saved.
- **Rules and sentences outside React** are in `src/lib/maintenance-mode.ts`:
  - which change switches maintenance on (`isSwitchOn`);
  - the banner's and the conflict's wording;
  - each queue's pause line, which the Maintenance page and the Overview's
    status card both list.

[Maintenance controls](SECURITY.md#maintenance-controls) has the poll
intervals, what a switch-on asks for, how a conflict avoids an overwrite,
and where the message and reason render.

The Overview's **System status** card ("The API over the last 15 minutes")
shows:

- the API's release;
- error tracking: enabled or not, events sent, events dropped by reason, and
  the last failed send;
- when the API sends them, a **Feature flags** section and a **Maintenance
  mode** section.

Each section gets a **Needs attention** badge when one of these holds:

| Section     | Needs attention when                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flags       | The definitions snapshot is missing or stale; a fetch failed; the property matching version is not 1; a flag is missing, unsupported or answered an unknown variant. |
| Maintenance | The API has not read the state; a reload failed; queues disagree with the mode; change notices are still waiting.                                                    |

## The container and run-time config

This section covers the container image: how the `Dockerfile` builds it,
how nginx serves the app, and how each environment's settings reach the
bundle at start.

The `Dockerfile` has two stages.

**Build stage** (`node:26-alpine`, pinned by digest):

1. Installs Corepack, then the pnpm version named by `packageManager` in
   `package.json`, then the dependencies from the frozen lockfile.
2. Downloads the `posthog-cli` binary and checks its SHA-256 hash against
   `docker/posthog-cli.sha256` before it first runs.
3. Copies the source and refuses a `.git` in the build context.
4. Runs `pnpm build`, with `GIT_SHA` as the only build argument the bundle
   reads.
5. Injects chunk ids, with no release (see [Error tracking](#error-tracking)).
6. Uploads the source maps to each project in `POSTHOG_SOURCEMAP_PROJECTS`
   (`docker/upload-sourcemaps.sh`), with the token as a BuildKit secret, then
   deletes every `.map`.

**Serve stage** (`nginxinc/nginx-unprivileged`, pinned by digest) runs as
user id 101 on port 8080. It is built for a read-only root filesystem:
everything it writes is under `/tmp`, which must be a writable tmpfs
(in-memory filesystem).

- `docker/nginx.main.conf` replaces the image's `nginx.conf`. It sets the pid
  file and temp paths under `/tmp`, the connection limits (its comments give
  the sizing), and an include of `/tmp/nginx/conf.d/*.conf`.
- `nginx.conf` is the server block, installed as a template. At start, the
  image's entrypoint runs `/docker-entrypoint.d/` in name order:
  1. `docker/05-prepare.sh` creates the render directory and validates
     `API_UPSTREAM`.
  2. `docker/10-runtime-config.sh` validates the run-time settings and
     writes `/tmp/runtime/runtime-config.js`.
  3. `docker/15-app-links.sh` validates `IOS_APP_IDS` and `ANDROID_APP_LINKS`
     and writes `/tmp/runtime/well-known/`.
  4. The stock envsubst script renders `nginx.conf`. It substitutes
     `API_UPSTREAM` and nothing else, so nginx's own variables survive.

  A failing script stops the container before nginx starts.

`nginx.conf` does five things:

- proxies `/api/` to `API_UPSTREAM`;
- gives `/api/v1/collect/` a larger request body that streams to the API,
  for session replay batches;
- serves `/runtime-config.js` from where the entrypoint wrote it;
- serves `/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json` from exact-match locations, as
  `application/json`. A variable left unset leaves its file absent, which is a
  real 404 and never `index.html`;
- answers a missing file under `/assets/` with a real 404, not `index.html`;
- falls back to `index.html` for every other path.

Each location's comment in `nginx.conf` gives its reason.
[CSP and headers](SECURITY.md#csp-and-headers) covers the source map
location.

A `map` on the URI chooses Cache-Control, not each location:

- Hashed assets are immutable for 1 year.
- `index.html`, `theme-init.js`, `boot-variant.js`, the favicon,
  `runtime-config.js` and the two app-association files are `no-store`, so a deploy never leaves a browser
  asking for asset names it removed.

The security headers, the reason no location declares an `add_header`, and
the logging choices are in [CSP and headers](SECURITY.md#csp-and-headers).

**Nothing is configured at build time.** One image digest is promoted
through every environment. A setting that differs between environments is
therefore a container environment variable read at start, never a `VITE_*`
value or a build argument. The flow:

1. `docker/10-runtime-config.sh` checks each value against its pattern and
   writes `window.__APP_CONFIG__ = Object.freeze({...})`.
2. `index.html` loads `/runtime-config.js` before the bundle.
3. `getRuntimeConfig()` (`src/configs/runtime-config.ts`), the app's only
   reader, applies the same patterns again.
   - A production bundle, including the one `pnpm preview` serves, reads
     only `window.__APP_CONFIG__`.
   - The dev server and the unit tests read the same names with a `VITE_`
     prefix from `import.meta.env`.
   - On the dev and preview servers, `scripts/runtime-config-plugin.mjs`
     renders `/runtime-config.js` from those `VITE_` names.

The two app-association variables are the exception to that flow: the browser
never reads them, so they have no `RUNTIME_CONFIG_KEYS` entry, no `VITE_` name
and no plugin entry. They touch `docker/15-app-links.sh`,
`docker/check-image.sh`, the Dockerfile, `nginx.conf`, `.env.example`'s comment
and the README.

Adding a setting takes one change that updates all of these:

- `RUNTIME_CONFIG_KEYS` and `RUNTIME_CONFIG_PATTERNS`;
- the entrypoint script, with the same pattern;
- `RUNTIME_CONFIG_NAMES` in `scripts/runtime-config-plugin.mjs`;
- `docker/check-image.sh`;
- `.env.example`;
- the README's table.

The variables and their defaults are in the
[README's run-time configuration table](README.md#run-time-configuration).
Why the values are safe to write unescaped is in
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

`docker/check-image.sh` checks a built image from outside.
[CSP and headers](SECURITY.md#csp-and-headers) lists its checks on the user,
the root filesystem, the headers, the source maps, the refused run-time
settings and the release. The script also checks two more things:

- `docker/05-prepare.sh` accepts good `API_UPSTREAM` values and refuses bad
  ones;
- the content type of the JavaScript the image serves.

## Sibling sync with react-boilerplate

`react-boilerplate`, the customer app, is the source of a set of files this app
copies byte for byte. React's `shared-core.json` is the list: every row in its
`files` and `tests` keys that names `apex` is a file this app holds as react's
exact copy. React's ARCHITECTURE.md section
[Shared core](https://github.com/mahaverick/react-boilerplate/blob/main/ARCHITECTURE.md#shared-core)
renders that list as a table and gives the rules. This app keeps no copy of the
table, so the list cannot go stale here.

### The sync check

`pnpm sync:check` (`scripts/sync-check.mjs`) checks two things:

1. Every `files` and `tests` row that names `apex` matches react's copy byte for
   byte. A finding reads `path: missing` or `path: differs from react-boilerplate`.
2. The copied `scripts/check-shared.mjs` runs without `--app`, so only the
   expo-row rules run (no browser global, no banned package, imports only
   another shared file or a declared port export). Only findings on rows this
   app holds count. An apex-only row is a byte copy, so the purity rules do not
   bind it. The check passes no `--docs`, because this file holds no table.

It reads react's working tree from `--react <dir>`, then
`REACT_BOILERPLATE_DIR`, then `../react-boilerplate` beside this repository's
root. Locally, it compares against whichever branch that checkout has, so check
out react's `main` to see what CI sees. From a git worktree, `../react-boilerplate`
does not resolve to the sibling checkout; set `REACT_BOILERPLATE_DIR`. With no
react checkout, it warns and passes, except under `CI=true`, where it fails.

CI's `sync` job checks out `mahaverick/react-boilerplate` at `main` under
`react-boilerplate/` and runs the check. It is a job of its own, so `eslint .`,
`vp check` and knip in the `lint` job never scan react's tree. `pnpm gate` runs
it after `pnpm lint:docs`.

### Rules

- **Change a shared file in react first, then copy it here** with
  `git -C ../react-boilerplate show main:<path> > <path>`. The pull request
  description says what happened in the other app ("ported in react#N", or
  "not applicable because ...").
- **Never edit a shared file here alone.** If a copy breaks this app, fix it in
  react, or move the file out of the manifest there.
- **`scrub.ts` changes in express first** ([The scrubber](SECURITY.md#the-scrubber)),
  then in react, then here.
- **`sse.ts` is react's alone.** This app has no notification stream, so it has
  no `src/http/sse.ts`, and `nginx.conf` has no stream location.
- **Shared passkey files keep react's `messageFrom`**, so they stay
  byte-identical; react has no `staffMessageFrom`. Express's passkey errors
  carry their own codes (a missing passkey is `passkey_not_found`), so the
  staff wording would not change them. ESLint's `messageFrom` ban exempts
  those files.
- **Some suites at shared paths are this app's own.**
  `tests/unit/queries/step-up.queries.test.tsx` and
  `tests/unit/components/features/step-up-staff.test.tsx` are not copies, and
  `src/lib/write-failure.ts` stays react's.

### This app's own files at shared paths

These files sit where react has a file of the same name, and the copies differ
on purpose. The sync check does not compare them.

- **Ports**, which shared files import and each app writes itself (the
  manifest's `ports` key lists their exports):
  - `src/http/client.ts` and `src/http/session.ts`. They match react's today:
    this app's session holds no maintenance state, and nothing under
    `src/http/` reads the `Maintenance-Mode` header.
  - `src/ports/runtime.ts`, `src/ports/navigation.ts` and
    `src/ports/webauthn.ts`, also equal to react's. No file here imports
    `navigation.ts` yet; it exists because the manifest declares it.
  - `src/constants/frontend-app.ts` (`FRONTEND_APP`),
    `src/observability/flags/flag-keys.ts` and `src/states/auth.store.ts`.
    `src/lib/toast.ts` and `src/observability/telemetry/index.ts` are ports
    too, but this app holds them as byte copies.
  - `tests/support/runner.ts`, the runner port shared tests take their test
    functions from.
- **Seam files** that shared passkey files import:
  `src/lib/action-message.ts` (`actionMessageFrom` is `staffMessageFrom` here)
  and `tests/mocks/setup-refusal.ts` (it refuses `GET /api/v1/platform/me/flags`).
- **Copy.** This app says "tenant" to staff where react says "workspace" to
  customers, so `src/components/features/tenant/role-error.ts` and
  `src/lib/role-denied.ts` (a 404 here, a 403 in react) are this app's own.
- **Container files.** `Dockerfile`, `docker/check-image.sh`, `nginx.conf` and
  `tests/unit/docker/nginx-conf.test.ts` are per-app. Their shared parts are
  ported by hand: the security headers and CSP (without react's Razorpay
  hosts), the `/api/v1/collect/`, Google callback, `/runtime-config.js` and
  `.well-known` locations, the cache map, and `check-image.sh`'s checks of each.
- **`src/types/api.types.ts`.** The files differ, but the `ClientSettings`
  interface matches react's, and every type a shared file imports from it
  exists here.

### Shared in part

These paths are not in the manifest, so the sync check does not compare them.
Keep the shared part in step by hand, in the same pull request as react's
change. React's
[Shared in part](https://github.com/mahaverick/react-boilerplate/blob/main/ARCHITECTURE.md#shared-in-part)
table lists the rest.

- `scripts/check-bundle.mjs`, except `ENTRY_BUDGET_BYTES` (each app's measured
  budget) and this app's `BILLING_ADMIN_MODULE` rule.
- `vitest.config.ts`'s React Compiler plugin block.
- `index.html`'s `<style id="boot-shell">` block and `#root` markup, not its
  `<style id="boot-tokens">` colours.
- `pnpm-workspace.yaml`, `e2e/nginx/cors.test.ts` and `scripts/lint-docs.mjs`.
- `src/observability/telemetry/config.ts`'s shared constants and
  `event-registry.ts`'s guards; each app keeps its own registry.
- `tests/unit/observability/telemetry/url-sanitizer.test.ts` and the
  `tests/unit/http/` suites, which test shared files with this app's mocks.

The error scrubber is also held in step with express-boilerplate; see
[The scrubber](SECURITY.md#the-scrubber).

## Deploy

This section covers what the deploy pipeline, `.github/workflows/deploy.yml`,
does for each trigger:

- **A push to `main`:**
  1. runs `ci.yml` as a gate;
  2. the `image` job builds the image once and pushes it to the GitHub
     Container Registry (GHCR) as `sha-<commit>` and `main`, with a software
     bill of materials (SBOM) and a provenance attestation;
  3. runs the `deploy` job, bound to the `production` environment. That job
     is a placeholder until a deployment target is chosen.
- **A `vX.Y.Z` tag**, pushed by the release workflow, builds nothing. The
  `promote` job waits for `main`'s `sha-<commit>` image and adds `X.Y.Z`,
  `X.Y` and `X` to that same digest.
- **A manual dispatch from another branch** pushes the sha-tagged image
  only. The `main` tag and the `deploy` job run only from `main`.

A release promotes a digest instead of rebuilding, so source maps are
uploaded only when an image is built. The README's
[Source maps](README.md#source-maps) gives the consequence. The one-time
repository setup, the release flow and the one-origin rule for deployments
are in the README's [Deploying](README.md#deploying) and
[Releases](README.md#releases) sections.
