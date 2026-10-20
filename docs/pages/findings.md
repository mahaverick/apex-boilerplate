# Findings

Each finding: where, what is wrong, evidence, and the part that fixes it.

The tag names the work that fixes it: `[P2 loading]` boot and loading states, `[P3 shadcn]` the shadcn refresh, `[P4 table]` the data table, `[P5 palette]` the command palette, and `[UX]` a copy or flow change outside those.

## Summary by part

[P2 loading]

- [F-boot-1](#f-boot-1), [F-boot-2](#f-boot-2), [F-auth-3](#f-auth-3), [F-auth-5](#f-auth-5)
- [F-overview-1](#f-overview-1)
- [F-tenants-2](#f-tenants-2), [F-tenants-3](#f-tenants-3), [F-tenants-4](#f-tenants-4)
- [F-users-2](#f-users-2), [F-users-3](#f-users-3)
- [F-emails-2](#f-emails-2), [F-emails-3](#f-emails-3), [F-suppressions-2](#f-suppressions-2), [F-deliverability-1](#f-deliverability-1)
- [F-onboarding-1](#f-onboarding-1), [F-onboarding-3](#f-onboarding-3), [F-activity-1](#f-activity-1)
- [F-settings-1](#f-settings-1), [F-settings-2](#f-settings-2), [F-settings-3](#f-settings-3)

[P3 shadcn]

- [F-overview-2](#f-overview-2), [F-overview-3](#f-overview-3), [F-overview-4](#f-overview-4), [F-overview-7](#f-overview-7)

[P4 table]

- [F-tenants-1](#f-tenants-1), [F-users-1](#f-users-1), [F-emails-1](#f-emails-1), [F-suppressions-1](#f-suppressions-1), [F-onboarding-2](#f-onboarding-2)
- [F-settings-4](#f-settings-4), [F-settings-5](#f-settings-5)

[P5 palette]

- [F-palette-1](#f-palette-1), [F-palette-2](#f-palette-2), [F-palette-3](#f-palette-3), [F-palette-4](#f-palette-4), [F-palette-5](#f-palette-5), [F-palette-6](#f-palette-6)
- [F-palette-7](#f-palette-7), [F-palette-8](#f-palette-8), [F-palette-9](#f-palette-9), [F-palette-10](#f-palette-10)

[UX]

- [F-auth-1](#f-auth-1), [F-auth-2](#f-auth-2), [F-auth-4](#f-auth-4), [F-auth-6](#f-auth-6), [F-auth-7](#f-auth-7), [F-auth-8](#f-auth-8), [F-system-1](#f-system-1)
- [F-overview-5](#f-overview-5), [F-overview-6](#f-overview-6)
- [F-tenants-5](#f-tenants-5), [F-tenants-6](#f-tenants-6), [F-tenants-7](#f-tenants-7), [F-users-5](#f-users-5)
- [F-activity-2](#f-activity-2), [F-activity-3](#f-activity-3), [F-settings-6](#f-settings-6), [F-settings-7](#f-settings-7)

## All findings

"The walk" below is, for boot, auth and system, two throwaway Playwright scripts run against the dev stack, signed out: three cold loads of `/login`, and a pass over `/`, `/auth/callback`, `/register` with and without a bad `?invitation`, `/no-access`, `/overview`, `/flags` and `/invitations/accept` with a bad `?token`. For the signed-in areas it is a throwaway Playwright script signed in as a fresh platform owner: the palette opened by keyboard and by the header button, searched, and failed; a tenant's Members tab with the tenant detail held for 2.5 s, then with only the members read failing; a tenant's Overview with only the audit-log read failing; and `/settings/account/profile` with `GET /profile` failing. "The capture" is `pnpm capture:pages` and its `report.json`. Its error shots fail every section of a route at once, so a single section's failure is from the walk or from the code, as each finding says. Sizes in pixels are read off the 1440 × 900 shots.

| Id                 | Route                                                                                      | Tag          | Finding                                                                                                                                                                                                        | Evidence                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| F-boot-1           | cold load                                                                                  | [P2 loading] | The splash paints unstyled in the top-left, then re-paints centred once the CSS arrives.                                                                                                                       | [frames](boot.md#frame-by-frame)                                              |
| F-boot-2           | cold load of an `_app` page                                                                | [P2 loading] | The session restore and the flags read hold the whole screen on the boot shell, with no staff shell or progress; the flags wait is capped at 10 s, the session restore is not.                                 | [boot](boot.md#what-happens)                                                  |
| F-auth-1           | `/verify-email`                                                                            | [UX]         | Without `?token` the page shows the form with an empty token field, where the other mailed-link pages say the link is incomplete.                                                                              | [page](auth.md#register-forgot-password-reset-password-verify-email--retired) |
| F-auth-2           | `/verify-email`                                                                            | [UX]         | The verification token is shown as an editable text field the user has no reason to read or change.                                                                                                            | [page](auth.md#register-forgot-password-reset-password-verify-email--retired) |
| F-auth-3           | `/invitations/accept`                                                                      | [P2 loading] | The loading card has a different title and about 60% of the height of the card that replaces it, so the page jumps when the preview lands.                                                                     | [shots](auth.md#invitationsaccept--accept-an-invitation)                      |
| F-auth-4           | `/invitations/accept`                                                                      | [UX]         | The error state says "We could not load this invitation" twice, in the title and again in the `LoadError` box nested inside the card.                                                                          | [shot](auth.md#invitationsaccept--accept-an-invitation)                       |
| F-auth-5           | `/register`                                                                                | [P2 loading] | The loading card is two bars about a third the height of the form that replaces it, so the card grows and re-centres when the preview lands.                                                                   | [page](auth.md#register-forgot-password-reset-password-verify-email--retired) |
| F-auth-6           | `/register`                                                                                | [UX]         | An unusable invitation leaves a card with no link or button at all, and a failed preview offers only Try again, no way back to sign in.                                                                        | [page](auth.md#register-forgot-password-reset-password-verify-email--retired) |
| F-auth-7           | `/invitations/accept`, `/register`                                                         | [UX]         | A staff invitation reads "Join Platform … as Viewer": it names the internal platform tenant, not the staff console the person is joining.                                                                      | [shots](auth.md#invitationsaccept--accept-an-invitation)                      |
| F-auth-8           | `/register`                                                                                | [UX]         | The invited address is a read-only field drawn exactly like the editable ones, under a description that already states it.                                                                                     | [page](auth.md#register-forgot-password-reset-password-verify-email--retired) |
| F-system-1         | `/$`                                                                                       | [UX]         | The not-found page has no staff shell for a signed-in user and no auth frame for a signed-out one: a bare card on a plain page.                                                                                | [shot](system.md#--not-found)                                                 |
| F-overview-1       | `/overview`                                                                                | [P2 loading] | The KPI skeletons are about 120 px tall for cards about 188 px, and the status card's `h-32` skeleton stands in for a card about 470 px, so the page grows and the status card moves when the data lands.      | [shots](overview.md#overview--overview)                                       |
| F-overview-2       | every staff page                                                                           | [P3 shadcn]  | `LoadError`, `RoleDenied` and `SectionBoundary`'s failure are hand-rolled bordered boxes: full width on a page, shrink-wrapped under a list's filters.                                                         | [shots](tenants.md#tenants--tenants)                                          |
| F-overview-3       | email, flags, deliverability                                                               | [P3 shadcn]  | Notes and warnings are hand-rolled bordered paragraphs, one look for "not set up", "suppressed", "deleted" and "no provider events" alike.                                                                     | [shots](settings.md#settingsplatformflags--feature-flags)                     |
| F-overview-4       | tenant tabs, user pages, activity                                                          | [P3 shadcn]  | Empty states inside cards and tabs are plain muted paragraphs, while the lists use `Empty`: two looks for the same state.                                                                                      | [shots](tenants.md#tenantstenantidactivity--activity)                         |
| F-overview-5       | admin-only tabs                                                                            | [UX]         | A viewer who opens an admin-only tab by URL reads "Your role can’t see this any more. If your access just changed, reload the page.", though nothing changed and Reload changes nothing.                       | [shots](tenants.md#tenantstenantidflags--flags)                               |
| F-overview-6       | `/overview`, `/deliverability` at 390 px                                                   | [UX]         | KPI cards stack one per row below 640 px, so five or seven cards fill the first screen or more before any chart.                                                                                               | [shots](deliverability.md#deliverability--deliverability)                     |
| F-overview-7       | Load more buttons                                                                          | [P3 shadcn]  | Superseded: Load more activity and Load more events said "Loading…" while pending, with no spinner; both buttons are gone (Activity pages by cursor, the timelines left in 4a).                                | [code](activity.md#activity--activity)                                        |
| F-tenants-1        | `/tenants/`, `/tenants/$tenantId/emails`                                                   | [P4 table]   | Both tables are assembled by hand per page (toolbar, cursor buttons, empty and stale-page states), with no page count, page size or column visibility, and on a phone they scroll sideways and cut columns.    | [shots](tenants.md#tenants--tenants)                                          |
| F-tenants-2        | `/tenants/`, `/tenants/$tenantId/emails`                                                   | [P2 loading] | Each list loads as one block (`h-96`, `h-64`) for a header row, twenty rows and the pagination.                                                                                                                | [shots](tenants.md#tenants--tenants)                                          |
| F-tenants-3        | `/tenants/$tenantId/*`                                                                     | [P2 loading] | Every tab renders nothing until the layout's tenant read answers, and the members, invitations, activity and flags reads start only then.                                                                      | [walk](tenants.md#layout)                                                     |
| F-tenants-4        | `/tenants/$tenantId`                                                                       | [P2 loading] | The layout's skeleton is two blocks with no header, actions or tab bar, and the tab then draws its own skeleton: two steps and a jump.                                                                         | [shot](tenants.md#tenantstenantid--tenant-overview)                           |
| F-tenants-5        | `/tenants/$tenantId`                                                                       | [UX]         | A failed tenant read leaves one "We could not load this tenant." box with no name and no way back, where the not-found state offers Back to tenants.                                                           | [shot](tenants.md#tenantstenantid--tenant-overview)                           |
| F-tenants-6        | tenant Owners and Members, Staff                                                           | [UX]         | An account with no name shows its email twice, as the name and as the email.                                                                                                                                   | [shots](tenants.md#tenantstenantidmembers--members)                           |
| F-tenants-7        | `/tenants/$tenantId` at 390 px                                                             | [UX]         | The nine-tab bar scrolls sideways with nothing to show that five tabs are off screen.                                                                                                                          | [shot](tenants.md#tenantstenantid--tenant-overview)                           |
| F-users-1          | `/users/`                                                                                  | [P4 table]   | The users table repeats the hand-assembled list, with its filters on a second row where the tenant list puts them beside the title.                                                                            | [shots](users.md#users--users)                                                |
| F-users-2          | `/users/`                                                                                  | [P2 loading] | The list loads as one `h-96` block for about 880 px of table and pagination.                                                                                                                                   | [shots](users.md#users--users)                                                |
| F-users-3          | `/users/$userId/`                                                                          | [P2 loading] | The skeleton is two full-width blocks for a page capped at `max-w-4xl` with a header and five cards, so the page narrows and grows when it lands.                                                              | [shots](users.md#usersuserid--user)                                           |
| F-users-5          | `/users/$userId/*`                                                                         | [UX]         | A user's pages have no tab bar: Flags is a button on the user page.                                                                                                                                            | [layout](users.md#layout)                                                     |
| F-emails-1         | `/emails/`                                                                                 | [P4 table]   | The emails table, its four filters and its chips are assembled by hand, with no column visibility; the User column mostly repeats the recipient.                                                               | [shots](emails.md#emails--emails)                                             |
| F-emails-2         | `/emails/`                                                                                 | [P2 loading] | The list loads as one `h-96` block for about 850 px of table and pagination.                                                                                                                                   | [shots](emails.md#emails--emails)                                             |
| F-emails-3         | `/emails/$emailId`                                                                         | [P2 loading] | The skeleton is two full-width blocks (`h-16`, `h-64`) for a `max-w-4xl` header, tab list and short timeline.                                                                                                  | [shots](emails.md#emailsemailid--email)                                       |
| F-suppressions-1   | `/suppressions`                                                                            | [P4 table]   | The table, search, state filter and cursor buttons are assembled by hand like the other lists.                                                                                                                 | [shots](suppressions.md#suppressions--suppressions)                           |
| F-suppressions-2   | `/suppressions`                                                                            | [P2 loading] | The list loads as one `h-96` block.                                                                                                                                                                            | [shots](suppressions.md#suppressions--suppressions)                           |
| F-deliverability-1 | `/deliverability`                                                                          | [P2 loading] | The KPI skeletons are about 120 px for cards about 145 px, and the provider note arrives only with the data, pushing everything down again.                                                                    | [shots](deliverability.md#deliverability--deliverability)                     |
| F-onboarding-1     | `/onboarding`                                                                              | [P2 loading] | The Tenants section is not rendered until the funnel answers, though its own read started at the same time.                                                                                                    | [shot](onboarding.md#onboarding--onboarding)                                  |
| F-onboarding-2     | `/onboarding`                                                                              | [P4 table]   | The onboarding tenants table pages with cursor buttons and filters by state tabs, assembled by hand like the other lists.                                                                                      | [shots](onboarding.md#onboarding--onboarding)                                 |
| F-onboarding-3     | `/onboarding`                                                                              | [P2 loading] | The KPI skeletons are about 120 px for cards about 176 px, and the tenants tab loads as one `h-64` block.                                                                                                      | [shots](onboarding.md#onboarding--onboarding)                                 |
| F-activity-1       | `/activity`, tenant Activity, History cards                                                | [P2 loading] | Activity lists load as two `h-14` bars for a first page of up to 50 entries.                                                                                                                                   | [shots](activity.md#activity--activity)                                       |
| F-activity-2       | `/activity`                                                                                | [UX]         | The filters live in component state: a filtered view cannot be linked, and Back or a reload drops it.                                                                                                          | [code](activity.md#activity--activity)                                        |
| F-activity-3       | `/activity`                                                                                | [UX]         | When the staff members read fails, the who-acted filter offers only "Anyone" and nothing says why.                                                                                                             | [code](activity.md#activity--activity)                                        |
| F-settings-1       | `/settings/account/profile`                                                                | [P2 loading] | The page has no error state of its own: a failed profile read is never shown.                                                                                                                                  | [code](settings.md#settingsaccountprofile--profile)                           |
| F-settings-2       | `/settings/platform/flags`, `/settings/platform/maintenance`, `/settings/account/security` | [P2 loading] | Settings pages load as single blocks: one `h-64` for four flags sections and for two maintenance cards, two bars for the security form.                                                                        | [shots](settings.md#settingsplatformflags--feature-flags)                     |
| F-settings-3       | `/settings/platform/staff`                                                                 | [P2 loading] | One failed role read shows the same alert twice, in the members card and again for the invitations.                                                                                                            | [shot](settings.md#settingsplatformstaff--staff)                              |
| F-settings-4       | `/settings/platform/staff`, tenant Members                                                 | [P4 table]   | `MembersCard` lists every member from one unpaged read, with no search; on Staff that is 60 rows, and the Actions column is cut at the card's edge. The `DataTable` needs an API change or a part 4 exception. | [shot](settings.md#settingsplatformstaff--staff)                              |
| F-settings-5       | `/settings/platform/flags`                                                                 | [P4 table]   | The registry and unregistered tables are static `Table`s from one unpaged read, with no search, sorting or column visibility. The `DataTable` needs an API change or a part 4 exception.                       | [shot](settings.md#settingsplatformflags--feature-flags)                      |
| F-settings-6       | `/settings/*`                                                                              | [UX]         | The settings pages use four widths: the header `max-w-3xl`, Profile and Security `max-w-2xl`, Staff `max-w-4xl`, Flags and Maintenance the full width.                                                         | [layout](settings.md#layout)                                                  |
| F-settings-7       | `/settings/platform/staff`                                                                 | [UX]         | The Staff page's errors say "this tenant’s members" and "your role in this tenant", naming a platform tenant the page never mentions.                                                                          | [shot](settings.md#settingsplatformstaff--staff)                              |
| F-palette-1        | ⌘K palette                                                                                 | [P5 palette] | No theme action: "theme" finds nothing.                                                                                                                                                                        | [walk](palette.md#before)                                                     |
| F-palette-2        | ⌘K palette                                                                                 | [P5 palette] | No create-tenant action for admins.                                                                                                                                                                            | [code](palette.md#before)                                                     |
| F-palette-3        | ⌘K palette                                                                                 | [P5 palette] | No sign-out action: "sign out" finds nothing.                                                                                                                                                                  | [walk](palette.md#before)                                                     |
| F-palette-4        | ⌘K palette                                                                                 | [P5 palette] | No action copies the id of the tenant, user or email open on the page.                                                                                                                                         | [code](palette.md#before)                                                     |
| F-palette-5        | ⌘K palette                                                                                 | [P5 palette] | No recents: the empty palette lists the static pages only.                                                                                                                                                     | [shot](palette.md#before)                                                     |
| F-palette-6        | ⌘K palette                                                                                 | [P5 palette] | No role-gated actions for the current page: the tenant and user actions, Resend, Lift.                                                                                                                         | [code](palette.md#before)                                                     |
| F-palette-7        | ⌘K palette                                                                                 | [P5 palette] | A tenant result shows only its name, so same-named tenants cannot be told apart.                                                                                                                               | [shot](palette.md#before)                                                     |
| F-palette-8        | ⌘K palette                                                                                 | [P5 palette] | "Settings" finds nothing, and a tenant's tabs and an email cannot be reached from the palette.                                                                                                                 | [walk](palette.md#before)                                                     |
| F-palette-9        | ⌘K palette                                                                                 | [P5 palette] | A failed search says "Some results could not be loaded." over "No results." with no retry, and an empty status line leaves a gap above the list.                                                               | [shot](palette.md#before)                                                     |
| F-palette-10       | ⌘K palette                                                                                 | [P5 palette] | The dialog's accessible description says "Search for a page or a tenant." though it also searches users.                                                                                                       | [code](palette.md#before)                                                     |

### F-boot-1

Status: fixed. The shell's CSS is inline in `index.html`, so after the browser's own blank frame the first frame is the styled shell, in both builds ([frames](boot.md#the-first-frame)). `tests/unit/boot-shell.test.ts` ("paints only colours it copied", "sizes its boxes as border-box…") and `e2e/nginx/boot-shell.test.ts` (the styled shell with the bundle blocked, in a light and a dark colour scheme) cover it.

On every cold load under `vite dev`, the splash in `index.html` showed as unstyled black serif "Loading…" in the top-left corner, with no spinner, before it jumped to the centred, styled splash. Its only styles were in `src/styles/globals.css`, which `vite dev` delivers through JavaScript after the module graph runs. A production build links that CSS in `<head>`, so production was not affected. Fix: give the splash styles that do not depend on the bundle.

### F-boot-2

Status: partly fixed. The flags wait is at most 10 s (`FLAGS_BOOT_WAIT_MS`), and the mount waits for the pending templates for at most 3 s; the session restore is still awaited before React mounts, so a slow `POST /auth/refresh` still shows only the boot shell ([frames](boot.md#what-happens)). `tests/unit/observability/flags/flag-query.test.ts` ("resolves to the fallbacks once FLAGS_BOOT_WAIT_MS passes with no answer…") covers the flags cap, and `tests/unit/components/shared/pending-templates-preload.test.tsx` ("stops waiting for a template whose chunk never settles after TEMPLATES_WAIT_MS") the templates cap.

React mounts only after `router.load()` settles (`src/main.tsx`), and `router.load()` awaits the session restore (`POST /auth/refresh`, then `GET /profile`) and, on every `_app` page, `_app`'s loader, which awaits `GET /platform/me/flags`. The flags read has no retry and falls back on failure, but it still waited for the answer, bounded only by the HTTP client's 30 s timeout (`src/http/client.ts`). While any of these is slow, the user sees only the boot shell: no staff shell, no skeleton, no sign of which page is coming. The page reads are not part of this wait. The capture held no boot request, so this is from the code. Fix: cap the flags wait, and show the shell's skeleton in place of the splash.

### F-auth-1

Status: closed. `/verify-email` and `/reset-password` redirect to `/login?notice=sign-in-link` before they render, dropping the token; there is no verification or reset page. `tests/unit/pages/retired-auth-routes.test.tsx` covers the redirects.

`/reset-password` and `/invitations/accept` without `?token` both show "This link is incomplete" and one way out. `/verify-email` without `?token` shows the normal form with a blank "Verification token" field, so a user who lost the token is asked to type something they never saw. Fix: give `/verify-email` the same incomplete-link state, pointing at the resend form.

### F-auth-2

Status: closed, as [F-auth-1](#f-auth-1): no page renders a token. Every mailed-link page carries its token in the URL and posts it without rendering it.

`/verify-email` renders the token from the link in a labelled, editable text input. The reset page carries its token in the form values without rendering it. The visible field adds a step that means nothing to the user and invites accidental edits. Fix: carry the token like the reset page does, and show the field only when there is no token.

### F-auth-3

Status: partly fixed. The loading card is shaped like the loaded one, a sentence and three bars in place of the buttons and hint, so it comes close to the loaded card's height; its title stays "Checking your invitation", since only the preview knows the tenant's name. `tests/unit/pages/invitations/accept.test.tsx` ("holds the loaded card’s height while the preview loads…") covers the shape, not the height, which jsdom cannot measure.

While the preview loads, the card is titled "Checking your invitation" and holds two skeleton bars; when it lands, the card becomes "Join {tenant}" with a sentence, two buttons and a hint paragraph. The card grows from about 165 px to about 280 px tall and its title changes, so everything in it moves. Fix: a skeleton shaped like the loaded state (title line, sentence, two button-height bars, hint lines).

### F-auth-4

Status: fixed. The title reads "We couldn’t check this invitation" and the box "Your invitation link still works. Select Try again.", so the two no longer repeat each other. `tests/unit/pages/invitations/accept.test.tsx` ("does not call a failed request "invalid", and its retry asks again") pins both.

The preview-failure state has the title "We could not load this invitation" and, inside the card, a bordered `LoadError` box whose message starts with the same sentence. Fix: shorten the box's message to the part the title does not say, or drop the box's border inside a card.

### F-auth-5

Status: closed. `/register` redirects to `/login?notice=sign-in-link` before it renders; there is no registration form to load. `tests/unit/pages/retired-auth-routes.test.tsx` covers the redirect.

`RegisterSkeleton` is the "Create an account" card over two `h-10` bars, about 190 px tall; the form that replaces it has a description, four labelled fields, the button and a sign-in line, about 555 px tall. Because `AuthLayout` centres the column, the card's top edge also moves up by about 180 px when the preview lands. Fix: a skeleton with the form's rows (description lines, four label-and-field pairs, the button).

### F-auth-6

Status: closed for `/register`, which redirects to sign-in. `/invitations/accept`'s dead invitation now offers Go to Overview signed in, and the sign-in form signed out.

When the preview answers 404, `/register` shows "This invitation can’t be used" and "Ask the person who invited you for a new one." in a card with no content, so the page has no link at all, not even back to sign in (in the walk, `?invitation=not-a-real-token` left no link or button in `<main>`). `/invitations/accept` gives the same state a "Go to the home page" button, and refuses a malformed token locally (`invitationTokenSchema`) where `/register` sends it to the API. The other failure state offers only Try again. Fix: give both failure states a way out (Back to sign in), and check the token's shape before the preview as the accept page does.

### F-auth-7

Status: fixed. For the platform tenant the accept page reads "Join the staff team", "{inviter} invited you to join the staff team as {role}." and "Joining the staff team as {address}…", and the join toast reads "You’re now on the staff team. Signed in as {address}." (`src/lib/staff-team.ts`, `land-team-joined.ts`); the registration card is gone with `/register`. `tests/unit/pages/invitations/accept.test.tsx` ("a staff invitation names the staff team…") and `confirm.test.tsx` cover it.

A staff invitation is an invitation to the platform tenant, so the accept page reads "Join Platform" and "A teammate invited you to join Platform as Viewer.", and the registration card "Create an account with {address} to join Platform.". For a new staff member, "Platform" reads as an unexplained product or team name; the console calls itself "Apex" and "Staff console". Fix: when the invitation's tenant is the platform tenant, word the title and sentence for joining the staff console.

### F-auth-8

Status: closed. `/register` redirects to sign-in, and no page shows an address in a read-only field.

The registration form shows the invited address in the description ("Create an account with {address} to join …") and again in an `Email` input marked `readOnly`, which has the same border, background and text colour as the editable name and password inputs. A user can focus it and type, and nothing changes or explains why. Fix: show the address once, as text, or give the read-only field a visibly read-only style.

### F-system-1

`src/pages/$.tsx` is a top-level route, so the not-found page renders outside both layouts: a bare card on a plain background, with no sidebar, header or search for a signed-in staff member, and without the muted auth frame for a signed-out one ([shot](img/system/not-found--default.jpg), taken signed in as staff). Fix: render the not-found card inside the shell when signed in, and inside `AuthLayout` when signed out.

### F-overview-1

Status: fixed. The five KPI skeletons are the loaded cards' height and the two chart blocks are `h-80`; the status card holds 13 rows, 476 px against 479 px loaded in a browser ([after](img/overview/overview--loading.jpg)). `tests/unit/pages/_app/overview.test.tsx` ("holds five KPI cards at the loaded cards’ height…") covers the cards, and `e2e/fixtures/sections.test.ts` ("a held system status leaves the Overview’s figures and charts") covers the status card on its own.

`OverviewSkeleton` says it is shaped like the loaded layout, and it has the right count: five `h-30` cards and two `h-74` blocks. The heights are not the loaded ones. In the shots the skeleton cards run from y 148 to 268 (120 px) and the loaded KPI cards from 148 to 336 (about 188 px); the chart blocks are 296 px against about 320 px loaded. The System status card holds one `h-32` bar under its header, about 250 px in all, where the loaded card is about 475 px. So the status card starts at y 612 while loading and at y 704 once loaded, and grows by about 220 px ([loading](img/overview/overview--loading.jpg), [loaded](img/overview/overview--default.jpg)). Fix: skeletons with the cards' real rows (label, figure, note), and a status skeleton with its label-and-value rows.

### F-overview-2

Status: fixed in #67 for `LoadError` and `RoleDenied`: each is an `Alert` with its action at full width, the two load errors on one page ([load errors](img/onboarding/onboarding--error.jpg)) and the role refusal with Reload ([role refusal](img/tenants/tenant-flags--role-denied.jpg)). The refusal shot shows it in the destructive colours, not the default variant the fix proposed. `SectionBoundary`'s failure has no after-shot; `tests/unit/components/shared/section-boundary.test.tsx` asserts it renders an alert, and nothing asserts its width.

`LoadError` (`src/components/features/load-error.tsx`), `RoleDenied` (`role-denied.tsx`) and `SectionBoundary`'s failure message are each a `div` or `p` with `rounded-md border p-4`, a muted sentence and, for the first two, an outline button. They take the width of whatever wraps them: full width on the Overview ([shot](img/overview/overview--error.jpg)), but shrink-wrapped at the left under a list's filters, because the lists wrap them in `grid justify-items-start` to put First page beside them ([shot](img/tenants/tenants--error.jpg)); the onboarding error shot shows both widths on one page ([shot](img/onboarding/onboarding--error.jpg)). Fix: one shadcn `Alert` (destructive for a failure, default for a role refusal) with its action, at full width everywhere.

### F-overview-3

Status: fixed in #67. The notes are one `Note` component with a warning, info or passive tone; only a passive note has no live region. The after-shot shows the passive not-configured note on the flags page ([after](img/settings/platform-flags--default.jpg)); that note has no icon or title, so the fix's "icon and title" is not what shipped. No shot shows a warning or info note: `e2e/contrast/contrast.test.ts` ("notes and compact empty states") renders the stale-flags and partial-preview warnings, the template-unavailable info note and the no-provider-events passive note in both themes and asserts each is present.

Notes the page wants read are hand-rolled: the email's suppression banner and its preview's template-unavailable note, the deleted-account note on a user page, the flags page's not-configured and stale notes ([shot](img/settings/platform-flags--default.jpg)), and `NoProviderEvents` on Deliverability ([shot](img/deliverability/deliverability--default.jpg)). Each is a `p` or `div` with `rounded-md border p-3 text-sm`, the same look for "informational" and "this address receives no mail". Fix: shadcn `Alert` with an icon, a title and a variant that matches the weight of the note.

### F-overview-4

Status: fixed in #67. Empty states in cards and tabs are an `EmptyState` ([after](img/tenants/tenant-activity--empty.jpg)); the compact variant in a card is graded by `e2e/contrast/contrast.test.ts` (the user emails card with no emails, both themes).

The paged lists use shadcn `Empty` (a centred title and description), but most empty states inside cards and tabs are a plain `text-sm text-muted-foreground` paragraph: "Nothing has happened in this tenant yet.", "No invitations are waiting to be accepted.", "No one has access to this tenant yet…", "Not a member of any tenant.", "None.", "No emails sent to this account yet.", the chart cards' "No sign-ups in the last …", "No flags are registered." and "The API reported no queues.". Fix: shadcn `Empty`, in its compact form inside a card.

### F-overview-5

`RoleDenied` is written for a role that dropped while a page was open: "Your role can’t see this any more. If your access just changed, reload the page." The tenant Flags tab also renders it, without a request, to anyone below admin, who has never seen it; the capture's viewer, opening the Flags tab by URL, reads that the role "can’t see this any more" and is offered Reload, which renders the same card ([shot](img/tenants/tenant-flags--role-denied.jpg)). Fix: a second wording for a page the role never had ("This tab is for platform admins."), with a way back.

### F-overview-6

The KPI grids are `sm:grid-cols-2` and up, so below 640 px every card takes a full row. On the Overview at 390 px the five cards run to about 800 px before the first chart ([shot](img/overview/overview--mobile.jpg)); on Deliverability the provider note and seven cards run past 1,000 px ([shot](img/deliverability/deliverability--mobile.jpg)). Fix: two columns from the smallest width, with the figures and labels sized to fit.

### F-overview-7

Status: superseded. Activity pages by cursor (F-activity-2), and the timelines with Load more events were removed in 4a, so neither button exists. `BusyButton` itself shows a spinner and the busy label (`tests/unit/components/shared/busy-button.test.tsx`).

The activity list’s Load more activity (before the activity table) replaces its label with the word "Loading…" while the next page loads, and nothing else marks the wait ([code](activity.md#activity--activity)). Fix: shadcn `Spinner` in the button beside its label.

### F-tenants-1

Status: fixed. `/tenants/` and the tenant Emails tab render through `DataTable`: one toolbar (search, the State facet with its chips, New tenant), sortable headers, cursor paging with a page size and “Showing”, a Columns menu, and cards on a phone. `tests/unit/pages/_app/tenants.test.tsx` (“sorts by name by default and by creation date from the header”, “filters by state through a comma list”, “pages forward and back through the API’s cursors, kept in the URL”), `tests/unit/pages/_app/tenant-emails.test.tsx` (“pages in the URL with the API cursor”) and `e2e/fixtures/lists.test.ts` (“sorting the tenants then paging keeps the sort and moves the cursor”) assert it.

`/tenants/` and the tenant Emails tab each assemble their own list: the search input, the state `Select` and New tenant in the header row; `TenantsTable` or `EmailsTable` built on TanStack Table's `useTable` with no features; a `nav` of two icon buttons, Previous page and Next page, that move `?cursor`; and their own copies of the empty, stale-page ("Nothing on this page." with First page) and failed-page states. Columns: Name, Slug, Status, Members, Created; and on the tab Recipient, Template, Status, Created, User. There is no page count, no page size, no way to hide a column, and on a phone the table scrolls sideways with the Status column cut at the edge ([shot](img/tenants/tenants--mobile.jpg)). A shared `DataTable` with a toolbar (search, filters, the primary action), server-side cursor pagination with its states, and column visibility would replace all of it.

### F-tenants-2

Status: fixed. The first page shows `DataTable`’s table-shaped skeleton (`TableRowsSkeleton`) on `/tenants/` and on the tenant Emails tab. `tests/unit/components/shared/data-table/data-table.test.tsx` ("shows a table-shaped skeleton while the first page loads") and `tests/unit/pages/_app/tenants.test.tsx` (“does not say the next term matches nothing while its page is still loading”) assert it.

While the page loads, the tenant list is one `Skeleton h-96`: 384 px from y 140, where the loaded table with twenty rows and the pagination reaches about y 990 ([loading](img/tenants/tenants--loading.jpg), [loaded](img/tenants/tenants--default.jpg)). The tenant Emails tab does the same with one `h-64`. Fix: a table skeleton with the header row and a row per expected line, which the shared `DataTable` can own.

### F-tenants-3

Status: partly fixed. The header skeleton and the tab row render while the tenant loads, and Overview, Flags, Onboarding and Emails draw their own skeletons; Members, Invitations and Activity stay blank until the tenant lands, and each of those tabs still reads the tenant it is about before its own requests ([overview](img/tenants/tenant-overview--loading.jpg), [flags](img/tenants/tenant-flags--loading.jpg), [members](img/tenants/tenant-members--loading.jpg), [onboarding](img/tenants/tenant-onboarding--loading.jpg), [emails](img/tenants/tenant-emails--loading.jpg)). `tests/unit/pages/_app/tenant-detail.test.tsx` ("shows the header skeleton, the tabs and the Overview tab’s skeleton while the tenant loads") and `tests/unit/pages/_app/tenant-flags.test.tsx` ("shows the Flags heading and the member picker’s skeleton…") cover it.

Every tab under `/tenants/$tenantId` reads `GET /platform/tenants/:id` and returns `null` until it has data, and the layout does not render its `Outlet` until then either. The Members, Invitations, Activity and Flags tabs need the slug from that detail for their own reads, so each of those reads starts only when the detail answers: a waterfall. The Emails and Onboarding tabs start their reads in their loaders, but still cannot draw. Every loading shot of a tab is therefore the layout's skeleton ([shot](img/tenants/tenant-members--loading.jpg)), and in the walk, with the detail held 2.5 s, the Members tab showed only that skeleton for 2.5 s and requested the members afterwards. Fix: render the header and tabs from the cached list row or a header skeleton, start the slug-free reads from their loaders with the id, and let each tab draw its own skeleton at once.

### F-tenants-4

Status: fixed. The layout shows the header skeleton over the real tab row, and the tab's own skeleton below it ([after](img/tenants/tenant-overview--loading.jpg), [in-app](img/tenants/tenant-overview--nav-route.jpg)). `tests/unit/pages/_app/tenant-detail.test.tsx` ("shows the header skeleton, the tabs…") covers it.

The layout's loading state is a hidden `h1`, an `h-10 w-64` bar and an `h-64` block ([shot](img/tenants/tenant-overview--loading.jpg)). The loaded layout has a title row with a badge and the Actions button, a subtitle, a tab bar, and then the tab, which may draw its own skeleton next. So a tab arrives in two steps, and the header, the tabs and the content all move once. Fix: a header skeleton with the title, subtitle, Actions and tab bar in place, and the tab's skeleton below it from the start.

### F-tenants-5

When the tenant read fails with anything but 404, the layout renders only `LoadError` "We could not load this tenant." with Try again ([shot](img/tenants/tenant-overview--error.jpg)): no tenant name (the breadcrumb says "Tenant"), no tabs, and no link back. The 404 state offers Back to tenants. Fix: keep a link back to the list in the failure state, and show the name when the list row has it.

### F-tenants-6

`TenantOwners` and `MembersCard` show a member's name, falling back to the email when the account has none, and then the email. For the many accounts with no name, the Owners card reads the same address on two lines ([shot](img/tenants/tenant-overview--default.jpg)), and the Members and Staff tables show it in both the Name and the Email column ([shot](img/tenants/tenant-members--default.jpg)). Fix: show the address once, with "No name" or nothing in the name slot.

### F-tenants-7

At 390 px the tab bar shows Overview, Members, Invitations and Activity; the other five tabs are reachable only by scrolling the bar sideways, and nothing (a fade, an arrow, a "More" menu) says they are there ([shot](img/tenants/tenant-overview--mobile.jpg)). Fix: an overflow cue or menu, or a `Select` of tabs at that width. The bar is a hand-rolled `nav` of links, not the `ui/tabs.tsx` component, so the part 3 refresh does not reach it unless the bar moves onto that component.

### F-users-1

Status: fixed. `/users/` renders through `DataTable`: the toolbar holds the search, the Status, Signed in and Staff facets and New user; headers sort; paging is by cursor; the phone shows cards. `tests/unit/pages/_app/users.test.tsx` (“sorts by email by default and by last sign-in from the header”, “labels users with no sign-in Never signed in, by last sign-in, in the badge and the facet”, “pages with the API cursors, carrying them in the URL”) and `e2e/fixtures/lists.test.ts` (“a search on Users writes ?search= and leaves the matching rows”, “Users stacks as cards with no sideways scroll”) assert it.

`/users/` is the same hand-assembled list as the tenants ([F-tenants-1](#f-tenants-1)): a search input, three filter `Select`s (status, verified, staff), New user, `UsersTable` (Email, Name, Status, Staff role, Tenants, Last sign-in) and the two cursor buttons. Its filters sit on their own row under the title, and its New user button has no icon, where the tenant list puts both in the title row with a plus icon ([shot](img/users/users--default.jpg)). On a phone the table is cut after Email ([shot](img/users/users--mobile.jpg)). Fix: the shared `DataTable`, whose toolbar puts every list's search, filters and primary action in one place.

### F-users-2

Status: fixed. The first page shows `DataTable`’s table-shaped skeleton. `tests/unit/components/shared/data-table/data-table.test.tsx` ("shows a table-shaped skeleton while the first page loads") asserts it.

While the page loads, the users list is one `Skeleton h-96`, 384 px, where the loaded table and pagination take about 880 px ([loading](img/users/users--loading.jpg), [loaded](img/users/users--default.jpg)). Fix: a table-shaped skeleton.

### F-users-3

Status: fixed. The skeleton is the header's bars over the five cards an admin sees ([after](img/users/user-overview--loading.jpg)). `tests/unit/pages/_app/user-detail.test.tsx` ("holds the user page’s header and five cards while the user loads") covers the cards.

While the user loads, the page is a hidden `h1` over an `h-16` and an `h-64` block, full width ([shot](img/users/user-overview--loading.jpg)). The loaded page is capped at `max-w-4xl` (896 px against 1136 px) and has a header with buttons and five cards, about 900 px tall ([shot](img/users/user-overview--default.jpg)). The content narrows and more than doubles in height when it lands. Fix: a skeleton inside the same `max-w-4xl` column with the header and a block per card.

### F-users-5

A tenant has a tab bar under its header; a user has none. The user page links to Flags with an outline button in its header ([shot](img/users/user-overview--default.jpg)). Fix: the same header-and-tabs layout the tenant pages use, at `/users/$userId`.

### F-emails-1

Status: fixed. `/emails` renders through `DataTable`: the recipient search, the Status and Template facets, the date range and the User and Tenant chips in one toolbar, sortable headers, cursor paging, and the Columns menu, which can hide the User column. `tests/unit/pages/_app/emails.test.tsx` (“sorts newest first by default, and by oldest first from the Created header”, “filters by two templates through one comma list”, “shows ?user and ?tenant as chips named from the listed rows, and removes them”) and `e2e/fixtures/lists.test.ts` (“a facet on Emails writes a comma list and its chip removes one value”) assert it.

The Emails list assembles its toolbar by hand: the recipient search, status and template `Select`s, the `DateRangeFilter` popover, and removable chips for the user and tenant filters, then `EmailsTable` (Recipient, Template, Status, Created, User, Tenant) and the cursor buttons ([shot](img/emails/emails--default.jpg)). For most rows the User column repeats the recipient's address, and nothing lets a reader hide it; on a phone the table is cut at Template ([shot](img/emails/emails--mobile.jpg)). Fix: the shared `DataTable` with its toolbar, filter chips and column visibility.

### F-emails-2

Status: fixed. The first page shows `DataTable`’s table-shaped skeleton. `tests/unit/components/shared/data-table/data-table.test.tsx` ("shows a table-shaped skeleton while the first page loads") asserts it.

While the page loads, the emails list is one `Skeleton h-96`, against about 850 px of table and pagination ([loading](img/emails/emails--loading.jpg), [loaded](img/emails/emails--default.jpg)). Fix: a table-shaped skeleton.

### F-emails-3

Status: fixed. The skeleton is the header's bars, the tab-list bar and four rows ([after](img/emails/email-detail--loading.jpg)). `tests/unit/pages/_app/email-detail.test.tsx` ("holds the email page’s header, tabs and timeline while the email loads") covers it.

While the email loads, the page is an `h-16` and an `h-64` block across the full width ([shot](img/emails/email-detail--loading.jpg)); the loaded page is a `max-w-4xl` column with a three-line header, the tab list and a short timeline, about 250 px tall ([shot](img/emails/email-detail--default.jpg)). Fix: a skeleton in the same column with the header lines and the tab list.

### F-suppressions-1

Status: fixed. `/suppressions` renders through `DataTable`: the address search, the State facet, sortable headers, cursor paging, cards on a phone, and Lift as the row’s action. `tests/unit/pages/_app/suppressions.test.tsx` (“sorts newest first by default, by address and by oldest first from the headers”, “keeps the state filter in the URL, and leaves the default out of it”, “pages with the API cursor, both ways”) asserts it.

The suppressions list has its own search, state `Select`, `SuppressionsTable` (Address, Reason, Source, Suppressed, State, and Lift for admins) and cursor buttons, assembled by hand like the other lists ([shot](img/suppressions/suppressions--default.jpg)). Fix: the shared `DataTable`, with Lift as a row action.

### F-suppressions-2

Status: fixed. The first page shows `DataTable`’s table-shaped skeleton. `tests/unit/components/shared/data-table/data-table.test.tsx` ("shows a table-shaped skeleton while the first page loads") asserts it.

While the page loads, the list is one `Skeleton h-96` ([shot](img/suppressions/suppressions--loading.jpg)). Fix: a table-shaped skeleton.

### F-deliverability-1

Status: partly fixed. The seven KPI skeletons are the loaded cards' 9rem, the chart skeleton is the chart card's 20rem and each breakdown skeleton is a card of three rows, as measured in a browser; the provider note depends on the figures, so its place is not held ([after](img/deliverability/deliverability--loading.jpg)). `tests/unit/pages/_app/deliverability.test.tsx` ("holds seven KPI cards at the loaded cards’ height…") covers the figures.

`DeliverabilitySkeleton` has the right parts but not the right sizes: its seven KPI blocks are 120 px tall where the loaded cards are about 145 px, and it has no slot for the `NoProviderEvents` note, which appears above the cards with the data and pushes the page down by about 70 px ([loading](img/deliverability/deliverability--loading.jpg), [loaded](img/deliverability/deliverability--default.jpg)). Fix: card skeletons at the loaded height, and the note's place held, or the note moved below the figures.

### F-onboarding-1

Status: fixed. The Tenants section renders beside the funnel from the start, and a held funnel leaves it usable ([after](img/onboarding/onboarding--loading.jpg)). `tests/unit/pages/_app/onboarding.test.tsx` ("shows the tenants by state while the funnel is still loading") and `e2e/fixtures/sections.test.ts` ("a held funnel leaves the tenants by state usable") cover it.

`OnboardingPage` renders `TenantsByState` only in the funnel's loaded branch (or its failure branch). The loader starts the tenants read alongside the funnel's, but while the funnel is pending the page shows `FunnelSkeleton` alone: no Tenants heading, no state tabs, no list skeleton ([shot](img/onboarding/onboarding--loading.jpg)). A slow funnel holds back a list that may already be loaded. Fix: render the Tenants section beside the funnel from the start, with its own skeleton.

### F-onboarding-2

Status: fixed. The Tenants section is a `DataTable` whose state tabs write `?state=`: search, sort by tenant name, cursor paging that restarts on a new tab, and Back and Forward between tabs. `tests/unit/pages/_app/onboarding.test.tsx` (“sorts any tab by tenant name through ?sort=name”, “pages with the API’s cursors, and a new tab starts from the first page”, “returns to the previous tab and its rows on Back, and to the next on Forward”) asserts it.

The Tenants section is a hand-assembled list: state `Tabs` for the filter (Stuck, In progress, Awaiting owner, Complete, Dismissed), `OnboardingTenantsTable` (Tenant, Owners, Started, Last progress, Days stuck on the stuck tab, Next required step, Progress) and the cursor buttons ([shot](img/onboarding/onboarding--default.jpg)). Fix: the shared `DataTable`, with the state tabs as its filter.

### F-onboarding-3

Status: fixed. The KPI skeletons are the loaded cards’ 11rem, the funnel block is `h-78`, and the tenants list shows `DataTable`’s table-shaped skeleton ([after](img/onboarding/onboarding--loading.jpg)). `tests/unit/pages/_app/onboarding.test.tsx` (“holds the funnel’s KPI cards at the loaded cards’ height…”, “shows the tenants by state while the funnel is still loading”) and `tests/unit/components/shared/data-table/data-table.test.tsx` ("shows a table-shaped skeleton while the first page loads") assert it.

`FunnelSkeleton`'s five KPI blocks are 120 px tall for cards about 176 px, and its `h-74` funnel block is shorter than the loaded funnel card (about 310 px); the tenants tab then loads as one `Skeleton h-64` for a table ([loading](img/onboarding/onboarding--loading.jpg), [loaded](img/onboarding/onboarding--default.jpg)). Fix: skeletons at the loaded sizes, and a table-shaped one for the list.

### F-activity-1

Status: fixed. `/activity`, a tenant’s Activity tab and the History cards render through `DataTable`, so the first page shows its table-shaped skeleton in place of the two bars. `tests/unit/components/shared/data-table/data-table.test.tsx` ("shows a table-shaped skeleton while the first page loads") asserts it.

The activity list (`ActivityList`, now `ActivityTable`) showed two `h-14` bars while the first page loaded ([shot](img/activity/activity--loading.jpg)); the first page is up to 50 entries, about 4,500 px on `/activity` ([shot](img/activity/activity--default.jpg)). The same two bars stand in for the tenant Activity tab and the History cards on a tenant and a user. Fix: as many entry-shaped rows as fill the view (name line, sentence, time).

### F-activity-2

Status: fixed. Tenant, Actor, Action and Access are facets of the table toolbar, and their values are in the URL, so a filtered view can be linked and Back undoes one filter. `tests/unit/pages/_app/activity.test.tsx` (“keeps every filter in the URL, so Back undoes one”, “narrows to what staff did with the Access facet, through ?access=platform”) asserts it.

`/activity` keeps its tenant, action, actor and staff-only filters in `useState`. A filtered view cannot be linked or bookmarked, a reload resets it, and Back leaves the page instead of undoing a filter. Every other filtered page (tenants, users, emails, suppressions, onboarding) keeps its filters in the URL. Fix: validated search params, as the other lists use.

### F-activity-3

Status: fixed. The Actor facet says the staff list could not be loaded and offers Try again. `tests/unit/pages/_app/activity.test.tsx` (“says the staff list could not be loaded, in the actor facet, and retries it”) asserts it.

The who-acted `Select` is filled from `GET /tenants/platform/members`. When that read fails, the select lists only "Anyone", and nothing on the page says the staff list could not be loaded; the capture's error shot fails it with the log, so this single failure is from the code. Fix: an inline error in the select's list, with a retry.

### F-settings-1

Status: fixed. A failed `GET /profile` with the stored profile on screen keeps the stored form with a `LoadError` and Try again above it; a profile with no stored copy cannot occur in a signed-in page, so no skeleton or loading shot is claimed. `tests/unit/pages/_app/settings/account.profile.test.tsx` ("keeps the stored profile on screen with a retry above it when the refetch fails") covers it, and `e2e/contrast/contrast.test.ts` ("profile (read failed)", which seeds the stored profile as stale and waits for the alert) grades the failed read in both themes.

`/settings/account/profile` reads the profile with `useProfile`, which paints from the session's user (`initialData`) and has no error branch: the page renders the form when there is data and two `h-9` bars when there is none, and a failed `GET /profile` is never shown. The route's `errorComponent` catches render errors only. The capture has no section for this page, so there is no loading or error shot (the report has no `errorUi` for it); in the walk, failing `GET /profile` on a full load failed the session restore and landed on `/login?redirect=%2Fsettings%2Faccount%2Fprofile`, so the page's own failure is from the code. Fix: a `LoadError` in the card when the read fails with no data, and a note when a refresh fails over shown data.

### F-settings-2

Status: partly fixed. Maintenance and Security are shaped ([maintenance](img/settings/platform-maintenance--loading.jpg); the Security shot is retaken with the passwordless page); the Feature flags page is still one `h-64` block until its tables move to the data table. `tests/unit/pages/_app/settings/platform.maintenance.test.tsx` ("holds both maintenance cards while the state loads") and `tests/unit/components/features/profile/security-section.test.tsx` ("holds the sign-in methods’ place while they load") cover them.

The Feature flags page loads as one `Skeleton h-64` for four sections that run to about 1,250 px ([loading](img/settings/platform-flags--loading.jpg), [loaded](img/settings/platform-flags--default.jpg)); Maintenance loads as one `h-64` for two cards ([shot](img/settings/platform-maintenance--loading.jpg)); Security shows an `h-5 w-40` bar and an `h-9` bar where the sign-in methods and the three-field change-password form were. Fix: a skeleton per section with its heading, so each page keeps its outline while it loads.

### F-settings-3

Status: fixed. The Staff page shows the role alert once, in the members card with its Try again, and the invitations section waits silently. `tests/unit/pages/_app/settings/platform.staff-members.test.tsx` (“shows the role failure once on the Staff page, with a Try again that retries it”) asserts it ([after](img/settings/platform-staff--error.jpg)).

On the Staff page both `MembersCard` and `InvitationsSection` call `useMyRole` for the platform tenant and each shows `ROLE_ERROR` when it fails. With the role read and the members read failing, the page shows three alerts, two of them "We could not load your role in this tenant, so its controls are hidden until we can." with their own Try again ([shot](img/settings/platform-staff--error.jpg)). Fix: one page-level role alert, with the sections below waiting on it.

### F-settings-4

Status: fixed. The members of a tenant and of the platform tenant are a `DataTable` on express 5.0.0’s paged, searchable members read: search, sort by name, email or role (joined by URL only), cursor paging, and cards on a phone, with Actions never hideable. The pending invitations are a second table with its own prefixed params. `tests/unit/pages/_app/tenant-detail.test.tsx` (“lists members in a table sorted by name, and sorts by email through ?sort=email”, “sorts invitations by email and filters them by role, in prefixed keys”) and `tests/unit/pages/_app/settings/platform.staff-members.test.tsx` (“keeps the staff search and the invitations search apart”, “keeps the invitations cursor when the staff list is paged”) assert it.

`MembersCard` renders every member of a tenant in one `Table` (Name, Email, Role, Actions) with no search, filter or paging. On the Staff page the dev database's 60 staff members make a page about 4,100 px tall, and the table is wider than its `max-w-4xl` card (`min-w-2xl` plus a role `Select` per row), so the Actions column is cut at the card's edge and its buttons read "Remo" ([shot](img/settings/platform-staff--default.jpg)). The tenant Members tab uses the same card. `GET /tenants/:slug/members` returns every member in one response, with no cursor and no search term. Part 4 names tenants, users, emails and suppressions as the lists that move onto the shared `DataTable`, and keeps ordering, filtering and paging the API's; so moving this card onto it needs either an API change (server-side search and paging on the members read) or an exception ruled in the part 4 spec. Either way, the row actions belong in a menu that fits the card.

### F-settings-5

Status: fixed. The registered and unregistered flags are two `DataTable`s on express 5.0.0’s paged, searchable flag reads, with a Columns menu, Kind and State facets on the registry, and a search each. `tests/unit/pages/_app/settings/platform.flags.test.tsx` (“searches the registry and the unregistered list apart”, “filters the registry by kind”, “filters the registry by state through the State facet”) and `e2e/fixtures/flags.test.ts` assert it.

`FlagRegistryTable` has eight columns (Flag with its description, Kind, Scope, Sent to, Fallback, State, Rollout, a PostHog link) and `UnregisteredFlagsTable` three; both are static `Table`s with no search, sort or column visibility ([shot](img/settings/platform-flags--default.jpg)). Two reference flags fit; a real registry will not. `GET /platform/flags` returns the whole registry in one response, with no cursor and no search term. Part 4 keeps ordering, filtering and paging the API's and does not name these tables, so moving them onto the shared `DataTable` needs either an API change (server-side search and paging on the flags read) or an exception ruled in the part 4 spec; column visibility alone needs neither.

### F-settings-6

The settings layout's header is `max-w-3xl`; Profile and Security are `max-w-2xl` cards ([shot](img/settings/account-profile--default.jpg)); Staff is `max-w-4xl`; Feature flags and Maintenance take the full width ([shot](img/settings/platform-maintenance--default.jpg)). Moving between sections, the content's right edge jumps between four places. Fix: one settings column width, with the wide tables allowed to break out of it.

### F-settings-7

The Staff page is the platform tenant's members and invitations, and its errors come from the tenant components unchanged: "We could not load this tenant’s members, so none are listed here. This is not a sign that it has none." and "We could not load your role in this tenant, so its controls are hidden until we can." ([shot](img/settings/platform-staff--error.jpg)). The page never mentions a tenant; it says Staff. Fix: Staff wording on this page ("the staff list", "your staff role").

### F-palette-1

The palette's items are pages only. There is no Light, Dark or System action; in the walk "theme" gave "No results." The theme menu is in the header from `md` up and in the drawer's footer below it. Fix: a Theme group with the three choices.

Status: fixed. The palette has a Theme group with Light, Dark and System, the current one marked ([palette.md](palette.md#the-command-palette)). `tests/unit/components/features/command-palette.test.tsx` ("sets the theme, marking the current one") and `e2e/fixtures/palette.test.ts` ("sets the theme from the keyboard alone") cover it.

### F-palette-2

Creating a tenant needs a trip to `/tenants/` and New tenant, which is shown to admins and up. The palette has no create action of any kind. Fix: New tenant for admins and up, opening `CreateTenantDialog`.

Status: fixed. Account lists New tenant for admin and up, opening `CreateTenantDialog` once the palette has closed ([palette.md](palette.md#the-command-palette)). `tests/unit/components/features/command-palette.test.tsx` ("offers New tenant to a %s: %s", "opens the New tenant dialog after the palette closes, with focus in it") covers it.

### F-palette-3

Signing out is in the account menu only; in the walk "sign out" gave "No results." Fix: a Sign out action.

Status: fixed. Account lists Sign out for every signed-in caller ([palette.md](palette.md#the-command-palette)). `tests/unit/components/features/command-palette.test.tsx` ("lists no pages or recents and searches nothing once the platform role is gone, but keeps Theme and Sign out", "signs out, and is disabled while the sign-out is pending") covers it.

### F-palette-4

Staff pass ids around (a tenant's or user's id in a URL, an email's id in a support thread), and no page has a copy control for its own id. The palette knows the current route but offers nothing for it. Fix: Copy tenant id, Copy user id and Copy email id when one is open.

Status: fixed. This page lists Copy tenant ID, Copy user ID and Copy email ID on their pages ([palette.md](palette.md#the-command-palette)). `tests/unit/components/features/command-palette-sources.test.tsx` ("copies the tenant’s ID", "copies the user’s ID and records them in Recent under their email", "registers Resend only when the API allows it (canResend %s)") covers it.

### F-palette-5

With no term the palette shows the same thirteen pages every time ([shot](img/palette/palette--before-default.jpg)). The tenants and users staff open most are reachable only by typing a search that goes to the API. Fix: a Recent group of the last tenants and users opened, kept per browser.

Status: fixed. Recent lists the tenants and users whose pages were opened lately, per user in `localStorage` ([palette.md](palette.md#the-command-palette)). `tests/unit/components/features/command-palette.test.tsx` ("lists recent tenants and users, newest first, a user inside Pii") and `tests/unit/components/features/command-palette-sources.test.tsx` ("records the tenant in Recent once it loads, with its slug", "forgets the tenant when its page answers 404") cover it.

### F-palette-6

The tenant actions (Edit details, Resend owner invitation, Suspend, Reactivate, Archive, Delete permanently), the user actions (Edit name, the password and verification emails, since replaced by Send sign-in link, Sign out everywhere, Deactivate, Reactivate, Delete), Resend on an email and Lift on a suppression are each reachable only from their page's own controls, and only for the roles `TenantActionsMenu`, `availableUserActions`, `canResend` and the admin check allow. Fix: a group for the page that is open, listing the same actions under the same role rules, each opening the same dialog.

Status: partly fixed. This page lists the tenant actions, the user actions and Resend under their controls' role rules, each opening the same dialog ([palette.md](palette.md#the-command-palette)). Lift stays in the Suppressions table, since it is a list row's action and the palette has no row ([out of scope](palette.md#out-of-scope)); it is a later `[P5 palette]` follow-up. `tests/unit/components/features/command-palette-sources.test.tsx` ("registers exactly the menu’s actions for a %s on a %s tenant", "registers exactly the menu’s actions for a %s (%j)", "runs Suspend from the palette: the reason dialog opens with focus, and closing it returns focus to the heading") and `e2e/fixtures/palette.test.ts` ("runs Suspend from ⌘K, and the reason dialog takes focus") cover it.

### F-palette-7

A tenant result is a building icon and the tenant's name. In the walk the term `e2e` listed five rows reading "Capture Co" ([shot](img/palette/palette--before-search.jpg)); nothing shows which is which. Users show their email and name, which do tell them apart. Fix: the slug, and the state when it is not active, beside a tenant's name.

Status: fixed. A tenant row shows its slug, and "Suspended" or "Archived" when it is not active ([palette.md](palette.md#the-command-palette)). `tests/unit/components/features/command-palette.test.tsx` ("finds tenants by name with their slug, and the state when not active, asking for no total") covers it.

### F-palette-8

The Pages group is the main nav and the five settings sections. The Settings landing page is not in it ("settings" gave "No results." in the walk), and neither are a tenant's tabs, an email by recipient or id, or a list with a filter applied. Fix: Settings as a page, and the open tenant's or user's tabs as items while one is open.

Status: partly fixed. Go to lists Settings, and This page lists the open tenant's tabs ([palette.md](palette.md#the-command-palette)). Searching emails by recipient or id and opening a filtered list stay open, as a later `[P5 palette]` follow-up ([out of scope](palette.md#out-of-scope)). `tests/unit/components/features/command-palette.test.tsx` ("offers a viewer the settings page for "%s" and opens it") and `tests/unit/components/features/command-palette-sources.test.tsx` ("registers the visible tabs and Copy tenant ID, Flags only from admin up") cover it.

### F-palette-9

When a search fails, the palette shows "Some results could not be loaded." in its status line and "No results." under it, with no retry; typing again is the only way to ask again ([shot](img/palette/palette--before-error.jpg)). With no term, the empty status paragraph and the list's padding leave about 56 px of blank space between the input and the first group ([shot](img/palette/palette--before-default.jpg)). Fix: a failure row with Try again in place of "No results.", and no space held by an empty status line.

Status: fixed. A failed search shows a "Search failed. Try again" row in place of "No results.", and an empty status line takes no room ([palette.md](palette.md#the-command-palette)). The shared suite's `tests/unit/components/shared/command-palette/command-palette-shell.test.tsx` ("offers Try again in place of "No results.", and the row keeps the palette open", "keeps the status line empty, and taking no room, when nothing is pending") covers it.

### F-palette-10

`CommandDialog`'s default description, "Search for a page or a tenant.", is the dialog's accessible description, while the input's label says "Search pages, tenants and users" ([code](palette.md#before)). A screen reader hears both. Fix: pass a description that names users too, or let the input's label stand alone.

Status: fixed. The dialog is described "Go to a page, a tenant or a user, or run an action." ([palette.md](palette.md#the-command-palette)). `tests/unit/components/features/command-palette.test.tsx` ("describes itself as reaching pages, tenants, users and actions") covers it.

## Walk fixes

The second walk, on the passwordless release, found these. Each is fixed, and the test named beside it covers it.

- **Invitation Resend says how long to wait.** A pending invitation's Resend is disabled with the time left ("Resend in 4 min"), from `resendAvailableAt` or a 429's `Retry-After`, and stays focusable. `tests/unit/components/features/tenant/pending-invitations.test.tsx` ("disables Resend with the minutes left from resendAvailableAt", "counts down from Retry-After after a 429 cooldown").
- **Focus follows a page change.** After New tenant, New user, and Delete permanently on a tenant or a user, focus moves to the destination's `h1` (`requestArrivalFocus`, `useArrivalFocus`). `tests/unit/pages/_app/tenants.test.tsx` ("focuses the new tenant’s heading after New tenant"), `tests/unit/pages/_app/users.test.tsx` ("focuses the new user’s heading after New user"), `tests/unit/pages/_app/tenant-detail.test.tsx` and `tests/unit/pages/_app/user-detail.test.tsx` ("focuses the … heading after Delete permanently").
- **Staff actions refresh after Edit details.** A tenant edit refreshes its detail, the platform and tenant activity logs, and the users pages, whose details name each membership's tenant. `tests/unit/queries/tenant.queries.test.tsx` ("refreshes the staff activity after Edit details", "refreshes the users pages and every user’s details, which show the tenant’s name").
- **The Owners card and the frozen tabs name a step the reader can take.** The copy follows the tenant's state and the reader's role. `tests/unit/components/features/tenants/tenant-owners.test.tsx` and `tests/unit/pages/_app/tenant-detail.test.tsx` ("a %s tenant’s %s tab is frozen for a platform %s, names the next step…").
- **The Staff page's invite button reads "Invite staff".** `tests/unit/pages/_app/settings/platform.staff.test.tsx`.
- **The Activity Actor facet searches the server**, twenty at a time, and names a selected actor who is not in the results. `tests/unit/pages/_app/activity.test.tsx` ("searches actors on the server, twenty at a time", "names a selected actor who is not in the results").
- **The tenant Flags member picker searches.** A member beyond the first page is found by search. `tests/unit/pages/_app/tenant-flags.test.tsx` ("finds a member beyond the first page by search").
- **No palette action mails anyone at once.** The two immediate mail actions are gone with the password emails; Send sign-in link opens its confirm dialog from the menu and the palette. `tests/unit/components/features/command-palette-sources.test.tsx` ("opens the Send sign-in link dialog from the palette, which sends one link on confirm").
