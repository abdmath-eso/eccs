# ECCS Platform: Daily Log

A plain record of what was done each working day, newest day first. One entry per day, written at the end of the day.

How this differs from the other docs:

- `STATUS.md` says where the project stands **now** (what is built, decided, open). It is updated as work happens.
- `PROPOSAL.md` says **what** we are building and why.
- This file says **what happened when**. Entries are not rewritten later; a correction goes in the day it was found.

Each entry has the same parts: what was built, what the founder decided, what was tested and how, problems found, and what was left open.

---

## Friday 16 October 2026

*In progress. To be written up at the next end of day.*

**So far**

- The founder said to continue. Stage B2 of the business dashboards was started: the BDE's own screens on the phone (Home with Do today, a lead logged from a photo of the shop board read by AI, their leads and steps, a short free-check scorecard, all usable without signal). One builder is on it, with a brief that also asks it to measure the shop-board reader on drawn boards before calling it done.
- The founder asked whether BDE screens on the phone were needed. Claude said not strictly (a BDE can work leads in the console, also in a phone's browser), set out what the phone app adds (no signal needed, the shop-board photo read by AI, a Call that logs itself, the scorecard) and offered to stop the builder. The founder said to keep it.
- **Stage B2 built:** the BDE's phone app (Home with Do today and the week against target; Leads; the lead page and its steps; Log a lead from a shop-board photo read by AI; the ten-point free-check scorecard shared on WhatsApp; quotes on WhatsApp; offline through the outbox), and the board photo and scorecard on the console's lead page. The shop-board reader was measured on 12 drawn boards: 47, 48 and 47 of 48 fields right, about US$0.0004 a board. The 234 new lines of text were translated into the 11 other languages. Tested by program: shared rules 610 tests, the whole server suite (37 files, 690 tests) run alone, the phone's offline tests (41), type checks and lint on all three apps; seen by Claude in the browser preview at 390 wide. Not yet tried by the founder, and the camera, dialler, WhatsApp and offline use are untried on a real phone.
- The app showed "Could not reach the server" in the browser with the API running: the router had given the PC a new Wi-Fi address (192.168.1.21, was .40). Claude pointed the app at the new address; the founder restarts Expo. The 15 Oct APK has the old address built in.
- The founder asked whether the BDE app is connected with the Sales dashboard (yes: the same leads, steps, targets and quotes), then said "go" for Stage C, Team. One builder started on it.
- **Stage C built:** Team in the console: the team list (who is in today, each person's week, what to keep an eye on, salaries for the Super Admin); each person's page to the founder's design (keep an eye on, three cards against target, the last 14 days read from each person's first lead step, visit or action of the day, leave, what the app found); adding a team member, now the one way to make an ECCS login, and marking one as left with their open leads handed over first; and salaries into Finance's Salaries line, one row a person a month that can only be marked paid there. A new record keeps each lead's next-step due time from today, for "follow-ups on time". The team sample is loaded (₹1,68,000 a month against the ₹1,70,000 budget); the Finance sample's two typed salary rows were removed so nothing counts twice. Tested by program: shared rules 640 tests, the whole server suite (38 files, 710 tests) run alone, type checks, lint and builds on all three apps; seen by Claude on test copies at 1280 and 390 wide. Not yet seen by the founder.
- The founder asked for onboarding of a new employee in the console, researched well. Claude looked at how BambooHR, Keka, greytHR, Zoho People and cleaning-company checklists do it, and at the Indian rules (the labour codes' appointment letter, Aadhaar masking under the DPDP Act, police verification in Hyderabad, FSSAI's medical fitness for kitchen work), and started one builder on Stage D: a checklist per new hire by role and phase, the joining file and documents the new hire fills in themselves, the appointment letter, the staff handbook, and their own "Joining ECCS" page.
- **Stage D built:** onboarding a new employee in the console: Start onboarding on adding a team member or for someone already working; the checklist by phase at the top of the person's page, from a template per role the founder can change, with seven tasks that tick themselves; the joining file (ID kept as type and last 4 digits only, bank and PAN masked), documents accepted or sent back, the appointment letter as a PDF with the labour codes' particulars, accepted by the new hire or signed on paper, and the staff handbook, all seen only by the Super Admin and the person; the new hire's own "Joining ECCS" page, made for a phone's browser; Joining on the Team list. Kiran (sample), a Supervisor joining Mon 19 Oct, is loaded part-way through. Tested by program: shared rules 669 tests, the whole server suite (39 files, 730 tests) run alone, type checks, lint and builds on all three apps; seen by Claude on test copies at 1280 and 390 wide. Not yet seen by the founder; a lawyer or CA should check the letter's terms.
- The founder asked for ECCS Buddy, an AI chatbot in the app for the Owner and Manager that answers any restaurant or app question, does what they ask in the app (book services, add checklists, SOPs and more), with a mic as well as typing. Claude researched assistants that take actions (Shopify Sidekick's approve-each-change, agent-UX guidance), chatbot design (NN/g), voice dictation (OpenAI's, editable before sending) and speech recognition in Indian languages, and started one builder on Stage E: every change through a confirmation card the person taps, nothing about attendance, pay or faces, the model chosen by measuring Haiku and Sonnet.
- First measuring (41 sample requests in English, Hindi, Telugu and Hinglish): Haiku 5.5 got 38–41 right per run at about ₹0.05 a message, Sonnet 5.5 37–39 at about ₹0.70, so Haiku was the default. The founder then asked for Buddy to be "adaptive and really smart" and for its security to be "perfect": no abuse, no personal or coding questions, only the app and relevant general answers. Claude added to the builder's work a harder test set to settle the model, and server-side protection: a check of each message by a small model, a check of each answer, limits, a pause for repeat abusers, and a red-team test of about 40 attacks.

---

## Thursday 15 October 2026

*In progress. To be written up at the next end of day.*

**So far**

- The founder asked what the AI licence reader is. Claude explained it and that ECCS staff in the console still had the free reader; the founder asked for the AI reader there too. A job built it to match the app, with the document beside the fields on a computer screen, as expense apps lay it out. One real call (US$0.0003), nothing saved. The `ai`, `ai-part2` and `licences` end-to-end suites pass. Claude also fixed the Licences page scrolling sideways on a phone, which the job found.
- The founder asked for logs in the console of everything that happens in the restaurant app, the console, the Supervisor's app and the AI, with filters such as only restaurant logs or one restaurant. Claude looked at how GitHub, Stripe and WorkOS lay out their audit logs and set it as two jobs, the recording on the server first and then the console page. What is kept out, and why, is in STATUS once it is built.
- The first job built the recording: a new log table; every one of the 146 server routes that change something carries a name, and a test fails if a new one does not; logins, wrong PINs and codes, lock-outs; reports and documents opened; every AI request with its cost (the 50 earlier ones copied in); and the server's own work. Kept out: PINs, codes, tokens, typed text, what checklist problems were, staff names, times and amounts, and clock-ins altogether. A test scans every row it makes for any of these. 613 end-to-end tests pass.
- The second job built the page: tabs for each app and for AI and the system, a period, search, filter menus with counts, chips, every filter in the page address, a side panel with all the details and links, live mode and CSV export. It took pictures at computer and phone width, shortened what wrapped or shouted, and checked 24 things in a browser (the address, Back, the panel, load more, export, live). Claude looked at the pictures and let the browser read the export's row count.
- Claude's final full test run failed three log tests that had passed for the job. Running the log tests over and over found two timing faults in the writer, which saves rows in small batches a quarter of a second apart: a request asked to "save everything now" could return while an earlier batch was still being saved, and marking an AI answer as accepted could look for its row in that moment, find nothing, and lose the mark. Both now wait for a save already under way; a third failure was the test itself picking one of two rows at random. The log tests then passed ten times running, and the whole suite (613 end-to-end tests) and 525 shared unit tests pass.
- The founder reported, with a screenshot of a checklist in Hindi, that the AI was not translating every item the restaurant adds: "Check for water leaks." was still in English. The database showed every own item had either all twelve languages or English only. Two groups had been missed: suggestions picked from the checklist library, which Claude's brief of 14 Oct had wrongly called translated already (the library is English only), and items saved before the AI existed or while the founder's server ran older code, since translation happened only at saving. A job fixed both: a suggestion is now translated once, the first time it is picked, and kept for every later pick; and an hourly filler gives any own item, checklist name, SOP or label name the languages it is missing, never changing what is there. Its first run filled the sample restaurants' 29 untranslated texts for US$0.006, and none is left short. 622 end-to-end tests and 528 shared unit tests pass.
- The founder reported, with a screenshot, that a photo of a cook in a clean chef's coat and hairnet, for "Staff in clean uniform, hair covered", got "This photo doesn't seem to show ...", and that the Retake button broke its word over two lines. The AI's instructions had named "a person instead of the place" as the wrong subject and told it never to comment on people. Claude pointed out that staff photos, faces included, go to Anthropic, and offered to keep the AI off staff checks; the founder said to keep it. A job rewrote the instructions so that for staff checks a person is the right subject and only the items the check names are judged, never who the person is or anything else about them, and let the two buttons wrap onto two rows when they do not fit. Four real tests on drawn cooks were all right ("Hair is not covered.", "The uniform has visible stains and spatters across the front.", and the wrong subject for "Floor mopped and dry"), for US$0.0009.
- The founder then asked for the camera check to understand any item a restaurant adds ("TV is on", "the doors are locked"), not only the kinds its instructions had examples for. Claude looked at how it is done (Taqtile's AI Verify and Xenia check each photo against a short standard for that step; research finds a fixed standard per task works much better than asking cold; Anthropic's vision guide) and set a job to give every item its own photo standard, made once by AI and kept, and to measure the result on 20 kinds of item with both models before saying it works.
- The job built it: a standard for each item, written once by AI and kept (on a library suggestion too, so later picks get it free), and the photo judged against it, never "not done" where a photo cannot show the check. On drawn pictures of 22 kinds of item, 54 cases, Haiku was right 54 and 53 times in two runs and Sonnet 53, and no correct photo was wrongly flagged; Sonnet cost about 20 times as much and was no better, so Haiku stays. The first version of the instructions got 50 of 54; the job fixed two ambiguous drawings and the rules, tried a stricter rule that made things worse and dropped it, and kept one line: shine, reflections and shadows are not dirt. The founder's staff case gave the right answers again. Measuring cost US$0.44, the most spent on any one thing so far. 632 end-to-end tests and 536 shared unit tests pass.
- The founder asked for the APK. It was ready at 3:44 pm, after 12 minutes.
- Of the questions Claude asked about the camera check, the founder answered one: "app should send todays date". Claude made the server send the checklist's day, written as Indian kitchens write it, with a line telling the AI to use it only for dated things (a register's row for the day, a dated label, the day's specials) and never to guess; a job tested it on drawn registers, boards and labels. All 7 dated cases were right in two runs, a floor photo with an old calendar on the wall was rightly left alone, but Claude's wording made the AI quicker to say "not done" in general: a closed gas valve, right in every earlier run, was flagged 3 times in 5. The job reworded the line to start from "ignore it unless the check is about something dated"; after that no correct photo of the 54 earlier cases was flagged. US$0.055. 632 end-to-end tests pass. The founder restarted the API at 3:55 pm and was testing on the phone meanwhile.
- The founder decided that the Owner should not see an item's photo standard ("owner should not see it"); it stays on the server, as built.
- The founder added three PDFs of their own designs for the console: a Finance dashboard, a Sales dashboard (a CRM) and one salesperson's Team page, and asked for them to be built for the founders to manage the business. Claude read them (moved to `docs/design/`), worked out what each figure needs and which the app already has (invoices, payments, plans, visits, ratings, AI cost) and which are new (expenses, budgets, founders' money, leads, quotes, a BDE role, targets), looked at how Pipedrive, LeadSquared and Zoho Books design the same screens, and split the work into four stages built one after another: Finance; Sales in the console; the BDE in the app; Team. Stage A, Finance, was started.
- Stage A was built to the founder's design: the six cards, collected against expenses by week, spend against a lean or full budget by line, founders' money and runway, daily cash flow and the cash balance, today's cash, spend by type, the expense book with receipts and visit links, collections ageing with Remind (WhatsApp), payouts due with Mark paid, and three CSV files for the CA. Invoices, payments, plans and the AI cost come from the app; expenses, budgets, founders' money and the opening balance are new, with sample data loaded (73 expenses, the two budgets, the founders' ₹6,00,000). Super Admin only. 654 end-to-end tests and 557 shared unit tests pass. Claude looked at the pictures.
- The founder reported "AI inspection-summary not asked: OUTLET_LIMIT". Spice Route, Jubilee Hills had used US$0.50 of AI that day, against its US$0.25 daily allowance, almost all of it Claude's own measuring of the camera check, so the founder's inspection summary was refused. Claude made ECCS's own AI work (the inspection summary and the Monitoring digest) count against ECCS's overall daily limit only, with a test, and will run real-AI tests on a throwaway outlet from now on.
- Stage B1 was started. While it was being built, the founder rebuilt the API (Claude had suggested restarting it without waiting for the builder), the build hit the half-done code, and because a failed build deletes the API's last good build, the API was down. Claude asked the builder to make the code compile first, checked it, and the founder started the API again. Claude will not ask for a rebuild while a builder is working.
- Stage B1 was built to the founder's Sales design: a new ECCS role, BDE (sales executive), who sees and changes only their own leads; leads that move from New to On a plan by themselves as steps are logged, with First job and On a plan read from the client's own visits and plan; quotes with a public link that records when the owner opens it, sent through WhatsApp; Do today, stale leads and Likely to close worked out from rules; targets per BDE reset each Monday from the last two weeks; growth with a forecast to 31 December; where first jobs came from. 167 sample leads and three sample BDEs (Ravi, Sana, Imran) are loaded. 672 end-to-end tests and 598 shared unit tests pass. Claude looked at the pictures.

---

## Wednesday 14 October 2026

The day AI came into the app. The morning went on terms and privacy: five documents drafted for a lawyer, and an agreement screen at first login. The afternoon went on six AI features using the Claude API, which were built, looked at with the real AI, cut down and corrected, and then widened at the founder's word so that the camera judges whether a check looks done. Four APKs, each at the founder's word. 16 commits. Pushed to GitHub at the end of the day.

### Terms and privacy

- The founder asked for a really good Privacy Policy and Terms, any other documents the app needs, agreement to them at first login (the Owner after the one-time code, Managers and Head Chefs after their PIN), the agreement saved before access is given, and the documents kept in the profile; and to look at TrustPlate's documents.
- Two jobs ran side by side. One researched Indian law (the IT Act and SPDI Rules in force now, the DPDP Act and Rules 2025 as they start, consumer law, GST record-keeping, Google Play's and Razorpay's requirements, clickwrap contracts) and drafted five documents in plain English, about 14,500 words: Terms of Service, Privacy Policy, Refund and Cancellation Policy, Data Processing Terms and a Disclaimer. Every company detail is a placeholder and 72 business choices are marked [to confirm]; notes for the founder and the lawyer are in `docs/LEGAL_NOTES.md`. The other built the agreement screen, a stored record of each agreement with a fingerprint of the exact text, a refusal by the server until people agree, Profile > Legal, and public pages at `/legal/<name>`.
- The founder tried it on the 1:15 pm APK and said it came out well.

### Clock in / Clock out missing

- The founder found Clock in / Clock out gone from the PIN screen. The phone had been linked to the whole restaurant by the Owner's number-and-code login, which Claude's test steps had offered as one way to see the Owner's agreement, and such a phone hides the button by design. Nothing was broken. The test steps now warn about it and say how to get it back.

### AI in the app

- The founder asked where AI could go now, with US$100 of Anthropic credit for testing. Claude answered from the 12 Oct report, after checking Anthropic's current models and prices, with six uses where a person confirms the result. The founder said "Add 1,2,3,4,5,6" and saved the key in the server's `.env`.
- Two jobs built them one after the other. First the shared AI part: called only by the server, an off switch, daily limits of US$2 overall and US$0.25 per outlet, a record of every request with its cost and no text or pictures, and a pretend engine for the tests. Then (1) a licence read into the form, (2) translation of support messages and of the restaurant's own checklist items, SOPs and label names, (3) "Why this score?", (4) a daily digest on the console's monitoring board, (5) a draft inspection summary for the Supervisor and (6) a nudge at the camera for poor proof photos. Claude Haiku 5.5 does the quick jobs; Sonnet 5.5 the digest, the summary and licences Haiku cannot read.
- A third job looked at every screen with the real AI. Every fact and number was true, but several screens were longer or less clear than they should be. A fourth job fixed them: "Why this score?" is two sentences with no numbers; the licence picture opens full size, with one AI line instead of four and a warning when renewing with the wrong kind of licence; "Translated by AI" in the app and the English in the console's issue list; the summary box grows with its text; the digest follows the board's order.
- Seeing the fixed screens again with real calls caught the inspection draft saying "Six sections scored 100" when five had. The app now hands the model the counts and refuses numbers written in words.

### The camera judges whether the check looks done

- The founder asked whether the nudge reads a restaurant's own items, such as "Water bottles empty and clean". It did read the wording, but judged only whether the photo was usable and of the right thing. The founder decided it must judge the check itself and say so without enforcing it. A photo that clearly shows the check is not met now gets "This may not be done yet: Two of the four bottles still have water in them." in the person's language, with Retake and Keep it. Nothing is marked, failed or reported, and each verdict and whether the photo was kept is recorded so that its mistakes can be counted.

### Decisions the founder made

- Draft the terms, privacy policy and any other documents the app needs; agreement at first login before anything else; the documents kept in the profile.
- Add the six AI features, with the key on the server.
- The camera nudge judges whether the check looks done and says so, never enforcing it: "the user can simply click on keep it if ai is wrong".
- APKs at 11:47 am, 1:15 pm, 5:11 pm and 6:06 pm.

Decided by Claude and its workers and not yet reviewed by the founder: the wording of the agreement boxes, and that the documents are in English only; the AI spending limits; that restaurant users read the inspection summary in English; that ECCS staff keep the free licence reader in the console; that a "not done" answer with no reason shows nothing; that "Other languages filled in by AI." shows only once something is typed. All are in `STATUS.md` sections 3 and 4.

### How it was tested

- 580 automated end-to-end tests pass in 31 files (57 new today), with 503 shared unit tests and the app's 31 offline tests. The type checks and lint pass with every language required to have every key.
- By Claude, in a browser at phone size and in the console, on test copies of the server, the app and the console with throwaway logins removed afterwards: the agreement screens and Profile > Legal; every AI screen with the real AI, before and after the fixes.
- Real AI calls by Claude's jobs, all on sample data and drawn pictures: 25, about US$0.056.
- **By the founder, on a phone:** the terms and agreement screens. The record of AI requests also shows the AI features in use on the founder's server after 5 pm: 15 proof-photo checks (several retaken), four licence reads (twice Haiku could not read the number or expiry date and Sonnet read it), one "Why this score?" and two of the restaurant's own items translated. The founder has not yet said how they went. All 49 real AI calls of the day cost US$0.082 (about ₹7).
- Not tried by anyone on a phone: support translation, the daily digest and the inspection summary.

### Problems found

- **The key was not in the saved file** when the founder said it had been added: the editor had not saved `.env`. Found by checking for the line without reading it.
- **Claude's test steps cost the founder Clock in / Clock out** by suggesting the Owner's number-and-code login (above).
- **AI screens longer and less clear than they should be**, found only by looking at real pictures: an explanation that repeated the list above it with numbers that seemed to contradict the cards, a licence picture too small to check against, a summary box that cut off its own text, a digest in a different order from the board, and an English language name inside Telugu text.
- **An AI draft miscounted** ("Six sections scored 100" when five had): a number written as a word passed the number check. Closed.
- **Two notification numbers clashed**: the terms rows were L1 and L2, already the licence reminders. Renumbered G1 and G2.
- **One inspection test runs close to its time limit** and failed while Claude ran other checks alongside; it passes alone.
- **The issues test suite deletes every checklist record at the Deccan Biryani outlet** when it cleans up. It was already so; noted in STATUS.

### Left open at the end of the day

- **For the founder to try:** rebuild and restart the API (`pnpm build`, then `pnpm --filter @eccs/api start`), install the 6:06 pm APK, and follow `docs/TEST_LOGINS.md` sections 21 and 22. Use sample documents and photos with the AI features: what they send goes to Anthropic in the US.
- **Decisions waiting** in `STATUS.md` section 4: the AI spending limits; whether the Privacy Policy and Data Processing Terms name Anthropic now or at the lawyer's review; how long to measure the camera nudge before trusting it; translating the inspection summary; the AI licence reader in the console; a morning notification for the digest; and the 72 [to confirm] choices in the legal drafts.
- **For a lawyer:** the five drafts with `docs/LEGAL_NOTES.md`, which now includes point 12 on AI.
- Still open from before: the three questions the viability report turns on, and Y Combinator (deadline 2 November 2026); the ECCS logo; a hosted server; a registered company; real prices; a review of the translations and of the SOPs.

### Carried over from 13 October

- Not reported on yet: the shortened customer page, the attendance roles and the vendor directory on a phone, and the BD briefing. The decisions listed on 13 Oct are still waiting.

---

## Tuesday 13 October 2026

The day the founder tested on the phone and sent things back. The customer QR page was rebuilt to the founder's design and then, after a try on the phone, shortened. The attendance page was put back as it had been, and who may see and change attendance was tightened. Two new things were added: a vendor directory and a briefing document for business development staff. 16 commits. Pushed to GitHub at the end of the day.

### A server that would not start

- The founder restarted the API and the app said "could not reach the server". Docker Desktop was open but its engine had stopped, so the database, cache and file store were down, and the API waited for ever at start-up without a word. Claude restarted Docker and the three containers; the data was intact.
- The API now checks the database at start-up and stops within about 10 seconds with one plain sentence that names Docker Desktop.

### The attendance page, and the branch chooser

- The founder saw the 12 Oct redesign of the attendance page and asked for it to be reverted. It is back to a card for each person with the counts at the bottom.
- The founder liked the one-line branch chooser on the Staff page and asked for it wherever the Owner picks a branch. It is now one shared piece on sixteen more screens and forms.

### The customer QR page, twice

- **To the founder's design:** the page shows yesterday's hygiene score, the daily checklists and a few photos, even before ECCS has inspected, adds the inspection once there is one, and carries a disclaimer that ECCS is a private company paid by the restaurant and is not associated with FSSAI, TG-SAFE or any government body. The Owner or Manager puts forward photos from the outlet's own daily checks, and ECCS approves each one.
- **After the founder tried it on the phone:** no photo could be chosen, and the page was "too cluttered, too much text and too long". The photos were missing because every one was marked "taken about 9 km from the outlet" (the sample outlet's saved place is elsewhere) and the screen left marked photos out without saying so. Such photos are now offered with the distance shown, to the restaurant and to ECCS. The Owner's screen now starts with the page's switch, then the photos, then the QR code, with the explanations folded into three lines that open. The public page has the score on its first screen with a short disclaimer directly under it and the full one at the end; it went from 6.3 phone screens to 4.4.

### Who sees and changes attendance

- The founder asked why the Head Chef could see attendance, and said a Manager must not be able to change their own. The Head Chef now has no attendance page and no staff list.
- Nobody but the Owner changes their own record: a Manager reads their own attendance, pay and details but cannot edit them, and cannot clock themselves in with their own PIN. This follows how attendance and payroll systems separate a manager's own record from the team's.
- The rule needs each Manager's login linked to that Manager on the staff list, and none was. The Owner's Staff screen now shows a card for each unlinked Manager login.

### A vendor directory

- A new page, "Vendors", for the Owner and Manager: suppliers who sell in bulk to restaurants, the whole directory sorted nearest first from the outlet's saved place, with search, category chips, and Call, WhatsApp and Directions on each row. A short page for each vendor shows the FSSAI number.
- 24 invented sample vendors in real Hyderabad localities. The app never dials a sample and does not show its made-up number.
- Not built: a way for ECCS to add real vendors.

### A briefing for business development staff

- `docs/ECCS briefing for the BD team.pdf`: 15 pages in simple English with pictures of the app. What ECCS is and sells, the app and console, a restaurant's journey, what is ready and what is not, what never to say (above all, that the score is a government or FSSAI rating), owners' questions, a word list and a first-meeting script. No prices and no contact details.

### Decisions the founder made

- Revert the attendance page; put the one-line branch chooser on every page where the Owner picks a branch.
- The customer page's contents and disclaimer, and that it must be shorter with the main part first.
- The Head Chef does not see attendance; a Manager cannot change their own.
- A vendor directory for the Owner and Manager, nearest first, with sample vendors for now.
- No new APK for the vendor directory. Claude had built two that afternoon without being asked; APKs are built only when the founder asks.

Decided by Claude and its workers and not yet reviewed by the founder: offering photos taken far from the outlet instead of barring them; the short disclaimer's wording; how far the own-record rule reaches (pay, the staff record, the PIN fallback) and that only the Owner still corrects attendance; the vendor categories, 5 km as "near", how the FSSAI number is shown and that samples are never dialled; and the blunt page in the briefing that says ECCS is not yet registered and has no customers. All are in `STATUS.md` sections 3 and 4.

### How it was tested

- 523 automated end-to-end tests pass in 28 files, and 439 unit tests. The type check and lint pass with every language required to have every key.
- **By the founder, on a phone:** the customer page from the 3:08 pm APK, which is how the two problems with it were found.
- By Claude, in a browser at phone size on test copies of the server and app: the customer page (the public page from invented data, the Owner's screens with the founder's own test photos), the attendance roles with the sample logins, and the vendor directory. The briefing was checked page by page as pictures.
- The newest APK is from 4:58 pm. It has everything except the vendor directory.
- Not tried by anyone on a phone: the shortened customer page, the attendance roles, and the vendor directory, whose Call, WhatsApp and map links have not been opened on a real phone.

### Problems found

- **Docker's engine had stopped** and the API gave no sign of why. Why the engine stopped is not known; the PC had run low on memory the day before.
- **An APK was again ready without the founder being told** (1:01 pm). The build script now stops the build tool's helper, and the next builds reported at once.
- **The PC ran short of memory** in the early afternoon with the founder's Expo terminal at 4.8 GB, so for a while nothing could be looked at on a screen.
- **Claude's first guess about the missing photos was wrong** (that reviewing a checklist changes its status). The database showed the real cause. The deeper fault was leaving photos out without saying so.
- **Two older faults on the public page**, found by looking at pictures: photos drawn far taller than their shape, and two photos side by side running off the screen when a picture failed to load. Both fixed.
- **A Manager could change their own pay and clock themselves in by PIN.** Found while working on the founder's attendance question; closed.
- **Claude built two APKs without being asked.** The founder stopped the third.
- **A picture meant for the briefing showed a tester's name and profile photo.** It was retaken without them before use, and the staff list and invoices were left out of the document.

### Left open at the end of the day

- **For the founder to try:** restart the server (`pnpm build`, then `pnpm --filter @eccs/api start`) and follow `docs/TEST_LOGINS.md` section 17 (steps 13 to 15), section 19 and section 20. The vendor directory needs a new APK, or the Expo terminal.
- **For the founder to read:** the BD briefing, above all page 3 (the services in plain words) and page 12 (what is not ready), before it is shared.
- **Decisions waiting** in `STATUS.md` section 4: whether a Manager may correct the team's attendance; a "My attendance" page for each person; who adds real vendors and whether ECCS checks their FSSAI numbers; photos taken far from the outlet; the short disclaimer.
- Still open from before: the three questions the viability report turns on, and Y Combinator (deadline 2 November 2026); a lawyer on the consent notice and on the customer page; the ECCS logo; a hosted server; a registered company; real prices; a review of the translations and of the SOPs.

### Carried over from 12 October

- A new APK with the pay rules and plainer screens: built today.
- The attendance screen made "less cluttered" on 12 Oct: its day view was reverted today at the founder's word; the one-line branch chooser from the same change was kept and spread to every screen.

---

## Monday 12 October 2026

The day face attendance met a real phone. The founder tried it for the first time, sent it back twice to be made simpler, and then moved on to how pay is counted and to three questions about the business itself: a pitch deck, where AI fits, and whether the company is viable and should apply to Y Combinator. 12 commits. Pushed to GitHub at the end of the day, together with everything since the push on 9 October.

### Face attendance on a phone

- The founder ran `pnpm install`, which let a camera component be added. The first version was a camera inside the app with an oval and a countdown. The founder called it primitive and asked for it to work like face unlock: move the face around to add it, no photo-taking to recognise it.
- It was rebuilt with face detection on the phone (VisionCamera with Google ML Kit). Adding a face is one scan: the person moves their head in a circle and marks round it fill in as five poses are captured. Clocking in locks on by itself when the face is centred and steady and catches a small head turn by itself. A sure match shows the name for three seconds with "Not me" and then marks it; an unsure one still asks.
- The founder installed the APK and it worked, after one false alarm (see problems). Two changes followed from trying it: the clock screen now says when nobody at the outlet has a face added, and every scan switches between in and out.

### Pay rules and plainer screens

- A person added with no joining date gets today's, and pay for the first month counts from that day. People already on the list with no joining date count from the day they were added to the app.
- The Owner chooses, per outlet, the days a month's salary is divided by: the month's own days, always 30, always 26, or another number. The pay screen shows how the figure was reached. A month keeps its number once paid or saved.
- The attendance day view became a plain list with a strip of count chips that filter it, and on all staff screens the outlet chooser became one line that opens a list.

### A pitch deck

- Ten slides, made as a slide Artifact that is private to the founder until shared and is not in the repository. Prices, market size, customers, the team and the amount to raise are left as brackets, because there was no source for them.

### Research: where AI fits

- `reports/ECCS where AI fits.md`. Sixteen possible uses in three groups. Build first: reading a document into the vault form, translating what people type, a nudge at the camera when a proof photo is unusable, a draft of the inspection write-up, and a daily digest. Not for AI: face attendance, the score, inspection marks, attendance or pay. The key stays on the server. Cost at pilot scale: a few hundred rupees a month. Nothing was built.

### Research: is the business viable, and Y Combinator

- Seven lines of research and a report, `reports/ECCS viability and YC fit.md`.
- **Its verdict:** viable as a specialised hygiene-services company for Hyderabad kitchens, with the app as proof of work, if a paid pilot shows that restaurants pay something near Rs 6,000 a month and renew, that crews stay busy within a few neighbourhoods, and that the work stays specialised. Not a venture-scale business on today's evidence. Software sold by itself to Indian restaurants is not viable. The service cannot be exported; the Gulf is a later market through a licensed local partner.
- **On Y Combinator:** not as a serious bid for the Winter 2027 batch (deadline 2 November 2026), and not at all if the aim is a profitable local business. For venture scale, apply in 2027 with paying customers and preferably a co-founder. If ECCS already trades with customers, apply on time with the real numbers.
- **Its weak points, stated in the report:** no price actually paid by a Hyderabad restaurant was found; the market size, margins and odds are the researchers' own arithmetic; and every researcher ran out of web searches part-way through.

### Decisions the founder made

- The face step must work like face unlock, with no photo-taking.
- Every scan switches between clock in and clock out.
- A new employee's pay starts on the day they joined, and the Owner chooses the days a month's salary is divided by.
- The attendance screen was to be made less cluttered.

Decided by Claude and its workers and not yet reviewed by the founder: Android 8 as the minimum; the three-second automatic confirm on a sure match; every threshold in the face camera; that a phone recognises only its own outlet's staff; the pay rule for a part month under "always 30" or "always 26"; that a month locks its number at its first payment; the consent notice saying "a few photos". All are in `STATUS.md` sections 3 and 4. Not decided: whether to use AI at all, and whether to apply to Y Combinator.

### How it was tested

- 494 automated end-to-end tests pass in 27 files, and 402 unit tests. The full build, type check and lint pass with every language required to have every key.
- **By the founder, on a phone:** adding a face and clocking in work.
- By Claude: the new face camera opened and ran its detector on the virtual phone, which has no face to show it. The pay and attendance screens were looked at in a browser at phone size, on test copies of the server and the app.
- The newest APK is from 2:02 pm. It has face attendance; it does not have the pay rules or the plainer screens.
- Not tried by anyone on a phone: switching between in and out, the PIN fallback, the Owner's review list and corrections, the hours and pay-days settings, the Manager's and Head Chef's views, and everything about pay built today.

### Problems found

- **"Not recognised" on the founder's first try.** The faces had been added to staff at Gachibowli and the phone was linked to Jubilee Hills; a phone recognises only its own outlet's staff. The matching was working. The message was the fault, and it now says what is wrong.
- **An APK was ready about 15 minutes before the founder was told.** The build tool leaves a helper running, so the "finished" signal never came, and Claude waited for it instead of looking at the file. A later build's leftover process was stopped by the system for low memory, after the APK had been written.
- **The Android build was blocked once** by that same idle helper holding a file. And the build script puts `package.json` back as it was in git, which removes a dependency that has been added but not yet committed.
- **Claude told the founder that Anthropic keeps nothing that is sent to it.** Its policy is deletion within 30 days. Corrected the same day. The first research job's fact sheet contradicted itself in places, so its figures were checked against Anthropic's own pages before being used.
- **The viability research ran out of web searches.** All seven researchers lost them part-way, and the report marks which conclusions rest on thin evidence.
- **The founder's server was running old code** while the app preview already had the new screens; the pay screen fails against an older server.

### Left open at the end of the day

- **For the founder to try:** restart the server (`pnpm build`, then `pnpm --filter @eccs/api start`) and follow `docs/TEST_LOGINS.md` sections 17 and 18. A new APK with the pay rules and plainer screens has not been built.
- **For the founder to answer, since the viability verdict turns on them:** whether ECCS already trades with paying customers and a crew; the founder's own history in the trade; and whether the aim is investment and fast growth or a profitable local business.
- **The report's next steps:** phone five vendors for real quotes, talk to ten to twenty restaurant operators about what they pay now, and get three to five restaurants to pay for a first job before anything else is built.
- **Decisions waiting** in `STATUS.md` section 4: the face attendance defaults; one wording for "Clock in / Clock out" across the languages; whether staff of one outlet may clock in at another; the pay rule; whether the Head Chef may add a food label; whether to use AI and which use first.
- **Before real employees use face attendance:** a lawyer on the consent notice, and a week's trial at one outlet with 15 to 20 people.
- Still open from before: the ECCS logo; a hosted server; a registered company; ECCS's real GSTIN and bank details; real prices; a review of the translations and of the 50 SOPs.

### Carried over from 11 October

- The camera inside the app and the check against a photo of a colleague, which waited for `pnpm install`: done today.
- Trying face attendance on a phone: done by the founder for adding a face and clocking in. The rest is still to try.

---

## Sunday 11 October 2026

Not a working day for the founder. The face attendance build, asked for late on 9 October, ran on unattended, and the PC's clock read 11 October when it finished. 4 commits. Not pushed until 12 October.

### The research

- Three research jobs ran first, because salary would come to depend on this: the technology (where matching should run, which models may be used commercially, stopping a photo of a colleague), the law in India (consent for face data, what happens when someone leaves), and how established attendance apps do it. Notes are kept on this PC in `research_notes/Face attendance/` and are not in git.
- **What shaped the build:** the face model most tutorials use is licensed for research only; a face pattern is sensitive personal data that needs the employee's own consent; and no attendance product works without one fallback and an owner's correction.

### The server half

- Face matching on our own server with two openly licensed models (YuNet and SFace). Only an encrypted face pattern is kept, and only after a recorded consent. Every clock-in and clock-out is kept with its score and a photo for 35 days.
- The rules that turn those into a day's status: a day runs from 4 am to 4 am, all the pairs are added up, 8 hours is a full day and 4 a half day. The salary tracker reads the result as before.
- Hand-marking was removed. Only the Owner corrects a day, with a reason. An Owner's or Manager's PIN is the one fallback when a face will not scan.

### The phone half

- A "Clock in / Clock out" button on the PIN screen and the scan screens behind it; the consent notice and face capture when a person is added; a read-only day sheet; the Owner's corrections, review list and hours settings.
- It used the phone's own camera app, because a camera component could not be installed while the founder's servers were running.

### Decisions the founder made

- From the request on 9 October: attendance is by face at the PIN screen; nobody marks it by hand, Managers and Head Chefs included; the Owner captures every employee's face when adding them, on the same form as the salary.

Added by Claude from the research and not yet reviewed by the founder: the consent step; the PIN fallback; Owner-only corrections with a reason; the 4 am day and the 8 and 4 hours; a photo with every scan, kept 35 days; an unsure match allowed but flagged; matching on our own server.

### How it was tested

- 489 automated end-to-end tests passed (26 new) and 226 unit tests.
- The matching was measured on 181 public photos of 38 people: 38 of 40 scans by enrolled people matched and none matched the wrong person; no stranger matched, and 4 of 81 were "unsure". These were press photos, not kitchen phones.
- Nothing was tried on a phone.

### Problems found

- **The first worker stalled twice** and had to be replaced. The cause was `pnpm` trying to reinstall packages against files the founder's running server held open.
- **The translators did not agree on "Clock in / Clock out":** native words in five languages, the English phrase in local script in six.

### Left open at the end of the day

- The founder to stop the servers and run `pnpm install`, so that a camera can be put inside the app and the check against a photo of a colleague switched on.
- A lawyer to read the consent notice. A trial at one outlet before salary depends on it.

### Carried over from 9 October

- Nothing: this work was the last request of that day.

---

## Friday 9 October 2026, after the day was closed

The founder called this a new day; the PC's clock still read Friday 9 October, so it is logged under that date. Phase 1d was built, food labels were changed twice at the founder's word, a printer was started and stopped, and the founder asked how the app gets to the Play Store. 12 commits. Not pushed until 12 October.

### Phase 1d

- Three workers built the three parts at once. **Staff:** people, a day sheet for attendance with month views, and a salary tracker with pay worked out from attendance and overridable, advances and payments, a carried balance and a text summary to share. **Food labels:** items with shelf lives and a starter list, a label drawn as a picture, printing through the phone's print screen, a shared picture or an A4 sheet. **Customer page:** a public page per outlet showing the ECCS inspection result with its date and report number, saying plainly that it is not a government rating, off by default, with photos approved by ECCS.
- The 393 new pieces of text were translated into the other eleven languages.

### Food labels, changed twice

- First the founder asked for labels to be simpler: anyone makes a label from a name and a length of time such as "8 hours", never an exact time, and "prepared" is the moment Print is pressed.
- Later the founder described the screen wanted, with the Jolt app as the model: a search bar, every saved label with − 0 + beside it, and one Print for all of them; only the Owner and Manager change labels; "prepared by" is the person signed in; no page of "use by, used up, thrown away". The screen was rebuilt that way and the fridge page and Home counts were removed.

### A printer, started and stopped

- The founder sent photos of a printer on hand, a Rugtek RP326-USE. Claude found it is an 80 mm receipt printer with no Bluetooth, which prints slips and not sticky labels, and started a worker on printing to it over the network. The founder said to stop and not print. The worker was stopped and everything it had done was removed.

### Going live

- The founder asked for the steps to the Play Store, the hosting options and costs, and how internal testing works. Claude answered from Google's own help pages.
- A 13-page document to share, `docs/ECCS go-live requirements.pdf`: a registered business, the D-U-N-S number, the Play and App Store organisation accounts, SMS registration (DLT), WhatsApp, hosting, costs and the order to do things, with each fact marked as official or secondary.

### Decisions the founder made

- Start phase 1d.
- Food labels: a name and a length of time, prepared at the press of Print; then one list with a counter on each label and a single Print.
- No direct printing to a printer for now.
- ECCS is not a registered company, so a personal Google Play developer account is opened now and converted later. Hosting waits.

Decided by Claude and its workers and not yet reviewed by the founder: the salary rules; the limits on labels, including 50 of each and that the Head Chef may add a label but not change one; the wording of the customer page. All are in `STATUS.md` sections 3 and 4.

### How it was tested

- 463 automated end-to-end tests and 184 unit tests passed at the end of this stretch, with the build, type check and lint.
- An APK was built at 4:40 pm with the new labels screen. It was not installed or run by Claude.
- Nothing from this stretch was seen on a phone by Claude, and the founder had not yet reported trying it.

### Problems found

- **The go-live document's first print had a squeezed table and two totals that disagreed.** Both were fixed before it was handed over.
- **The printer on hand is not a label printer.** A true label printer is still to be chosen.
- **One worker's test file had a type error,** fixed by Claude.

### Left open at the end of the day

- Testing by the founder of all of phase 1d and the new labels screen.
- The salary rules, the customer page's wording, and which label printer to buy.
- The founder's sign-up for the Play developer account.

### Carried over from 9 October

- Phase 1d, not started when the day was closed: built in this stretch.
- Testing by the founder of the new console, the new services and photo integrity: still to do.

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
