# Findings

Each finding: where, what is wrong, evidence, and the part that fixes it.

The tag names the work that fixes it: `[P2 loading]` boot and loading states, `[P3 shadcn]` the shadcn refresh, `[P4 table]` the data table, `[P5 palette]` the command palette, and `[UX]` a copy or flow change outside those.

## Summary by part

[P2 loading]

- [F-boot-1](#f-boot-1), [F-boot-2](#f-boot-2), [F-auth-3](#f-auth-3), [F-auth-5](#f-auth-5)

[UX]

- [F-auth-1](#f-auth-1), [F-auth-2](#f-auth-2), [F-auth-4](#f-auth-4), [F-auth-6](#f-auth-6), [F-auth-7](#f-auth-7), [F-auth-8](#f-auth-8), [F-system-1](#f-system-1)

## All findings

"The walk" below is two throwaway Playwright scripts run against the dev stack, signed out: three cold loads of `/login`, and a pass over `/`, `/auth/callback`, `/register` with and without a bad `?invitation`, `/no-access`, `/overview`, `/flags` and `/invitations/accept` with a bad `?token`. "The capture" is `pnpm capture:pages` and its `report.json`.

| Id         | Route                              | Tag          | Finding                                                                                                                                         | Evidence                                                 |
| ---------- | ---------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| F-boot-1   | cold load                          | [P2 loading] | The splash paints unstyled in the top-left, then re-paints centred once the CSS arrives.                                                        | [frames](boot.md#frame-by-frame)                         |
| F-boot-2   | cold load of an `_app` page        | [P2 loading] | The session restore and the flags read hold the whole screen on the splash; a slow answer shows no shell or progress, for up to 30 s a request. | [boot](boot.md#what-happens)                             |
| F-auth-1   | `/verify-email`                    | [UX]         | Without `?token` the page shows the form with an empty token field, where the other mailed-link pages say the link is incomplete.               | [shot](auth.md#verify-email--verify-your-email)          |
| F-auth-2   | `/verify-email`                    | [UX]         | The verification token is shown as an editable text field the user has no reason to read or change.                                             | [shot](auth.md#verify-email--verify-your-email)          |
| F-auth-3   | `/invitations/accept`              | [P2 loading] | The loading card has a different title and about 60% of the height of the card that replaces it, so the page jumps when the preview lands.      | [shots](auth.md#invitationsaccept--accept-an-invitation) |
| F-auth-4   | `/invitations/accept`              | [UX]         | The error state says "We could not load this invitation" twice, in the title and again in the `LoadError` box nested inside the card.           | [shot](auth.md#invitationsaccept--accept-an-invitation)  |
| F-auth-5   | `/register`                        | [P2 loading] | The loading card is two bars about a third the height of the form that replaces it, so the card grows and re-centres when the preview lands.    | [shots](auth.md#register--create-an-account)             |
| F-auth-6   | `/register`                        | [UX]         | An unusable invitation leaves a card with no link or button at all, and a failed preview offers only Try again, no way back to sign in.         | [walk](auth.md#register--create-an-account)              |
| F-auth-7   | `/invitations/accept`, `/register` | [UX]         | A staff invitation reads "Join Platform … as Viewer": it names the internal platform tenant, not the staff console the person is joining.       | [shots](auth.md#invitationsaccept--accept-an-invitation) |
| F-auth-8   | `/register`                        | [UX]         | The invited address is a read-only field drawn exactly like the editable ones, under a description that already states it.                      | [shot](auth.md#register--create-an-account)              |
| F-system-1 | `/$`                               | [UX]         | The not-found page has no staff shell for a signed-in user and no auth frame for a signed-out one: a bare card on a plain page.                 | [shot](system.md#--not-found)                            |

### F-boot-1

On every cold load under `vite dev`, the splash in `index.html` shows as unstyled black serif "Loading…" in the top-left corner, with no spinner, before it jumps to the centred, styled splash (frames 01 and 02 of each scenario in [boot.md](boot.md#frame-by-frame): 207 → 1308 ms, 26 → 524 ms, 26 → 533 ms). The splash's only styles are in `src/styles/globals.css`, which `vite dev` delivers through JavaScript after the module graph runs ([why](boot.md#why-the-first-frame-is-unstyled)). A production build links that CSS in `<head>`, so production is not affected. Fix: give the splash styles that do not depend on the bundle, for example a small stylesheet linked from `index.html`.

### F-boot-2

React mounts only after `router.load()` settles (`src/main.tsx`), and `router.load()` awaits the session restore (`POST /auth/refresh`, then `GET /profile`) and, on every `_app` page, `_app`'s loader, which awaits `GET /platform/me/flags`. Each is bounded only by the HTTP client's 30 s timeout (`src/http/client.ts`); the flags read has no retry and falls back on failure, but still waits for the answer. While any of them is slow the user sees only the boot splash: no shell, no skeleton, no sign of which page is coming. The page reads are not part of this wait, so once those settle every page draws its own skeletons ([frames](boot.md#signed-in-overview)). The capture held no boot request, so this is from the code. Fix: mount the shell before the flags read finishes, or cap that wait, and show the shell's skeleton in place of the splash.

### F-auth-1

`/reset-password` and `/invitations/accept` without `?token` both show "This link is incomplete" and one way out. `/verify-email` without `?token` shows the normal form with a blank "Verification token" field ([shot](img/auth/verify-email--empty.jpg)), so a user who lost the token is asked to type something they never saw. Fix: give `/verify-email` the same incomplete-link state, pointing at the resend form.

### F-auth-2

`/verify-email` renders the token from the link in a labelled, editable text input ([shot](img/auth/verify-email--default.jpg)). The reset page carries its token in the form values without rendering it. The visible field adds a step that means nothing to the user and invites accidental edits. Fix: carry the token like the reset page does, and show the field only when there is no token.

### F-auth-3

While the preview loads, the card is titled "Checking your invitation" and holds two skeleton bars; when it lands, the card becomes "Join {tenant}" with a sentence, two buttons and a hint paragraph ([loading](img/auth/invitation-accept--loading.jpg), [loaded](img/auth/invitation-accept--default.jpg)). The card grows from about 165 px to about 280 px tall and its title changes, so everything in it moves. Fix: a skeleton shaped like the loaded state (title line, sentence, two button-height bars, hint lines).

### F-auth-4

The preview-failure state has the title "We could not load this invitation" and, inside the card, a bordered `LoadError` box whose message starts with the same sentence ([shot](img/auth/invitation-accept--error.jpg)). Fix: shorten the box's message to the part the title does not say, or drop the box's border inside a card.

### F-auth-5

`RegisterSkeleton` is the "Create an account" card over two `h-10` bars, about 190 px tall; the form that replaces it has a description, four labelled fields, the button and a sign-in line, about 555 px tall ([loading](img/auth/register--loading.jpg), [loaded](img/auth/register--default.jpg)). Because `AuthLayout` centres the column, the card's top edge also moves up by about 180 px when the preview lands. Fix: a skeleton with the form's rows (description lines, four label-and-field pairs, the button).

### F-auth-6

When the preview answers 404, `/register` shows "This invitation can’t be used" and "Ask the person who invited you for a new one." in a card with no content, so the page has no link at all, not even back to sign in (in the walk, `?invitation=not-a-real-token` left no link or button in `<main>`). `/invitations/accept` gives the same state a "Go to the home page" button, and refuses a malformed token locally (`invitationTokenSchema`) where `/register` sends it to the API. The other failure state ([shot](img/auth/register--error.jpg)) offers only Try again. Fix: give both failure states a way out (Back to sign in), and check the token's shape before the preview as the accept page does.

### F-auth-7

A staff invitation is an invitation to the platform tenant, so the accept page reads "Join Platform" and "A teammate invited you to join Platform as Viewer.", and the registration card "Create an account with {address} to join Platform." ([accept](img/auth/invitation-accept--default.jpg), [register](img/auth/register--default.jpg)). For a new staff member, "Platform" reads as an unexplained product or team name; the console calls itself "Apex" and "Staff console". Fix: when the invitation's tenant is the platform tenant, word the title and sentence for joining the staff console.

### F-auth-8

The registration form shows the invited address in the description ("Create an account with {address} to join …") and again in an `Email` input marked `readOnly`, which has the same border, background and text colour as the editable name and password inputs ([shot](img/auth/register--default.jpg)). A user can focus it and type, and nothing changes or explains why. Fix: show the address once, as text, or give the read-only field a visibly read-only style.

### F-system-1

`src/pages/$.tsx` is a top-level route, so the not-found page renders outside both layouts: a bare card on a plain background, with no sidebar, header or search for a signed-in staff member, and without the muted auth frame for a signed-out one ([shot](img/system/not-found--default.jpg), taken signed in as staff). Fix: render the not-found card inside the shell when signed in, and inside `AuthLayout` when signed out.
