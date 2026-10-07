# ECCS Platform: Notifications register

Every message the platform should send to a person without them opening the app first. Started on 7 October 2026 at the founder's request, so that none is forgotten. **First version built on 7 October 2026: a list inside the app and the console (a bell with a count), with no push, SMS, WhatsApp or email yet.** The Status column says which rows are built; none has been tested by the founder.

**How to use this file**

- When a feature is built or changed, add or update its rows here in the same session (this is a rule in `CLAUDE.md`).
- "Status" is `not built` until the notification is actually sent. When one is built, change it to `built` with the date, and to `tested` once the founder has seen it arrive on a phone.
- Wording in the "Says" column is a draft. Final wording goes into the app's language files, in all twelve languages.

**What exists already**

- The database has a `Notification` table (one row per message per person, with a read mark) and a `DeviceToken` table (where to push to). The API writes to `Notification`; nothing uses `DeviceToken` yet.
- The mobile app has a bell with an unread count at the top right of Home, opening a Notifications screen. The console has a bell in its header, opening a Notifications page.
- Each notification is stored as its kind and its values (names, dates), and the app words it in the reader's own language. **The wording exists in English only so far; the other eleven languages fall back to English until they are translated.** The console shows English.
- Time-based reminders are checked every 15 minutes by the API (`apps/api/src/notifications/reminders.service.ts`); each is sent to a person once.
- Nobody is notified of their own action. A failed notification never stops the action it is about.
- Adding push later is one place: `outsideChannels` in `apps/api/src/notifications/notifications.service.ts`.
- Push notifications cannot be fully tested in Expo Go. They need a proper build of the app installed on the phone.

**Decisions still to make (founder)**

1. **How each one is delivered:** a push notification on the phone, a list inside the app, WhatsApp, SMS, email, or a mix. The "Channel" column below is Claude's suggestion only. WhatsApp and SMS cost money per message and need a provider account.
2. **Quiet hours:** should anything wait until morning, or do kitchens want night-time messages (many visits are after closing)?
3. **Language:** each person's own app language (assumed below).
4. **Who can switch what off:** for example, may a Head Chef mute checklist reminders?
5. **Reminder timings:** the numbers below (30 minutes before, 30/15/7/1 days before) are placeholders.

Roles: **O** Owner, **M** Manager, **HC** Head Chef (restaurant side); **Adm** Super Admin and Operations Manager, **Sup** Supervisor (ECCS side).

---

## 1. Service visits and reports

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| S1 | ECCS approves a signed-off report, so its PDF is ready | O, M of the outlet | "Your service report SR-… for {service} is ready. Open it as a PDF." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) (**asked for by the founder, 7 Oct**) |
| S2 | A restaurant sends a booking request | Adm | "{outlet} asked for {service} on {date}, {time}." | Console badge (exists as a count) + push | built 7 Oct (in-app list only; not tested by the founder) |
| S3 | ECCS confirms a request | O, M | "ECCS confirmed {service} for {date}, {time}." (The Supervisor's name is not in the wording yet; it is on the visit.) | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S4 | ECCS turns down a request it has not confirmed (cancelling one already confirmed is S6) | O, M | "ECCS could not take your request for {service} on {date}. Call us to rearrange." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S5 | ECCS moves a visit to another day or time | O, M; Sup | "{service} has moved to {date}, {time}." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S6 | ECCS cancels a visit | O, M; Sup | "{service} on {date} has been cancelled." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S7 | A visit is given to a Supervisor (when ECCS confirms a request, adds a visit, changes who does it, or a plan visit is created with a Supervisor), or taken away | Sup | "New visit for you: {service} at {outlet}, {date}, {time}." / "{service} at {outlet} on {date} has been given to someone else or cancelled." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S8 | The day before a visit | O, M; Sup | "Reminder: ECCS {service} tomorrow, {time}." | Push | built 7 Oct (in-app list only; not tested by the founder) |
| S9 | The morning of a visit | Sup | "Today: {count} visits. First: {outlet}, {time}." | Push | not built |
| S10 | The Supervisor checks in at the outlet | O, M | "The ECCS team has arrived for {service}." | Push | built 7 Oct (in-app list only; not tested by the founder) |
| S11 | The Supervisor finishes the visit (not when a report ECCS sent back after sign-off is finished again: that returns to ECCS) | O, M | "{service} is finished. Check the photos and sign off." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S12 | A finished visit is still not signed off after a day (sent once) | O, M | "{service} from {date} is waiting for your sign-off." | Push | built 7 Oct (in-app list only; not tested by the founder) |
| S13 | The restaurant signs off | Adm; Sup (for one or two stars the admins get S14 instead, the Supervisor still gets this) | "{outlet} signed off {service}: {stars} out of 5 stars. The report is ready to approve." | Console badge (exists as a count) + push | built 7 Oct (in-app list only; not tested by the founder) |
| S14 | The restaurant gives one or two stars | Adm, in place of S13 | "{outlet} gave {service} {stars} out of 5 stars. '{comment}'" | Push, straight away | built 7 Oct (in-app list only; not tested by the founder) |
| S15 | ECCS sends a report back for correction | Sup | "ECCS asked for a correction on {service} at {outlet}: {note}" | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S16 | A visit's date has passed and it was never started (checked for the last 7 days; sent once per visit) | Adm; Sup | "{service} at {outlet} on {date} was not done." | Console + push | built 7 Oct (in-app list only; not tested by the founder) |
| S18 | Plan visits are added to the diary without a Supervisor | Adm (not the admin who has just set the plan) | "New plan visits without a Supervisor: {count}." | Console badge (exists as a count) | built 7 Oct (in-app list only; not tested by the founder) |
| S19 | An outlet is put on a plan, its plan is changed, or its plan is stopped | O, M | "{outlet} is now on the {plan} plan. First visit: {date}." / "The {plan} plan at {outlet} has ended." (Changing a plan sends only the first.) | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S17 | A visit in the next two days has no Supervisor | Adm | "{service} at {outlet} on {date} has no Supervisor yet." | Console badge (exists as a count) | not built |

## 2. Daily checklists

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| C1 | 30 minutes before a checklist is due and it is not submitted | HC (and M) | "{checklist} is due by {time}. {done} of {total} done." | Push | not built |
| C2 | A checklist's due time passes and it is not submitted (checked every 15 minutes; sent once per checklist per day) | HC, M | "{checklist} is overdue." | Push | built 7 Oct (in-app list only; not tested by the founder) |
| C3 | A checklist is submitted with a problem reported | M, O | "{name} reported a problem on {checklist}: {item}." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| C4 | A day ends with a checklist not submitted | M, O | "{checklist} was missed on {date}." (The outlet's name is shown under it.) | In-app (morning summary) | built 7 Oct (in-app list only; not tested by the founder) |
| C5 | A submitted checklist has not been reviewed after a day | M | "{checklist} from {date} is waiting for your review." | In-app | not built |
| C6 | A photo or answer saved without signal could not be sent after several tries (once offline working is built) | whoever took it | "Some checklist items have not been sent. Open the app when you have signal." | Push | not built |

## 3. Issues raised with ECCS

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| I1 | A restaurant raises an issue | Adm, and Supervisors who have a visit at that outlet | "{outlet} raised {reference}: {category}. '{first words}'" | Console badge (exists as a count) + push | built 7 Oct (in-app list only; not tested by the founder) |
| I2 | ECCS replies on an issue | whoever raised it, plus M, O | "ECCS replied on {reference}: '{first words}'" | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| I3 | The restaurant replies on an issue | Adm, and Supervisors who have a visit at that outlet | "{outlet} replied on {reference}: '{first words}'" | Console + push | built 7 Oct (in-app list only; not tested by the founder) |
| I4 | ECCS marks an issue in progress or resolved (ECCS closing or reopening one sends nothing) | whoever raised it, plus M, O | "ECCS is working on {reference}." / "ECCS marked {reference} as resolved." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| I5 | The restaurant closes or reopens an issue | Adm, and Supervisors who have a visit at that outlet | "{outlet} closed {reference}." / "{outlet} reopened {reference}." | Console + push | built 7 Oct (in-app list only; not tested by the founder) |
| I6 | An open issue has had no reply from ECCS for a day | Adm | "{reference} at {outlet} has been waiting {hours} hours." | Console | not built |

## 4. Licences and documents

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| L1 | A licence expires in 30, 15, 7 and 1 days (one first seen between two of these gets the reminder it has just passed) | O, M | "{licence} expires on {date}. Days left: {days}." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| L2 | A licence has expired (repeated every 7 days until it is renewed) | O, M | "{licence} expired on {date}. Renew it and add the new copy." | Push + in-app, repeated weekly | built 7 Oct (in-app list only; not tested by the founder) |
| L3 | ECCS adds or replaces a licence or document for the outlet, or changes a licence's details | O, M | "ECCS added or updated {title} in your licences and documents." | In-app | built 7 Oct (in-app list only; not tested by the founder) |
| L4 | A client's licence is expired or expiring | Adm | "{count} licences need attention." | Console badge (exists as a count) | not built |
| L5 | A service report PDF is filed in the outlet's documents | O, M | Covered by S1 | – | see S1 |

## 5. Logins and staff

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| A1 | A new phone is linked to an outlet with its restaurant code | O, M of the outlet | "A new phone was linked to {outlet}." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| A2 | A PIN is locked after five wrong tries | O, M of the outlet the phone is linked to (the Owners, for an Owner's own phone) | "Someone tried a wrong PIN five times at {outlet}." | In-app | built 7 Oct (in-app list only; not tested by the founder) |
| A3 | The Owner asks for a new PIN by one-time code | the Owner | The one-time code itself | SMS (real SMS is not set up; sample code 123456 today) | not built |
| A4 | A person's access is removed or given back | – | No message planned: they are told in person | – | not planned |

## 6. SOPs

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| P1 | ECCS publishes a new standard SOP or changes one | O, M, HC | "ECCS updated the SOP '{name}'." | In-app | not built |

## 7. Inspections

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| N1 | An inspection is planned and given to a Supervisor, moved, or taken away | Sup | "Inspection at {outlet} on {date}." | Push + in-app | not built |
| N2 | The Supervisor finishes an inspection | Adm | "Inspection report for {outlet} is waiting for approval: {score}, {grade}." | Console + in-app | not built |
| N3 | ECCS sends an inspection report back | Sup | "ECCS asked for a correction on the inspection at {outlet}: {note}" | Push + in-app | not built |
| N4 | ECCS approves an inspection report | O, M | "Your inspection report is ready: {score} out of 100, grade {grade}." | Push + in-app | not built |
| N5 | A corrective action's fix-by date is tomorrow, or has passed | O, M | "{count} corrective actions are due." | Push + in-app | not built |
| N6 | An inspection fails a critical check | Adm | "{outlet} failed a critical check: {check}." | Push | not built |

## 8. Hygiene score

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| H1 | The score drops into a lower band | O, M | "Your hygiene score is now {score} ({band}). Biggest cause: {reason}." | Push + in-app | not built |
| H2 | The score falls 10 points or more in a week | O, M; Adm | "Hygiene score at {outlet} fell from {from} to {to} this week." | Push + in-app | not built |
| H3 | A new outlet gets its first score | O, M | "Your first hygiene score is ready: {score}." | In-app | not built |
| H4 | Weekly summary of the score and what is costing points | O | "This week: {score} ({change}). {reason}." | In-app | not built |

## 9. Monitoring (to ECCS)

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| M1 | Each morning | Adm | "{count} outlets need attention today: {names}." | In-app or email | not built |
| M2 | An outlet first reaches "needs attention" | Adm | "{outlet} now needs attention: {area}." | Push + in-app | not built |
| M3 | Checklists missed two days running at an outlet | Adm | "{outlet} has missed its checklists for 2 days." | In-app | not built |
| M4 | A report or inspection report has waited more than 2 days for approval | Adm | "{count} reports are waiting for approval." | Console badge + in-app | not built |

## 10. Changes ECCS makes in the console

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| E1 | An outlet or client is switched off or back on | O | "{outlet} has been switched off by ECCS. Call ECCS." | SMS (they cannot log in when switched off) | not built |
| E2 | A new restaurant code is issued | O, M | "{outlet} has a new restaurant code. The old one no longer links new phones." | In-app | not built |
| E3 | ECCS unlinks a phone, removes the Owner's PIN, or changes the Owner's mobile number | O | A security notice saying what was changed | SMS | not built |
| E4 | A kind of service's task list changes | Sup | "The task list for {service} has changed." | In-app | not built |
| E5 | A service is added or its price changes | O, M | "ECCS now offers {service}." | In-app, optional | not built |

## 11. Features not built yet (to fill in when they are)

| Feature | Notifications to expect |
|---|---|
| Invoices and payments | Invoice raised; payment due soon; overdue; payment received |
| Subscription | Renewal coming; plan changed; plan ended |
| Certificates | Certificate issued; certificate expiring |
| Attendance and salary | To be decided with the feature |
| Food labels | Labelled food reaching its use-by time |
| Customer QR page | A photo is waiting for approval |

---

## Change log

| Date | Change |
|---|---|
| 7 Oct 2026 | Added sections 8 to 10 (hygiene score, monitoring, console changes), not built. The inspection report's PDF is ready at the moment N4 would fire, so it needs no notification of its own. |
| 7 Oct 2026 | Added section 7 for inspections (N1 to N6), not built. |
| 7 Oct 2026 | First version built as a list inside the app and the console: S1 to S8, S10 to S16, S18, S19, C2 to C4, I1 to I5, L1 to L3, A1, A2. Not built: S9, S17, C1, C5, C6, I6, L4, P1, A3. Rows corrected to match what was built: S3 (no Supervisor name in the wording), S4, S7, S11, S12, S13 and S14 (a low rating replaces the ordinary sign-off notification for admins), S16, S18, S19, C2, C4, I1, I3, I4, I5 (Supervisors with a visit at the outlet are included), L1, L2, L3, A1, A2. Not sent, and not in the register: a restaurant withdrawing its own request; ECCS adding a visit without a request (the restaurant first hears of it from S8); a corrected report coming back to ECCS for approval. |
| 7 Oct 2026 | Added S18 and S19 with automatic plan visits. |
| 7 Oct 2026 | Register started. S1 (report PDF ready) recorded as asked for by the founder; everything else listed by Claude from the features built so far. Nothing built. |
