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
| C6 | Working without signal (already planned in Phase 1a) | Save on the phone and send when the signal returns | done 7 Oct (not tried on a phone) |

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
| R1 | Urdu text reads right to left but the layout is not mirrored | Mirror the layout: row order, arrows, which side the menu opens | partly: built 7 Oct, **not yet seen on a phone or in the browser** (types and lint only). The layout follows the app's language at once, with no restart and no new package: the app and every pop-up are wrapped in a direction box (`components/direction-view.tsx`, `lib/direction.ts`), left/right styles became start/end, and the back and forward arrows, the More menu's slide and the calendar's month swipe follow the direction. Kept left to right on purpose, as Material and Apple say: PIN dots and keypad, phone numbers ("+91" stays left of the box), boxes for digits, photos, ticks. Stars and progress bars do mirror (Apple: rating and progress controls flip). Still to try in Urdu on Android, iPhone and the browser: every screen's row order and text alignment; the menu sliding from the right; the calendar (Sunday on the right, arrows, swipe); the booking date strip starting at the right; pop-ups; typing in text and number boxes; the iPhone's swipe-back edge; switching language back to English |

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

## Screen review from screenshots, 22 October

The founder asked for every page of the app to be looked at for misalignment and other UI faults, with research. Unlike the 7 October review, this one looked at **pictures**: about 100 screens (250 screenshots) taken at the founder's phone width (360) from a test copy of the app in the browser, as the Owner, the Manager, the ECCS Supervisor and a BDE, plus 11 busy screens in the dark theme, in Telugu and on a small 320-wide phone. Six reviewers compared them with Material Design 3, Apple's HIG, WCAG 2.2, Nielsen Norman Group, GOV.UK and field-service apps (Salesforce Field Service, Jobber, Pipedrive, Zoho). Their notes are in `.work/uireview/findings-*.md` (not in git); the report with before-and-after screenshots is at https://claude.ai/artifact/NX6U6nth3E8qj5zcUdXV3M. **Not seen:** the Head Chef and the one-branch Owner (Deccan Biryani), whose sample logins have not agreed to the terms, so every screen showed the agreement page; Claude did not agree on their behalf.

### Fixed on 22 October (alignment and consistency)

| # | Fault | Fix | Status |
|---|---|---|---|
| V1 | Buddy's welcome had a "Nothing changes until you tap to confirm" line that sat out of line (founder's screenshot) | Removed in all 13 languages; the same point stays under "What Buddy can and cannot do" | done 22 Oct |
| V2 | Page margins of 24 left little room at 360: titles, names and buttons wrapped; the top bar's right button sat 8 to the right of the cards; "Back" was squeezed to the arrow alone on Food labels; text slid under the top bar with no edge | Margins of 16 (Material 3 and Android); the top bar's arrow and round buttons on the content's edge; "Back" never gives way; a hairline under the top bar once the page scrolls; title and subtitle grouped | done 22 Oct |
| V3 | Buddy's entry drawn three ways (ringed circle, pill with the word, a bigger mascot in the menu) | One round button with no ring, like the bell (M3 top-bar icon buttons) | done 22 Oct |
| V4 | A button whose words wrap, or that has a hint, left its icon stranded at the edge; links centred inside left-aligned cards | Icon stays beside the words; links can sit on the left edge; link hints grey; a new "tonal" button for a second action | done 22 Oct |
| V5 | Status labels drawn four ways (grey or black outlines, a text tick, an icon); the overdue mark was a filled red clock that read as an "L" | One label for checklists, visits, issues, inspections and the score band: a soft tint, an icon and a word (Atlassian lozenge, WCAG 1.4.1). Home's overdue rows say "Overdue"; the Checklists page keeps the founder's red clock (5 Oct) as an outline clock | done 22 Oct |
| V6 | Visits whose day had passed (9 to 11 Oct) showed under "Coming up" as "Booked", while the Calendar said "Not done"; the Supervisor's Home listed every open visit oldest first, today's four screens down | "Earlier, not done yet" with a "Not done" label on Services and the visit; the Supervisor's Home shows today first and earlier ones below | done 22 Oct |
| V7 | Menu: "ECCS Buddy" 2 to the right of the other labels; the Supervisor's and BDE's menu an empty white panel | A fixed icon slot; one 16 edge; close button at the top; role grey and "View my profile" teal; Notifications and My profile in the staff menus | done 22 Oct |
| V8 | Dark theme: the menu, sheets and dialogs were the page's own colour, so they had no edge | A raised surface colour for them | done 22 Oct |
| V9 | Home: the three stat numbers at different heights; "pm" alone on a line; "To pay" and "Ask ECCS Buddy" text on different edges; checklist and licence rows with a state icon instead of an arrow | Numbers from the top; non-breaking space before am/pm and before the dash in time windows; one icon slot; rows with the state under the title and an arrow | done 22 Oct |
| V10 | Score: in Telugu the notes squeezed into a narrow column beside the number; note icons halfway down wrapped lines; "Why this score?" centred | Notes always under the number; icons on the first line; the link on the left edge | done 22 Oct |
| V11 | Visit cards and the day sheet used a small "›" character at the top; the address pin sat between two lines | The arrow icon, centred; the pin on the first line | done 22 Oct |
| V12 | Notifications: the unread dot sat halfway down three-line rows | Beside the title | done 22 Oct |
| V13 | Buddy: the message box was taller than the round buttons beside it, which sat at its foot; a grey send button with a green ring looked ready; recent chats had uneven gaps and a red bin on every row | One rounded bar holding the box, the microphone and send (Gemini, ChatGPT, WhatsApp); send appears when there is text; even rows, grey bins | done 22 Oct |
| V14 | Food labels: "Manage labels" in the top bar pushed Buddy off the screen in Telugu and at 320; names broke mid-word beside the stepper | "Manage labels" under the list beside "Add a label"; the stepper moves under the name when the row is narrow | done 22 Oct |
| V15 | Attendance: names squeezed ("Sample / Helper") beside a status that never shrank | The status moves under the name when both do not fit; "No record" grey | done 22 Oct |
| V16 | Invoice and receipt: labels squeezed into "For the / period"; long values started mid-row | A two-column summary list (GOV.UK); the Total label the same size as its amount | done 22 Oct |
| V17 | Vendors: rows with two pills stretched them across the row | Pills keep their width | done 22 Oct |
| V18 | BDE: to-do buttons of three widths; red borders on most rows; the free check's "OK" sat lower than the other two answers | One button width; red only on the "when" line; answers from the top | done 22 Oct |
| V19 | Pay-day settings: the radio sat halfway down three-line options | Beside the option's name | done 22 Oct |
| V20 | Long choices (a person and their role on Add a person, outlets on Start an inspection) ran off the screen | Choice chips wrap inside the screen | done 22 Oct |
| V21 | Several filled buttons on one screen (three "Take photo" plus Submit; Call plus the lead's main step; the board photo plus Save lead) | The extra ones are tonal, so the main action stands out (M3, GOV.UK) | done 22 Oct |
| V22 | Placeholders cut off: "10-digit mobile numbe", "e.g. fridge, g", "Search, e.g. fridge, cash," | Removed (the label says it) or one word, "Search" | done 22 Oct |
| V23 | Calendar had no title (so Buddy sat in a bar of its own); "Services and booking" wrapped onto two lines | "Calendar"; "Services", the tab's own word | done 22 Oct |
| V24 | Staff: the hub rows and the people rows started on two different edges | Initials in a 40-wide slot, the same slot as the hub icons | done 22 Oct |

### Proposed, for the founder to decide (not built)

| # | Where it falls short | Proposal | Status |
|---|---|---|---|
| W1 | About 25 screens open with two to five lines of explanation before the main part (Services, SOPs, Edit checklists, Score, Salary, Pay, Pay-day settings, Attendance, To review, Staff logins, Starter labels, SOP library) | One line at most; the rest in an "About this" fold (founder's own rule, NN/g progressive disclosure) | todo |
| W2 | Cards come in four border widths (1, 1.5, 2, 3) and two colours, filled or not; the same people are cards on one screen and rows on another; 83 notifications are 83 boxes | Shared Card and ListRow parts; notifications and "Last 7 days" as plain rows grouped by day; repeats collapsed ("4 checklists missed") | todo |
| W3 | Empty Certificates, Inspections and "Photos from your daily checks" are a grey paragraph | A shared empty state: icon, one-line heading, one sentence, a button where there is a next step (NN/g) | todo |
| W4 | Delete and Remove are as big as the safe actions beside them (Remove licence, 8 red bins on documents, Cancel plan, 12 buttons on Staff logins) | A ⋮ menu or a sheet per row; Cancel plan as a red text link (NN/g, Google Drive, Apple Subscriptions) | todo |
| W5 | Edit checklists opens every checklist at once, with two big buttons per item (over five screens) | A list of checklists, each opening its own editor, with a Photo switch and a remove icon per item (SafetyCulture, Google Tasks) | todo |
| W6 | Book a service lists all twelve services before the day and time | Fold the list to the chosen service with "Change", or three short steps (GOV.UK, Urban Company) | todo |
| W7 | New SOP: 15 category chips fill a screen, and one is chosen in advance | A select field like the outlet picker, nothing chosen until asked | todo |
| W8 | Login screens grey out "Link this phone", "Send code", "Verify" and "Accept and continue" without saying why (the 7 Oct S7 rule); the code countdown is faint; the PIN title sits above the Clock in button, away from its dots | Buttons stay active and say what is missing (two new sentences in every language); plain grey countdown; Clock in below the keypad | todo |
| W9 | Field screens lack Map and Call where work starts (Home cards, the visit page); the inspection report puts the PDF before the score; "What to carry" repeats outlet names; a quote can tick two plans | Map and Call on visit cards and visits (Jobber, Dynamics 365); score first; "All 3 visits"; plans as radios | todo |
| W10 | Pay: "Share summary" is the pinned main button while "Record a payment" is grey at the end | Pin "Record a payment"; fold "How this is worked out" | todo |
| W11 | Indian languages: body text weight 500 has no Telugu (and other scripts') medium, so lines mix weights; 12-size labels are cramped for tall scripts | Body text at 400; more line height and at least 13 for Indian scripts (Material language support) | todo |
| W12 | The plan card and Plan page give a past date as "Next visit" (10 Oct) | "Due since 10 Oct" with a Book link | todo |
| W13 | Invoice titles are three bold English lines repeating the outlet; one due today looks like one due next month | A short title (the period) with the plan under it, translated; "Due today" in amber | todo |
| W14 | Search boxes built three ways (with or without a magnifier) | One search field with a magnifier and a clear button (M3, Apple) | todo |
| W15 | Six orange notice boxes with five icons, two radii and two paddings | One notice part: info, warning, danger, sample | todo |
| W16 | Wording: "Steps: 5", "Days left: 160", "You agreed on … (version …)", "ECCS Pest control is tomorrow, After closing.", "need the Owner's look", "Add a person" meaning two things, the Staff link button naming the person, "What Buddy can and cannot do" | Short natural forms in every language | todo |
| W17 | Customer page: while it is off, "Share the link" is the strongest button | While off, the main action is turning it on | todo |
| W18 | Still to see: the Head Chef's and the one-branch Owner's screens, and the bottom bar at 320 in Telugu (the Telugu More menu was checked after the fixes and is fine) | A second look once those logins have agreed to the terms | todo |

## Left over after 7 October

Nothing below was tried on a phone; the reworked screens were opened in the browser preview only.

- **R1, Urdu layout mirroring:** built, not yet tried on a phone or in the browser (see the R1 row for what to look at).
- **C6, checklists without signal:** a separate planned feature. A failed photo is now kept for retry, but answers still need a connection.
- **Small gaps in the shared pieces** that the screen work ran into: ~~the button has no slot for an icon~~ (fixed 7 Oct: the shared button takes an `icon`, and the camera, file, call, WhatsApp, share and add buttons carry one; never put emoji in a label); the text field has no slot for an icon or a clear button inside it (the search fields place theirs beside or over the field); the choice chip has no red variant; the confirm box always says "Cancel" for its second button; the "saved" message can briefly cover the top of a pinned footer.
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
