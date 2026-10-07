# ECCS Platform: Daily Log

A plain record of what was done each working day, newest day first. One entry per day, written at the end of the day.

How this differs from the other docs:

- `STATUS.md` says where the project stands **now** (what is built, decided, open). It is updated as work happens.
- `PROPOSAL.md` says **what** we are building and why.
- This file says **what happened when**. Entries are not rewritten later; a correction goes in the day it was found.

Each entry has the same parts: what was built, what the founder decided, what was tested and how, problems found, and what was left open.

---

## Wednesday 7 October 2026

*In progress. To be written up at the end of the day.*

**So far today**

- Founder reported SOPs not showing in the newer languages. Cause: his API terminal had been started before the translation work was built. Restarting it fixed that.
- Founder then sent three phone screenshots (filed in `docs/screenshots/` as `library-bengali-screen-marathi-content-android.png`, `library-bengali-screen-english-content-iphone.jpeg` and `library-sop-english-content-iphone.jpeg`): with the app set to Bengali, the SOP library showed Marathi on the Android phone and English on the iPhone; and on first opening, the language did not appear until after some refreshing. Cause: the screen follows the language chosen on that phone, but the library's wording followed the language saved on the account, and the two had drifted apart (one login on two phones; a save that failed silently, probably while the API was restarting). Fixed: the app now sends the language on screen with every request and the server answers in it; the library reloads when the language changes; a phone follows the saved language when the app opens, and re-sends its own choice if that never reached the server. One more check added to the end-to-end tests (122 pass). Not checked in the browser by Claude; the founder restarted the terminals, retested on the phones and confirmed it works.
- Founder asked for the service loop to be built complete. Built it in one go. In the app, the Owner or Manager books a service from the priced catalogue (service, one of the next 14 days, time of day, a note), sees upcoming visits, cancels a request ECCS has not confirmed, signs off finished visits and opens past reports; the home screen lists the outlet's visits and the calendar opens them. In the console, a new Visits page shows requests waiting, where ECCS confirms the day and time and picks the Supervisor, and the diary, where ECCS can add, move, reassign and cancel visits and read reports. In the app again, ECCS staff get My visits: the Supervisor checks in, marks each task done or not done with a reason, takes before and after photos, records the team and notes, and finishes; the visit gets a report number and waits for the restaurant's sign-off.
- Decided by Claude during the build, for the founder to review (STATUS section 4): sign-off happens in the restaurant's own app rather than as a signature on the Supervisor's phone; the Owner can sign off as well as the Manager; a restaurant cannot cancel once ECCS has confirmed; finishing needs every task answered and one "after" photo.
- 75 new pieces of app text, translated into the 11 other languages by parallel translation jobs and checked by program.
- Tested with 16 new end-to-end tests (138 in total) and by going through the whole loop in Chrome: booked as the Spice Route Owner, confirmed in the console, recorded as the Supervisor (whose screens came up in Telugu), signed off as the Owner, read the report in the console. The photos in that run were uploaded by script, not through the camera button. One fault found and fixed: the booking screen stayed busy after sending when opened directly. Not tried on a phone.
- That browser run left one real-looking record in the local data: a signed-off pest control visit at Spice Route, Gachibowli, dated 8 October, report SR-2026-00001, with two coloured sample pictures as photos.
- Not built: PDF of the report, filing it in the document vault, visits generated from plans, chemicals used, location check at check-in, certificates, working without signal, notifications.
- Founder feedback on booking, with a screenshot (`docs/screenshots/booking-too-many-day-buttons.png`): too many day buttons, and the time should be proper time slots, large, as other booking apps do it. Looked at how booking apps lay this out and rebuilt it: one row of dates to swipe through, and two-hour arrival windows in large buttons grouped by morning, afternoon and evening, plus "After closing". The console and every place a visit's time is shown use the same windows; times already saved were moved to a matching window. Checked in Chrome. 138 end-to-end tests pass.
- Founder asked for the language choice to move from My profile to the bottom of the side menu. Done; the Preferences section is gone from the profile. Checked in Chrome that the list opens from the menu; not tried on a phone.
- Founder rule: always research the design and use the industry standard for UI/UX, for everything from now on. Written into `CLAUDE.md`.
- Founder asked for every existing screen to be reviewed against that rule. Four reviewers read all the app and console screens against published guidance and returned about 50 items; saved as `docs/UI_REVIEW.md`. Founder approved all of it, including replacing the side menu with a bottom bar.
- Built the shared pieces first: the bottom bar (main sections by role, plus "More"), a page frame with a fixed top bar, pull-to-refresh and a pinned footer, a brief "saved" message, a ticked choice chip, errors with a retry button, a stronger outline for inputs, and specific wording for common failures. ECCS staff now see today's visits on Home. Fixed four faults the review found (one of them introduced earlier today in the calendar).
- Then five workers reworked the screens in parallel, each on its own files: login; checklists, issues and staff; licences, calendar, SOPs and profile; service visits; the web console. Every review item was built except mirroring the layout for Urdu, which needs a phone to try. Details and the few partial items are in `docs/UI_REVIEW.md`.
- 135 new pieces of app text, translated into the 11 other languages by three translation jobs and checked by program.
- Tested: the full build, type check and lint pass; 138 end-to-end tests pass (the PIN lockout test was adjusted: the fifth wrong PIN now locks at once and reports the time left). Opened in Chrome: the bottom bar and moving between sections, the calendar, a checklist with its pinned progress and Submit, Services, Raise an issue, Licences, and in the console Visits (grouped diary, filters, the cancel dialog), Clients (table and search) and the counts in the menu. Most reworked behaviour was not exercised by hand (retrying a failed photo, the PIN lockout countdown, reordering SOP steps, sharing a PIN, the Supervisor's recording flow after the rework), and nothing was tried on a phone.
- Choices the workers made that the founder should confirm are listed in STATUS section 4 under "UI review".
- Founder asked what "buttons are words only" meant, then asked for the icons back. The shared button now takes an icon from the app's own icon set (the standard is a small icon before the label), and the take-photo, choose-file, call, WhatsApp, share-PIN and add buttons carry one. Type check and lint pass; not looked at in the browser or on a phone.
- Founder asked for a rating at sign-off: five stars and an optional written comment from the Owner or Manager. Looked up the usual pattern (a five-point star scale with an optional comment, asked right after the job) and built it into the sign-off: stars with a word under them, an optional comment, shown afterwards on the report in the app and the console. The rating is required to sign off; that part is Claude's choice.
- Founder asked for the bottom bar to show the calendar instead of Issues, with Issues under More, and for History to be renamed Service calendar. Done for the Owner and Manager; the Head Chef, who has no calendar, keeps Issues in the bar.
- Tested: 138 end-to-end tests pass, with the sign-off test extended for the rating. In Chrome as the Owner: the new bar, and a full sign-off of a test visit (pressing Sign off with no rating jumps to the stars and says so; five stars and a comment were saved and show on the report). That left a second test record in the local data: a signed-off safety inspection at Spice Route, Gachibowli, dated 9 October, report SR-2026-00003.
- Found while testing: on screens that show "loading" before their content (a checklist, a visit), jumping to the first missing item did nothing in the browser preview. Fixed in the shared page frame. Whether phones were affected is not known.
- The 13 new or changed pieces of text were translated into the 11 other languages by one translation job and checked by program.
- Founder asked for the More menu not to repeat what is in the bottom bar. Done: for the Owner and Manager it now lists Raise an issue, SOPs, Licences and documents, and Staff logins. Type check and lint pass; not looked at in the browser or on a phone.
- Founder decisions: a restaurant cannot cancel a confirmed visit (already how it works), and a report needs ECCS's approval before the restaurant sees it. Built the approval: a finished visit waits as "ECCS is checking the report"; in the console an admin approves it or sends it back to the Supervisor; only then can the restaurant read it and sign off. 3 new end-to-end tests (141 in total, all passing). The new console buttons and app messages were not looked at in the browser or on a phone.
- Founder decisions: the arrival windows stay as they are for now; the star rating at sign-off is mandatory; sending a report back needs a note; and Claude should write the reasons a task might not get done. Built the note (ECCS types what to correct, the Supervisor sees it on the visit, the restaurant does not) and replaced the four placeholder reasons with nine. The ten pieces of text were translated into the 11 other languages. 141 end-to-end tests pass. Not looked at in the browser or on a phone.
- Founder asked for the PDF reports. Looked up what a field-service report carries and built it: when a visit is signed off, the server lays the report out as a page and prints it to a PDF (through the Edge browser installed on this machine), files it in the outlet's documents, and the app and console get an "Open the report as a PDF" button. 3 new end-to-end tests. Made the PDF for the first test visit and read it: two pages, layout as intended. That filed a sample "Service report SR-2026-00001" in Spice Route, Gachibowli's documents. The buttons in the app and console were not pressed by hand, and nothing was tried on a phone.
- Founder corrected the order at the end of a visit: the Owner signs off first, as before, without waiting for ECCS; then ECCS approves the report in the console; then the PDF is made and the Owner and Manager can open it, with a notification. Rebuilt it that way. If ECCS sends a signed-off report back, the sign-off is kept (Claude's choice). 143 end-to-end tests pass. The reordered screens were not looked at in the browser or on a phone.
- Founder asked for a document tracking every notification across all features, to be built and tested later. Wrote `docs/NOTIFICATIONS.md`: about 35 notifications across visits, checklists, issues, licences, logins and SOPs, each with who gets it and when. None is built, including the report-ready one.

**Carried over from yesterday**

- Phone retest of the 6 October work (see "Left open" below).
- The founder has not yet chosen what to build next. Recommended: Phase 1b, the service loop.

---

## Tuesday 6 October 2026

The second day. Started with daily checklists as the only finished feature and ended with most of the restaurant side of Phase 1a in place: ECCS support, licences and documents, the dashboard, the history calendar, the SOP library, a profile page, and the app in twelve languages. 40 commits. Pushed to GitHub twice: once at midday when the repository was first put there, and once at the end of the day.

### ECCS support (issues)

- In the app: raise an issue (category, description, optional photos), see its status, exchange messages with ECCS, call or WhatsApp ECCS. The Owner or Manager can close or reopen an issue.
- In the console: an Issues page across all clients, where ECCS replies and marks issues in progress or resolved.
- After the founder's feedback, the app's two pages ("Raise an issue with ECCS" and "ECCS support") became one page named "Raise an issue", opened from a single home tile. It opens showing a "Raise an issue" button, the call and WhatsApp buttons and recent issues; the form appears on tap.

### Licences and the document vault

- In the app (Owner and Manager): licences with their expiry date and a valid, expiring soon or expired state; add, renew and remove; a document vault; files added by camera or by choosing a PDF or image.
- In the console: a Licences page listing licences that need attention across all clients, and each outlet's licences and documents, which ECCS admins can add to.
- An outlet holds one licence of each kind. Adding the same kind again, or renewing with a new copy, replaces the old one and deletes its document. The forms warn before this happens.
- Reading the document: the server reads images with OCR (Tesseract, on our own server) and PDFs from their text, and picks out the kind of licence, its number and its dates. In the app and the console the document is chosen first, and the fields fill in for the person to check before saving.

### Dashboard and home screen

- The top of the home screen became a dashboard: three numbers that can be tapped (checklists done today, licences to renew, open issues with ECCS), today's checklists with their status and a red mark when overdue, and the licences that are expired or expiring soon. The Head Chef sees only today's checklists. The hygiene score and upcoming visits are a one-line note until service visits are built.
- After the founder's feedback it shows one branch at a time. The Owner picks the branch at the top; the choice is remembered and shared with the other screens.
- The menu moved off the home screen into a panel that slides in from the left, with every section and the Lock button.

### History calendar

- Built to work like the iPhone calendar (the founder's reference picture is `docs/screenshots/calendar-reference-iphone.png`). A month grid with small coloured labels in each day: checklists done ("2/2", red when missed), ECCS services, a licence expiring, a holiday.
- Tapping a day lists everything for it underneath, and a checklist there opens the full record. A "Coming up" list shows the next services and licence due dates. It goes a year back and a year ahead. For the Owner and Manager only.
- Added 12 sample past service visits to the local data so past days have completed services to show.

### SOPs

- **SOPs in the app.** Everyone can read SOPs as numbered steps, grouped by category. The Owner and Manager can add, change and delete SOPs for their own outlet. In the console ECCS writes the standard SOPs, one language at a time, and publishes them. Seven sample standard SOPs were loaded (hand washing, fridge storage, daily hygiene, chimney filters, pests, waste, gas and fire safety).
- **The ready-made library.** The founder added a workbook (`docs/Restaurant_SOP_Knowledge_Base_Expanded_Cuisine_Dishes.xlsx`). Imported 792 SOPs from it (265 on running the restaurant, 527 dishes and recipes) and sorted its 27 modules into 13 app categories. "Find a ready-made SOP" in the app: type and matches appear, or pick a category and section; open one to read it; "Add to my SOPs" makes the restaurant's own copy to reword.
- **50 SOPs written out in full.** The workbook's steps turned out to be thin, so Claude wrote real steps for the 50 most important SOPs (397 steps): food safety, cooking and cooling temperatures, storage, receiving, cleaning, chemicals, dishwashing, pests, waste, fire, gas and injuries. They went straight into the library.
- After the founder's feedback: the section buttons say "5 SOPs" instead of a bare number, section names always show, and inside a category there is one back control, "All categories"; Back from the category list returns to SOPs.

### My profile

- A profile page for everyone at a restaurant: photo, name, role, details, restaurant and branches (with restaurant codes for the Owner and Manager), and a preferences section holding the language. The top of the side menu shows the photo and name and opens the profile.
- The photo is changed from a small camera icon on the photo, which opens a pop-up from the bottom of the screen: Take a photo, Choose a photo, Remove photo.

### Languages

- Nine languages were added to English, Telugu and Hindi: Kannada, Malayalam, Tamil, Marathi, Bengali, Odia, Gujarati, Punjabi and Urdu. The three language buttons became a dropdown that lists each language in its own script. Urdu reads right to left.
- The app's own text (351 pieces) is in all twelve.
- The content is in all twelve too: ECCS's checklist names and items, the seven standard SOPs, all 792 library SOPs (names, steps, notes, section names, dish names in each script), service names and holiday names. About 14,000 pieces of text for the nine newer languages, written by 36 translation jobs run up to 20 at a time. The library answers and searches in the reader's language, and a copy a restaurant adds carries every language.
- Not translated in any language: the checklist suggestion library (588 ready-made checks), and anything a restaurant wrote itself.

### Smaller things

- Started this daily log and wrote up 5 October.
- Wrote `docs/TEST_LOGINS.md`: restaurant codes, PINs, ECCS phone numbers, the one-time code, and what each role can open.
- Phone layout faults from the founder's screenshots were fixed (see "Problems found").
- Stopped the browser preview's warning about the native animation driver.
- Switched off Expo's generated route types, which kept causing false type errors while a dev server was running.
- The founder's screenshots are filed in `docs/screenshots/`.

### Decisions the founder made

- Problems noted on a checklist stay inside the restaurant and are never sent to ECCS. ECCS support is a separate channel, and Head Chefs can raise issues there too.
- Commit locally through the day; push to GitHub once, at the end of the day, when the founder says so.
- ECCS staff can upload licences and documents for restaurants for now. Documents can be PDFs or images.
- A new licence replaces the old one of the same kind; the old one is not kept.
- Licence details are read off the document. Start with the free reader; add an AI reader later.
- The calendar works like the iPhone calendar and also shows upcoming services, licence due dates and holidays.
- The dashboard shows one branch with a selector at the top, and the menu lives in a side panel.
- Restaurants can add their own SOPs, not only read ECCS's.
- For the thin workbook content, Claude writes the important SOPs in full and they go straight into the app, with no draft label and no separate review by the founder.
- SOPs and all other ECCS content are to be in every language the app offers.
- Everyone at a restaurant gets a profile page; the language setting lives there, not in the side menu.
- The nine languages listed above are added.

Decided by Claude during the build and not yet reviewed by the founder: a Manager or Head Chef cannot rename themselves. The others are marked in `STATUS.md` section 3.

### How it was tested

- 122 automated end-to-end tests on the API, up from 61 at the start of the day. New today: issues, licences and document reading, the dashboard, the calendar, SOPs and the library, the profile, and a test that someone using Tamil gets everything in Tamil. Unit tests cover the date and number parsing for licences.
- Claude clicked through each feature in Chrome using the browser preview of the app and the console, as the Owner and, for the dashboard, as the Head Chef. Tamil, Urdu and Kannada were looked at there.
- Translations were checked by program only: every key and every SOP present in every language, the same numbers as the English in every step, placeholders intact, ordinary digits, no characters from another script. All 792 library SOPs were read back from the database.
- The founder tested on an Android phone (photo upload, licences, staff logins) and on an iPhone (side menu, profile), and sent screenshots.

### Problems found

- **On the Android phone:** on a licence, "View document" was squeezed into a narrow column beside Renew and Remove; in Staff logins, New PIN and Remove access were different heights. Both fixed.
- **On the iPhone:** the side menu's name and photo ran up under the clock. Cause: the usual safe-area wrapper does nothing inside a pop-up layer on iPhone. Fixed by applying the gap by hand, in the menu and in the photo viewer.
- **Section names were blank in the SOP library** on the founder's screen ("· 5 SOPs"). Cause: his API terminal was still running an older build. The app now falls back to the plain name; the API terminal has to be restarted to pick up server changes.
- **The workbook's SOP steps are mostly shared**: 20 different sets of steps across the 265 operating SOPs, and one identical set for all 527 dishes. A few do not fit their title. This led to the 50 written-out SOPs; the other 215 operating SOPs and the dishes are still thin outlines.
- A profile test failed because the founder had renamed the sample Owner while testing. The tests now create their own throwaway login and neither depend on nor change the sample accounts.
- In Urdu a phone number came out reversed. Fixed.
- Hindi sentences built from an SOP's name read wrongly for some names. Fixed with a grammar rule in the loader.
- The side menu crashed the browser preview at first (an animation helper that does not exist on the web). Fixed.

### Left open at the end of the day

- **Retest on the phones.** Not yet rechecked after their fixes: the licence and staff buttons on Android, and the side menu on the iPhone. Never tried on a phone at all: raising an issue, the dashboard, the calendar, SOPs and the library, taking a profile photo with the camera or from the gallery, the language dropdown, and reading a real licence from a phone photo (it has only been tried with clear, typed samples).
- **The food-safety limits in the 50 written-out SOPs** (temperatures, cooling times, oil and chlorine limits, emergency numbers) follow FSSAI and FoSTaC guidance as Claude understands them. No food-safety professional has checked them.
- **No native speaker has read any translation**, in any of the eleven languages other than English.
- The holiday list is a sample written by Claude and needs checking against the Telangana government list.
- The seven standard SOPs are samples; ECCS's own are still to come.
- Whether to write out more of the library's SOPs, and whether to translate the checklist suggestion library.
- Urdu text reads right to left, but the screens themselves are not mirrored.
- Still to build in Phase 1a: checklists working without signal, and reminders.
- The founder has not yet chosen what to build next. Recommended: a round of phone testing, then Phase 1b, the service loop (booking, scheduling, the visit, sign-off, the service report).

### Carried over from 5 October

- Retest photo upload on the phone: done in the morning, it works.
- Choose the next feature: done, the founder chose each one through the day.
- Still parked: checklists without signal, reminders, console screens for ECCS to edit checklists.

---

## Monday 5 October 2026

The first day. Started from an empty Windows machine and ended with a working login, an ECCS web console and a complete daily checklist feature running on the founder's Android phone. 18 commits.

### Planning and setup

- Wrote the proposal: tech stack, roles and permissions, data model, pilot scope, roadmap and folder structure (`docs/PROPOSAL.md`).
- Read the founder's whiteboard photo (`image.png`), which listed twelve restaurant-app features, and folded all twelve into the pilot scope. The estimate moved from about 10 weeks to about 16 to 18.
- Created the status tracker (`docs/STATUS.md`) and the instructions file new Claude sessions read first (`CLAUDE.md`).
- Installed Git, Node 24, pnpm and the VS Code extensions. The founder enabled virtualisation and installed WSL2 and Docker Desktop.
- Scaffolded the project: a web app (Next.js), an API (NestJS) and a mobile app (Expo) in one repository.
- Started the local database, Redis and photo storage in Docker, and created the full database schema (about 48 tables) with sample restaurants, users and data.

### Login and roles

- Built the six roles (Super Admin, Operations Manager, Supervisor on the ECCS side; Owner, Manager, Head Chef on the restaurant side) with one shared definition of who may do what.
- First version of login used a phone number and one-time code for everyone. The founder then specified a different design, which replaced it the same day:
  - The Owner is onboarded once with a mobile number and one-time code, and is given a 4-digit PIN.
  - After that nobody at the restaurant uses one-time codes. Everyone logs in with a PIN, and whose PIN it is decides what they see.
  - A new phone is linked once by typing the outlet's restaurant code.
  - The Owner or Manager adds staff and is shown each person's generated PIN once.
  - No biometrics on the restaurant side. ECCS staff keep using a mobile number and one-time code.
- Built the mobile screens: welcome, restaurant code, PIN pad, phone number, one-time code, a home screen that differs by role, and a staff logins screen. English, Telugu and Hindi.

### ECCS web console

- Login for ECCS staff, a clients page listing every restaurant with its owner, outlets and restaurant codes, and "Onboard a restaurant", which creates the brand, its first outlet, a restaurant code and the owner's login in one step.
- Restaurant codes are also shown to the Owner and Manager in the app so they can hand them to staff.

### Daily checklists

Built in stages through the afternoon as the founder gave feedback.

- Read the founder's `FSSAI 2026 KITCHEN SAFETY CHECKLIST.docx`. Its daily opening and closing checks became two short basic checklists of five items each. Its 92 detailed inspection checks were set aside for the ECCS inspection feature.
- Filling in a checklist: a photo per item, OK or Problem, submit. Photos are stored privately and shown through links that expire.
- After the founder uploaded a first photo and asked how it looked: added a done or problem mark, a stamp on each photo with the date, time and name of whoever took it, and a full-size view.
- One checklist per outlet per day, shared by all head chefs. Once anyone submits it, nobody else can change it.
- The Owner or Manager can create extra checklists (for example a mid-day one), set due times, and add or remove their own items.
- A red clock on a checklist past its due time, and a red exclamation mark on one where a problem was reported. A problem must come with a reason.
- Loaded the founder's `Restaurant_Master_Checklist_Library.xlsx` (588 checks in 65 checklists) plus 52 checks Claude wrote for Indian kitchens. The add-item box now searches this library as the person types; they tap a match to add it or add their own text.
- Items can be "photo needed" (the default) or "tick only" for checks where a photo is not possible. Tick-only items are ticked with one tap.
- The founder called the checklist feature done for now.

### Decisions the founder made

- Approved the tech stack.
- Company-side roles are Super Admin, Operations Manager and Supervisor only. Technicians do not get the app.
- Android and iOS, on staff's own phones. All three languages.
- Use sample data for company details, prices, SOPs and certificates for now.
- All twelve whiteboard items are in the pilot. Attendance and salary are for the restaurant's own staff. The customer QR is a public page with the score, service times and photos. Food labels are printed.
- The login design described above, with restaurant codes and 4-digit PINs.
- Everything on the restaurant side must work in the mobile app.
- The checklist rules described above.
- Benched: adding a whole library checklist ("pack") in one tap.

### How it was tested

- 61 automated end-to-end tests on the API, covering login, roles, onboarding, checklists, photo upload and the library search.
- Claude clicked through the main screens in Chrome using the browser preview of the mobile app.
- In the evening the founder ran the app on an Android phone through Expo Go.

### Problems found

- **Photo upload failed on the phone** with "Could not reach the server", though it worked in the browser. Cause: this version of Expo no longer accepts the way the photo file was being attached. Fixed the same evening by reading Expo's own code; **not yet retested on the phone**.
- The image used for local photo storage (MinIO) is no longer published, so SeaweedFS is used instead.
- The database tool refuses to create migrations without a terminal, so migrations are generated a different way (noted in `STATUS.md`).
- Loading the first sample checklists wiped the database, including a test manager the founder had added. Later data loads were written not to wipe anything.

### Left open at the end of the day

- Retest photo upload on the phone.
- Choose the next feature.
- Parked checklist follow-ups: working without signal, reminders, Telugu and Hindi wording for the library, console screens for ECCS to edit checklists.
- Several choices Claude made during the build are marked "not yet reviewed by the founder" in `STATUS.md` section 3.
- Telugu and Hindi text throughout is machine-drafted and needs a native speaker's check.
