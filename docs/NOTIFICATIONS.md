# ECCS Platform: Notifications register

Every message the platform should send to a person without them opening the app first. Started on 7 October 2026 at the founder's request, so that none is forgotten: **no notification is built or tested yet.** The founder will have them built and tested together later.

**How to use this file**

- When a feature is built or changed, add or update its rows here in the same session (this is a rule in `CLAUDE.md`).
- "Status" is `not built` until the notification is actually sent. When one is built, change it to `built` with the date, and to `tested` once the founder has seen it arrive on a phone.
- Wording in the "Says" column is a draft. Final wording goes into the app's language files, in all twelve languages.

**What exists already**

- The database has a `Notification` table (one row per message per person, with a read mark) and a `DeviceToken` table (where to push to). Nothing writes to them yet.
- Nothing in the app shows notifications: there is no bell, no list and no badge.
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
| S1 | ECCS approves a signed-off report, so its PDF is ready | O, M of the outlet | "Your service report SR-… for {service} is ready. Open it as a PDF." | Push + in-app | not built (**asked for by the founder, 7 Oct**) |
| S2 | A restaurant sends a booking request | Adm | "{outlet} asked for {service} on {date}, {time}." | Console badge (exists as a count) + push | not built |
| S3 | ECCS confirms a request | O, M | "ECCS confirmed {service} for {date}, {time}. Supervisor: {name}." | Push + in-app | not built |
| S4 | ECCS turns down a request | O, M | "ECCS could not take your request for {service} on {date}. Call us to rearrange." | Push + in-app | not built |
| S5 | ECCS moves a visit to another day or time | O, M; Sup | "{service} has moved to {date}, {time}." | Push + in-app | not built |
| S6 | ECCS cancels a visit | O, M; Sup | "{service} on {date} has been cancelled." | Push + in-app | not built |
| S7 | A visit is given to a Supervisor, or taken away | Sup | "New visit: {service} at {outlet}, {date}, {time}." | Push + in-app | not built |
| S8 | The day before a visit | O, M; Sup | "Reminder: ECCS {service} tomorrow, {time}." | Push | not built |
| S9 | The morning of a visit | Sup | "Today: {count} visits. First: {outlet}, {time}." | Push | not built |
| S10 | The Supervisor checks in at the outlet | O, M | "The ECCS team has arrived for {service}." | Push | not built |
| S11 | The Supervisor finishes the visit | O, M | "{service} is finished. Check the photos and sign off." | Push + in-app | not built |
| S12 | A finished visit is still not signed off after a day | O, M | "{service} from {date} is waiting for your sign-off." | Push | not built |
| S13 | The restaurant signs off | Adm; Sup | "{outlet} signed off {service}: {stars} stars. Report to approve." | Console badge (exists as a count) + push | not built |
| S14 | The restaurant gives one or two stars | Adm | "Low rating at {outlet}: {stars} stars. '{comment}'" | Push, straight away | not built |
| S15 | ECCS sends a report back for correction | Sup | "ECCS asked for a correction on {service} at {outlet}: {note}" | Push + in-app | not built |
| S16 | A visit's date has passed and it was never started | Adm; Sup | "{service} at {outlet} on {date} was not done." | Console + push | not built |
| S17 | A visit in the next two days has no Supervisor | Adm | "{service} at {outlet} on {date} has no Supervisor yet." | Console badge (exists as a count) | not built |

## 2. Daily checklists

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| C1 | 30 minutes before a checklist is due and it is not submitted | HC (and M) | "{checklist} is due by {time}. {done} of {total} done." | Push | not built |
| C2 | A checklist's due time passes and it is not submitted | HC, M | "{checklist} is overdue." | Push | not built |
| C3 | A checklist is submitted with a problem reported | M, O | "{name} reported a problem on {checklist}: {item}." | Push + in-app | not built |
| C4 | A day ends with a checklist not submitted | M, O | "{checklist} was missed at {outlet} on {date}." | In-app (morning summary) | not built |
| C5 | A submitted checklist has not been reviewed after a day | M | "{checklist} from {date} is waiting for your review." | In-app | not built |
| C6 | A photo or answer saved without signal could not be sent after several tries (once offline working is built) | whoever took it | "Some checklist items have not been sent. Open the app when you have signal." | Push | not built |

## 3. Issues raised with ECCS

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| I1 | A restaurant raises an issue | Adm (Sup for their outlets) | "{outlet} raised an issue: {category}. '{first words}'" | Console badge (exists as a count) + push | not built |
| I2 | ECCS replies on an issue | whoever raised it, plus M, O | "ECCS replied on {reference}: '{first words}'" | Push + in-app | not built |
| I3 | The restaurant replies on an issue | Adm | "{outlet} replied on {reference}." | Console + push | not built |
| I4 | ECCS marks an issue in progress or resolved | whoever raised it, plus M, O | "ECCS is working on {reference}." / "ECCS marked {reference} as resolved." | Push + in-app | not built |
| I5 | The restaurant closes or reopens an issue | Adm | "{outlet} reopened {reference}." | Console + push | not built |
| I6 | An open issue has had no reply from ECCS for a day | Adm | "{reference} at {outlet} has been waiting {hours} hours." | Console | not built |

## 4. Licences and documents

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| L1 | A licence expires in 30, 15, 7 and 1 days | O, M | "{licence} expires in {days} days ({date})." | Push + in-app | not built |
| L2 | A licence has expired | O, M | "{licence} expired on {date}. Renew it and add the new copy." | Push + in-app, repeated weekly | not built |
| L3 | ECCS adds or replaces a licence or document for the outlet | O, M | "ECCS added {title} to your documents." | In-app | not built |
| L4 | A client's licence is expired or expiring | Adm | "{count} licences need attention." | Console badge (exists as a count) | not built |
| L5 | A service report PDF is filed in the outlet's documents | O, M | Covered by S1 | – | see S1 |

## 5. Logins and staff

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| A1 | A new phone is linked to an outlet with its restaurant code | O (M for their outlet) | "A new phone was linked to {outlet}." | Push + in-app | not built |
| A2 | A PIN is locked after five wrong tries | O, M | "Someone tried a wrong PIN five times at {outlet}." | In-app | not built |
| A3 | The Owner asks for a new PIN by one-time code | the Owner | The one-time code itself | SMS (real SMS is not set up; sample code 123456 today) | not built |
| A4 | A person's access is removed or given back | – | No message planned: they are told in person | – | not planned |

## 6. SOPs

| # | When | Who | Says | Channel (suggested) | Status |
|---|---|---|---|---|---|
| P1 | ECCS publishes a new standard SOP or changes one | O, M, HC | "ECCS updated the SOP '{name}'." | In-app | not built |

## 7. Features not built yet (to fill in when they are)

| Feature | Notifications to expect |
|---|---|
| Visits created from a plan | A month's visits scheduled; a plan visit could not be scheduled |
| Scored inspections | Inspection booked; report ready; a critical finding |
| Hygiene score | Score dropped; weekly summary |
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
| 7 Oct 2026 | Register started. S1 (report PDF ready) recorded as asked for by the founder; everything else listed by Claude from the features built so far. Nothing built. |
