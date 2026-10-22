// ECCS Buddy's guide to the restaurant app (16 Oct 2026): every screen the Owner and the Manager
// have, where it is, and how to do the common tasks. Buddy answers questions about the app from
// this text only, never from guesses (the founder's brief). Keep it in step with the app: when a
// screen moves or a button is renamed, change it here too. It is part of the fixed instructions
// that are cached (claude-engine.ts), so it costs almost nothing per message; keep it plain and short.
//
// The words in quotes are the app's own English labels (packages/i18n/src/en.ts). The app is in
// twelve languages, so Buddy describes the place ("the bottom bar, then More") rather than
// quoting a label the person may see in another language.

export const BUDDY_APP_GUIDE = `# The ECCS restaurant app: where things are and how to do them

Who uses it: the Owner (all outlets of the restaurant), the Manager (one outlet) and the Head Chef (checklists, food labels, SOPs and issues only). Each person logs in on a phone linked to the restaurant with their own 4-digit PIN; the PIN decides what they see. "Lock" (in More) returns the phone to the PIN pad for the next person. A forgotten PIN: "Forgot your PIN?" under the keypad (the Owner gets a new one with their mobile number; staff ask the Owner or Manager).

Bottom bar for the Owner and Manager: Home, Checklists, Services, Calendar, and More (the full menu: profile, language, Lock and every other screen). An Owner with several outlets picks the outlet on each screen from the one-line outlet chooser at the top (a shop icon and the outlet's name).

## Home
How today is going at the outlet: the hygiene score card, money due (if any), today's checklists with their status, licences to renew, open issues with ECCS, and ECCS visits (today's and coming ones first, then "Earlier, not done yet" for a booked visit whose day passed without it starting). The bell at the top opens Notifications. ECCS Buddy opens from the Buddy button at the top of most screens, from its card on Home, and from More.

## Daily checklists (bottom bar: Checklists)
- Today's checklists, each with its state ("Overdue", "In progress", "Submitted"). A red alarm clock in the corner, above the arrow, means it is past its due time and not handed in; a red exclamation mark means someone reported a problem on it. "Last 7 days" lists one line per day (for example "2 of 4 missed"); tap a day to see its checklists.
- Filling one in: open it, answer each check OK or Problem (a problem needs a reason). A check marked "Photo needed" needs a photo from the app's camera; a "Tick only" check is ticked with one tap. Then "Submit checklist". One checklist per outlet per day is shared by everyone; once anyone submits it, nobody can change it.
- The Owner or Manager can "Mark as reviewed" a submitted checklist.
- Adding your own check: Checklists, then "Edit checklists" (a list of the outlet's checklists with their due time and number of items), tap the checklist, then under "Add an item" search for it (matching ready-made checks appear as you type; tap one, or add exactly what you typed), and choose "Photo needed" or "Tick only". In the checklist, each of your own items has a "Photo needed" switch and a bin to remove it; ECCS's basic items cannot be changed or removed.
- A new checklist (for example a mid-day checklist): Edit checklists, "Add a checklist": a name and a due time (24-hour, like 14:30); it then opens for its items. A checklist's due time is changed inside it; your own checklists can be removed there ("Remove this checklist").
- Checklists work without signal once opened with signal; answers are sent when signal returns.
- History of past days: the Calendar.

## Services (bottom bar: Services; "Services and booking" in More)
- The list: visits waiting for your sign-off, then "Earlier, not done yet" (a booked visit whose day has passed without it starting, marked "Not done"; call ECCS about it), then "Coming up". Further down, "Your plan" lists each service of the plan with its next visit; a service whose visit day has passed says "Due since" that day, with "Ask ECCS about it", which opens Issues to call or message ECCS (a plan visit is arranged by ECCS and paid for by the plan, so it is not booked again).
- Booking a one-time service: Services, "Book a service": choose the service (prices shown before GST; once one is chosen the list folds to it, and "Change" opens the list again), a day from tomorrow (up to 14 days ahead) and a two-hour arrival window (8-10 am to 6-8 pm, or After closing), add a note if you like, and send. ECCS confirms the visit; until then you can withdraw the request. After ECCS confirms, only ECCS can change or cancel it: call ECCS (Raise an issue has Call and WhatsApp).
- A booked visit is invoiced after ECCS approves its report. Visits that come from your plan are covered by the plan's invoice.
- A visit's page lists "What the team will do" (afterwards "What the team did", each task ticked or marked "Not done" with the reason; a visit that did not happen or was cancelled lists "What this visit covers"). During a visit the ECCS Supervisor records the tasks and photos. When the visit is finished, the Owner or Manager opens it, checks the work and photos, rates it (1 to 5 stars) and taps "Sign off this visit". The report PDF is available once ECCS approves it (the line under the visit's status says so meanwhile); some services (pest control 15 days, deep clean 30, chimney and hood 90) also give an ECCS certificate.

## Calendar (bottom bar: Calendar)
A month view like a phone's calendar: each day's checklists (a clipboard with how many were done, like 2/3), ECCS visits, licence expiries and holidays; "What the marks mean" under the month explains the pictures and colours. Tap a day to see its details, with the same labels as Services (for example "Supervisor assigned" or "Not done"); today's checklists past their due time say "Overdue" and are red on today, as on Home. "Coming up" lists the next visits and licences expiring within 90 days, from tomorrow.

## More menu (the full list)
Food labels, Issues, SOPs, Services and booking, Service calendar, Vendors, Licences and documents, Certificates, Customer page, Plan, Invoices, Inspections, Staff, ECCS Buddy; at the top the person's photo and name (My profile); at the bottom the language and Lock.

## SOPs
ECCS's standard SOPs and the restaurant's own, grouped by category, each with its number of steps. "Add SOP" offers two ways: "Write your own" (a name, a category chosen from a list, and numbered steps) or "Find a ready-made SOP" (search the library of about 800 SOPs, or pick a category, and tap "Add to my SOPs" to make your own copy, which you can reword). An SOP belongs to one outlet (an Owner with two outlets adds it at each). The Head Chef can read SOPs but not change them.

## Food labels
One list of saved labels, each with how long the food keeps. Set how many of each with minus and plus, then one Print button prints them all: "prepared" is the moment Print is pressed and "use by" is that plus the keeping time; "prepared by" is the person logged in. "Add a label" saves a new one: its name and how long it keeps (4, 8 or 12 hours, 1 to 7 days, or "Another length", a number with Hours or Days; changing a saved label asks the same way). The search box at the top finds a label by name; each row says how long it keeps and when it was last printed ("Printed 13 Oct"). Only the Owner and Manager can change or remove a saved label: tap its name, or "Manage labels" under the list (where each label can also say where it is kept, chilled, frozen or dry store, its allergens and a note, and "Add from the starter list" adds common kitchen items in one tap; their times are only suggestions). Printing goes through the phone's own print screen, a shared picture or PDF, or an A4 sheet; there is no direct label printer yet.

## Licences and documents
"Add a licence": pick a photo or PDF of it and the type, number, holder, issue and expiry dates fill in by themselves (read by AI): check each field and Save. Renewing replaces the old copy. "Add a document" keeps certificates, reports and other papers (PDF or picture, up to 10 MB). A licence is "expiring soon" in its last 60 days. Each licence card has "View document" and "Renew"; "Remove" is under its ⋮ (More actions) button. A document opens with a tap; "Delete" is under its ⋮. Papers ECCS files there (service reports, inspection reports, certificates, tax invoices) are titled by what and when, with their number underneath.

## Certificates
ECCS's own service certificates (for example pest control), with their numbers and validity. Open one to show or print it. They are ECCS's certificates of service, not FSSAI or government documents.

## Customer page
A public web page customers open by scanning your QR code: yesterday's hygiene score, your daily checklists' names and results, photos you chose and ECCS approved, ECCS's inspection and services, and a box saying ECCS is a private company, not a government body. Only the Owner can turn it on or off: while it is off, the screen's main button "Turn the page on" turns it on; once it is on, the switch beside where it stands turns it off. "Add photos" puts forward photos from your daily checks for ECCS to approve. The QR code can be shared or printed as a poster; it works only while the page is on.

## Plan (regular ECCS visits)
The outlet's service plan: its services and how often, the next visits, the price per cycle with GST, and when it renews. Only the Owner subscribes, changes plan (from the next cycle) or cancels (at the end of the cycle; "Cancel plan" is the red link under "Change plan", and it asks first); the Manager reads it. Visits from the plan are put in the diary by themselves. A service whose visit day has passed says "Due since" that day, with "Ask ECCS about it", which opens Issues to call or message ECCS (a plan visit is arranged by ECCS and paid for by the plan, so it is not booked again).

## Invoices
GST invoices from ECCS, newest first, with what is due and overdue. A plan's invoice is titled by the period it covers (for example 15 Oct to 14 Nov) with the plan under it; a visit's by the service. One due today or tomorrow says "Due today" or "Due tomorrow"; one past its date says how many days overdue (for example "7 days overdue"). Open one to see or share its PDF. Only the Owner pays, with "Pay" on the invoice (today this is a sample payment: no money moves). Invoices are due 7 days after they are issued.

## Hygiene score
A number out of 100 for the outlet: ECCS's latest inspection 60 points, licences 10, the day's checklists 30 (on time full share, late half, not handed in nothing). "Provisional" until ECCS has inspected. "Why this score?" gives two sentences on what costs the most and what to do first. Open it from the score card on Home ("See how it is worked out"): the parts with their points come first, and "How it is worked out" is folded under them.

## Inspections
ECCS's scored hygiene inspections against the FSSAI checklist (92 checks, grade A+ from 88, A from 80, B from 68). The restaurant sees an inspection once ECCS approves its report, in this order: the score and grade, the date and who inspected with the button to open the PDF right under them, the summary with "Fix these first", each non-compliance with what to fix and by when, and the section scores (with "How the score works" folded under them).

## Raise an issue (contacting ECCS)
The screen is titled "Issues". Tap "Raise an issue" and tell ECCS what is wrong: a category (pest sighting, chimney or exhaust, equipment, cleaning or hygiene, help with the app or service, something else), what happened, and up to 4 photos. Each issue gets a reference like ECCS-0042. The same screen has Call and WhatsApp buttons (under "Or contact ECCS directly") and your recent issues; ECCS replies inside the issue, as in a chat (the day once, the time on each message). Problems reported on your own checklists stay with the restaurant and are never sent to ECCS.

## Staff (More, then Staff)
- People: the outlet's staff list. "Add a person": name, job, phone, joining date, monthly salary or daily wage, weekly day off, and for someone who signs in to this app with their own PIN, which login is theirs ("Their login for this app", a list of names with the role under each). The Owner then adds the person's face for clock-in.
- Attendance: staff clock in and out by face on the outlet's linked phone, from the PIN screen ("Clock in / Clock out", at the top, above the PIN); nobody marks attendance by hand. Only the Owner corrects a day.
- Salary tracker: each month's pay worked out from attendance, with advances and payments. Open a person for their month: "Record a payment" is the main button at the foot of the screen, "Share summary" sends the month as text, and "How this is worked out" opens the sums. The Manager cannot change their own record, pay or attendance; only the Owner can.
- To review: clock-ins and days waiting for the Owner to check; a red number on its row says how many. Hours and pay days: the hours for a full and a half day, and the days a month's salary is divided by (the Owner sets them).
- App logins: the people who use this app (Manager, Head Chefs). "Add a login" gives someone a PIN, shown once. Tap a person's row for "New PIN" or "Remove access". The Owner adds Managers and Head Chefs; a Manager adds Head Chefs at their outlet.
Buddy never reads or changes anything in Staff: attendance, pay, faces and clock-in photos are the restaurant's private records.

## Vendors
Nearby food wholesalers and distributors, nearest first, by category (vegetables, rice and groceries, dairy, meat, packaging, cleaning supplies, gas and more), with Call, WhatsApp and Directions. The vendors listed today are samples: their numbers are not real. ECCS has not checked the vendors; check a vendor's FSSAI number on FSSAI's FoSCoS portal.

## My profile and language
Tap your photo and name at the top of More: your details, a photo, your restaurants, and Legal (the terms and privacy policy, each with the day you agreed; a long document has a "Contents" list that jumps to each section). The language is chosen at the bottom of More (twelve languages); the whole app changes at once. Urdu is laid out right to left.

## Notifications
The bell on Home: visits confirmed, reports ready, issues answered, licences expiring, checklists overdue, newest first by day; unread ones have a dot and bold writing. Several of one kind for one outlet on one day are one line (for example "4 checklists missed"): tap it to see them. Tapping one opens what it is about. "Mark all as read" is at the top right. Push notifications to the phone work in the installed app.

## Without signal
Checklists work without signal once opened; the rest of the app, and ECCS Buddy, need the internet.`;
