# ECCS Platform: UI/UX review against industry standards

Carried out on 7 October 2026, after the founder's rule that every screen follows researched, industry-standard patterns (see `CLAUDE.md`). Four reviewers read the code of every screen built up to that day and compared it with published guidance (Material Design 3, Apple Human Interface Guidelines, WCAG 2.2, Nielsen Norman Group, GOV.UK Design System, and how comparable apps work). They read code, not a phone, so anything about how a screen looks on a device is unconfirmed until tried.

The founder approved all of it on 7 October 2026, including replacing the side menu as the main navigation with a bottom bar.

**How to use this file:** each item has a status. Change it when the item is built, in the same session. `todo` = not started, `done` = built (say the date), `partly` = say what is left.

## Faults found along the way

| # | Fault | Where | Status |
|---|---|---|---|
| F1 | In the calendar's "Coming up" list a visit was a button inside a button, so tapping it never jumped to that day | App, History | done 7 Oct |
| F2 | A visit dated in the past could not be edited in the console, because the date box refuses past dates (inferred from the code) | Console, Visits | done 7 Oct |
| F3 | The "Uploading…" wording on photo buttons could never appear; the button showed a bare spinner | App, Button | done 7 Oct |
| F4 | The PIN pad is a fixed 288 wide and overflows on a 320-wide phone (worked out, not seen) | App, PIN screen | done 7 Oct |

## Shared building blocks (built once, used everywhere)

| # | Now | Standard pattern | Status |
|---|---|---|---|
| S1 | No pull-to-refresh anywhere; a failed load shows red text with no way to retry | Pull down to refresh; a "Try again" button beside the error | done 7 Oct |
| S2 | No progress shown and the main button sits at the very bottom, greyed out, when filling a checklist or recording a visit | A bar pinned to the bottom with the count done and the main button; tapping it while incomplete jumps to the first missing item | done 7 Oct |
| S3 | Errors appear far from what caused them | Show the error next to the button or field that caused it | done 7 Oct |
| S4 | No "saved" or "sent" confirmation anywhere | A brief message at the bottom of the screen (snackbar) | done 7 Oct |
| S5 | Input box and chip outlines are too faint (about 1.4:1; 3:1 is required) | A stronger outline colour for inputs and chips; a clear focus state | partly: done for inputs and choices; the booking screen's date tiles and time buttons keep the fainter edge the founder approved |
| S6 | Selected options are marked by colour alone | A tick on the selected option | done 7 Oct |
| S7 | Greyed-out buttons do not say why | Keep the button usable and say what is missing, or explain beside it | done 7 Oct |
| S8 | Back and menu buttons scroll away on long screens | A fixed bar at the top | done 7 Oct |
| S9 | Most unexpected failures read "Something went wrong" | Specific wording for "too many tries", "not allowed" and "server problem" | done 7 Oct |

## Navigation

| # | Now | Standard pattern | Status |
|---|---|---|---|
| N1 | Every section is behind a side menu that opens only from Home | A bottom bar with four or five main sections by role, and "More" opening the full menu | done 7 Oct |
| N2 | The menu lists unbuilt sections as greyed "Coming soon" rows | Hide them, or collapse them into one line | done 7 Oct |
| N3 | ECCS Supervisors land on an empty home screen | Show today's visits on Home | done 7 Oct |

## App: login

| # | Now | Standard pattern | Status |
|---|---|---|---|
| L1 | A wrong PIN shows text below the keypad; no shake or vibration; during a lockout the pad stays active with a fixed "15 minutes" | Error under the dots, shake and vibrate, pad disabled with a countdown | done 7 Oct |
| L2 | Restaurant code, phone and one-time code fields have no visible label; no "+91" on the phone field | A label on every field; a fixed +91 prefix | done 7 Oct |
| L3 | "Send a new code" shows nothing and can be tapped repeatedly | Confirmation, and a short countdown before it can be sent again | done 7 Oct |
| L4 | PIN pad screen-reader labels are in English only | Translate them | done 7 Oct |

## App: daily checklists

| # | Now | Standard pattern | Status |
|---|---|---|---|
| C1 | A photo that fails to upload is thrown away | Keep it with "Not sent – tap to retry" | done 7 Oct |
| C2 | Tapping "Problem" looks selected before it is saved; an unsaved reason is lost silently | A clear "not saved yet" state; block Submit while a reason is unsaved; a label on the reason field | done 7 Oct |
| C3 | The due time is typed as free text on a letter keyboard | A number pad with the colon added automatically, read back as a time | done 7 Oct |
| C4 | The item search shows a dropped connection as "no matches"; no clear button | Say "could not search" with retry; a clear (✕) button | done 7 Oct |
| C5 | Dates in the list are shown raw | Use the app's date wording | done 7 Oct |
| C6 | Working without signal (already planned in Phase 1a) | Save on the phone and send when the signal returns | todo (separate feature) |

## App: raise an issue

| # | Now | Standard pattern | Status |
|---|---|---|---|
| I1 | The conversation is a long page with the reply box at the very end | Reply box pinned above the keyboard; open at the newest message; no reply box on a closed issue | done 7 Oct |
| I2 | Attached photos cannot be removed or enlarged before sending | A ✕ on each thumbnail | done 7 Oct |
| I3 | Send stays greyed with no hint | Say what is missing | done 7 Oct |
| I4 | Call and WhatsApp buttons can end up different heights | Equal heights | done 7 Oct |

## App: staff logins

| # | Now | Standard pattern | Status |
|---|---|---|---|
| T1 | A new PIN is shown once with no way to pass it on | A Share button (WhatsApp is the natural route) | done 7 Oct |
| T2 | No feedback while Reset PIN or Remove access is running | Show it is working | done 7 Oct |
| T3 | A removed person cannot be given access back | "Give access back" on removed people | done 7 Oct (no automated test yet) |

## App: licences and documents

| # | Now | Standard pattern | Status |
|---|---|---|---|
| D1 | The expiry date field opens a full letter keyboard on Android; slashes typed by hand; a wrong date reported only on Save | A number pad that adds the slashes, and the date read back in words underneath | done 7 Oct |

## App: history calendar

| # | Now | Standard pattern | Status |
|---|---|---|---|
| H1 | Tapping a day changes details that are below the bottom of the screen | Compact day cells so the day's list is visible under the grid, or scroll to it | done 7 Oct |
| H2 | Labels are 10px and cut off; colour means both the kind of thing and its status; red is not in the legend | Icons for the kind, colour only for status, text at 11px or more, a legend that matches | partly: done, but inside a day cell the service, licence and holiday icons show status by colour only (the words are in the day's list) |
| H3 | Months change by arrows only | Swipe between months (nice to have) | done 7 Oct |

## App: SOPs

| # | Now | Standard pattern | Status |
|---|---|---|---|
| P1 | Editor: steps cannot be reordered, numbers vanish once typed, deleting a step is instant, leaving discards changes silently | A permanent number on each step, up/down buttons, confirm before deleting a written step, ask before leaving with unsaved changes | done 7 Oct |
| P2 | Library search: no clear button, results blank out on every keystroke, no recent searches, unclear that a search covers every category | Search icon and ✕, keep old results while loading, recent searches, say where the results come from | done 7 Oct |
| P3 | The main action ("Add to my SOPs", Edit) sits after all the steps | Keep it reachable without scrolling | done 7 Oct |

## App: service visits

| # | Now | Standard pattern | Status |
|---|---|---|---|
| V1 | Removing a visit photo deletes it at once | Ask first, as every other delete does | done 7 Oct |
| V2 | Photos stack full-width; before and after are far apart in the report | A thumbnail grid; before and after together in the report | done 7 Oct |
| V3 | "Not done" forces typing a reason | A few one-tap reasons, with "Other" for typing (sample reasons until the founder supplies real ones) | done 7 Oct |
| V4 | The Supervisor's list has no "Today" and no address on the card | Today / Tomorrow / Later, with the address | done 7 Oct |
| V5 | The booking screen's Send is greyed with no reason; no summary before sending | Say what is missing; a one-line summary above Send | done 7 Oct |

## App: languages

| # | Now | Standard pattern | Status |
|---|---|---|---|
| R1 | Urdu text reads right to left but the layout is not mirrored | Mirror the layout: row order, arrows, which side the menu opens | todo: needs trying on a phone, because the app has to restart to flip its layout |

## Console

| # | Now | Standard pattern | Status |
|---|---|---|---|
| W1 | Visits is one flat list with no day headings, "overdue" or filters | Group by day with Overdue at the top; filters for No Supervisor / Overdue / Today and by Supervisor | done 7 Oct |
| W2 | Clients is a stack of large cards with no search | One table with a search box; open a row for outlets and codes | done 7 Oct |
| W3 | No confirmation after most actions; errors for row actions appear at the top of the page | A brief "saved" message; errors beside the row or form | done 7 Oct |
| W4 | The selected visit or issue and the filters are not in the web address | Put them in the address so refresh, Back and links work | done 7 Oct |
| W5 | The detail panel can run off the bottom of the window, drops below the list on a tablet, and the page is capped at 1024 wide | A wider page, the detail scrolling on its own, the detail replacing the list on narrow screens | done 7 Oct |
| W6 | Clicking an outlet under "Needs attention" on Licences appears to do nothing | Scroll to the result, or a Renew action in the row | done 7 Oct |
| W7 | Deletes and cancels use the browser's plain OK / Cancel box | A proper dialog with buttons that say what they do | done 7 Oct |
| W8 | The top menu shows no counts of things waiting | Counts beside Visits, Issues and Licences | done 7 Oct |
| W9 | Form checks rely on the browser's pop-up bubbles; no format hints | A message beside each field; hints for phone, GSTIN and PIN code | done 7 Oct |
| W10 | Every browser tab is titled "ECCS Console" | The page's name first in the title | done 7 Oct |
| W11 | Input outlines too faint; weak focus ring | A stronger outline and a solid focus ring | done 7 Oct |
| W12 | Small screen-reader and keyboard gaps (language switcher, filter toggles, task marks, "Loading…") | Fix each | done 7 Oct |

## Left over after 7 October

Nothing below was tried on a phone; the reworked screens were opened in the browser preview only.

- **R1, Urdu layout mirroring:** not started.
- **C6, checklists without signal:** a separate planned feature. A failed photo is now kept for retry, but answers still need a connection.
- **Small gaps in the shared pieces** that the screen work ran into: the button has no slot for an icon (so Take photo, Call and WhatsApp are words only); the text field has no slot for an icon or a clear button inside it (the search fields place theirs beside or over the field); the choice chip has no red variant; the confirm box always says "Cancel" for its second button; the "saved" message can briefly cover the top of a pinned footer.
- **To confirm on a phone:** the swipe between months alongside scrolling; scrolling to the first unanswered item; the reply box and pinned footers with the keyboard open; the share sheet for a new PIN; the number pads and automatic slashes and colons; the PIN screen's shake and vibration; long translations in the bottom bar and in side-by-side buttons.
- **Decisions made during the work, for the founder to confirm:** see STATUS.md section 4, "UI review".
- **Unused text** left in the language files (`visit.finishNeeds`, `visit.notDoneWhy`, `visit.saved`, `profile.preferences`, `profile.language`, `dash.menu`, the `tile.*` names of unbuilt sections) can be removed in a tidy-up.

## Already at the standard (no need to revisit)

- Text contrast passes in light and dark themes.
- Buttons and rows are comfortably large (52 against a 48 guideline).
- The system font size is respected.
- One-time code entry is set up for SMS autofill.
- Status labels always carry words, not only colour.
- Deletes ask first on most screens.
- Dates and rupee amounts are written the Indian way.
- Typing a far-future expiry date (rather than spinning a picker) is the recommended method; only the details in D1 need work.

## Sources

- Material 3: [Navigation bar](https://m3.material.io/components/navigation-bar/guidelines), [Navigation drawer](https://m3.material.io/components/navigation-drawer/guidelines), [Snackbar](https://m3.material.io/components/snackbar/guidelines), [Progress indicators](https://m3.material.io/components/progress-indicators/guidelines), [Date pickers](https://m3.material.io/components/date-pickers/guidelines), [Search](https://m3.material.io/components/search/guidelines), [Top app bar](https://m3.material.io/components/top-app-bar/guidelines), [Badges](https://m3.material.io/components/badges), [Type scale](https://m3.material.io/styles/typography/type-scale-tokens)
- Nielsen Norman Group: [Hamburger menus](https://www.nngroup.com/articles/hamburger-menus/), [Errors in forms](https://www.nngroup.com/articles/errors-forms-design-guidelines/), [Error messages](https://www.nngroup.com/articles/error-message-guidelines/), [Placeholders](https://www.nngroup.com/articles/form-design-placeholders/), [Confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/), [Data tables](https://www.nngroup.com/articles/data-tables/), [Date input](https://www.nngroup.com/articles/date-input/), [Deep linking](https://www.nngroup.com/articles/deep-linking-is-good-linking/)
- WCAG 2.2: [Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [Use of color](https://www.w3.org/TR/WCAG22/#use-of-color), [Dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [Page titled](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html), [Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [Resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
- Apple HIG: [Right to left](https://developer.apple.com/design/human-interface-guidelines/right-to-left/), [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields), [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
- Android: [Pull to refresh](https://developer.android.com/develop/ui/compose/components/pull-to-refresh)
- GOV.UK Design System: [Error summary](https://design-system.service.gov.uk/components/error-summary/), [Error message](https://design-system.service.gov.uk/components/error-message), [Validation](https://design-system.service.gov.uk/patterns/validation/)
- Others: [web.dev offline UX](https://web.dev/articles/offline-ux-design-guidelines), [Smashing Magazine on disabled buttons](https://www.smashingmagazine.com/2021/08/frustrating-design-patterns-disabled-buttons/), [Carbon data table](https://carbondesignsystem.com/components/data-table/usage/), [W3C tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [Housecall Pro schedule](https://help.housecallpro.com/en/articles/1029139-viewing-your-schedule-in-the-field), [SafetyCulture offline](https://help.safetyculture.com/000034)
