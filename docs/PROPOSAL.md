# ECCS Platform: Proposal and Plan

**Status:** Draft v1 for review, 5 Oct 2026. Nothing has been installed or scaffolded.
**Project root (proposed):** `C:\Users\eosfera\eccs`

---

## 0. Summary

- **One language, TypeScript, across everything.** One Android and iOS app (Expo / React Native) for restaurant staff and ECCS supervisors, one web app (Next.js) for ECCS admins and restaurant owners, one API (NestJS) on PostgreSQL.
- **Offline by design** for the two flows that happen inside kitchens: daily checklists and technician jobs. Work is saved on the phone first and uploaded when signal returns.
- **The pilot includes the full whiteboard scope** (section 8): checklists, service booking, subscriptions and GST billing, attendance and salary tracking, printed food labels, the customer QR page and scored FSSAI-style inspections.
- **Rough timeline:** about 16 to 18 weeks to a pilot-ready build, assuming one full-time developer pairing with Claude Code. This is an estimate and depends on the open questions tracked in `docs/STATUS.md`.
- **Live status, decisions and open questions** are kept in `docs/STATUS.md`. This file is the specification; that file is the tracker.

---

## 1. Clarifying questions (prioritised)

Each has the assumption I have planned around. Correct any that are wrong; questions 1–5 change the architecture most.

| # | Question | Assumption used in this plan |
|---|---|---|
| 1 | **Devices in the kitchen.** Do kitchen staff use their own phones, or one shared phone/tablet per outlet? Android only? | Android only. Mix of personal phones and a shared outlet device, so the app supports fast user switching with a 4-digit PIN. |
| 2 | **Who builds this and by when?** Just you with Claude Code, or a dev team? Is there a pilot date? | One developer plus Claude Code; pilot in roughly 10 weeks. |
| 3 | **Invoicing: build or integrate?** Do you already use Zoho Books, Tally or similar? | **Decided: built in-app for the pilot** (GST invoices, dues, Razorpay). Still useful to know your accounting tool so invoices can be exported to it. |
| 4 | **Commercial model.** Fixed monthly AMC per outlet, per-visit pricing, tiered bundles, or a mix? | AMC plan per outlet with a list of included services and frequencies, plus chargeable ad-hoc visits. |
| 5 | **Is the restaurant app only for ECCS service clients,** or will you also sell it as standalone software to restaurants that do not buy services? | Service clients only. The data model is multi-tenant, so standalone SaaS stays possible later. |
| 6 | **Technicians.** Employees or subcontractors? How many at pilot? Is GPS-verified check-in required? | 3–10 employed technicians, GPS and timestamp captured at check-in, no continuous tracking. |
| 7 | **Existing SOPs and checklists.** Do you have them on paper or Excel already, and do they follow FSSAI Schedule 4? | You have draft SOPs. We digitise them into the template library; I will need copies. |
| 8 | **Certificates.** Which documents must the system produce, and do any need a prescribed format or a licensed signatory (pest control treatment certificate, for example)? | Service report per visit in the MVP; pest control and deep-clean certificates in Phase 2. |
| 9 | **Languages.** English, Telugu and Hindi from day one? Would audio prompts help low-literacy staff? | All three languages in the MVP for the mobile app. Web console in English only. No audio initially. |
| 10 | **Accounts and budget.** Do you have a domain, Google Play developer account, AWS account, and a registered company entity (needed for SMS sender registration)? Monthly cloud budget for the pilot? | None exist yet. Budget up to roughly ₹15,000/month for the pilot. |

---

## 2. Tech stack (single recommendation)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language, shared types and validation between phone, web and server. |
| Mobile | **Expo (React Native)** for **Android and iOS**, **one app** with role-based home screens | One codebase for both platforms, one listing per store. Head Chefs, Managers, Owners and ECCS Supervisors see different screens after login. iOS builds are made in the cloud with EAS Build because this is a Windows machine; that needs an Apple Developer account (US$99/year) and a real iPhone for testing, since the iOS simulator only runs on a Mac. |
| Web | **Next.js** (App Router) with Tailwind and shadcn/ui | ECCS admin console and restaurant owner dashboard in one deployable, separated by route group and role. |
| API | **NestJS** (REST), request and response shapes defined once in **Zod** and shared with clients | Modular structure suits a system with many domains (scheduling, jobs, compliance, billing). Guards give a single place to enforce roles. |
| Database | **PostgreSQL 16** with **Prisma** | Relational data with strong integrity needs (contracts, invoices, audit records). JSONB for checklist definitions and translations. |
| Background jobs | **BullMQ on Redis** | Generating recurring visits, sending reminders, building PDFs, recalculating hygiene scores. |
| Auth | **Our own small auth module in the API**, stored in our Postgres. See "How login works" below | Keeping auth in our own database avoids per-user fees and keeps data in India. The first draft named the Better Auth library; the need turned out to be small and specific to us, so it was written directly. |

**Mobile first for restaurants (decided by the founder, 5 Oct 2026).** Every restaurant-side feature, including everything the Owner and Manager do, must work in the mobile app. A web version for restaurants would be an extra, never the only place a feature lives. The web app is primarily the ECCS console.

**How login works (decided by the founder, 5 Oct 2026)**

*Restaurant side: PIN only, no biometrics.*

1. **Onboarding, once.** ECCS creates the restaurant and its Owner with a mobile number and email. The Owner opens the app, enters the number and a one-time code. That links the Owner's phone to the restaurant and shows the Owner a 4-digit PIN.
2. **After that, nobody at the restaurant needs a one-time code.** Everyone logs in with a 4-digit PIN, and whose PIN it is decides what they see: Owner, Manager or Head Chef.
3. **Adding people.** The Owner adds a Manager or Head Chef in the app and is shown a generated PIN once, to hand over. A Manager can add Head Chefs at their own outlet.
4. **Linking a phone.** A PIN alone cannot say which restaurant it belongs to, so each outlet has a restaurant code such as `SPICE-JH2K7M`. A new phone types it once; from then on that phone asks only for a PIN.
5. **Forgotten PIN.** Staff ask the Owner or Manager for a new one (the old one stops working and they are logged out). The Owner gets a new one with a one-time code.

*Company side:* ECCS staff log in with mobile number and one-time code.

*Safeguards.* PINs are unique within a restaurant and stored as a keyed hash, so the database alone does not reveal them. A PIN only works from a linked phone, and five wrong PINs lock that phone for 15 minutes. Restaurant codes have six random characters and are not guessable. Session and device tokens are stored only as hashes. **Known limit:** a 4-digit PIN is weak by itself; the protection is that an attacker also needs the restaurant code or a linked phone. Anyone who has both a linked phone and patience could eventually guess a PIN, so restaurant codes should be treated as private and changed if leaked (changing a code and unlinking phones from the app is not built yet).
| Files and photos | **Amazon S3, Mumbai region**, direct upload from the phone via pre-signed URLs; photos compressed on-device to about 300 KB | Photos never pass through the API server, so uploads survive weak connections better and the server stays small. |
| Offline | **SQLite on the device** (expo-sqlite) with an **outbox queue** | Checklists and jobs are downloaded ahead of time. Submissions get an ID generated on the phone and queue until online; the server accepts each ID once, so retries are safe. This is simpler than a full two-way sync engine and is enough because the phone mostly creates new records rather than editing shared ones. |
| Notifications | **Push** via Firebase Cloud Messaging (through Expo). **SMS OTP and WhatsApp** via MSG91. **Email** via Amazon SES | Owners in India read WhatsApp, not email, so licence-expiry and overdue alerts go there from Phase 2. |
| PDFs | HTML templates rendered to PDF with headless Chromium in the worker | Service reports and certificates share branding with the web UI. |
| Payments (Phase 2) | **Razorpay** payment links and UPI | Standard for Indian B2B collections. |
| Translations | **i18next**, with `en`, `te`, `hi` (the app's own screens are also in Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia and Urdu) | SOP and checklist text is stored per language in the database so ECCS can edit it without a release. |
| Hosting | **AWS Mumbai (ap-south-1)**: API and worker on ECS Fargate, RDS PostgreSQL, ElastiCache Redis, S3. Web on the same cluster behind CloudFront | Data stays in India, one vendor, room to grow. Infrastructure defined in Terraform. |
| CI/CD and monitoring | GitHub Actions, EAS Build for Android, Sentry for errors | |

**Things with lead time that should start early**

- **SMS sender registration (DLT).** Indian telecom rules require a registered business entity and approved message templates before any OTP SMS can be sent. Approval commonly takes one to two weeks.
- **WhatsApp Business API** approval and template review.
- **Google Play developer account** verification.

**Multi-tenancy.** One database. Every client-owned row carries `organization_id` and, where relevant, `outlet_id`. Access is enforced in the API, with PostgreSQL row-level security as a second barrier. ECCS staff are the only users who see across organisations.

**Data protection.** The system stores staff phone numbers, signatures and location at check-in. Plan for India's DPDP Act: consent notice at first login, a stated retention period for photos, and an audit log of who accessed what.

---

## 3. Roles and permissions

### ECCS (company side)

| Role | Purpose |
|---|---|
| **Super Admin** | Founders. Everything, including user management and settings. |
| **Operations Manager** | Clients, outlets, contracts, scheduling, SOP library, monitoring. |
| **Supervisor** | Uses the mobile app on site to run each visit: check-in, service checklist, chemicals, photos, customer sign-off, inspections. Handles issues for assigned clients. |

Technicians do not get the app; the Supervisor records the visit on their behalf. Finance, Sales and Technician roles are deferred and can be added later without redesign, because roles are stored as memberships.

### Restaurant (client side)

| Role | Purpose |
|---|---|
| **Owner** | All outlets of the brand. Everything the Manager has, plus certificates, invoices, subscription and billing, and user management. |
| **Manager** | One or more assigned outlets. Everything the Head Chef has, plus service reminders, dues, booking, attendance and salary, history calendar, licences, visit sign-off. |
| **Head Chef** | Mobile only. Daily checklists with photos, food labels, raising issues, marking attendance. |
| **Auditor / Viewer** (Phase 3) | Time-limited read-only access to the document vault, for an inspector or franchise auditor. |

### Permission matrix

C = create, R = read, U = update, A = approve or sign off. "own" means limited to assigned outlets or jobs.

#### Company side (ECCS)

ECCS roles see across all client organisations; a Supervisor is limited to the jobs and clients assigned to them.

| Capability | Super Admin | Ops Mgr | Supervisor |
|---|---|---|---|
| Clients and outlets | CRU | CRU | R assigned |
| ECCS users | CRU | R | – |
| Restaurant users | CRU | CRU | R |
| SOP and checklist templates | CRU | CRU | R |
| Daily checklists (from restaurants) | R | R | R assigned |
| Issues and support tickets | CRU | CRU | CRU assigned |
| Service catalogue, plans, bookings | CRU | CRU | R |
| Service schedule | CRU | CRU | R own, U own |
| Jobs (visits): run on site | CRU | CRU | R, U own |
| Inspections (scored) | CRU | CRU | CRU own |
| Service reports and certificates | R, A | R, A | C own, R |
| Customer QR photos | A | A | C (propose) |
| Licences and document vault | CRU | CRU | R assigned |
| Hygiene score and dashboards | R all | R all | R assigned |
| Invoices, payments, dues | CRU | CRU | – |
| Audit log, settings | R, U | R | – |

#### Restaurant side (client)

Restaurant roles never see another organisation's data. Owner covers all outlets of the brand; Manager and Head Chef cover only their assigned outlets. Everyone logs in with their own PIN, so on a shared phone one person locks the app and the next enters theirs. No biometrics on the restaurant side.

| Capability | Owner | Manager | Head Chef |
|---|---|---|---|
| Own organisation and outlet details | R | R own | – |
| App users (logins) | CRU own brand | CRU own outlet | – |
| SOP library | R standard, CRU own brand's | R standard, CRU own outlet's | R |
| Checklist templates | R | R | R assigned |
| Daily checklists | R | R, A | C own |
| Food items and labels | CRU | CRU | C labels, R items |
| Issues and ECCS support | CR | CRU own | C |
| Service catalogue and booking | CRU | CRU own | – |
| Service schedule and reminders | R | R | – |
| Jobs (visits) | R, sign-off | R, sign-off | – |
| Service reports, certificates, inspection reports | R | R | – |
| History calendar (1 year) | R | R own | – (sees the last 7 days in Daily checklists) |
| Licences and document vault | CRU | CRU own | – |
| Hygiene score and dashboards | R all own outlets | R own | R own outlet (simple view) |
| Staff list and attendance | CRU | CRU own | C mark attendance |
| Salary tracker | CRU | CRU own | – |
| Dues | R, pay | R, pay | – |
| Subscription plan, invoices, billing | CRU, pay | R | – |
| Customer QR page | R, U settings | R | – |

Roles are stored as a membership: a user, a role, and a scope (all of ECCS, one organisation, or one outlet). One person can hold several, for example a manager of two outlets.

---

## 4. Core data model

### Tenancy and people
- **Organization**: a restaurant brand (the client). Has GSTIN, billing address.
- **Outlet**: belongs to an Organization. Address, geo-location, kitchen type, FSSAI number.
- **User**: phone, name, preferred language, PIN hash.
- **Membership**: User + role + scope (ECCS / Organization / Outlet).

### SOPs and checklists
- **SopTemplate**: ECCS-authored, versioned, translated. Belongs to the library.
- **ChecklistTemplate**: belongs to a SopTemplate version. Has ordered **ChecklistItems** (type: yes/no, number such as fridge temperature, photo required, note).
- **OutletChecklist**: a ChecklistTemplate assigned to an Outlet with a schedule (daily, per shift, weekly).
- **ChecklistRun**: one instance for an outlet, date and shift. Status: pending, in progress, submitted, missed. Submitted by a User.
- **ChecklistResponse**: one per item in a run. Value, note, captured-at time from the device, linked **Attachments**.

### Services and field work
- **ServiceType**: deep clean, pest control, chimney/hood, fire and equipment inspection.
- **ServiceSchedule**: recurrence rule per Outlet and ServiceType, generated from the PlanLines of the outlet's Subscription (see Booking and billing). The earlier "Contract" entity was folded into Plan and Subscription.
- **Job**: one visit. Outlet, ServiceType, planned window, status (scheduled, assigned, en route, checked in, completed, approved, cancelled), assigned Technicians.
- **JobCheckIn**: time, GPS position, distance from outlet.
- **JobTaskResponse**: the technician's service checklist answers.
- **Chemical** (catalogue, with safety data) and **JobChemicalUsage** (chemical, quantity, dilution, area applied).
- **Attachment**: photo or file, tagged before / after / proof / document, stored in S3.
- **SignOff**: name, role, signature image, time.
- **ServiceReport**: generated PDF per Job. **Certificate** (Phase 2): numbered, with validity dates.
- **InspectionFinding**: from safety inspections. Severity, recommendation, due date; can open an Issue.

### Compliance
- **Licence**: Outlet, type (FSSAI, fire NOC, trade licence, pest control contract, others), number, issue and expiry dates, linked document, reminder schedule.
- **Document**: the vault. Categorised files per Outlet, including auto-filed service reports.
- **Issue**: raised by a restaurant through ECCS support for ECCS to act on. Problems noted on a daily checklist are not issues and are never sent to ECCS (founder, 6 Oct 2026). Category (pest sighting, chimney, equipment, hygiene, other), severity, photos, status, assignee, optional linked Job. Has **IssueComments**.
- **HygieneScoreSnapshot**: daily score per Outlet with its component breakdown.

### Booking and billing
- **ServiceCatalogItem**: ServiceType, price, duration, SAC code, GST rate.
- **Plan**: a subscription bundle with a price per billing cycle. Has **PlanLines** (ServiceType + interval in days, for example pest control every 15 days).
- **Subscription**: Outlet + Plan, status, start date, next billing date. Creates ServiceSchedules from the PlanLines.
- **Booking**: a one-time service request from a restaurant for a catalogue item and preferred slot. On confirmation it creates a Job.
- **Invoice** and **InvoiceLines**: SAC code, taxable value, CGST/SGST or IGST, sequential invoice number per financial year. Raised per booking or per subscription cycle.
- **Payment**: amount, method, Razorpay reference. Dues for an outlet are unpaid invoice balances.
- **As built on 8 Oct 2026** (first version): a subscription is billed in advance, one invoice per cycle, with the price copied from the plan when the cycle starts; a booked one-time visit is invoiced when ECCS approves its report; payments in the app are samples behind a gateway interface that Razorpay can fill later, and ECCS can record payments by hand. The rules are in STATUS section 3 (8 Oct).

### Restaurant staff management
- **StaffMember**: a restaurant employee (name, role, phone, monthly salary, joining date). Separate from User, because most staff never log in.
- **AttendanceRecord**: StaffMember, date, status (present, absent, half day, leave), marked by.
- **SalaryRecord**: StaffMember, month, base pay, days worked, overtime (hours and amount), bonuses, advances, deductions, amount paid, paid on. A record-keeping tracker only: no statutory calculations and no payouts.

### Food labels
- **FoodItem**: per outlet. Name (translated), shelf life, storage type.
- **FoodLabel**: FoodItem, prepared at, expires at (worked out from shelf life), prepared by, printed at.

### Inspections and public page
- **Inspection**: a scored ECCS audit of an outlet using an FSSAI Schedule 4 style template. Section scores, overall score, non-conformities with photos and corrective actions, PDF report. Scoring as built (7 Oct 2026), after FSSAI's hygiene rating: 2 marks a check and 4 for a critical one; a not-applicable check is left out; score = marks earned ÷ marks possible × 100; grade A+ from 88, A from 80, B from 68, otherwise none; failing any critical check means no grade.
- **PublicProfile**: per outlet. Random URL token for the QR, an on/off switch the restaurant controls, and the **PublicPhotos** approved for display.

### Cross-cutting
- **Notification**: recipient, channel, template, status.
- **AuditLog**: who did what to which record, when.

### Key relationships
```
Organization 1─* Outlet 1─* OutletChecklist *─1 ChecklistTemplate *─1 SopTemplate
Outlet 1─* ChecklistRun 1─* ChecklistResponse 1─* Attachment
Organization 1─* Contract 1─* ContractLine *─1 ServiceType
Outlet 1─* ServiceSchedule 1─* Job *─* User (technicians)
Job 1─1 JobCheckIn, 1─* JobTaskResponse, 1─* JobChemicalUsage, 1─1 SignOff, 1─1 ServiceReport
Outlet 1─* Licence, 1─* Document, 1─* Issue, 1─* HygieneScoreSnapshot
Contract 1─* Invoice 1─* Payment
User 1─* Membership (role + scope)
```

### Daily checklist rules

Decided by the founder on 5 Oct 2026; source document `docs/FSSAI 2026 KITCHEN SAFETY CHECKLIST.docx`.

- ECCS gives every restaurant a short basic list (Opening and Closing, five items each in the sample data).
- The Owner or Manager adds items specific to their kitchen, and can remove what they added. ECCS's basic items cannot be removed by the restaurant.
- Items need a photo as proof by default, and a checklist cannot be submitted until each photo item has one. On a phone the photo comes from the camera, not the gallery.
- When adding an item, the Owner or Manager can mark it "tick only" for checks where a photo is not possible; staff then tick it with one tap. ECCS's basic items always need a photo.
- Each item is answered OK or Problem. A problem must come with a reason.
- There is one checklist per outlet per day, shared by everyone at the outlet. Several Head Chefs can fill it in together; once anyone submits it, it is locked for all.
- The Owner or Manager can create extra checklists (for example a mid-day one) with a name and due time, and can change any checklist's due time. ECCS's basic checklists cannot be renamed or removed.
- Adding an item is a search: as the Owner or Manager types, matching ready-made checks from the library appear (the founder's master sheet of 588 checks plus ECCS additions for Indian kitchens). One tap adds a check; if nothing fits, they add exactly what they typed.
- On the daily checklists page a red clock marks a checklist that is past its due time and not submitted, and a red exclamation mark marks one in which a problem was reported.
- The document's ten detailed sections (92 checks) are the basis for the ECCS scored inspection, not the daily list.

### Hygiene score, version 1
A 0–100 score per outlet with the breakdown always visible, so nobody has to trust a black box. The rule was set by the founder on 7 Oct 2026 and replaces the five-part draft this section first held:

| Component | Points |
|---|---|
| The latest approved ECCS inspection (from the last 180 days), its score as a share of 60 | 60 |
| Licences valid, each with a copy on file | 10 |
| The day's checklists: handed in on time earns the full share, late half, not handed in nothing | 30 |

- The inspection and licence points change rarely; the checklist points move through every day.
- A checklist counts once it is handed in or past its due time. Until the first of the day does, yesterday's checklists are counted.
- An outlet ECCS has not inspected yet is scored on licences and checklists alone, scaled to 100 and marked "Provisional".
- A failed critical check lowers the inspection's own score but puts no further cap on the hygiene score.
- Bands: Excellent from 88, Good from 80, Fair from 68, otherwise Needs attention.
- Recalculated every 6 hours and whenever it is asked for; one snapshot a day is kept for the trend.

Weights are configuration, so they can be tuned during the pilot.

---

## 5. MVP scope for a 3–5 restaurant pilot

**Goal of the pilot:** prove that restaurants complete daily checklists, that technicians can run a full visit on the phone, and that ECCS can see who is falling behind.

### In the MVP

**Restaurant side (mobile, plus web for owners and managers)**
- Phone OTP login, PIN switching on shared devices, English / Telugu / Hindi
- Daily and per-shift checklists with photo proof and timestamps, working offline
- Raise an issue with photo and category; track its status
- Dashboard: hygiene score, today's checklist status, upcoming visits, open issues
- My profile: photo, name, role, restaurant and branches, and preferences (language)
- Licence tracker with expiry reminders by push at 60, 30, 15 and 7 days. One licence of each kind per outlet: a new one replaces the old one and its document. The number and expiry date are read off the uploaded document (free OCR first, an AI reader later) for the person to check
- Document vault: upload and view; service reports filed automatically
- Visit history with service reports, and a one-year history calendar in the style of a phone calendar: each day shows its checklists, ECCS services, licences falling due and public holidays, and upcoming services and due dates are listed
- Service booking from a priced catalogue: one-time or subscription
- Dues, GST invoices and online payment through Razorpay
- Service certificates stored in the vault
- SOP library, separate from checklists: ECCS's standard SOPs to read, plus SOPs the Owner or Manager writes for their own outlet or copies from a searchable library of ready-made SOPs
- Attendance tracker (calendar based) and salary tracker for the restaurant's own staff
- Food labels: pick an item, the app sets prepared and expiry times, prints to a Bluetooth label printer
- Customer QR: a public web page per outlet showing the cleanliness score, timestamps of recent services and a few approved photos (grill, hood and similar)
- ECCS support screen: call, WhatsApp, ticket
- PIN or biometric unlock for Manager and Owner areas

**ECCS side**
- Web console: organisations, outlets, users
- SOP and checklist template library; assign templates to outlets
- Recurring service schedules, automatic job generation, supervisor assignment, calendar view
- Supervisor mobile flow, working offline: job list, check-in with GPS, service checklist, chemicals used, before and after photos, customer signature
- Auto-generated PDF service report, supervisor approval
- Monitoring board: missed checklists, low scores, overdue services, open issues
- Service catalogue, subscription plans, booking confirmation
- GST invoicing, payment tracking, dues follow-up
- Certificates generated per service (pest control, deep clean, chimney)
- Scored inspection flow for supervisors with PDF report
- Approval of photos shown on each outlet's customer QR page
- Audit log

### Deliberately left out of the MVP
- WhatsApp notifications (push and SMS only)
- A technician login (supervisors record visits)
- Real company details, prices, SOPs and certificates: the build uses sample data until the real ones are supplied
- Payroll calculations, statutory deductions (PF, ESI) and salary payouts
- Route optimisation, chemical stock, analytics, auditor access

### Roadmap

| Phase | Rough duration | Content |
|---|---|---|
| **0. Foundation** | Weeks 1–2 | Monorepo, database schema, auth and roles, CI, staging environment. Start DLT and Play Store registrations. |
| **1a. Restaurant loop** | Weeks 3–6 | Templates, SOP library, checklists with offline and photos, issues and support, licences, vault, restaurant dashboard, history calendar. |
| **1b. Service loop** | Weeks 7–10 | Catalogue, booking, scheduling, technician flow, service report and certificate PDFs, scored inspections, monitoring board. |
| **1c. Billing** | Weeks 11–13 | Plans, subscriptions, GST invoices, Razorpay, dues. |
| **1d. Staff, labels, QR** | Weeks 14–16 | Attendance, salary tracker, food labels with printing, customer QR page. |
| **1e. Hardening** | Weeks 17–18 | Hygiene score tuning, translations, testing on low-end Android phones in a real kitchen. |
| **Pilot** | 4–6 weeks | 3–5 restaurants, weekly feedback, fixes only. |
| **2. Commercial polish** | About 4–6 weeks | WhatsApp alerts, accounting export, Finance role refinements, contract variations found in the pilot. |
| **3. Scale** | Ongoing | iOS, technician route planning, chemical inventory, analytics and benchmarking across outlets, auditor access, multi-city support. |
| **4. Differentiators** | Later | Photo checks by AI (is this hood actually clean?), temperature sensor integration, public hygiene badge with QR code for the restaurant's storefront. |

Durations are estimates for one developer with Claude Code and will move with the answers to section 1.

---

## 6. Windows development environment

**Current state of this machine (checked 5 Oct 2026):** Windows 11 Home, 64-bit, 16 GB RAM, 407 GB free. `wsl.exe` is present. Git, Node, Python, Docker, Java, `winget` and the `code` command were not found on the PATH. A `.vscode` folder exists in the user profile, so VS Code may already be installed without its command on the PATH.

**Approach:** code and Android tooling run natively on Windows. Docker (on WSL2) is used only to run PostgreSQL, Redis and a local S3 substitute, so nothing needs installing as a Windows service.

Run these in **PowerShell**. Steps marked (Admin) need "Run as administrator". Nothing here has been run.

### Step 1. Get winget working
`winget` ships with Windows 11 but was not found. Open Microsoft Store, search for **App Installer**, and install or update it. Then open a new PowerShell window and confirm:
```powershell
winget --version
```

### Step 2. Core tools
```powershell
winget install --id Git.Git -e
winget install --id GitHub.cli -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Microsoft.VisualStudioCode -e
```
Close and reopen PowerShell, then:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
npm install -g pnpm
node -v
pnpm -v
git --version
```

### Step 3. Git configuration
```powershell
git config --global user.name "Your Name"
git config --global user.email "eccs2710@outlook.com"
git config --global init.defaultBranch main
git config --global core.autocrlf input
git config --global core.longpaths true
gh auth login
```

### Step 4. Allow long file paths (Admin)
React Native builds create deep folder paths that exceed the Windows default limit.
```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

### Step 5. WSL2 and Docker Desktop (Admin)
```powershell
wsl --install
```
Restart the computer when asked, then:
```powershell
winget install --id Docker.DockerDesktop -e
```
Start Docker Desktop, accept the WSL2 backend (the only option on Windows 11 Home), then confirm:
```powershell
docker run --rm hello-world
```
Virtualisation must be enabled in the BIOS; if `wsl --install` reports it is off, that setting needs changing first.

### Step 6. Android tooling
```powershell
winget install --id Microsoft.OpenJDK.17 -e
winget install --id Google.AndroidStudio -e
```
Open Android Studio once and complete the setup wizard (installs the Android SDK, platform tools and an emulator image). Then set the environment variables:
```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
$p = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$p;$env:LOCALAPPDATA\Android\Sdk\platform-tools", "User")
```
Reopen PowerShell and confirm with `adb --version`. For day-to-day work a real low-end Android phone over USB is a better test device than the emulator, since that is what kitchen staff will use.

### Step 7. VS Code extensions
```powershell
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension Prisma.prisma
code --install-extension bradlc.vscode-tailwindcss
code --install-extension expo.vscode-expo-tools
code --install-extension ms-azuretools.vscode-docker
code --install-extension usernamehw.errorlens
```

### Step 8. Local services (after the repo exists)
A `docker-compose.yml` in the repo starts PostgreSQL 16, Redis and SeaweedFS (stands in for S3 locally; MinIO's image is no longer published on Docker Hub):
```powershell
docker compose -f infra/docker-compose.yml up -d
```

### Accounts to create (no install)
GitHub organisation, AWS account, Expo account, Google Play Console, MSG91, Sentry, and a domain name.

---

## 7. Monorepo structure

pnpm workspaces with Turborepo.

```
eccs/
├─ apps/
│  ├─ api/                 NestJS REST API
│  │  └─ src/modules/      auth, orgs, outlets, users, sops, checklists, issues,
│  │                       scheduling, jobs, reports, licences, documents,
│  │                       scores, notifications, billing (Phase 2), audit
│  ├─ worker/              BullMQ processors: job generation, reminders, PDFs, scores
│  ├─ web/                 Next.js
│  │  └─ app/
│  │     ├─ (auth)/
│  │     ├─ (eccs)/        admin console
│  │     └─ (restaurant)/  owner and manager dashboard
│  └─ mobile/              Expo app
│     └─ src/
│        ├─ features/      checklists, issues, jobs, dashboard, licences
│        ├─ offline/       SQLite schema, outbox, photo upload queue
│        └─ navigation/    role-based routing
├─ packages/
│  ├─ db/                  Prisma schema, migrations, seed data
│  ├─ shared/              Zod schemas, types, role and permission definitions, constants
│  ├─ api-client/          typed client used by web and mobile
│  ├─ i18n/                en, te, hi translation files
│  ├─ pdf-templates/       service report and certificate layouts
│  └─ config/              shared ESLint, TypeScript and Prettier settings
├─ infra/
│  ├─ docker-compose.yml   local Postgres, Redis, SeaweedFS (S3)
│  └─ terraform/           AWS environments
├─ docs/
│  ├─ PROPOSAL.md          this file
│  ├─ adr/                 architecture decision records
│  └─ sops/                source SOP documents from ECCS
├─ .github/workflows/      CI
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
└─ CLAUDE.md               project conventions for Claude Code
```

---

## 8. Whiteboard requirements (added from `image.png`)

The whiteboard lists twelve restaurant-app features. This section maps each to the original plan and records what changed. Sections 3 to 5 have since been updated to match, and all twelve items are confirmed for the pilot.

### Mapping

| # | Whiteboard item | Status against the plan | Change |
|---|---|---|---|
| 1a | Daily checklist (photos, list), for **Head Chef** | Covered | Role renamed, see below. |
| 1b | Service reminders and dues, for **Manager** | Reminders covered; **dues are new to the MVP** | Needs invoices to exist in the MVP. |
| 1c | Service certificate storage and invoices, for **Owner** | Vault covered; **certificates and invoices were Phase 2** | Both move into the MVP. |
| – | PIN / biometric (written under Manager) | PIN covered | Add fingerprint / face unlock. Manager and Owner areas are locked behind it on a shared device. |
| 2a | Attendance tracker, calendar based | **New** | New module. |
| 2b | Salary tracker | **New** | New module. |
| 3 | Service booking, one-time or subscription | **Changed** | The plan had ECCS scheduling everything and restaurants only raising requests. Restaurants now book from a priced service catalogue themselves. |
| 4 | OTP-based login | Covered | – |
| 5 | Checklist reminders / notifications | Covered | – |
| 6 | ECCS support | Partly covered by issues | Add a dedicated Support screen: call, WhatsApp, and ticket. |
| 7 | History log of 1 year, calendar based | Partly covered | Add a calendar view per outlet showing checklists, visits and issues by day. Photos kept at least 12 months. |
| 8 | Food labels (prep, expiry) | **New** | New module. |
| 9 | Customer-end QR | Was Phase 4 | Moves earlier, see open points. |
| 10 | Overall SOPs | Covered | Add a readable SOP library screen, not only checklists derived from SOPs. |
| 11 | Subscription plans, billing | **Was Phase 2** | Moves into the MVP. |
| 12 | Inspection report with score (FSSAI) | Partly covered | Becomes a scored audit, see below. |

### Revised restaurant roles

The whiteboard uses three tiers, which replace the names in section 3:

| Whiteboard role | Replaces | Main screens |
|---|---|---|
| **Head Chef** | Kitchen Staff | Daily checklists with photos, food labels, raise an issue, attendance marking |
| **Manager** | Outlet Manager | Everything the Head Chef has, plus service reminders, dues, booking, attendance and salary, history calendar |
| **Owner** | Brand Owner | Everything the Manager has across all outlets, plus certificates, invoices, subscription and billing |

### What the new items mean for the design

- **Billing moves into the MVP.** Items 1b, 1c, 3 and 11 together need a service catalogue with prices, subscription plans, GST invoices, a dues ledger and Razorpay payments. This is the largest change and adds roughly three to four weeks to the estimate in section 5.
- **Service booking.** New entities: `ServiceCatalogItem` (service, price, duration), `Booking` (one-time), `Subscription` (plan, outlet, billing cycle). A confirmed booking or active subscription creates Jobs, which then follow the technician flow already planned.
- **Attendance and salary.** New entities: `StaffMember` (restaurant employees, most of whom will never log in), `AttendanceRecord` (date, status, marked by), `SalaryRecord` (month, base pay, days worked, advances, amount paid). Planned as a simple tracker: it records and totals, it does not calculate statutory deductions or pay anyone.
- **Food labels.** New entities: `FoodItem` (name, shelf life) and `FoodLabel` (item, prepared at, expires at, prepared by). The app works out expiry from shelf life. Printing needs a Bluetooth thermal label printer, which is supported in Expo but requires choosing a printer model to build against.
- **FSSAI inspection report.** ECCS supervisors run a scored audit on the phone using a checklist modelled on FSSAI Schedule 4, producing a PDF with section scores, photos of non-conformities and corrective actions. This is separate from the daily hygiene score: one is ECCS's periodic audit, the other is the restaurant's own day-to-day discipline. The inspection score feeds into the hygiene score.
- **History calendar.** One calendar component reused for attendance, checklist history and visit history.

### Confirmed by the founder (5 Oct 2026)

1. **Attendance and salary** are for the restaurant's own employees: a basic staff-management service inside the restaurant app.
2. **Customer QR** opens a simple public web page showing the cleanliness score, timestamps of services done and a few photos (grill and similar), so a diner can see quickly how clean the kitchen is. No login. Photos are approved by ECCS before they appear and must not show people's faces.
3. **Food labels are printed.** Each label shows the food name, when it was made and when it expires.
4. **All twelve whiteboard items are in the pilot.**

---

## 9. What I need from you to proceed

1. Answers to the questions in section 1, at least 1 to 5.
2. Approval of, or changes to, the stack in section 2 and the MVP boundary in section 5.
3. Copies of any existing SOPs, checklists and a sample service report, however rough.
4. Go-ahead to run the setup in section 6.
