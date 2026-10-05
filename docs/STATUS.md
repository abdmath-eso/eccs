# ECCS Platform: Status Tracker

**Read this first.** It is the single source of truth for where the project stands. `docs/PROPOSAL.md` is the specification (what we are building and why); this file is the tracker (what is done, what is decided, what is blocked).

**Rule for anyone working on this repo, human or Claude:** update this file in the same session as any change that affects it: a feature started or finished, a decision made, a question answered, a tool installed. Add a line to the change log at the bottom every time.

**Last updated:** 5 Oct 2026

---

## 1. Project in one paragraph

ECCS (Eosfera Commercial Cleaning Services) is a Hyderabad startup selling bundled cleaning, pest control, chimney cleaning, safety inspection and SOP services to commercial restaurant kitchens. We are building a two-sided platform: a **restaurant app** (checklists, service booking, billing, staff attendance and salary, food labels, customer QR page, compliance vault) and a **company app** (clients, scheduling, technician field flow, reports and certificates, inspections, invoicing, monitoring). Pilot target: 3 to 5 restaurants.

## 2. Current state

| | |
|---|---|
| **Phase** | Planning. Proposal drafted, awaiting founder approval. |
| **Code** | None. Nothing scaffolded. |
| **Machine** | Fresh Windows 11 Home, 16 GB RAM. No dev tools installed (see section 6). |
| **Git** | Not initialised (Git is not installed yet). |
| **Next action** | Founder answers the open questions in section 4 and approves the proposal. Then run the environment setup in PROPOSAL.md section 6, then Phase 0. |
| **Standing instruction** | Do not install or scaffold anything until the founder approves the plan. |

## 3. Decisions made

| Date | Decision | Source |
|---|---|---|
| 5 Oct 2026 | TypeScript across the stack: Expo (Android), Next.js, NestJS, PostgreSQL + Prisma, BullMQ/Redis, S3 Mumbai, Better Auth, MSG91, Razorpay, AWS ap-south-1. **Proposed, not yet approved.** | PROPOSAL.md section 2 |
| 5 Oct 2026 | One mobile app with role-based screens, not separate apps. **Proposed, not yet approved.** | PROPOSAL.md section 2 |
| 5 Oct 2026 | Restaurant roles are Head Chef, Manager, Owner. Manager and Owner areas unlock with PIN or biometric. | Whiteboard (`image.png`) |
| 5 Oct 2026 | All twelve whiteboard items are in the pilot scope. Estimate moves to roughly 16 to 18 weeks. | Founder |
| 5 Oct 2026 | Attendance and salary tracking is for the restaurant's own employees, as basic staff management. Tracking only, no payroll. | Founder |
| 5 Oct 2026 | Customer QR is a public web page: cleanliness score, service timestamps, a few photos (grill and similar). | Founder |
| 5 Oct 2026 | Food labels are printed: food name, made time, expiry time. | Founder |
| 5 Oct 2026 | Billing (catalogue, subscriptions, GST invoices, Razorpay, dues) is built in-app for the pilot. | Follows from whiteboard items 1b, 1c, 3, 11 |

## 4. Open questions for the founder

Ordered by how much they block. "Blocks" says what cannot start until it is answered.

| # | Question | Blocks |
|---|---|---|
| 1 | Do you approve the tech stack in PROPOSAL.md section 2, and may I run the environment setup in section 6? | Everything |
| 2 | Is ECCS a registered company with a GSTIN and bank account? Do you have a domain, Google Play developer account and AWS account? | SMS OTP registration (DLT), Razorpay onboarding, invoicing, Play Store release. These have lead times of one to three weeks. |
| 3 | Who is building: you alone with Claude Code, or other developers too? Is there a target pilot date? | Timeline, how work is sequenced |
| 4 | Kitchen devices: staff's own phones, or one shared phone/tablet per outlet? Android only? | Login and device design |
| 5 | Service catalogue and prices: what are the services, prices, and subscription plans (what each includes, monthly or annual)? Is payment taken before the visit or after? | Booking and billing |
| 6 | Existing SOPs, checklists, a sample service report and a sample certificate: can you share them, however rough? Do they follow FSSAI Schedule 4? | Checklist templates, inspection scoring, PDF layouts |
| 7 | Label printer: do you have a model in mind? If not, I will recommend a 2-inch Bluetooth thermal label printer for you to buy one of for testing. | Food label printing |
| 8 | Technicians: employees or subcontractors, how many at pilot, and is GPS check-in required? | Technician flow |
| 9 | Languages for the pilot: English, Telugu and Hindi all from day one? | Translation effort |
| 10 | Customer QR page: can a restaurant switch its page off, or hide it when the score is low? Who picks the photos (my assumption: ECCS approves them from service after-photos)? | QR page rules |
| 11 | Salary tracker depth: is base pay, days worked, advances and amount paid enough, or do you need overtime and bonuses? | Salary tracker design |
| 12 | Will the restaurant app ever be sold to restaurants that do not buy ECCS services? | Minor; affects sign-up flow |
| 13 | Monthly cloud budget for the pilot? (Assumed up to about ₹15,000.) | Hosting sizing |
| 14 | Do you use an accounting tool (Tally, Zoho Books) that invoices should export to? | Invoice export, later |

## 5. Build progress

Status values: not started, in progress, done, blocked.

### Phase 0: Foundation (weeks 1–2)
| Item | Status | Notes |
|---|---|---|
| Dev environment installed | not started | Steps in PROPOSAL.md section 6 |
| Monorepo scaffolded (pnpm + Turborepo) | not started | |
| Local services via Docker Compose (Postgres, Redis, MinIO) | not started | |
| Database schema v1 and migrations | not started | |
| Auth: phone OTP, PIN, biometric, roles and memberships | not started | |
| CI (GitHub Actions) | not started | |
| Staging environment on AWS | not started | |
| DLT, Play Console, Razorpay registrations started | not started | Founder task |

### Phase 1a: Restaurant loop (weeks 3–6)
| Item | Status | Notes |
|---|---|---|
| SOP and checklist template library | not started | |
| Daily checklists, offline, with photos | not started | |
| Checklist reminders and notifications | not started | |
| Issues and ECCS support screen | not started | |
| Licence tracker and document vault | not started | |
| Restaurant dashboard | not started | |
| History calendar (1 year) | not started | |

### Phase 1b: Service loop (weeks 7–10)
| Item | Status | Notes |
|---|---|---|
| Client and outlet management (web) | not started | |
| Service catalogue and booking (one-time) | not started | |
| Recurring schedules and job generation | not started | |
| Technician flow, offline | not started | |
| Service report and certificate PDFs | not started | |
| Scored inspection with FSSAI-style report | not started | |
| ECCS monitoring board | not started | |

### Phase 1c: Billing (weeks 11–13)
| Item | Status | Notes |
|---|---|---|
| Subscription plans and subscriptions | not started | |
| GST invoices | not started | |
| Razorpay payments and dues | not started | |

### Phase 1d: Staff, labels, QR (weeks 14–16)
| Item | Status | Notes |
|---|---|---|
| Staff list and attendance tracker | not started | |
| Salary tracker | not started | |
| Food items and label printing | not started | Needs printer model (question 7) |
| Customer QR public page | not started | |

### Phase 1e: Hardening (weeks 17–18)
| Item | Status | Notes |
|---|---|---|
| Hygiene score v1 | not started | |
| Telugu and Hindi translations | not started | |
| Field test on low-end Android in a real kitchen | not started | |
| Play Store internal release | not started | |

## 6. Machine and environment

Checked 5 Oct 2026 on the founder's machine (`C:\Users\eosfera`, Windows 11 Home, x64, 16 GB RAM, 407 GB free).

| Tool | Installed |
|---|---|
| winget | No (not on PATH; install "App Installer" from Microsoft Store) |
| Git | No |
| Node.js / pnpm | No |
| Docker Desktop / WSL2 distro | No (`wsl.exe` present, no distro confirmed) |
| JDK 17 / Android Studio | No |
| VS Code | Possibly (a `.vscode` folder exists; `code` not on PATH) |

## 7. Files in this repo

| Path | What it is |
|---|---|
| `CLAUDE.md` | Instructions loaded automatically by Claude Code. Points here. |
| `docs/STATUS.md` | This tracker. |
| `docs/PROPOSAL.md` | Specification: stack, roles, data model, MVP, roadmap, setup steps, folder structure. |
| `image.png` | Founder's whiteboard photo listing twelve restaurant-app features. Transcribed in PROPOSAL.md section 8. |

## 8. Change log

Newest first.

| Date | Change |
|---|---|
| 5 Oct 2026 | Founder confirmed whiteboard open points; all twelve items in pilot. PROPOSAL.md sections 0, 3, 4, 5 and 8 updated. STATUS.md and CLAUDE.md created. |
| 5 Oct 2026 | Whiteboard (`image.png`) reviewed; section 8 added to PROPOSAL.md. |
| 5 Oct 2026 | Permission matrix split into company-side and restaurant-side tables. |
| 5 Oct 2026 | PROPOSAL.md first draft written. Machine checked; no dev tools present. |
