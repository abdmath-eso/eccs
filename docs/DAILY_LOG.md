# ECCS Platform: Daily Log

A plain record of what was done each working day, newest day first. One entry per day, written at the end of the day.

How this differs from the other docs:

- `STATUS.md` says where the project stands **now** (what is built, decided, open). It is updated as work happens.
- `PROPOSAL.md` says **what** we are building and why.
- This file says **what happened when**. Entries are not rewritten later; a correction goes in the day it was found.

Each entry has the same parts: what was built, what the founder decided, what was tested and how, problems found, and what was left open.

---

## Friday 9 October 2026

A day of acting on research. The founder had asked on the 8th what else the startup should do; the answer came back this morning, the founder picked from it, and two things were built: checks that make proof photos trustworthy, and seven new kinds of service in the catalogue. 8 commits. Pushed to GitHub at the end of the day, together with everything from 8 October, which had not been pushed.

### The research

- Five researchers worked in parallel on competitors, the compliance obligations of an Indian restaurant in 2026, the market and what restaurants pay for, technology features, and adjacent services. A sixth pass wrote the report, `reports/ECCS product growth ideas.md`; the researchers' notes are kept on this PC in `research_notes/` and are not in git.
- **Its conclusion:** sell inspection readiness, with the app bundled into service plans as proof of work, rather than widening the app or selling software by itself. The reasons given: in Hyderabad the real penalty is same-day closure and publicity rather than fines, and inspectors cite missing records as a violation; restaurants spend several times more on hygiene services than on software; and nobody found combines cleaning, pest control, inspections and a restaurant app.
- **Its weak points, stated in the report:** almost no reliable Hyderabad prices were found; most compliance facts come from explainers and not the regulation text; sources conflict on a few rules; and nothing shows a private hygiene score moves diners the way government grades do.

### Photo integrity

- Every proof photo (checklist, visit, inspection) now has its time checked against the server's, is compared with earlier photos from the same outlet, and, with the person's permission, has the phone's location compared with the outlet's.
- Doubtful photos are flagged, in words, for ECCS admins under visit and inspection photos, and counted in a new Photos column on the Monitoring board. The Owner and Manager see a neutral "matches one already used" line on a checklist photo. Nothing is blocked and the hygiene score is unchanged.
- An outlet's location can be set in the console or by the Supervisor during a visit.

### New services

- Seven new kinds of service with sample prices, tax codes and task lists in twelve languages: hygiene rating readiness, frying oil test, water test, staff medical camp, Food Safety Supervisor training, grease trap cleaning and a chemicals refill. Hood and duct cleaning with a certificate became one new bookable item under the existing chimney and hood kind.
- The oil test records a reading for each fryer with a verdict against FSSAI's 25% limit. Services a partner delivers record the partner's name and take the partner's document (lab report, audit report), which is filed in the outlet's documents.
- The app's booking list is grouped under five headings. The console's Catalogue page can now add a new kind of service, the gap noted when that page was built.

### Decisions the founder made

- Of the app ideas in the research, build only photo integrity.
- Bench the rest: corrective actions, a compliance file, a temperature log, a used-oil log, checklist behaviour flags, an equipment register, WhatsApp messages and audio SOPs. They are listed in `STATUS.md` section 3.
- Add all the services the research recommended.

Decided by Claude's workers and not yet reviewed by the founder: the distances, times and thresholds for photo flags; every new service's price, tax code, duration, task list and certificate setting; treating hood and duct cleaning as the existing kind; "close to the limit" from 20% on the oil reading. All are in `STATUS.md` sections 3 and 4.

### How it was tested

- 394 automated end-to-end tests pass, up from 347, in 23 files; 47 are new (26 for photo integrity, 21 for the new services). Unit tests cover the photo rules, the picture fingerprint (on pictures made by program) and the reading verdict.
- The full build, type check and lint pass on the final code with every language required to have every key.
- Claude read the app's new booking list on a test copy: all services present, grouped as intended.
- A new APK was built on this PC. It was not installed or run.
- Nothing from today was seen on a phone, and the photo flags in the console, the oil reading screens and the Catalogue form were not looked at on screen.

### Problems found

- **The APK build failed twice** with the Android folder "busy or locked". Cause: the helper that talks to a phone over USB (`adb`) had been started from inside that folder during the previous day's testing and kept it locked. Stopping it fixed the build, and the build script now leaves the folder before using that helper.
- **A plain picture fingerprint was not good enough.** The worker's first method called a re-saved copy of the same photo different; it was replaced with a comparison of a small grey thumbnail.
- **The workers' research turned up things that affect selling, not software:** no agreement exists with a rating agency, a lab, a clinic or a training partner; ECCS does not appear to qualify as a FoSTaC training partner itself; the lawful disposal route for grease trap waste in Hyderabad was not established; and the licence position for the pest control ECCS already offers is unconfirmed.
- **One finding touches what is built:** FSSAI licences reportedly became perpetual from 1 April 2026, which would weaken licence-expiry tracking and the 10 score points tied to licences. Not acted on; to be confirmed first.

### Left open at the end of the day

- **Testing by the founder** of everything from the afternoon of 8 October onwards: the new console and its desktop notifications with sound, the new services, and photo integrity (which needs the APK built today). Steps are in `docs/TEST_LOGINS.md` sections 15 and 16.
- **Before any new service is sold:** phone quotes for the four prices with no basis (oil test, grease trap, chemicals refill, full duct run); an accountant's view of the tax codes; and the partners and permissions listed in `STATUS.md` section 4.
- **The duplicate-photo check has only been proven on computer-made pictures.** The first weeks of real flags need watching before it is relied on.
- Staff should be told that their location is noted with proof photos.
- Phase 1d (attendance and salary, food labels, the customer QR page) has not been started. The research suggests testing two label printers first, keeping attendance and salary thin, and keeping the QR page clearly different from FSSAI's own rating.
- Still open from before: the ECCS logo; a real server for the API; ECCS's real GSTIN and bank details; real prices and task lists; a review of the translations and of the 50 SOPs; the holiday list.

### Carried over from 8 October

- The day's write-up and push, not done on the 8th: done today, below and above.
- Looking at the new console and turning on desktop notifications: still to do.

---

## Thursday 8 October 2026

*Written up on 9 October: the day was not closed on the 8th.*

The fourth day. It began with a small change to the monitoring board and ended with billing built, the app running as an installed Android app with push notifications arriving on the founder's phone, and the console reworked. 17 commits. Nothing was pushed on the day; it went to GitHub with 9 October's work.

### Morning

- **Monitoring.** The founder asked for the "actions overdue" flag to go, since without re-inspection nothing could clear it. The board now only counts the corrective actions on the latest report.
- **Phone testing.** The founder finished testing everything built on 7 October on the phone, including checklists, visits and inspections without signal: "everything is good".

### Billing (phase 1c)

- **Plans.** A Plans page in the console where ECCS creates and edits plans: name, price per cycle, a monthly, quarterly or annual cycle, and which services are included every how many days. An edit reaches existing subscribers only at their next cycle.
- **Subscriptions.** In the app the Owner subscribes, changes plan (from the next cycle) or cancels (at the end of the cycle), each undoable until it takes effect. ECCS can also pause, resume and cancel at once from the console.
- **Invoices.** A GST tax invoice is raised for each subscription cycle in advance and for a booked one-time visit when ECCS approves its report, numbered per financial year, with CGST and SGST or IGST by the buyer's state, and a PDF filed in the outlet's documents. ECCS can record payments by hand, void an invoice and raise it again.
- **Sample payments.** A payment screen in the app marked "Sample payment. No money moves.", which can be made to succeed or fail, behind an interface a real provider can replace.
- The founder tested billing on the phone the same day: "everything is good".

### The installed Android app and push notifications

- **Push, in code.** The app asks permission in its own words first, registers the phone at login and unregisters on Lock, and opens the right screen when a notification is tapped. The server sends each existing notification to the person's phones in their language. The console can send a test.
- **Android Studio** was installed by the founder, who accepted its licences; Claude pointed the PC at it and wrote `apps\mobile\build-apk.ps1`, which builds the APK here with no cloud service.
- **Accounts.** The founder created a free Expo account and a free Firebase project. Claude linked the app to the Expo project; the founder uploaded the Firebase key to Expo from the command line.
- **Delivery.** A test push arrived on the virtual phone on this PC, and, after some trouble, real notifications arrived on the founder's phone.

### The console

- A left side menu in three groups (Daily work, Client records, Set-up) replaced a top menu that had grown to twelve entries and wrapped. Every page got the same header, and long openings were folded behind "How this works".
- While the console is open in a browser tab, each new notification shows as a desktop notification with a chime and an in-page message, once however many tabs are open.
- The app's "Notifications are on for this phone" line was removed at the founder's request; the box now appears only when there is something to do.

### Decisions the founder made

- Remove the "actions overdue" flag from the monitoring board.
- Build billing now on sample prices: subscriptions and managing them, invoices, sample payments. This took plans out of the parking they were put in on 7 October.
- Test the app as an installed Android app with push notifications, and set up Android Studio on the PC.
- Before phase 1d, tidy the console to standard practice and notify on the PC with sound.
- No need for a line saying notifications are on.

Decided by Claude or its workers and not yet reviewed: listed in `STATUS.md` section 4 under "Subscriptions", "Invoices and payments", "Push notifications" and "Console".

### How it was tested

- 347 automated end-to-end tests by the end of the day, up from 273: billing and subscriptions, push, and the console's new "wait for news" request.
- Claude read the new billing pages on test copies, and looked at screenshots of the reworked Monitoring and Invoices pages.
- The first APK was installed on the virtual phone and driven by Claude: welcome, linking with a sample code, PIN login and Home, against the API on this PC.
- The founder tested billing and push on their own phone.
- Not tested by anyone: the real Windows desktop notification and its sound.

### Problems found

- **Push would not register on the founder's phone.** Google answered "SERVICE_NOT_AVAILABLE" through several installs and a restart, while the same build worked on the virtual phone and the phone's other apps received push normally. With the phone on USB, its log showed nothing wrong that Claude could find. It began working after one more fresh install. **The cause was never found**, so it may recur on Xiaomi, Redmi and POCO phones. The app now shows the phone's own error on the Notifications screen.
- **Android Studio's own Java (25) fails the Android build.** Java 17, which the build system had downloaded for itself, is used instead.
- **Two of Claude's first three build attempts failed through its own mistakes** in how the build was started.
- **The checklist tests tried to delete every file at a sample outlet**, which now includes filed invoice PDFs. Narrowed to checklist photos.
- **Claude deleted the founder's screenshot `docs/image.png`** while clearing its own temporary files, and told the founder.
- A permission change Claude tried while joining the two halves of billing broke seven tests and was taken back.
- Expo's website wizard for the Firebase key asked for a signing keystore, which a build made on this PC does not have; the command line avoids it.

### Left open at the end of the day

- The day was not closed, so there was no write-up and no push.
- The reworked console and its desktop notifications had not been looked at by the founder.
- The founder asked what else the startup should do; that research was started and reported the next morning.
- The phone must be on the same Wi-Fi as the PC, because the PC's address is built into the APK, until there is a real server.
- The app icon is still the Expo template's.
- No accountant has seen the GST treatment on invoices.

### Carried over from 7 October

- Phone testing of the afternoon and evening batches: done, all good.
- Pricing and plans: built on sample prices by the founder's decision.

---

## Wednesday 7 October 2026

The third day, and the longest. Started with the restaurant side of Phase 1a in place and no service side at all; ended with Phase 1b, the whole service loop, built as first versions, and the last two pieces of 1a (checklists without signal, notifications) done as well. Much of the building was done by workers running in parallel, each on its own part of the code, with Claude preparing the shared files first and checking everything together afterwards. 37 commits. Pushed to GitHub once, at the end of the day.

### Morning fixes

- **SOPs missing in the newer languages.** The founder's API terminal had been started before the translation work was built. Restarting it fixed that.
- **Languages mixing.** The founder sent three phone screenshots (in `docs/screenshots/`): with the app set to Bengali, the SOP library showed Marathi on the Android phone and English on the iPhone, and on first opening the language took some refreshing to appear. Cause: the screen followed the language chosen on that phone, the library's wording followed the language saved on the account, and the two had drifted apart. Fixed: the app sends the language on screen with every request and the server answers in it. The founder retested on the phones and confirmed it.

### The service loop

- **Booking and the visit.** The Owner or Manager books a service from the priced catalogue and sees what is coming up. In the console, ECCS confirms the day and time and picks the Supervisor on a new Visits page. The Supervisor checks in, marks each task done or not done with a reason, takes before and after photos, records the team and notes, and finishes.
- **Booking screen reworked** after the founder's screenshot: one row of dates to swipe, and two-hour arrival windows as large buttons, plus "After closing".
- **Sign-off with a rating.** The Owner or Manager signs off with one to five stars (required) and an optional comment.
- **ECCS approval and the PDF.** The order was corrected by the founder during the day and is now: the Supervisor finishes, the Owner or Manager signs off, ECCS approves the report in the console (or sends it back to the Supervisor with a required note), and only then is the PDF made, filed in the outlet's documents and opened from the app or console.
- **Reasons a task was not done.** The four placeholders were replaced with nine.
- **Visits from plans.** The server keeps the diary filled 30 days ahead from each outlet's plan; ECCS can put an outlet on a plan, change it or stop it. Parked by the founder the same day until pricing is final.
- **Scored inspections.** The founder's ten sections and 92 checks, scored and graded the FSSAI way, with screens for the Supervisor and the restaurant, a console page, and an eight-page PDF report made on ECCS's approval.
- **Service certificates.** When ECCS approves the report of a pest control, deep clean or chimney visit, a numbered certificate with validity dates is issued and its one-page PDF filed. A Certificates page in the console, a Certificates screen in the app, a button on the visit, and a setting per kind of service in Catalogue.
- **Monitoring board.** A console page listing every outlet, worst first, with a column each for checklists, issues, licences, visits, inspections and the hygiene score.
- **Console editing.** ECCS can change a client's and outlet's details, switch them off and on, issue a new restaurant code, unlink phones, reset an Owner's lost PIN, and manage the bookable services, prices and task lists on a new Catalogue page.

### Working without signal

- **Checklists** are saved on the phone first, answers and photos, and sent when the server answers, with a line at the bottom saying what is waiting.
- **The Supervisor's visit and the inspection** were put on the same mechanism in the evening. A whole visit or a whole 92-check inspection can be done with no signal once it has been loaded with signal. The server recognises a repeat of the same action, so sending twice is harmless. Work the office refuses (the visit was cancelled or reassigned meanwhile) is held on the phone with "Send again" and "Delete from this phone", never dropped.

### Hygiene score

- First built by a worker from the proposal's five parts plus the inspection. The founder asked how it worked, then set a different rule, which replaced it the same day: the latest approved ECCS inspection 60 points, licences 10, the day's checklists 30 (on time earns a checklist's full share, late half, missed nothing). An outlet not yet inspected is scored on licences and checklists alone and marked "Provisional".
- Shown on Home with its band and the change since last week, on its own screen with every part and a 30-day trend, and in a console panel.

### Screens, navigation and languages

- **The screen review.** After the founder's new rule on design (below), four reviewers read every app and console screen against published guidance and returned about 50 items (`docs/UI_REVIEW.md`). The founder approved all of it. Shared pieces were built first (a bottom bar, a page frame with a fixed top bar and pinned footer, a "saved" message, errors with a retry button), then five workers reworked the screens in parallel.
- **Bottom bar.** Owner and Manager: Home, Checklists, Services, Calendar, More. Supervisor: Home, Visits, Inspections, More. "History" was renamed "Service calendar", Issues moved under More, and More no longer repeats what is in the bar.
- **Smaller changes asked for by the founder:** the language choice moved from My profile to the bottom of the menu; icons were put back on buttons.
- **Urdu layout.** The whole layout now mirrors for Urdu at once, with no restart; digits, PINs and phone numbers stay left to right.
- **Notifications.** A list with a bell in the app and the console: 27 kinds fired by events and 7 reminders on a timer. In-app only; no push or SMS.
- **Translations.** About 550 new pieces of app text were written in English through the day and translated into the other eleven languages by translation jobs, each batch checked by program. The inspection checks stay in English by the founder's decision.

### Decisions the founder made

- Always research the design first and build the industry-standard pattern, for every screen from now on. Written into `CLAUDE.md`.
- Keep a register of every notification (`docs/NOTIFICATIONS.md`); they will be built and tested together later.
- A restaurant cannot cancel a visit ECCS has confirmed.
- The star rating at sign-off is mandatory.
- The order at the end of a visit: Supervisor finishes, Owner or Manager signs off, ECCS approves, then the PDF. Sending a report back needs a note.
- Arrival windows and working hours stay as they are for now.
- Plans are parked until pricing is final, and must be customisable and configurable by ECCS when we return to them.
- The 92 inspection checks stay in English only.
- The hygiene score rule: inspection 60, licences 10, the day's checklists 30; "done" and "on time" merged; "problems fixed" and "visits signed off" removed; provisional until inspected; no cap for a failed critical check; an inspection counts for 180 days.
- No re-inspection.
- The bottom bar and More menu as described above.

Decided by Claude or its workers during the build and not yet reviewed by the founder: listed feature by feature in `STATUS.md` section 4.

### How it was tested

- 273 automated end-to-end tests on the API, up from 122 at the start of the day, in 17 files. New today: visits, plans, notifications, inspections, the score, monitoring, the catalogue, certificates, and repeated sends from a phone.
- Unit tests for the first time: 39 on the shared rules (scores, inspections, certificates, slots) and 31 on the phone's offline queue.
- The full build, type check and lint pass on the final code.
- Claude went through the first version of the service loop by hand in Chrome (booked, confirmed, recorded, signed off, read the report), and later a sign-off with a rating. From the afternoon on, the Chrome window was hidden and screenshots failed, so new pages were opened on test copies and read as text only: Home, Notifications, Inspections, the score card and score screen, Certificates and Services in the app; Inspections, Notifications, Monitoring, Catalogue, Clients and Certificates in the console.
- Sample PDFs were made and read: a service report (two pages), an inspection report (eight pages) and a certificate (one page).
- The founder tested the morning's work on the phones ("it looks good"). Nothing built from the afternoon on has been tried on a phone.

### Problems found

- **An error box on opening the app**, reported by the founder in the evening. Cause: the new score chart set its direction in a way the browser version of the app refuses. Fixed. It was missed because the pages were being read as text, where an error box does not show.
- **The booking screen stayed busy** after sending when opened directly. Fixed.
- **Jumping to the first missing item did nothing** on screens that show "loading" first (a checklist, a visit), in the browser preview. Fixed in the shared page frame. Whether phones were affected is not known.
- **Four faults found by the screen review** were fixed, one of them introduced earlier the same day in the calendar.
- **The first certificate PDF ran onto a second page.** Fixed by its worker; a kind of service with a long task list has not been checked.
- **Claude started the test console with the wrong API address** once, which showed "Something went wrong" at login. Restarted with the right one.
- Test records left in the local data by the browser runs: two signed-off visits at Spice Route, Gachibowli (reports SR-2026-00001 and SR-2026-00003) and a filed sample report PDF.

### Left open at the end of the day

- **Phone testing of everything from the afternoon and evening:** checklists with no signal, notifications, an inspection and its PDF, the Urdu layout, the hygiene score, Monitoring, Catalogue and client editing, certificates, and a visit and an inspection in aeroplane mode. Steps are in `docs/TEST_LOGINS.md` sections 6 to 12.
- **The offline flows have never been run for real.** Their rules pass tests, but saving to a phone's storage, photos held as files, and sending on reconnection cannot be simulated from the PC.
- **Choices awaiting the founder** (`STATUS.md` section 4), among them: the monitoring thresholds, which are sample values; the certificate dates and periods; trusting the phone's clock for work done offline; what a switched-off restaurant sees; which inspection checks are critical.
- **A consequence of "no re-inspection":** corrective actions never close, so the Monitoring board will show "actions overdue" until the next full inspection. Claude offered to stop flagging them; not answered.
- **A closed day counts as missed checklists**, which now costs up to 30 points of the hygiene score that day.
- Notifications are in-app only, and most rows in the register are not built.
- Still sample data: prices, task lists, company details and logo on the PDFs, the holiday list, the seven standard SOPs.
- No native speaker has read any translation, and no food-safety professional has checked the 50 written-out SOPs.
- Pricing and plans, parked.
- Next to build, when the founder says so: Phase 1c, billing.

### Carried over from 6 October

- Retest on the phones: the founder tested in the morning and reported it looks good; the individual fixes were not ticked off one by one.
- Urdu screens not mirrored: done.
- Still to build in Phase 1a (checklists without signal, reminders): both done.
- Choose what to build next: done, the founder chose the service loop and each piece after it.
- Still open: the food-safety check, the translation review, the holiday list, the standard SOPs, whether to write out more library SOPs.

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
