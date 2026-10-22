# ECCS Platform: Notifications register

Every message the platform should send to a person without them opening the app first. Started on 7 October 2026 at the founder's request, so that none is forgotten. **First version built on 7 October 2026: a list inside the app and the console (a bell with a count), with no push, SMS, WhatsApp or email yet.** The Status column says which rows are built; none has been tested by the founder.

**How to use this file**

- When a feature is built or changed, add or update its rows here in the same session (this is a rule in `CLAUDE.md`).
- "Status" is `not built` until the notification is actually sent. When one is built, change it to `built` with the date, and to `tested` once the founder has seen it arrive on a phone.
- Wording in the "Says" column is a draft. Final wording goes into the app's language files, in all twelve languages.

**What exists already**

- The database has a `Notification` table (one row per message per person, with a read mark) and a `DeviceToken` table (where to push to). The API writes to `Notification`; `DeviceToken` holds the phones registered for push.
- The mobile app has a bell with an unread count at the top right of Home, opening a Notifications screen. The console has a bell in its header, opening a Notifications page.
- Each notification is stored as its kind and its values (names, dates), and the app words it in the reader's own language. **The wording exists in English only so far; the other eleven languages fall back to English until they are translated.** The console shows English.
- Time-based reminders are checked every 15 minutes by the API (`apps/api/src/notifications/reminders.service.ts`); each is sent to a person once.
- Nobody is notified of their own action. A failed notification never stops the action it is about.
- **Channels (8 October 2026): the list inside the app, plus push when enabled.** Every notification is always written to the person's list inside the app. When the server has `PUSH_NOTIFICATIONS=on` in `.env`, each new notification is also sent as a push notification, through Expo's push service, to every phone registered for that person, worded in the person's saved language. With it off (the default, and always under tests) only the list is used. No new kinds of notification were added for push: it delivers the ones marked built below. Not yet tried on a phone.
- A phone is registered for a person when they log in to the installed app and allow notifications, and is unregistered on Lock or logout, so a shared phone shows push notifications only for whoever is logged in (after Lock, none). The server also sends nothing to a person who is not logged in anywhere.
- No SMS, WhatsApp or email. A further channel is added in one place: `outsideChannels` in `apps/api/src/notifications/notifications.service.ts` (push is `push.service.ts` beside it).
- Push does not work in Expo Go or the browser preview. It needs the app built and installed on the phone: `docs/APK_BUILD.md`. ECCS admins can send a test push from the console's Notifications page.
- On the PC, the console shows each new notification as a Windows pop-up while it is open in a browser tab (even in the background or minimised), with **Windows' own notification sound** (since 20 Oct 2026; before that the page played its own chime, which only worked after a click in the tab). The sound can be turned off on the console's Notifications page; Windows' own settings (Do not disturb, the browser's notifications and "Play a sound when a notification arrives") come first.

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
| S5 | ECCS moves a visit to another day or time (also by dragging it or Move on the console's Visits > Week, 20 Oct 2026: section 16i) | O, M; Sup | "{service} has moved to {date}, {time}." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S6 | ECCS cancels a visit | O, M; Sup | "{service} on {date} has been cancelled." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S7 | A visit is given to a Supervisor (when ECCS confirms a request, adds a visit, changes who does it, or a plan visit is created with a Supervisor), or taken away | Sup | "New visit for you: {service} at {outlet}, {date}, {time}." / "{service} at {outlet} on {date} has been given to someone else or cancelled." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S8 | The day before a visit | O, M; Sup | "{service} by ECCS is tomorrow, {time}." (ECCS staff see "{service} at {outlet} is tomorrow, {time}." in the app); "after closing" in small letters (22 Oct) | Push | built 7 Oct (in-app list only; not tested by the founder) |
| S9 | The morning of a visit | Sup | "Today: {count} visits. First: {outlet}, {time}." | Push | not built |
| S10 | The Supervisor checks in at the outlet | O, M | "The ECCS team has arrived for {service}." | Push | built 7 Oct (in-app list only; not tested by the founder) |
| S11 | The Supervisor finishes the visit (not when a report ECCS sent back after sign-off is finished again: that returns to ECCS) | O, M | "{service} is finished. Check the photos and sign off." | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S12 | A finished visit is still not signed off after a day (sent once); and again each time ECCS presses **Remind** on the console's Today, at most once a day per visit (20 Oct 2026, section 16j) | O, M | "{service} from {date} is waiting for your sign-off." | Push | built 7 Oct (in-app list only; not tested by the founder); Remind built 20 Oct (not tested by the founder) |
| S13 | The restaurant signs off | Adm; Sup (for one or two stars the admins get S14 instead, the Supervisor still gets this) | "{outlet} signed off {service}: {stars} out of 5 stars. The report is ready to approve." | Console badge (exists as a count) + push | built 7 Oct (in-app list only; not tested by the founder) |
| S14 | The restaurant gives one or two stars | Adm, in place of S13 | "{outlet} gave {service} {stars} out of 5 stars. '{comment}'" | Push, straight away | built 7 Oct (in-app list only; not tested by the founder) |
| S15 | ECCS sends a report back for correction | Sup | "ECCS asked for a correction on {service} at {outlet}: {note}" | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S16 | A visit's date has passed and it was never started (checked for the last 7 days; sent once per visit) | Adm; Sup | "{service} at {outlet} on {date} was not done." | Console + push | built 7 Oct (in-app list only; not tested by the founder) |
| S18 | Plan visits are added to the diary without a Supervisor | Adm (not the admin who has just set the plan) | "New plan visits without a Supervisor: {count}." | Console badge (exists as a count) | built 7 Oct (in-app list only; not tested by the founder) |
| S19 | An outlet is put on a plan, its plan is changed, or its plan is stopped | O, M | "{outlet} is now on the {plan} plan. First visit: {date}." / "The {plan} plan at {outlet} has ended." (Changing a plan sends only the first.) | Push + in-app | built 7 Oct (in-app list only; not tested by the founder) |
| S17 | A visit in the next two days has no Supervisor | Adm | "{service} at {outlet} on {date} has no Supervisor yet." | Console badge (exists as a count) | not built |
| S26 | The office sends a Supervisor the day's sheet from Today (each send is its own notification, Send again after a change included) (20 Oct 2026, section 16k) | Sup | "Your day's sheet: Your sheet for {date} is ready: the visits in order and what to carry." Opens the Visits list, with the sheet at the top. | Push + in-app | built 20 Oct (`DAY_SHEET_SENT`; not tested by the founder; its phone wording needs the next APK) |
| S27 | The day's sheet is not sent by 7 am | Ops Manager | "Today's sheets are not sent yet: {names}." | Push + in-app | not built |
| S28 | A visit on a sheet already sent changes (added, removed, moved or given to someone else) | Sup | "Your sheet for today has changed: {change}." (Today only the ordinary S5 or S7 is sent.) | Push + in-app | not built |

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
| L3 | ECCS adds or replaces a licence or document for the outlet, or changes a licence's details | O, M | "ECCS added or updated {title} in your licences and documents." | In-app | built 7 Oct (in-app list only; not tested by the founder); unused since 20 Oct 2026: the console has no Licences page, so ECCS no longer adds licences or documents |
| L4 | ~~A client's licence is expired or expiring~~ | Adm | – | – | dropped 20 Oct 2026: ECCS no longer watches restaurants' licences (the founder); the restaurant gets L1 and L2 |
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
| H5 | The first inspection is approved, so the score stops being provisional | O, M | "Your hygiene score now includes your ECCS inspection: {score}." | In-app (can be joined to N4) | not built |
| H6 | The inspection in the score will be 180 days old within a month | O, M; Adm | "Your ECCS inspection is due again. After {date} your score becomes provisional." | In-app | not built |

## 9. Monitoring (to ECCS)

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| M1 | Each morning | Adm | "{count} outlets need attention today: {names}." | In-app or email | not built |
| M2 | An outlet first reaches "needs attention" | Adm | "{outlet} now needs attention: {area}." | Push + in-app | not built |
| M3 | ~~Checklists missed two days running at an outlet~~ | Adm | – | – | dropped 20 Oct 2026: checklists are not on the Monitoring board (the founder) |
| M4 | A report or inspection report has waited more than 2 days for approval | Adm | "{count} reports are waiting for approval." | Console badge + in-app | not built |

## 10. Changes ECCS makes in the console

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| E1 | An outlet or client is switched off or back on | O | "{outlet} has been switched off by ECCS. Call ECCS." | SMS (they cannot log in when switched off) | not built |
| E2 | A new restaurant code is issued | O, M | "{outlet} has a new restaurant code. The old one no longer links new phones." | In-app | not built |
| E3 | ECCS unlinks a phone, removes the Owner's PIN, or changes the Owner's mobile number | O | A security notice saying what was changed | SMS | not built |
| E4 | A kind of service's task list changes | Sup | "The task list for {service} has changed." | In-app | not built |
| E5 | A service is added or its price changes | O, M | "ECCS now offers {service}." | In-app, optional | not built |

## 11. Certificates

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| C1 | A certificate is issued (ECCS approves the report) | O, M | "Your {service} certificate {number} is ready, valid until {date}." | In-app (can be joined to "report approved") | not built |
| C2 | A certificate enters its "expiring soon" period | O, M; Adm if no next visit of that kind is in the diary | "Your {service} certificate expires on {date}." | Push + in-app | not built |
| C3 | A certificate has expired and no newer one of that kind exists | O, M; Adm | "Your {service} certificate expired on {date}." | Push + in-app | not built |
| C4 | ECCS makes a certificate's PDF again | O, M | "Your {service} certificate has been updated." | In-app, optional | not built |
| C5 | A certificate could not be issued or its PDF made | Adm | "Certificate for {visit} could not be made." | In-app | not built (only logged) |

## 12. Work done without signal

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| W1 | Work a Supervisor did offline was refused when sent (visit cancelled, reassigned, already finished) | Adm | "{supervisor} has unsent work for {visit} held on their phone." | In-app | not built (the Supervisor is told on the phone) |
| W2 | A phone has had work waiting to send for more than a day | Sup | "You have work on this phone that has not been sent. Open the app where there is signal." | Local reminder on the phone | not built |

## 13. Plans and subscriptions

The existing "plan started" and "plan ended" notifications (section 1) are reused: they now also fire when the Owner subscribes and when a plan ends at the end of its cycle.

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| P1 | The Owner subscribes | Adm | "{outlet} has taken the {plan} plan." | In-app | not built |
| P2 | A plan change is asked for or undone | Adm when the Owner did it; O, M when ECCS did it | "{outlet} moves to {plan} on {date}." | In-app | not built |
| P3 | A plan change takes effect | O, M | "You are now on {plan}." | In-app | not built |
| P4 | A cancellation is asked for or undone | Adm when the Owner did it; O when ECCS did it | "{outlet}'s plan ends on {date}." | In-app | not built |
| P5 | ECCS pauses or resumes a plan | O, M | "Your plan is paused." / "Your plan is running again." | Push + in-app | not built |
| P6 | A plan renews | O, M | "Your {plan} plan has renewed until {date}." | In-app (can be joined to B1) | not built |
| P7 | ECCS edits a plan: price or services change from a date | O, M of each subscriber | "From {date} your plan costs {amount}." | Push + in-app | not built |
| P8 | Reminder: the plan ends in 3 days | O | "Your plan ends on {date}." | Push + in-app | not built |
| P9 | Reminder: renewal in 3 days | O | "Your plan renews on {date} for {amount}." | In-app | not built |

## 14. Invoices and payments

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| B1 | An invoice is raised | O, M | "Invoice {number} for {amount} is due on {date}." | Push + in-app | not built |
| B2 | Reminder: an invoice is due tomorrow or today | O | "Invoice {number} for {amount} is due {when}." | Push + in-app | not built |
| B3 | An invoice is overdue (then weekly) | O; Adm | "Invoice {number} is overdue by {days} days." | Push + in-app | not built |
| B4 | A payment succeeds in the app | O (receipt); Adm | "Payment of {amount} received. Thank you." | In-app | not built |
| B5 | A payment fails in the app | O | "Your payment did not go through. Nothing was charged." | In-app | not built |
| B6 | ECCS records a payment by hand | O | "ECCS has recorded your payment of {amount}." | In-app | not built |
| B7 | An invoice is made void, or raised again after a void | O, M | "Invoice {number} has been cancelled by ECCS." | In-app | not built |
| B8 | An automatic invoice could not be raised | Adm | "An invoice for {outlet} could not be raised." | In-app | not built (only logged) |

## 15. New services and photo integrity

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| S20 | A water test result is due again (a year after the last; possibly half-yearly) | O, M; Adm | "Your water test is due again." | Push + in-app | not built |
| S21 | Staff medical certificates are due again (12 months) | O, M | "Staff medical check-ups are due again." | Push + in-app | not built |
| S22 | An oil reading on a finished visit is over the limit | O, M | "Frying oil at {outlet} is over the limit ({value}%). Change the oil." | Push + in-app | not built |
| S23 | A result document is attached to a visit | O, M | Today the general "document added" notice is sent; a wording that names the visit could replace it | In-app | sent as the existing notice |
| S24 | No lab report attached some days after a water-test visit | Adm | "The lab report for {visit} has not been attached." | In-app | not built |
| S25 | The rating audit date is booked or near | O, M | "Your hygiene rating audit is on {date}." | Push + in-app | not built |
| I1 | A proof photo gets a certain flag (same file re-used, or location faked) | Adm | "A proof photo at {outlet} needs a look: {reason}." | In-app | not built |
| I2 | An outlet's Photos area newly needs attention (daily digest) | Adm | "{count} outlets have doubtful proof photos." | In-app | not built |
| I3 | A checklist photo matches an earlier one | O, M | "A checklist photo matches one used on {date}." | In-app, optional | not built |

## 16. Staff, food labels and the customer page

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| T1 | Withdrawn 11 Oct 2026: "attendance not marked". Nobody marks attendance now; see T5 to T9. | | | | withdrawn |
| T5 | A scan needs the Owner's eye: an unsure match, a possible photo of a colleague, or a punch approved by the Manager's PIN | O | "{name}'s clock-in at {time} needs checking." | Push + in-app | not built |
| T6 | Each morning: yesterday's days to settle (no clock-out, a short day) | O | "{count} attendance days need settling." | In-app | not built |
| T7 | Someone on the staff has not clocked in by a set time | O, M | "{name} has not clocked in today." | In-app | not built |
| T8 | A face is added or removed, or consent withdrawn | O, M | "{name}'s face was added for attendance." | In-app | not built |
| T9 | Face clock-in is not working at an outlet, or the clock screen was locked after wrong PINs | O; Adm | "Face clock-in is not working at {outlet}." | Push + in-app | not built |
| T10 | A Manager adds a person to the staff | O | "{name} was added at {outlet}. Pay counts from {date}." | In-app | not built |
| T11 | The Owner changes the days a month's salary is divided by | M | "Salaries at {outlet} are now divided by {days} days." | In-app | not built |
| T12 | A person's joining date is changed | O | "{name}'s joining date was changed to {date}." | In-app | not built |
| T13 | A Manager login has gone a day without being linked to a person on the staff list | O | "{manager}'s login is not linked to a staff record yet. Link it in Staff." | In-app | not built |
| T14 | A Manager tried to clock themselves in or out with their own PIN | O | "{manager} tried to clock in with their own PIN at {outlet}." | In-app | not built |
| T2 | A month's pay still owed after a set day of the next month | O | "{count} people are still owed pay for {month}." | In-app | not built |
| T3 | The Manager records an advance or a payment | O | "{manager} recorded {amount} for {name}." | In-app | not built |
| T4 | A person is marked as left, or a past day's attendance is corrected | O | "{name} was marked as left." | In-app | not built |
| F1 to F3 | Withdrawn 9 Oct 2026: "use today", "past use-by" and "use-by extended". The app no longer tracks a label after it is printed and nobody can extend a use-by, so there is nothing to send. | | | | withdrawn |
| F5 | A saved label is added, changed or removed | O, M | "{name} added the label {item}." / "{name} changed {item}: keeps {length}." | In-app | not built |
| F4 | Labels made offline could not be saved | the person | "Some labels could not be saved. Make them again." | In-app | not built |
| Q1 | A photo is put forward for a customer page, by a Supervisor or by the restaurant from its daily checks | Adm | "A photo for {outlet}'s customer page is waiting." | Console badge + in-app | not built (the console shows a count) |
| Q2 | A photo is approved; a photo is not approved | O; whoever put it forward (Sup, or the Owner or Manager, who is told the reason) | "A new photo is on your customer page." / "Your photo was not approved: {reason}." | In-app | not built |
| Q3 | The Owner turns the page on or off, removes a photo, or makes a new link | Adm | "{outlet} turned its customer page {on/off}." | In-app | not built |
| Q4 | ECCS takes a page down or restores it | O, M | "Your customer page has been taken down by ECCS." | Push + in-app | not built |
| Q5 | ECCS's inspection is about to drop off a customer page (30 and 7 days before), and when it has. The page itself no longer stops. | O, M; Adm | "ECCS's inspection drops off your customer page on {date}." | Push + in-app | not built |
| Q6 | A newly approved inspection appears on the customer page (changed 13 Oct: the page no longer waits for one) | O | "ECCS's inspection is now on your customer page." | In-app | not built |
| Q7 | A photo will drop off the page in 7 days (90 days after it was taken) | O, M | "A photo drops off your customer page in 7 days." | In-app | not built |
| Q8 | A page that is switched on has had no score for 3 days | O, M | "Your customer page has had no score for 3 days." | In-app | not built |
| V1 | New vendors were added within 5 km of an outlet (a digest, weekly at most, never one per vendor) | O, M | "{count} new vendors near {outlet}." | In-app | not built |
| V2 | A vendor near an outlet was taken off the list (once ECCS can edit the list) | O, M | "{vendor} is no longer on the vendor list." | In-app | not built |
| V3 | A restaurant reported a wrong number or a closed vendor (if reporting is added) | Adm | "{restaurant} reported a problem with {vendor}." | In-app | not built |

## 16a. Terms and privacy

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| G1 | A document gets a new version (ideally a few days before it takes effect) | everyone who must agree to it again | "We have updated our {document}. You will be asked to agree to it the next time you open the app." | Push + in-app | not built |
| G2 | The Owner agrees for the restaurant | O | "You agreed to ECCS's terms for {restaurant} on {date}. You can read them any time in your profile." (a copy of the agreement) | In-app, email once there is email | not built |


## 16b. AI features

The six AI features (14 Oct 2026) send nothing of their own to restaurants: a translated support message arrives through the existing issue notifications (section 3), worded as before; a saved inspection summary reaches the restaurant with the approved report (section 7); "Why this score?" and the camera nudge are seen only on the screen that asked for them. These are for ECCS's office:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| AI1 | The day's AI spending limit is reached, overall or for one outlet, or (from 19 Oct, when one is set on the AI usage page) the month's (from 16 Oct this also pauses the shop-board reader, so BDEs type their leads) | Adm | "AI features are paused until tomorrow: today's limit was reached." / "AI is paused at {outlet} until tomorrow." / "AI features are paused until the 1st: this month's limit was reached." | In-app | not built |
| AI2 | Anthropic refuses every request (the key is wrong or withdrawn, or the monthly limit set in Anthropic's console is reached) | Adm | "AI features are not working: {reason}." | Push + in-app | not built |
| AI3 | Each morning, the monitoring board's digest is ready (the founder to decide) | Adm | "Today's summary of the monitoring board is ready." | Push | not built |
| AI4 | A day's AI spend passes the warning share of the daily limit (80% unless changed on the AI usage page, Stage F) | Adm | "AI spend today is at {percent}% of the daily limit (₹{spent} of ₹{limit})." | In-app | not built |
| AI5 | The month's AI spend passes the warning share of the monthly limit, if one is set (Stage F) | Adm | "AI spend this month is at {percent}% of the monthly limit." | In-app | not built |
| AI6 | The credit left on the Anthropic key, by the app's own count, falls under the warning amount (US$20 unless changed; Stage F) | Adm | "About US${left} of AI credit is left: top it up in Anthropic's console." | Push + in-app | not built |
| AI7 | Someone changes an AI setting on the AI usage page (a helper off, a model, a limit) (Stage F; the founder to decide) | Adm | "{name} changed {setting} from {from} to {to}." | In-app | not built |
| AI8 | An AI helper fails more than 10% of today's tries (at least 3) (Stage F) | Adm, Ops | "{helper} is failing: {failed} of {tries} tries today." | In-app | not built |


## 16c. Logs

The Logs page (15 Oct 2026) sends nothing itself. Alerts it could feed, for ECCS's office:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| LG1 | Many wrong PINs, or a phone locked out, at one outlet within an hour | Adm | "{count} wrong PINs at {outlet} in the last hour." | In-app | not built |
| LG2 | A run of server errors (for example 5 in 10 minutes) | Adm | "The server failed {count} requests in the last 10 minutes." | Push + in-app | not built |
| LG3 | A timed job failed (visits from plans, billing, renewals, reminders) | Adm | "Tonight's {job} did not finish." | Push + in-app | not built |


## 16d. Finance

The Finance page (15 Oct 2026) sends nothing itself: "Remind" opens WhatsApp on the computer. Suggested, for the Super Admin:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| FN1 | A payout is due tomorrow, or has become overdue | Adm (Super Admin) | "{payee}: {amount} is due on {date}." | In-app | not built |
| FN2 | An invoice has just become overdue | Adm (Super Admin) | "{invoice} for {client} is overdue: {amount}. Send a reminder?" | In-app | not built |
| FN3 | A budget line passes 100% of its month | Adm (Super Admin) | "{line} is over budget by {amount} this month." | In-app | not built |
| FN4 | What is left lasts under 2 months at the current pace | Adm (Super Admin) | "At this month's pace the money left lasts about {months} months." | Push + in-app | not built |
| FN5 | A wage advance has not been recovered by month end | Adm (Super Admin) | "{name}'s advance of {amount} is not recovered yet." | In-app | not built |
| FN6 | Collections are under target at month end | Adm (Super Admin) | "{percent}% of {month}'s invoices were collected; the target is {target}%." | In-app | not built |


## 16e. Sales

The Sales pages (15 Oct 2026) send nothing themselves: sending a quote opens WhatsApp on the computer. Suggested:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| SL1 | The owner opened a quote | the lead's BDE | "{business} opened your quote." | Push + in-app | not built |
| SL2 | Each morning, the day's to-dos | each BDE | "{count} things to do today." | Push | not built |
| SL3 | A parked lead's date has come | the lead's BDE | "{business} was parked until today: call them." | In-app | not built |
| SL4 | A lead has gone stale (and a weekly summary) | the lead's BDE; Adm weekly | "{business} has had nothing logged for 5 days." | In-app | not built |
| SL5 | A lead reached First job or On a plan | the lead's BDE; Super Admin | "{business} is now a paying customer." | Push + in-app | not built |
| SL6 | A lead was handed to another BDE | the new BDE | "{business} is now yours." | In-app | not built |
| SL7 | A free check was booked | whoever goes | "Free check at {business}, {time}." | Push + in-app | not built |
| SL8 | Monday's targets, and a BDE falling behind | the BDE; Super Admin | "This week's targets: {leads} leads, {checks} checks." | In-app | not built |
| SL9 | A quote is close to its end date with no reply | the lead's BDE | "{business}'s quote ends on {date}." | In-app | not built |

The BDE's phone app (16 Oct 2026) sends nothing either: a quote and the free check's result go from the BDE's own WhatsApp. SL1 to SL3 and SL8 above are the ones the phone app most needs, as push to the BDE's phone. Also suggested:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| SL10 | A free check the BDE booked is due in an hour | the lead's BDE | "Free check at {business} at {time}." | Push | not built |
| SL11 | A BDE is behind target midweek | the BDE; Super Admin | "{done} of {target} leads this week: {left} to go." | In-app | not built |
| SL12 | Work held on a BDE's phone was refused by the server | the BDE (on the phone already); Adm | "{business}: a step from {name}'s phone was not accepted." | In-app | not built |

## 16f. Team

The Team page (16 Oct 2026) sends nothing itself: Message opens WhatsApp on the computer, and a new team member is told their login by the founder. Suggested:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| TM1 | Someone is not in by a set hour on a working day, with no leave recorded | Super Admin; Ops Manager | "{name} is not in yet today." | In-app | not built |
| TM2 | Monday morning, each person's week | Super Admin | "Last week: {name} {figure} of {target}; {count} to keep an eye on." | In-app | not built |
| TM3 | A BDE's stale leads pass the threshold | the BDE; Super Admin | "{count} of your leads have had nothing logged for 5 days." | Push + in-app | not built |
| TM4 | A BDE's next steps due today are not logged by evening | the BDE | "{count} follow-ups due today are not logged yet." | Push | not built |
| TM5 | Salaries are due, two days before the month ends | Super Admin | "{month}'s salaries, {amount}, are due on {date}." | In-app | not built |
| TM6 | Leave is recorded, or starts tomorrow | Super Admin; Ops Manager | "{name} is on leave {dates}." | In-app | not built |
| TM7 | Leads are handed over when someone leaves | the BDE who receives them | "{count} of {name}'s leads are now yours." | Push + in-app | not built |
| TM8 | A new team member's login is ready | the new member | "You can log in to the ECCS app with {phone}." | SMS or WhatsApp | not built |

SL6 (a lead handed to another BDE) covers a single lead; TM7 covers a leaver's leads in one message.
## 16g. Onboarding

Onboarding (16 Oct 2026) sends nothing itself: Send joining link opens WhatsApp on the computer. Suggested:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| OB1 | Onboarding is started | the new hire | "Welcome to ECCS. Open your joining page: {link}" | SMS or WhatsApp | not built |
| OB2 | The new hire uploads a document | Super Admin | "{name} uploaded their {document}." | In-app | not built |
| OB3 | A document is sent back | the new hire | "Please upload your {document} again: {reason}" | SMS or WhatsApp | not built |
| OB4 | The letter is made, or made again | the new hire | "Your appointment letter is ready to read and accept." | SMS or WhatsApp | not built |
| OB5 | The new hire accepts the letter or the handbook | Super Admin | "{name} accepted their appointment letter." | In-app | not built |
| OB6 | A new handbook version is published | every team member | "The staff handbook has changed: please read and accept it." | In-app | not built |
| OB7 | An onboarding task is due tomorrow, or late | the task's owner | "{task} for {name} is due {date}." | In-app | not built |
| OB8 | A new hire joins tomorrow | Ops Manager; Super Admin | "{name} joins tomorrow as {role}." | In-app | not built |
| OB9 | The 30- or 60-day check-in or the probation review is 7 days away | Super Admin | "{name}'s probation review is due on {date}." | In-app | not built |
| OB10 | Onboarding is done | Super Admin; Ops Manager | "{name}'s onboarding is done." | In-app | not built |

## 16h. ECCS Buddy

ECCS Buddy (16 Oct 2026) sends nothing of its own. A card the person taps does what the app's own screen does and sends the same notifications: a booking request as in section 1, an issue or a support request as in section 3; a withdrawn request, a checklist item or checklist, an SOP or a food label send whatever their own screens send. Buddy's own notices (a limit reached, paused, too fast, the chat full) are shown in the chat, not sent, and AI1 also covers Buddy. Suggested, for ECCS's office:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| BU1 | Buddy pauses someone at a restaurant after 5 refused messages in a day | Adm; Ops Manager | "ECCS Buddy paused a user at {restaurant} today after messages it could not help with." | In-app | not built |
| BU2 | Several of Buddy's answers in a day are marked not helpful (the founder to say how many) | Adm | "{count} ECCS Buddy answers were marked not helpful today." | In-app | not built |

**On purpose, none for a crisis message (19 Oct 2026).** When someone writes to Buddy that they want to die or to hurt themselves or someone else, Buddy gives the Tele-MANAS line and 112 in the chat and tells no one else: it is the person's private health. Whether ECCS should ever be told is for the founder and the lawyer (`docs/LEGAL_NOTES.md` point 12).

## 16i. Console plan, step 1 (Week board, Quotes, New outlets, Team documents)

Step 1 of the console plan (20 Oct 2026) adds no notification of its own. **Moving a visit on Visits > Week** (drag or Move) goes through the same change as the visit's "change date" (`PATCH /visits/:id`, which calls `visitChanged`), so it already sends what that sends: a new date or time sends S5 (`VISIT_MOVED`) to the outlet's Owner and Manager, and to the Supervisor if unchanged; a new Supervisor sends S7 (`VISIT_UNASSIGNED` to the old one, `VISIT_ASSIGNED` to the new one); whoever made the change is not told. S2 (a booking request) now opens Visits > Waiting. The console's menu counts new outlets not live after 24 hours (Clients) and documents due (Team). Suggested:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| WK1 | A day on the Week board goes over the crew's capacity | Adm | "{day} has {booked} visits booked, over the crew's {capacity}." | In-app | not built |
| WK2 | The Super Admin changes the capacity | Ops Manager | "The crew's capacity is now {capacity} visits a week." | In-app | not built |
| WK3 | Each week, the busy streak | Super Admin | "{weeks} weeks in a row at 80% or more of capacity." | In-app | not built |
| QT1 | A sent quote has not been opened 5 days after sending, with nothing logged since (the new Do today line) | the lead's BDE | "Quote Q-… for {business}: no reply in 5 days." | Push + in-app | not built |
| QT2 | A quote is won (the lead became a client, or someone marked it) | the lead's BDE | "{business} became a client: quote Q-… won." | Push + in-app | not built |
| QT3 | Optional: a quote is marked declined | Adm | "Quote Q-… for {business} was declined: {reason}." | In-app | not built |
| OL1 | A new outlet is still not live 24 hours after it was added | Adm; perhaps the BDE who won it | "{outlet} is not live yet: visit and set it up, or call the Owner." | Console badge (exists as a count) + push | not built |
| OL2 | The day-3 or day-10 call to a new outlet is due | Adm | "Day-3 call due: {outlet}." | In-app | not built |
| OL3 | Optional: a new outlet goes live (steps 1 to 6 done) | the BDE who won it | "{outlet} is live on the ECCS app." | In-app | not built |
| TD1 | A team member's document runs out: 30 days before its date, and on the day | Adm | "{name}'s {document} runs out on {date}." | Console badge (Team's count includes it) + in-app | not built |
| TD2 | The same, to the person | the team member | "Your {document} runs out on {date}: upload a new one on Joining ECCS." | Push + in-app | not built |
| TD3 | A required document is still missing after the day it was expected | Super Admin | "{name} has not given their {document} yet." | In-app | not built |

SL5 (a lead reached First job or On a plan) and SL9 (a quote close to its end date) are near QT2 and QT1: the founder may want only one of each pair.

## 16j. Console plan, step 2 (Today)

Today (20 Oct 2026) sends one notification, by hand: **Remind**, on a sign-off waiting 2 days in Needs you, sends the existing S12 (`SIGN_OFF_WAITING`) again to the outlet's Owner and Managers, at most once a day per visit (a Supervisor only for their own visits). It has its own key (`sign-off-reminded:<visit>:<day>`); the automatic S12 keeps its own. Built 20 Oct; not tested by the founder. Every other button on Today opens the page where the work is done, which sends what that page sends. Suggested:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| TY1 | The day is not closed by 7 pm | Adm | "Today is not closed yet: {count} lines still open." | Push + in-app | not built |
| TY2 | The day is closed with lines still open | Super Admin | "{name} closed today with {count} lines open: {lines}." | In-app | not built |
| TY3 | Each morning, an overdue invoice at an outlet with a visit today | that visit's Sup | "{outlet} owes {amount}, {days} days overdue: ask the manager." | Push | not built |
| TY4 | Office follow-ups: a report waiting 2 days for approval; an issue nobody has picked up after 2 days; at 5 pm, tomorrow's visits without a Supervisor | Ops Manager | "{count} reports have waited 2 days for approval." / "{reference} at {outlet} has not been picked up in 2 days." / "{count} of tomorrow's visits have no Supervisor yet." | Push + in-app | not built |

TY4 overlaps M4 (a report waiting more than 2 days) and S17 (a visit in the next two days with no Supervisor), neither built: build one of each pair.

## 16k. Console plan, step 3 (Quality and the day's sheet)

Step 3 (20 Oct 2026) built two notifications, through the existing service, worded in all 12 language files and the server's English copy: **S26** (`DAY_SHEET_SENT`, section 1), the day's sheet sent to the Supervisor, which also covers much of S9 (the morning of a visit, not built); and **QY1** (`PHOTO_REJECTED`) below. Neither is tested by the founder, and their phone wording needs the next APK. Booking a free follow-up visit sends the Supervisor the ordinary S7 (`VISIT_ASSIGNED`). **Numbering:** the code's comments call these two S20 and Q1, numbers this register had already given to the water test (section 15) and the customer-page photo (section 16); here they are S26 and QY1. Suggested, besides:

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| QY1 | ECCS rejects a doubtful photo in Quality > Photos and asks for a retake | the outlet's Manager for a checklist's photo (its Owner when there is no Manager); the visit's Supervisor for a visit's photo | "Photo not accepted: please retake: {outlet}, {what}: {note}. Please take the photo again." | Push + in-app | built 20 Oct (`PHOTO_REJECTED`; not tested by the founder; its phone wording needs the next APK) |
| QY2 | A new follow-up comes in | Ops Manager | "{outlet} needs a follow-up: {cause}." | Push + in-app | not built |
| QY3 | A follow-up has had nothing booked for 2 days | Ops Manager | "{outlet}'s follow-up has had nothing booked for 2 days." | In-app | not built |
| QY4 | A free follow-up visit is booked | O, M of the outlet (told nothing today) | "ECCS will come back on {date} for a free {service} visit." | Push + in-app | not built |
| QY5 | An incident is added | Super Admin | "Incident INC-{number} at {outlet}: {what happened}." | Push + in-app | not built |
| QY6 | An incident is still open after 7 days | Super Admin | "INC-{number} at {outlet} has been open 7 days." | In-app | not built |
| QY7 | A checklist marked "too fast" is rejected (QY1 says "photo" even when there is no photo to retake) | as QY1 | "{checklist} at {outlet} was ticked too fast to be real: please do the checks again." | Push + in-app | not built |

I1 and I2 (section 15: a proof photo with a certain flag, outlets with doubtful photos) are the alerts that would bring people to Quality > Photos; they are still not built.

## 17. Features not built yet (to fill in when they are)

| Feature | Notifications to expect |
|---|---|

---

## Change log

| Date | Change |
|---|---|
| 15 Oct 2026 | Translations of library picks and the hourly filler: no notification needed. |
| 16 Oct 2026 | The BDE's phone app: SL10 to SL12 added to section 16e; AI1 also covers the shop-board reader. None built. |
| 16 Oct 2026 | The Team page: section 16f added (TM1 to TM8). None built. |
| 16 Oct 2026 | Onboarding: section 16g added (OB1 to OB10). None built. |
| 16 Oct 2026 | ECCS Buddy: section 16h added (BU1, BU2); its cards send the same notifications as the app's own screens. None built. |
| 15 Oct 2026 | Sales: section 16e added (SL1 to SL9), none built. |
| 15 Oct 2026 | Finance: section 16d added (FN1 to FN6), none built. |
| 15 Oct 2026 | Logs: section 16c added (LG1 to LG3), none built. |
| 14 Oct 2026 | AI features: section 16b added (AI1 to AI3), none built. |
| 14 Oct 2026 | Terms and privacy: the two rows first numbered L1 and L2 are now G1 and G2, since L1 and L2 were already the licence reminders. |
| 14 Oct 2026 | Terms and privacy: L1 and L2 added (renumbered G1 and G2 the same day). |
| 13 Oct 2026 | Vendor directory: V1 to V3 added. |
| 13 Oct 2026 | Attendance roles: T13 and T14 added. |
| 13 Oct 2026 | Customer page rebuilt: Q1, Q2, Q5 and Q6 reworded, Q7 and Q8 added. |
| 12 Oct 2026 | Pay rules: T10 to T12 added. |
| 11 Oct 2026 | Face attendance: T1 withdrawn, T5 to T9 added. |
| 19 Oct 2026 | ECCS Buddy: no notification for a crisis message, on purpose (section 16h). |
| 19 Oct 2026 | AI usage page (Stage F, started): AI4 to AI7 added to section 16b, from the design's "Alert me when". None built. |
| 19 Oct 2026 | AI usage page (Stage F, built): AI1 widened to the new monthly limit; AI8 added (a helper failing). The page shows AI4 to AI6 and AI8 as warnings at its top, and their number beside AI usage in the menu, meanwhile. None built. |
| 20 Oct 2026 | The console's Licences page removed and Monitoring without checklists and licences: L4 and M3 dropped; L3 unused. |
| 20 Oct 2026 | The console's notification sound is Windows' own, played with the pop-up (`silent: false`, `renotify`), not a chime from inside the page (the founder). |
| 20 Oct 2026 | Console plan step 1: section 16i added (WK1 to WK3, QT1 to QT3, OL1 to OL3, TD1 to TD3). Moving a visit on Visits > Week sends S5 and S7 through the existing path (S5 reworded); S2 opens Visits > Waiting. None of the new rows built. |
| 20 Oct 2026 | Console plan step 2 (Today): Remind built, sending S12 again by hand at most once a day per visit (S12 updated); section 16j added (TY1 to TY4), not built. |
| 20 Oct 2026 | Console plan step 3 (Quality and the day's sheet): S26 (`DAY_SHEET_SENT`) and QY1 (`PHOTO_REJECTED`) built, not tested by the founder, their phone wording waiting for the next APK (the code's comments call them S20 and Q1, numbers already taken here); S27, S28 and section 16k (QY2 to QY7) added, not built. |
| 22 Oct 2026 | Screen review: S8 reads "{service} by ECCS is tomorrow, {time}." with "after closing" in small letters (the phone's list and the push), and ECCS staff see "{service} at {outlet} is tomorrow, {time}." in the app. The app's Notifications list now groups notifications of the same kind, day and outlet into one row ("4 checklists missed · Gachibowli") that opens to show each one; "Mark all as read" moved to the top bar. No notification added or removed. |
| 9 Oct 2026 | Food labels rebuilt as a print list: F1 to F3 withdrawn, F5 added. |
| 9 Oct 2026 | Added section 16 (staff, food labels, customer page), none built. |
| 9 Oct 2026 | Added section 15 (new services and photo integrity), none built. |
| 8 Oct 2026 | The console now announces every notification a logged-in ECCS person receives, while it is open in a browser tab: a desktop notification, a chime and an in-page message, opening the same page as the list. With the browser closed nothing is shown (web push is not built). |
| 8 Oct 2026 | Added sections 13 (plans and subscriptions) and 14 (invoices and payments), not built. |
| 7 Oct 2026 | Added sections 11 (certificates) and 12 (work done without signal), not built. A repeated check-in or finish from a phone does not notify twice. |
| 7 Oct 2026 | Hygiene score rule changed (inspection 60, licences 10, checklists 30): added H5 and H6, not built. |
| 7 Oct 2026 | Added sections 8 to 10 (hygiene score, monitoring, console changes), not built. The inspection report's PDF is ready at the moment N4 would fire, so it needs no notification of its own. |
| 7 Oct 2026 | Added section 7 for inspections (N1 to N6), not built. |
| 7 Oct 2026 | First version built as a list inside the app and the console: S1 to S8, S10 to S16, S18, S19, C2 to C4, I1 to I5, L1 to L3, A1, A2. Not built: S9, S17, C1, C5, C6, I6, L4, P1, A3. Rows corrected to match what was built: S3 (no Supervisor name in the wording), S4, S7, S11, S12, S13 and S14 (a low rating replaces the ordinary sign-off notification for admins), S16, S18, S19, C2, C4, I1, I3, I4, I5 (Supervisors with a visit at the outlet are included), L1, L2, L3, A1, A2. Not sent, and not in the register: a restaurant withdrawing its own request; ECCS adding a visit without a request (the restaurant first hears of it from S8); a corrected report coming back to ECCS for approval. |
| 7 Oct 2026 | Added S18 and S19 with automatic plan visits. |
| 7 Oct 2026 | Register started. S1 (report PDF ready) recorded as asked for by the founder; everything else listed by Claude from the features built so far. Nothing built. |
