# ECCS Platform: Daily Log

A plain record of what was done each working day, newest day first. One entry per day, written at the end of the day.

How this differs from the other docs:

- `STATUS.md` says where the project stands **now** (what is built, decided, open). It is updated as work happens.
- `PROPOSAL.md` says **what** we are building and why.
- This file says **what happened when**. Entries are not rewritten later; a correction goes in the day it was found.

Each entry has the same parts: what was built, what the founder decided, what was tested and how, problems found, and what was left open.

---

## Tuesday 6 October 2026

*In progress. To be written up at the end of the day.*

**So far today**

- Started this daily log and wrote up 5 October.
- The founder retested photo upload on the Android phone: it works.
- Founder decision: problems noted on a checklist stay inside the restaurant and are never sent to ECCS. ECCS support is a separate channel; Head Chefs can raise issues there too.
- Built ECCS support. In the app: raise an issue (category, description, optional photos), see its status, exchange messages with ECCS, call or WhatsApp ECCS; the Owner or Manager can close or reopen an issue. In the console: an Issues page across all clients where ECCS replies and marks issues in progress or resolved.
- Tested with 8 new end-to-end tests (69 in total) and by clicking through the whole loop in Chrome: raised an issue in the app, replied and changed status in the console, saw the reply in the app. Not yet tried on the phone.
- Pushed the whole repository to GitHub at the founder's request: https://github.com/abdmath-eso/eccs.
- Founder feedback: the app's "Raise an issue with ECCS" and "ECCS support" pages were redundant. Merged them into one page named "Raise an issue" with the form, the call and WhatsApp buttons and recent issues, opened from a single home tile. On further feedback the form was tucked behind a "Raise an issue" button so the page opens showing only the button, the contact buttons and recent issues.
- Founder rule: commit locally through the day and push to GitHub once at end of day, when the founder says so.
- Founder decisions: ECCS staff can upload licences and documents for restaurants for now; documents can be PDFs or images.
- Built licences and the document vault. In the app (Owner and Manager): licences with their expiry date and a valid / expiring soon / expired state, add, renew and remove; a document vault; files added by camera or by choosing a PDF or image. In the console: a Licences page listing licences that need attention across all clients, and each outlet's licences and documents, which ECCS admins can add to.
- Tested with 15 new end-to-end tests (84 in total) and by viewing and adding a licence in Chrome in both the app and the console. Uploading a file through the screens was not tried by hand.
- Founder feedback on licences: when a new licence is added the old one should be replaced, not kept. Now an outlet holds one licence of each kind; adding the same kind again, or renewing with a new copy, replaces it and deletes the old document. The forms warn before this happens.
- Founder request: read the licence number and expiry date off the uploaded document instead of typing them. Founder chose to start with the free reader and add an AI reader later. Built it: the server reads images with OCR (Tesseract, on our own server) and PDFs from their text, and picks out the kind of licence, number and dates. In the app and the console the document is now chosen first, and the fields fill in for the person to check before saving.
- Tested with 5 more end-to-end tests (89 in total), unit tests for the date and number parsing, and in Chrome: renewing an FSSAI licence in the app and replacing an expired pest control contract in the console, both filled in correctly from clear typed sample images. Not tried with a real licence or a phone photo; the free reader is expected to miss blurred photos, scanned PDFs and Telugu or Hindi text.
- Founder confirmed the licence reading looks good and chose the restaurant dashboard as the next feature.
- Built the dashboard as the top of the app's home screen. For each outlet (all of them for the Owner, their own for the Manager): three numbers that can be tapped (checklists done today, licences to renew, open issues with ECCS), today's checklists with their status and a red mark when overdue, and the licences that are expired or expiring soon. The Head Chef sees only today's checklists. The hygiene score and upcoming visits are a one-line note until service visits are built.
- Tested with 6 new end-to-end tests (95 in total) and in Chrome as the Owner and as the Head Chef. Not tried on the phone.
- Founder asked for the history calendar to work like the iPhone calendar (reference picture `docs/screenshots/calendar-reference-iphone.png`): tap a date to see that day's status, and show upcoming services, licence due dates and holidays too.
- Built it. The History tile opens a month grid with small coloured labels in each day: checklists done ("2/2", red when missed), ECCS services, a licence expiring, a holiday. Tapping a day lists everything for it underneath, and a checklist there opens the full record. A "Coming up" list shows the next services and licence due dates. It goes a year back and a year ahead. For the Owner and Manager only.
- Holidays are a sample list written by Claude and need checking against the Telangana government list. Added 12 sample past service visits to the local data so past days have completed services to show.
- Tested with 6 new end-to-end tests (101 in total) and in Chrome as the Owner. Not tried on the phone.
- Founder feedback: the calendar looks nice. On the dashboard, showing every branch one under another was wrong; the Owner should pick a branch at the top, as in checklists and the calendar. And the menu should move off the home screen into a side menu.
- Changed the home screen accordingly: a branch selector at the top for the Owner (the choice is remembered and shared with the other screens), and a menu button that slides a panel in from the left with every section, the language choice and the Lock button. Checked in Chrome as the Owner: switching branch, opening the menu, opening a section from it.
- Founder decision: restaurants can add their own SOPs, not only read ECCS's.
- Built the SOP library. In the app everyone can read SOPs as numbered steps, grouped by category; the Owner and Manager can add, change and delete SOPs for their own outlet. In the console ECCS writes the standard SOPs, one language at a time, and publishes them. Loaded seven sample SOPs in English, Telugu and Hindi (hand washing, fridge storage, daily hygiene, chimney filters, pests, waste, gas and fire safety); the wording is Claude's and needs replacing with ECCS's own.
- Tested with 6 new end-to-end tests (107 in total) and in Chrome: read an SOP and added one as the Owner in the app, and opened the console page. Not tried on the phone.
- Founder asked for all the test logins in one document: wrote `docs/TEST_LOGINS.md` (restaurant codes, PINs, ECCS phone numbers, one-time code, what each role can open).
- Founder tested on the Android phone and sent two screenshots. Faults found: on a licence, "View document" was squeezed into a narrow column beside Renew and Remove; in Staff logins, New PIN and Remove access were different heights. Fixed both (the document button has its own row; side-by-side buttons now match in height). Waiting for the founder to recheck on the phone.
- Founder added a workbook of SOPs (`docs/Restaurant_SOP_Knowledge_Base_Expanded_Cuisine_Dishes.xlsx`) and asked for it to be fed in like the checklist library, delivered sensibly given how many there are, and categorised.
- Built the SOP library. Imported 792 SOPs (265 on running the restaurant, 527 dishes and recipes), sorted the workbook's 27 modules into 13 app categories, and added "Find a ready-made SOP" to the app: type and matches appear, or pick a category and section; open one to read it; "Add to my SOPs" makes the restaurant's own copy to reword.
- Found while importing: the workbook's steps are mostly shared between SOPs (20 different step sets across the 265 operating SOPs; one identical set for all 527 dishes), and a few do not fit their title. Recorded as an open question for the founder.
- Tested with 5 more end-to-end tests (112 in total) and in Chrome as the Owner. Not tried on the phone.
- Switched off Expo's generated route types, which kept causing false type errors while a dev server was running.

**Carried over from yesterday**

- ~~The phone photo-upload fix needs the founder's retest.~~ Done, works.
- The founder has not yet chosen the next feature. Recommended: issues and ECCS support.

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
