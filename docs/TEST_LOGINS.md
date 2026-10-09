# Test logins

Every login for trying the ECCS apps on this computer. **All of this is sample data** created by the seed (`packages/db/prisma/seed.ts`). None of it is a real person, phone number or password, and none of it must be used once the system goes live.

The one-time code (OTP) is always **`123456`** in development. No SMS is sent.

---

## 1. Restaurant app (mobile app)

Open the app, tap **"I have a restaurant code"**, type the code for the branch once, then enter a PIN. The phone remembers the branch; after that it only asks for a PIN.

### Spice Route Kitchens (two branches)

| Branch | Restaurant code |
|---|---|
| Spice Route, Jubilee Hills | **`SPICE-JH2K7M`** |
| Spice Route, Gachibowli | **`SPICE-GB4N8P`** |

| Person | Role | PIN | Works with code | App language | Sees |
|---|---|---|---|---|---|
| Sample Owner (Spice Route) | Owner | **`2580`** | either Spice code | English | Both branches |
| Sample Manager (Jubilee Hills) | Manager | **`4821`** | `SPICE-JH2K7M` | English | Jubilee Hills only |
| Sample Head Chef (Jubilee Hills) | Head Chef | **`7306`** | `SPICE-JH2K7M` | Telugu | Jubilee Hills only |
| Sample Manager (Gachibowli) | Manager | **`1593`** | `SPICE-GB4N8P` | Hindi | Gachibowli only |
| Sample Head Chef (Gachibowli) | Head Chef | **`6042`** | `SPICE-GB4N8P` | Hindi | Gachibowli only |

### Deccan Biryani House (one branch)

| Branch | Restaurant code |
|---|---|
| Deccan Biryani House, Kukatpally | **`DECCA-KP6R3T`** |

| Person | Role | PIN | App language | Sees |
|---|---|---|---|---|
| Sample Owner (Deccan Biryani) | Owner | **`3917`** | Telugu | Kukatpally |
| Sample Head Chef (Kukatpally) | Head Chef | **`8264`** | Telugu | Kukatpally |

Deccan Biryani has no Manager in the sample data. Add one from **Staff logins** as the Owner if you want to test that.

### Switching person or branch

- **Next person on the same phone:** open the menu (top left of the home screen) and tap **Lock**. The PIN pad comes back.
- **A different branch or restaurant:** on the PIN pad tap **"Use a different restaurant"**, then enter another code.
- The language is changed in **My profile** (tap your name at the top of the menu), under Preferences.

### Owner's login by phone and one-time code

This is the flow a new owner uses once, to link their phone and be given a PIN. Tap **"I am the owner"**.

| Owner | Phone | Email | One-time code |
|---|---|---|---|
| Sample Owner (Spice Route) | `9100000001` | owner@spiceroute.example | `123456` |
| Sample Owner (Deccan Biryani) | `9100000002` | owner@deccanbiryani.example | `123456` |

The sample owners already have a PIN, so this simply logs them in and keeps the PIN in the tables above. Only **"Owner: forgot PIN"** on the PIN pad (same phone number and code) issues a **new PIN**; the old one then stops working, so note the new one, or reset everything with the command in section 4.

---

## 2. ECCS web console

Open http://localhost:3000, enter the phone number, then the code.

| Person | Role | Phone | One-time code | Can do |
|---|---|---|---|---|
| Sample Super Admin | Super Admin | `9000000001` | `123456` | Everything |
| Sample Ops Manager | Operations Manager | `9000000002` | `123456` | Clients, issues, licences, SOPs |
| Sample Supervisor | Supervisor | `9000000003` | `123456` | Mostly read-only |

The same three can log in to the mobile app through **"ECCS staff login"**, but the app has nothing built for ECCS staff yet; their work is in the console.

---

## 3. What each restaurant role can open

| Section | Owner | Manager | Head Chef |
|---|---|---|---|
| Dashboard (home screen) | Yes, with branch selector | Yes, own branch | Today's checklists only |
| Daily checklists | Fill in, review, set up | Fill in, review, set up | Fill in |
| Raise an issue | Yes | Yes | Yes |
| SOPs | Read, add own | Read, add own | Read |
| History calendar | Yes | Yes | No |
| Licences and documents | Yes | Yes | No |
| Staff logins | Yes | Yes, own branch | No |

---

## 4. If a login stops working

- **"Could not reach the server":** the API is not running. Start it with `pnpm --filter @eccs/api start` from `C:\Users\eosfera\eccs`.
- **A PIN is refused:** check the phone is linked to the right branch (a Manager's or Head Chef's PIN only works with their own branch's code). It may also have been changed from Staff logins ("New PIN") or by "Owner: forgot PIN". The Owner can issue a new PIN from **Staff logins**.
- **Five wrong PINs in a row** lock that phone (or browser) for 15 minutes, for everyone. Wait, or use another device.
- **Reset everything to the lists above:** run this from `C:\Users\eosfera\eccs\packages\db`. **It wipes all data** (checklists filled in, issues, licences, SOPs you added) and reloads the samples.

  ```powershell
  pnpm seed
  ```

---

## 5. Where to open the apps

| App | Address |
|---|---|
| Restaurant app in a browser | http://localhost:8081 |
| ECCS web console | http://localhost:3000 |
| Restaurant app on the Android phone | Expo Go, scan the QR code from `pnpm --filter @eccs/mobile start` |

How to start them is in `docs/STATUS.md`, section 6, "See it running".

## 6. Trying the service loop

The loop needs three people (the restaurant, the ECCS office and the Supervisor). One phone and one computer are enough if you switch logins.

1. **Book (restaurant app).** Log in as an Owner or Manager. Menu → Services and booking → Book a service. Pick a service, a day and a time of day, and send. The request shows as "Waiting for ECCS to confirm".
2. **Confirm (web console).** Log in as the Operations Manager (9000000002). Open Visits. The request is at the top: choose the day, the time and the Supervisor, then Confirm the visit. "Add a visit" puts one in the diary without a request.
3. **Do the visit (app, as the Supervisor).** In the app choose Lock, then "Use a different restaurant" if needed to reach the welcome screen, then "ECCS staff login" with 9000000003 and the one-time code. Menu → My visits → open the visit → "I have arrived: check in". Mark each task, take a before and an after photo, type who did the work, then Finish the visit.
4. **Sign off (restaurant app).** Log back in as the Owner or Manager of that outlet. Services and booking shows the visit under "Waiting for your sign-off". Open it, read it, give it a star rating, and Sign off this visit. It then shows "ECCS is checking the report".
5. **Approve the report (web console).** Back in the console as the Operations Manager, Visits shows the visit as "Report to approve". Open it, look it over, and choose Approve the report (or Send back to the Supervisor, with a note saying what to correct).
6. **Open the PDF.** Once approved, the visit in the app and in the console has "Open the report as a PDF", and the PDF is filed in the outlet's Licences and documents.
7. **Read the report.** In the app it is under Past visits and on the History calendar. In the console it is under Visits → Finished.

The Head Chef does not see services. The Supervisor sees only visits given to them.

## 7. Trying an inspection

1. **Plan it (web console).** As the Operations Manager, open Inspections, choose an outlet and a date, and give it to the Supervisor (or "Myself").
2. **Do it (app, as the Supervisor, 9000000003).** More → Inspections → open it. Answer each check: Compliant, Not compliant or N/A. A "Not compliant" needs a note, how serious it is, what to do about it, a date to fix it by, and a photo. Finish when every check is answered.
3. **Approve it (web console).** Inspections shows the report with its score and grade. Approve it, or send it back with a note.
4. **Read it (restaurant app).** As the Owner or Manager of that outlet: More → Inspections.

## 8. Trying checklists without signal

1. With signal, open Checklists once so today's checklists are on the phone.
2. Switch on aeroplane mode. Open a checklist, tick items, take photos, report a problem, and Submit. A line at the bottom says how many are waiting to be sent.
3. Switch aeroplane mode off. The line changes to "Sending…" and then "All sent".

## 9. Trying the hygiene score, the monitoring board and console editing

- **Hygiene score (app).** About half a minute after the API starts, Home shows the score for the chosen outlet. Tap it for the breakdown and the 30-day trend. The sample outlets have not been inspected, so their scores say "Provisional" and come from licences and checklists only; approve an inspection (section 7) to see the inspection take 60 of the 100 points. Hand in a checklist and pull down to refresh to watch the score move.
- **Monitoring (console).** Open Monitoring: every outlet, worst first. The tiles at the top filter the list; open a row to see what it is behind on.
- **Catalogue (console).** Open Catalogue to add or change a bookable service, its price, and the task list for each kind of service.
- **Editing a client or outlet (console).** On Clients, open a client: Change details, New restaurant code, Linked phones, Switch off.

**Take care with the sample restaurants.** Switching off a sample outlet or client, issuing a new restaurant code, or using "Lost PIN: set up again" on a sample Owner changes the logins in this file until you undo it. To try those, onboard a restaurant of your own first.

## 10. Trying the inspection report PDF

After approving an inspection in the console (section 7), the report has "Open the report as a PDF", in the console and in the app, and the PDF is filed in the outlet's Licences and documents.

## 11. Trying certificates

1. Take a pest control, deep clean or chimney visit through to the end (section 6): the Supervisor finishes, the Owner or Manager signs off with a rating, and you approve the report in the console (Visits).
2. In the console open **Certificates**: the new certificate is listed with its number and dates. "Open the PDF" shows it.
3. In the app, as the Owner or Manager: **More > Certificates**, or open the visit and tap "Open the certificate".
4. In the console's **Catalogue**, each kind of service has a "Certificate" line where you can switch certificates on or off and set the number of days.

## 12. Trying a visit and an inspection with no signal

1. With signal, log in to the app as the Sample Supervisor (ECCS staff login, `9000000003`). Open **Visits** and **Inspections** once and wait a few seconds, so they are saved on the phone.
2. Turn on aeroplane mode (or stop the API on the PC). Do not reload the app in Expo Go while offline.
3. Open a visit. It says it is showing what was saved on this phone. Check in, tick tasks, mark one not done with a reason, take a before and an after photo, type the team and notes, then Finish.
4. Each item shows "Saved on this phone. Not sent yet." and the bottom line counts what is waiting.
5. Close the app fully and reopen it, still offline: everything is still there.
6. Open an inspection offline. Answer checks, record one non-compliance with a photo, then Finish. The score and grade appear, marked as worked out on this phone.
7. Turn the signal back on, or tap "Try now". It sends, then says all sent. Check both in the console.
8. To see a refusal: offline, check in to another visit; cancel that visit in the console; turn the signal on. The visit shows a "Not sent" box with "Send again" and "Delete from this phone".

## 13. Trying plans, invoices and sample payments

About a minute after the API starts it renews the plans and raises the invoices that are due, so each sample outlet on a plan gets an invoice. **No money moves anywhere: every payment is a sample.**

**Invoices and paying (app)**

1. Log in as the Spice Route Owner (`SPICE-JH2K7M`, PIN `2580`). Home shows a "To pay" line when something is due.
2. **More > Invoices**: the amount due is at the top. Open an invoice to see its lines, the GST split and "Open the invoice as a PDF".
3. Tap **Pay**. The screen says "Sample payment. No money moves." Choose UPI, then "Make this payment fail": the invoice stays unpaid.
4. Pay again and complete it: you get a receipt, and the PDF is now marked PAID.
5. As the Manager (PIN `4821`): invoices can be read but there is no Pay button. As a Head Chef: no Invoices entry.

**Plans (app)**

6. As the Owner: **More > Plan** shows the current plan, what it includes, the price with GST, the cycle dates and the next invoice date. Try **Change plan** (it takes effect at the next cycle and can be undone) and **Cancel** (it ends at the end of the cycle and can be undone).
7. To see the plans on offer and **Subscribe**: in the console cancel that outlet's plan with "Cancel now" first, then open More > Plan again. Subscribing raises the first invoice at once.

**Console**

8. **Plans**: add a plan, change a price. The form says how many outlets are on it and that they keep their price until their next cycle.
9. **Clients** > a client > an outlet: put it on a plan, change plan, pause, resume, cancel.
10. **Invoices**: totals at the top, search and filters. Open an invoice: Open the PDF, **Record a payment** (try part of it, then try more than is left: refused), **Void** an unpaid one with a reason, then **Raise it again**.
11. **A one-time visit**: book a service as the Owner, confirm it in Visits, do it as the Supervisor, sign off as the Owner, approve the report in the console. Its invoice appears in Invoices.

## 14. Trying the installed Android app (APK)

The APK is `apps\mobile\ECCS-test.apk` on the PC (how to build it: `docs/APK_BUILD.md`).

1. The phone on the same Wi-Fi as the PC; the API terminal running on the PC.
2. Copy the APK to the phone and open it to install. The app is called **ECCS**. It is separate from Expo Go and starts unlinked: enter a restaurant code and PIN from section 1 again.
3. Everything in sections 6 to 13 works the same way. Checklists, visits and inspections without signal can now be tried by simply switching Wi-Fi off on the phone, with no Expo Go in the way.
4. **Push notifications** arrive only after the Expo and Firebase accounts exist and the app has been rebuilt with them (`docs/APK_BUILD.md`, Part A). Until then More > Notifications says push is not available on this phone.

## 15. Trying the new services

Restart the API and console terminals first. All prices and tax codes are samples.

1. **App, as the Owner** (`SPICE-JH2K7M`, PIN `2580`): Services > Book a service. The list is under five headings; some services say "Part of this is done by an ECCS partner". Book "Frying oil test" and "Water test".
2. **Console > Visits:** confirm both for today and give them to the Sample Supervisor.
3. **App, as the Supervisor** (`9000000003`): open the oil test and check in. Type a reading for each fryer (try 24.9, 25 and 25.1) and Save each; mark a fryer the kitchen does not have as Not done; add an after photo; Finish. On the water test, type the partner's name, tick the tasks, add a photo, Finish.
4. **App, as the Owner:** sign off both.
5. **Console > Visits:** open the water test and use "Attach a result document" with any PDF. Approve both reports. The oil report's PDF shows each reading with its verdict; Invoices shows the tax code and 18%.
6. **App, as the Owner:** the water-test visit shows the document with Open; it is also under Licences and documents.
7. **Console > Catalogue:** "Add a kind of service" (for example "Water tank cleaning", Cleaning, tax code 998534, 18%). Add a task and a bookable service; it then appears in the app's booking list.

## 16. Trying photo integrity

1. **Console > Clients >** an outlet > "Change details": paste the kitchen's coordinates (for example `17.4326, 78.4071`, or a maps link) into "Location of the kitchen".
2. **Installed app on the phone** (rebuild the APK first: this adds the location question): take a proof photo on a checklist. The app asks once whether it may note where the phone is; choose Allow, then Allow on Android's own box.
3. **A re-used photo**, easiest in the browser preview: as a Head Chef (`DECCA-KP6R3T`, PIN `8264`) answer two checks with the same picture file. As the Owner (PIN `3917`) open that checklist: the second photo carries a neutral "matches one already used" line. The Head Chef does not see it.
4. **Console > Monitoring:** that outlet's Photos column shows the count, and opening the row lists the doubtful photos with reasons. Photos added in the browser preview are always listed as "picked from files".
5. **A visit photo:** as the Supervisor add the same picture twice as proof photos on a visit; as an admin open the visit in the console: the reason is under the photo.
6. **Far from the kitchen:** take a proof photo on the phone somewhere else; the console shows "Taken ... from the outlet". Nothing is blocked on the phone.
