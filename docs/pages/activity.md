# Activity

The platform activity log across every tenant (`/activity`), for admins and owners. One tenant's log is its [Activity tab](tenants.md#tenantstenantidactivity--activity). Back to the [route map](README.md#route-map).

## Pages

### `/activity` — Activity

![Activity](img/activity/activity--default.jpg)

|                     |                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Every change and every staff visit, across all tenants, newest first, filtered by tenant, action, actor and staff access.                                                                                                                                                                                                                                                                                         |
| File                | `src/pages/_app/activity.tsx`                                                                                                                                                                                                                                                                                                                                                                                     |
| Guard and redirects | `_app`; below admin the page renders `PlatformNotFound` ("Page not available", "This page does not exist, or it is not available to your account." and Back to the overview) and makes no request. The nav item (Activity log) is hidden below admin.                                                                                                                                                             |
| Layout              | `AppLayout`                                                                                                                                                                                                                                                                                                                                                                                                       |
| Data                | no loader: on mount, `GET /platform/audit-log?tenantId&action&actorUserId&access&cursor&limit=50` (`['platform', 'audit-log', filters]`, infinite, `staleTime` 0) and `GET /tenants/platform/members` (`['tenants', 'platform', 'members']`) for the actor list. The tenant filter, while open, searches `GET /platform/tenants?q&limit=20` (`['platform', 'tenants', 'search', q]`, infinite, debounced 250 ms). |
| Sections            | One **Activity** card holding the `h1`, "Every change and every staff visit, across all tenants, newest first.", the filters (a tenant `Combobox` with Clear, an action `Select`, a who-acted `Select` of staff members, a Staff only `Switch`), and `ActivityList` with "in {tenant}" on each row and Load more activity                                                                                         |
| Components          | `Card`, `Combobox`, `Select`, `Switch`, `Label`, `Button`, `ActivityList`, `Skeleton`, `LoadError`, `RoleDenied`; `EmptyState` (compact); hand-rolled: the entry list                                                                                                                                                                                                                                             |
| Transitions         | an actor → `/users/$userId`; View tenant → `/tenants/$tenantId`; View user → `/users/$userId`                                                                                                                                                                                                                                                                                                                     |

The filters live in component state, not the URL. The who-acted list comes from the staff members read; when that read fails, the select offers only "Anyone" and nothing says why (from the code). The default shot is the full first page: 50 entries and Load more activity, about 4,800 px tall.

| Loading                                        | Error                                                                                                                                | Empty                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| ![](img/activity/activity--loading.jpg)        | ![](img/activity/activity--error.jpg)                                                                                                | ![](img/activity/activity--empty.jpg)          |
| skeleton · the card and filters over 2× `h-14` | alert · `LoadError` "We could not load the activity, so none is listed here. This is not a sign that there is none." inside the card | log stubbed empty: "Nothing has happened yet." |

| Role-denied                                                               |
| ------------------------------------------------------------------------- |
| ![](img/activity/activity--role-denied.jpg)                               |
| A viewer: the "Page not available" card; no audit-log or members request. |

Findings: [F-activity-1](findings.md#f-activity-1), [F-activity-2](findings.md#f-activity-2), [F-activity-3](findings.md#f-activity-3), [F-overview-4](findings.md#f-overview-4), [F-overview-7](findings.md#f-overview-7)
