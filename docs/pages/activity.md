# Activity

The platform activity log across every tenant (`/activity`), for admins and owners. One tenant's log is its [Activity tab](tenants.md#tenantstenantidactivity--activity). Back to the [route map](README.md#route-map).

## Pages

### `/activity` — Activity

![Activity](img/activity/activity--default.jpg)

|                     |                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Every change and every staff visit, across all tenants, newest first, filtered by tenant, action, actor and staff access.                                                                                                                                                                                                                                                                          |
| File                | `src/pages/_app/activity.tsx`                                                                                                                                                                                                                                                                                                                                                                      |
| Guard and redirects | `_app`; below admin the page renders `PlatformNotFound` ("Page not available", "This page does not exist, or it is not available to your account." and Back to the overview) and makes no request. The nav item (Activity log) is hidden below admin.                                                                                                                                              |
| Layout              | `AppLayout`                                                                                                                                                                                                                                                                                                                                                                                        |
| Data                | no loader: on mount, `GET /platform/audit-log?tenant&action&actor&access&search&sort&cursor&direction&limit` (`['platform', 'audit-log', …]`, `staleTime` 0) and `GET /tenants/platform/members` (first hundred, the Actor facet). The Tenant facet searches `GET /platform/tenants?search&limit=20` (no total), debounced 250 ms. Every filter, the search, the sort and the page are URL params. |
| Sections            | One **Activity** card holding the `h1`, "Every change and every staff visit, across all tenants, newest first.", and `ActivityTable`: a search box, the Tenant, Action, Actor and Access facets, a sortable When column, the Tenant column and Next page / Previous page                                                                                                                           |
| Components          | `Card`, `ActivityTable` (`DataTable`, `Badge`, `Tooltip`), `DataTableChip`, `RoleDenied`, `EmptyState` (compact)                                                                                                                                                                                                                                                                                   |
| Transitions         | an actor → `/users/$userId`; View tenant → `/tenants/$tenantId`; View user → `/users/$userId`                                                                                                                                                                                                                                                                                                      |

Every filter lives in the URL, so Back undoes one. The Actor facet lists the first hundred staff by name; a URL naming another actor still filters, and its chip resolves the name. When the staff read fails, the facet says "Actor could not be loaded." and offers Try again.

| Loading                                        | Error                                                                                                                                | Empty                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| ![](img/activity/activity--loading.jpg)        | ![](img/activity/activity--error.jpg)                                                                                                | ![](img/activity/activity--empty.jpg)          |
| skeleton · the card and filters over 2× `h-14` | alert · `LoadError` "We could not load the activity, so none is listed here. This is not a sign that there is none." inside the card | log stubbed empty: "Nothing has happened yet." |

| Role-denied                                                               |
| ------------------------------------------------------------------------- |
| ![](img/activity/activity--role-denied.jpg)                               |
| A viewer: the "Page not available" card; no audit-log or members request. |

Findings: [F-activity-1](findings.md#f-activity-1), [F-activity-2](findings.md#f-activity-2), [F-activity-3](findings.md#f-activity-3), [F-overview-4](findings.md#f-overview-4), [F-overview-7](findings.md#f-overview-7)
