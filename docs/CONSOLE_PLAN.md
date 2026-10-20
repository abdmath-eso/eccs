# The ECCS console: pages, dashboards and how people work in them

**A plan for the founder to approve (20 Oct 2026). Nothing in it is built yet.**

It answers the founder's request:
- research where the eight pages of `docs/design/2026-10-20 Console operations (founder's design).pdf` fit (Today, Dispatch, Supplies, Partners, Quality, People, Quotes, Onboarding);
- keep the console smooth, simple and not bloated with dashboards;
- leave out People;
- write down the workflows of the console and every dashboard;
- say what we can build.

## 1. The answer

**The PDF's ideas are good; its shape would bloat the console.** It adds eight menu entries to today's sixteen. Several of them show the same visits, leads or photos a second time.

The plan keeps **every useful idea** and adds **only two new pages**:
- **Today**, the new home;
- **Quality**, a page of work queues.

Everything else becomes a **tab of the page that already holds that record**:

| PDF page | Where it goes | Why |
|---|---|---|
| **Today** | **New home page** (the first screen after login, for the office) | The console has no "what needs me now" screen; today it opens on the client list |
| **Dispatch** | **Visits → "Week" tab**, with "Waiting for a slot" beside it | It is the same visits seen as a week; Jobber's and ServiceTitan's schedules work this way (one schedule, a day and week view, an "unscheduled" side panel) |
| **Quality** | **New page**: Follow-ups, Photos, Incidents | Three to-do queues that have no home today |
| **Onboarding** (new outlets) | **Clients → "New outlets" tab** | It is a client's first ten days |
| **Quotes** | **Sales → "Quotes" tab** | Quotes already live on each lead; only a list of all of them is missing |
| **People** | **Not built** (the founder). Its two useful bits go into **Team**: document expiry dates, and who can open the console | Team already holds each person's joining file, documents and login |
| **Supplies** | **Later**, as a **Finance → "Stock and van" tab** | It needs the Supervisor's app to record chemicals used, which it does not yet; stock was left out of the first version on purpose (PROPOSAL) |
| **Partners** | **Later**, a small page under Set-up | Worth it once there is more than one partner; today it is one pest-control firm, a free-text name on the visit |

**The menu stays at 16 entries**, the same as today, while doing everything the PDF's 24 would. Monitoring also moves into Clients as its "Health" tab, and the Customer pages' photo approvals move into Quality.

## 2. The rules this plan follows (from the research)

1. **One home that answers "what needs me today".**
   - An operations screen is a single glance that shows what needs attention first, with the detail one click away (Stephen Few, *Information Dashboard Design*).
   - Today does that; every other page is where the work is done.
2. **Queues, not walls of charts.**
   - Each item has one button.
   - It leaves the queue when the work is done (the PDF's own rule, and ServiceTitan's job tray and alerts).
   - A number appears only where someone acts on it.
3. **One record, many views.**
   - A visit is one thing, whether seen in a list, on the week board, on Today or in the Supervisor's app. Moving it anywhere moves it everywhere.
   - Quotes and new outlets are views of leads and clients, not separate stores.
4. **Each fact in one place, linked from the others.** The inventory found repeats to remove:
   - Monitoring's columns repeat Visits, Inspections and Issues;
   - Finance's overdue list repeats Invoices;
   - the AI log is in two places.
5. **Shaped by role.** Each person lands on their own page and sees only their sections (section 3).
6. **Nothing typed twice, no sample numbers.** Every line comes from records the apps already write.

## 3. The console map

| Group | Entry | Tabs | Who sees it | What changes |
|---|---|---|---|---|
| | **Today** | – | Super Admin, Ops Manager, Supervisor (their own day) | **New**, and the home page |
| **Daily work** | **Visits** | List · **Week** · Waiting | SA, OM, SV (theirs, read-only) | **Week board** and **Waiting** added (was the PDF's Dispatch) |
| | **Inspections** | as today | SA, OM, SV | – |
| | **Issues** | as today | SA, OM, SV | – |
| | **Quality** | Follow-ups · Photos · Incidents | SA, OM | **New**; takes the Customer pages' photo queue |
| **Clients** | **Clients** | **Health** · All clients · **New outlets** | Health: SA, OM, SV (their outlets). The rest: SA, OM | Monitoring becomes **Health**; **New outlets** is the PDF's Onboarding |
| | **Invoices** | as today | SA, OM | Gets Finance's WhatsApp "Remind" too |
| | **Certificates** | as today | SA, OM, SV | – |
| **Business** | **Sales** | Overview · Leads · **Quotes** | SA, OM, BDE (own leads) | **Quotes** tab added |
| | **Finance** | as today (+ Stock and van, later) | SA | – |
| | **Team** | People · Joining templates | SA, OM | Document expiry and console access added (the useful part of the PDF's People) |
| | **AI usage** | as today | SA, OM (reads) | – |
| **Set-up** | **Catalogue** | as today | SA, OM | "What to carry" per kind of service, for the load list |
| | **Plans**, **SOPs** | as today | SA, OM (SOPs: SV too) | – |
| | **Partners** (later) | – | SA, OM | **New, later** |
| | **Logs** | as today | SA, OM | Moves into Set-up (one group fewer) |

**Where each person lands:**
- **Super Admin and Ops Manager:** Today (today they land on Clients).
- **Supervisor:** Today, showing their own visits. It is mostly a phone person; the console is optional for them.
- **BDE:** Sales, whose "Do today" is already their Today.
- **A new hire:** their Joining page, as now.

## 4. Page by page: what is on it, and how it is used

### 4.1 Today (new home)

**Layout.** A one-line headline answers the morning question. For example: "5 visits, 2 free checks. 4 things need you." Under it, top to bottom:

1. **Today's visits and free checks**, in time order:
   - outlet, service, Supervisor, a note from the last visit;
   - one badge: Partner, Free check, or a warning such as "invoice overdue 9 days".
   - Free checks come from Sales (`Lead.checkAt`). Clicking a visit opens it in Visits.
2. **Needs you**, at most about six items, each with **one button**. When the work is done, the item is gone. Rules:

   | Item | Rule (all from existing records) | Button |
   |---|---|---|
   | Booking waiting for a slot | an app booking not placed after 4 hours | Place (opens Visits → Waiting) |
   | Visit without a Supervisor | today's or tomorrow's | Assign |
   | Visit not signed off | finished, waiting for the restaurant over 2 days | Remind (a notification to the Owner or Manager) |
   | Report to approve | waiting over 2 days | Approve |
   | Overdue invoice with a visit today | invoice past due, a visit there today | Add a note to the visit ("ask the manager") |
   | Issue not picked up | open over 2 days | Open |
   | Photo flagged | a doubtful photo waiting | Review (opens Quality → Photos) |
   | Follow-up due | an item in Quality → Follow-ups with nothing booked | Open |
   | New outlet stuck | not live 24 hours after being added | Act (opens Clients → New outlets) |
   | Incident open | any | Open |
   | Team document due | a document past or within 30 days of its date (section 4.10) | Open |

3. **Also today:** what is worth knowing but needs no button now:
   - invoices due today;
   - calls due (Sales follow-ups; new outlets' day-3 and day-10 calls);
   - plan visits created today;
   - later, stock at its reorder point.
4. **The day's sheet for each Supervisor:**
   - **visits:** in time order, with address and map link, and notes from the last visit;
   - **what to carry:** from each service's new "what to carry" list in Catalogue, for example ladder, harness and hood brushes for a chimney clean;
   - **how it is sent:** "Send the day's sheet" sends it to the Supervisor's phone as a notification, and their app shows it on its Jobs screen.
   - Quantities of chemicals come later, with stock (section 4.13). Route optimisation is out of the first version (PROPOSAL), so the order is by time.
5. **Evening close**, a short checklist the app fills in as the day goes:
   - every visit finished, with before and after photos;
   - every report handed in;
   - sign-offs still waiting, named;
   - money collected today entered in Invoices;
   - tomorrow's visits all have a Supervisor.

   **Close the day** records who closed it. **It warns; it does not refuse** (decision 5): a restaurant's late sign-off is not the office's to force.

**Workflow: the office's day.**
- **6:00 to 7:00:**
  - open Today;
  - clear "Needs you" from the top;
  - press "Send the day's sheet" for each Supervisor.
- **During the day:**
  - items disappear as the work happens: a sign-off arrives, a report is approved, a booking is placed;
  - new ones appear with a bell notification.
- **18:30:**
  - read Evening close;
  - chase what is red;
  - Close the day;
  - check tomorrow's list.

**Workflow: the Supervisor** (mostly in the phone app):
- in the morning, the sheet arrives;
- through the day, each visit: check in, tasks, photos, Finish;
- in the evening, anything the close lists as missing for their visits shows in their app.

### 4.2 Visits: List · Week · Waiting

**List.** Today's Visits page, unchanged: the diary by day, filters, the detail panel with approve or send back.

**Week** (the PDF's Dispatch):
- **The board:**
  - Monday to Saturday as columns; each visit is a card (time, outlet, service);
  - a coloured edge shows the area: a new **area** field on the outlet (Jubilee Hills, Gachibowli, …).
- **Capacity:**
  - each day shows "4 of 5" against a **capacity per day**, a new setting (the PDF's 26 a week for one crew);
  - a day over capacity turns amber;
  - free checks do not use a slot.
- **Moving a visit:**
  - **dragging a card** to another day or slot moves the visit itself;
  - the restaurant's app and the Supervisor's phone show the new date at once, and both are notified;
  - the same as "change date" in the detail panel today.
- **The capacity box:**
  - this week's use;
  - "weeks at 80% or more: 3 in a row", the founder's rule of thumb for hiring a second crew;
  - a one-click suggestion when a day is over ("move the oil test to Friday").
- **Print the week.**

**Waiting** (beside the board): today's "Requests waiting for you": app bookings not yet placed.
- **Place** puts the visit on the board, with the date, slot and Supervisor.
- **Hold** keeps a slot for a lead's first job (later, with Sales).
- The restaurant sees "date to be confirmed" until it is placed, as now.

**Workflows:**
- **A restaurant books in the app:**
  - it appears in Waiting, and on Today after 4 hours;
  - the office places it on the board, and the restaurant and the Supervisor are told.
- **Plan visits:** created by themselves, as now. On Friday, the office looks at next week's board, fixes any day over capacity, and gives each visit a Supervisor.
- **A restaurant asks to move a visit:** drag it, and both apps follow.

**What it needs:**
- the area field on the outlet;
- a capacity setting;
- a week endpoint;
- the board itself, with drag and drop.

Crews and vans as records come when there are two crews: one row per crew, Jobber's week view.

### 4.3 Inspections and 4.4 Issues: unchanged

Their waiting items (reports to approve, issues not picked up) appear on Today, so nobody needs to visit them to know.

### 4.5 Quality (new): Follow-ups · Photos · Incidents

The PDF's three queues and its month strip, adjusted to the founder's earlier decisions.

**Follow-ups** (the PDF's "re-inspection queue"):
- **Why the name changes:** on 7 Oct the founder decided there is **no re-inspection**. An inspection's score stands until the next full inspection. So this queue never re-scores anything; it makes sure an unhappy kitchen is called back.
- **An outlet enters the queue when:**
  - a visit is rated 3 stars or fewer;
  - an issue is reopened;
  - the hygiene score falls 15 points or more in a week;
  - an inspection ends with no grade or a failed critical check.
- **The buttons:**
  - **Log a call** ("Abdul called; a free redo offered");
  - **Book a free redo or check-in visit:** a normal visit in Visits, with no new score (decision 3);
  - **Close with a note.**
- **It leaves the queue** when a follow-up is booked and done, or it is closed.

**Photos** (one queue for every photo that needs a person):
- **Doubtful photos:** today they are counted on Monitoring and flagged on a visit, but nobody judges them.
  - They come from the photo-integrity flags: the same photo again, taken far from the kitchen, a faked location, a wrong time.
  - A new flag is added: **a checklist finished too fast**.
  - **Accept**, or **Reject, ask to retake**:
    - for a restaurant's checklist photo, the outlet's Manager is told;
    - for an ECCS visit photo, the Supervisor is told.
  - Rejections count on the Health board, and the hygiene score follows.
- **Customer-page photos to approve:** today's Customer pages queue moves here (decision 4). The per-outlet customer-page switch stays on Clients.

**Incidents** (new): anything that could become a claim, a complaint or a lesson.
- **Examples:** an injury, damage, a missing item.
- **Each entry:** the date, the outlet, the visit, what happened, what was done, its photos, the cost if any, open or closed.
- **One link has the whole story**, for the insurer or a lawyer.
- **Open incidents show on Today.**

**Month strip** (one line at the bottom, not a page):
- visits rated, and the average;
- reports approved first time;
- follow-ups closed;
- incidents.

This is the field-service world's "callback rate" idea, in ECCS's own measures.

**Workflows:**
- **A low rating comes in:** it enters Follow-ups and shows on Today. The office calls, logs it, books a free redo if offered, and the item closes when the redo is done.
- **A doubtful photo:** it shows in Photos and on Today; someone judges it, and the person concerned is told.
- **An incident:** the Supervisor phones the office, which adds it with photos, follows it up, and closes it with what was paid or done.

### 4.6 Clients: Health · All clients · New outlets

**Health:** today's Monitoring board, unchanged.
- Every outlet, worst first, on what ECCS acts on: issues, visits, inspections, the hygiene score, photos.
- The AI digest at the top.
- Moving it here puts "how are my clients" next to the clients themselves (decision 2).

**All clients:** today's Clients page: records, outlets, plans, codes, the customer-page switch.

**New outlets** (the PDF's Onboarding): each newly won outlet from "won" to "running on its own".
- **Nine steps that tick themselves** from what the apps already record:
  1. outlet added, with its code;
  2. Owner logged in and PIN set;
  3. Manager and Head Chef PINs;
  4. terms and privacy agreed;
  5. licences photographed (in the restaurant's app);
  6. first checklist done with photos;
  7. day-3 call (logged in one tap);
  8. QR posters delivered (the only manual tick);
  9. day-10 call and rating ask.
- **"Live"** means steps 1 to 6 are done.
- **Over 24 hours without being live,** the outlet shows "Act" here and on Today, with the two fixes that work: visit and set up in person, or call the Owner.
- **On day 10** the outlet leaves this tab and is an ordinary row on Health.
- **A strip shows:**
  - outlets onboarded this month;
  - live within 24 hours;
  - the median time to the first checklist;
  - still using the app at day 10.

  That is "time to first value", the usual onboarding measure.

**Workflow:**
1. A lead is won in Sales.
2. **Onboard a restaurant** (today's handover card) adds the outlet.
3. The Owner is given the code.
4. The steps tick as the restaurant uses the app.
5. The office makes the day-3 and day-10 calls from Today's "Also today".

**What it needs:** a per-outlet onboarding record. It reuses the Team page's self-ticking checklist pattern and reads the existing activity events.

### 4.7 Invoices and 4.8 Certificates: unchanged

Invoices also gets the WhatsApp "Remind" that today only Finance has. Finance's overdue list then links here instead of repeating it.

### 4.9 Sales: Overview · Leads · Quotes

**Quotes** (the PDF's Quotes page, as a tab):
- **Every quote in one list:** draft, sent, opened (how often, and when last), won, expired, declined.
- **Buttons by state:** Revise, Send, "Build now" for a free check with no quote.
- **Built from the free check:** a new quote starts from the free check's findings, with the services that fix them already ticked. The phone app does this; the console will too.
- **Prices come from Catalogue,** so nobody types a price the founder has not set.
- **A PDF** besides the WhatsApp link.
- **A BDE** sees their own quotes.

**Workflow:**
1. Free check (the BDE's app).
2. The quote, the same day.
3. Send on WhatsApp.
4. "Opened" shows when the Owner looks; "No reply, 5 days" prompts a follow-up in Do today.
5. Won, which opens the onboarding handover.

**What it needs:**
- an endpoint listing all quotes;
- won, expired and declined states;
- the PDF;
- pre-ticking from the scorecard in the console.

### 4.10 Team: the useful part of the PDF's People

- **Document dates on the documents already kept** (ID proof, medical fitness, police verification, agreement):
  - a document within 30 days of its date, or missing, shows on the person's page and on Today;
  - **medical fitness renews once a year,** the same rule restaurant food handlers follow.
- **Console access card on each person:** their role, what that role can open, the last login, and the existing "Mark as left", which also ends the login.
- **No per-login custom sections** (decision 8): roles stay fixed, which is simpler and safer for a small team.

### 4.11 to 4.12 AI usage, Catalogue, Plans, SOPs, Logs: unchanged

Catalogue gets a "what to carry" list on each kind of service, for the day's sheet.

### 4.13 Later: Supplies (Finance → Stock and van) and Partners

**Supplies** (when the founder wants stock tracked):
- **Recording use:** the Supervisor's app records **chemicals used** on each visit. The tables for this exist but nothing uses them yet.
- **Stock and reorder:**
  - stock falls by what is used and rises with purchases entered in Finance;
  - each item has a **reorder point**: two weeks of use at the current rate, plus a margin. That is the usual formula: daily use × days to restock + a margin.
- **Cost per visit** feeds the margin on Sales.
- **The van:** fuel comes from Finance's vehicle expenses; the odometer is typed at the evening close.
- **Low stock** shows on Today's "Also today".

**Partners** (when there is more than one):
- **A partner list:** what each one does for ECCS, and their licence or accreditation with its expiry date (it shows on Today 30 days before).
- **Visits linked to the partner,** instead of today's free-text name.
- **Fees owed:** created when ECCS approves the visit report, and paid through Finance's "Payouts due", which already groups payouts by vendor.
- **Referral payouts** from Sales' lead sources.

## 5. The whole journeys

| Journey | Steps, and where each happens |
|---|---|
| **A new restaurant** | Lead and free check (BDE's app) → quote (Sales → Quotes) → won → Onboard a restaurant (Clients) → nine steps (Clients → New outlets; "Act" on Today if stuck) → live → an ordinary row on Clients → Health |
| **A booking** | Restaurant books (its app) → Visits → Waiting (Today after 4 h) → placed on the Week board → the Supervisor's sheet (Today) → the visit (Supervisor's app) → Finish → restaurant signs off (its app; Today reminds after 2 days) → ECCS approves the report (Visits; Today after 2 days) → certificate (Certificates) → invoice and payment (Invoices) → Finance |
| **A plan visit** | Made by itself → Week board on Friday (capacity, Supervisor) → as a booking from the Supervisor's sheet on |
| **An unhappy kitchen** | Low rating, reopened issue, score drop or failed inspection → Quality → Follow-ups (and Today) → call logged, or a free redo booked in Visits → closed |
| **A doubtful photo** | Flag → Quality → Photos (and Today) → accept, or reject and ask to retake → the person told; the Health board and the score follow |
| **An incident** | Supervisor calls → Quality → Incidents → handled → closed with the cost; open ones on Today |
| **A person joins ECCS** | Team → add (starts onboarding) → their Joining page → documents (expiry dates) → console access card |
| **The day** | 6:00 Today and the day's sheets → visits run → items clear themselves → 18:30 Evening close → Close the day |
| **The week** | Friday: next week's board (capacity, Supervisors) · Monday: Sales targets · Daily: Quotes "No reply" follow-ups |
| **The month** | Invoices raised, salaries and payouts (Finance), the Quality strip, AI usage |

## 6. What we can build, in order

| # | What | Uses what exists | New | Size |
|---|---|---|---|---|
| **1** | **Today** as the home (visits, Needs you, Also today, Evening close) | Visits, bookings, sign-offs, approvals, invoices, issues, photo flags, Sales follow-ups | One summary endpoint and the close record | about 2 days |
| **2** | **Visits → Week board and Waiting** | Visit dates and slots, reschedule, booking requests, plan visits | Area on the outlet, capacity setting, week endpoint, drag and drop | about 2 days |
| **3** | **Sales → Quotes tab** | Quotes, open tracking, scorecard, Catalogue prices | List endpoint, states, PDF, pre-ticking | about 1 day |
| **4** | **Clients → Health and New outlets** | Monitoring board (moves); activity events; licences; checklists; legal acceptances | Onboarding record per outlet, call logging, posters tick | about 2 days |
| **5** | **Team: document dates and access card** | Joining documents, roles | Expiry date on a document | half a day |
| **6** | **Quality** (Follow-ups, Photos, Incidents) | Ratings, score history, reopen events, photo flags, the Customer pages queue (moves) | Accept or reject on a photo, "too fast" flag, incident record, follow-up record | 2 to 3 days |
| **7** | **The day's sheet in the Supervisor's app** | Visits, notifications | "What to carry" in Catalogue; the sheet on the Jobs screen (needs a new APK) | 1 to 2 days |
| **8** | **Partners** (later) | Partner-delivered services, Payouts due | Partner record, link from a visit, fees | 1 to 2 days |
| **9** | **Supplies** (later) | Chemical tables (unused), expense categories | Chemicals used in the Supervisor's app, stock, reorder, van log (needs a new APK) | 2 to 3 days |

**Build 1 to 5 first:** together they give the PDF's daily picture with nearly no new data, about a week. Then 6 and 7. Then 8 and 9 when the business needs them (a second partner, stock worth tracking, a second crew).

## 7. Left out, and why

- **People page:** the founder. Its useful bits are in Team (4.10).
- **Licences page:** removed on 20 Oct. The PDF's menu still shows it; it stays out.
- **Separate Dispatch, Quotes and Onboarding pages:** tabs of Visits, Sales and Clients instead.
- **"Re-inspection":** the founder decided on 7 Oct there is none. It becomes Follow-ups.
- **Staff "not clocked in by 6:30":** ECCS has no crew clock-in, and the crew have no logins; presence is only worked out from activity. That waits for decision 7.
- **Crew and van as records, and route optimisation:** with one crew and one van, the Supervisor and the time order are enough. Revisit at the second crew.
- **Per-login custom sections, a developer login and an outside CA login:** fixed roles for now (decision 8).
- **A hard "Close the day" block:** it warns instead (decision 5).

## 8. Decisions for the founder

1. **The map in section 3:** Today as the home; 16 menu entries; tabs instead of separate pages.
2. **Monitoring becomes Clients → Health,** or stays its own entry?
3. **Follow-ups:** may the office book a **free redo or check-in visit** for an unhappy kitchen? It changes no score; the "no re-inspection" rule stays.
4. **Customer-page photo approvals move into Quality → Photos,** so all photo judging is in one queue?
5. **Close the day:** warn (recommended) or refuse while something is red?
6. **Supplies and Partners:** later, as planned (stock was left out of the first version), or sooner?
7. **Crew clock-in:** should ECCS's service workers clock in? It needs them in the system without console logins (for example on the Supervisor's phone).
8. **Logins:** keep fixed roles, or add a read-only login for the CA (Finance export only)?

## Sources

- [Jobber: week view of the schedule (rows per person or route, unscheduled panel, drag to book)](https://help.getjobber.com/es/articles/week-view-of-the-schedule-new-schedule/)
- [Jobber: day view of the schedule](https://help.getjobber.com/es/articles/day-view-of-the-schedule-new-schedule/)
- [ServiceTitan: plan your team's capacity (capacity, unassigned jobs, job tray)](https://help.servicetitan.com/docs/plan-your-team-s-capacity)
- [ServiceTitan: replenish items (reorder points per location)](https://help.servicetitan.com/docs/replenish-items-with-purchase-orders)
- [eTurns: the reorder point formula](https://www.eturns.com/resources/blog/reorder-point-formula-the-simple-calculation-for-stockrooms-and-service-trucks/)
- [UXmatters: review of Stephen Few's *Information Dashboard Design* (single screen, at a glance, overview first)](https://uxmatters.com/mt/archives/2007/04/book-review-information-dashboard-design.php)
- [Stephen Few: why most dashboards fail](https://blogs.ischool.berkeley.edu/i247s13/files/2013/02/WhyMostDashboardsFail.pdf)
- [ShareWillow: field service KPIs (first-time fix and callback rates)](https://www.sharewillow.com/blog/field-service-kpis)
- [Basedash: vanity metrics vs actionable metrics](https://www.basedash.com/blog/vanity-metrics-vs-actionable-metrics-how-to-tell-the-difference)
- [Valuecase: onboarding B2B customers (time to first value, milestones)](https://www.valuecase.com/articles/how-to-onboard-b2b-saas-customers)
- [Archdesk: subcontractor management (document expiry, payments per job)](https://archdesk.com/en-gb/solutions/subcontractor-management)
