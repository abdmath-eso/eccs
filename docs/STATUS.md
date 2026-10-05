# ECCS Platform: Status Tracker

**Read this first.** It is the single source of truth for where the project stands. `docs/PROPOSAL.md` is the specification (what we are building and why); this file is the tracker (what is done, what is decided, what is blocked).

**Rule for anyone working on this repo, human or Claude:** update this file in the same session as any change that affects it: a feature started or finished, a decision made, a question answered, a tool installed. Add a line to the change log at the bottom every time, and commit.

**Last updated:** 5 Oct 2026

---

## 1. Project in one paragraph

ECCS (Eosfera Commercial Cleaning Services) is a Hyderabad startup selling bundled cleaning, pest control, chimney cleaning, safety inspection and SOP services to commercial restaurant kitchens. We are building a two-sided platform: a **restaurant app** (checklists, service booking, billing, staff attendance and salary, food labels, customer QR page, compliance vault) and a **company app** (clients, scheduling, supervisor field flow, reports and certificates, inspections, invoicing, monitoring). Pilot target: 3 to 5 restaurants, then 15 to 20.

The team is the founder plus Claude Code. There are no other developers, so this file and `CLAUDE.md` are how context survives between sessions.

## 2. Current state

| | |
|---|---|
| **Phase** | Phase 0 (Foundation), in progress. |
| **Plan approval** | Approved by the founder on 5 Oct 2026. Installing and scaffolding are allowed. |
| **Code** | `packages/db`: schema (about 48 tables), migrations, sample seed. `packages/shared`: roles, permission rules, request schemas. `packages/api-client`: the one typed client web and mobile use. `packages/i18n`: English, Telugu, Hindi text. `apps/api`: login (restaurant code + PIN, one-time code), sessions, role and scope checks, staff logins, outlets, client onboarding. `apps/mobile`: welcome, restaurant code, PIN pad, phone, one-time code, role-based home, staff logins (shows restaurant codes). `apps/web`: ECCS console with login, client list and restaurant onboarding. |
| **Local services** | Running in Docker: PostgreSQL on 5432, Redis on 6379, SeaweedFS (S3 stand-in) on 8333. Database is migrated and seeded. |
| **Blocked** | Nothing. |
| **Next action (Claude)** | Phase 1a, starting with the daily checklist on mobile (offline, with photos). |
| **Next action (founder)** | Try both apps (section 6, "See it running") and give feedback. Restart any terminals left running from before, so they pick up new code. |

## 3. Decisions made

| Date | Decision | Source |
|---|---|---|
| 5 Oct 2026 | Tech stack approved: TypeScript throughout; Expo, Next.js, NestJS, PostgreSQL + Prisma, BullMQ/Redis, S3, Better Auth, MSG91, Razorpay, AWS Mumbai. | Founder |
| 5 Oct 2026 | One mobile app for **Android and iOS**, with role-based screens. Staff use their own phones. | Founder |
| 5 Oct 2026 | **Company-side roles are Super Admin, Ops Manager and Supervisor only.** Technicians do not get the app; the Supervisor records each visit. Finance, Sales and Technician roles come later. | Founder |
| 5 Oct 2026 | Restaurant roles are Head Chef, Manager, Owner. | Whiteboard (`image.png`) |
| 5 Oct 2026 | **Restaurant login is PIN only, no biometrics.** The Owner is onboarded once with mobile number (and email) and a one-time code, and gets a PIN. After that nobody at the restaurant uses one-time codes: each person logs in with a generated 4-digit PIN and the PIN decides their role. The Owner adds people and is shown their PIN once. Full description in PROPOSAL.md section 2, "How login works". | Founder |
| 5 Oct 2026 | A new phone is linked to a restaurant once by typing the outlet's **restaurant code**, then asks only for a PIN. PINs are **4 digits** for everyone. | Founder |
| 5 Oct 2026 | All twelve whiteboard items are in the pilot scope. Estimate roughly 16 to 18 weeks. | Founder |
| 5 Oct 2026 | **Sample-data mode for now.** Company details (GSTIN and so on), prices, plans, SOPs, checklists, certificates and accounting export all use realistic sample data until the founder supplies real ones. No real SMS or payments: a fixed development OTP and Razorpay test mode. | Founder |
| 5 Oct 2026 | English, Telugu and Hindi all supported, chosen per user as a preference. | Founder |
| 5 Oct 2026 | Attendance and salary tracking is for the restaurant's own employees. Tracking only, no payroll. Salary includes overtime and bonuses. | Founder |
| 5 Oct 2026 | Customer QR is a public web page: cleanliness score, service timestamps, a few photos. The restaurant can switch its page off. | Founder |
| 5 Oct 2026 | Food labels are printed: food name, made time, expiry time. | Founder |
| 5 Oct 2026 | The restaurant app is only for ECCS service clients; it will not be sold standalone. | Founder |
| 5 Oct 2026 | Billing (catalogue, subscriptions, GST invoices, Razorpay, dues) is built in-app for the pilot. | Follows from whiteboard items |
| 5 Oct 2026 | Login is our own module in the API, not the Better Auth library named in the first draft. Reason and safeguards in PROPOSAL.md section 2. **Founder has not explicitly reviewed this change.** | Claude, during build |
| 5 Oct 2026 | ECCS staff keep logging in with mobile number + one-time code. A Manager may add and reset Head Chefs at their own outlet but not other Managers. Owner logins are created by ECCS, not by other Owners. **Assumptions; founder has not reviewed.** | Claude, during build |
| 5 Oct 2026 | Translations are a small typed dictionary in `packages/i18n` rather than the i18next library named in the first draft; it can be swapped later if plural rules or similar are needed. | Claude, during build |
| 5 Oct 2026 | ECCS roles get no access to restaurant staff, attendance or salary data; it is the restaurant's private employee information. **Founder has not explicitly reviewed this.** | Claude, during build |
| 5 Oct 2026 | Users cannot sign themselves up. An ECCS admin, Owner or Manager creates each login. | Claude, during build |
| 5 Oct 2026 | Node is managed with fnm (no admin rights needed), pinned to Node 24 via `.node-version`. pnpm 12, Turborepo. `nodeLinker: hoisted` because of React Native. | Claude, during setup |

## 4. Open questions for the founder

| # | Question | Blocks | Working assumption |
|---|---|---|---|
| 1 | Label printer model? | Food label printing (Phase 1d) | Claude will recommend a 2-inch Bluetooth thermal label printer to buy for testing when Phase 1d approaches. |
| 2 | Is there a target pilot date? | Sequencing | None; follow the roadmap order. |
| 3 | Is GPS captured when the Supervisor checks in at an outlet? | Supervisor flow | Yes, position and time at check-in only. |
| 4 | Who chooses the photos on the customer QR page? | QR page | Supervisor proposes from service after-photos; Super Admin or Ops Manager approves. |
| 5 | Monthly cloud budget? | Hosting choice at deployment | Lean setup, see section 7. |
| 6 | Real company details, prices, SOPs, certificate formats | Going live, not building | Sample data. |
| 7 | Should the Owner's one-time code go to the mobile number, the email, or both? | Real code delivery | Mobile number. Email is stored but nothing is sent to it yet. |
| 8 | How should an Owner log in on the web dashboard: restaurant code + PIN like the app, or one-time code? | Web login for restaurants | Not built; ECCS console first. |
| 9 | Are 4-digit PINs acceptable given the known limit in PROPOSAL.md section 2 ("Safeguards")? Options later: longer PINs for Owner and Manager, or showing the Owner a list of linked phones to remove. | Nothing now | 4 digits, as chosen. |

Before the pilot goes live (not needed for building), the founder will need: company registration and GSTIN, a domain, Google Play developer account (US$25 once), Apple Developer account (US$99/year), AWS account, MSG91 with DLT registration for OTP SMS, and Razorpay onboarding. Several take one to three weeks.

## 5. Build progress

Status values: not started, in progress, done, blocked.

### Phase 0: Foundation
| Item | Status | Notes |
|---|---|---|
| Git, Node 24, pnpm, VS Code extensions | done | See section 6 |
| WSL2, Docker Desktop | done | Installed by the founder |
| JDK 17, Android Studio | not started | Optional for now; only needed for a local Android emulator |
| Monorepo scaffolded (pnpm + Turborepo) | done | `apps/web`, `apps/api`, `apps/mobile` are generator defaults |
| Local services (Postgres, Redis, S3 stand-in) | done | `pnpm services:up`. S3 bucket creation still to be verified when the storage module is built |
| `packages/db` (Prisma schema, migrations, sample seed) | done | Prisma 7.10. Seed: 3 ECCS users, 2 sample brands, 3 outlets, 7 restaurant users, 5 checklist templates in en/te/hi, 4 service types, 2 plans, jobs, licences, staff, food items |
| `packages/shared` (Zod schemas, roles, permissions) | done | `src/permissions.ts` is the one definition of who may do what; it mirrors PROPOSAL.md section 3 and has tests |
| `packages/i18n` (en, te, hi) | done | Login, home and staff text. Telugu and Hindi are machine-drafted and need a native speaker's review |
| Auth in the API | done | Restaurant code links a phone; PIN login decides the role; one-time code for ECCS staff and Owner onboarding; staff logins with generated PINs; lockouts. 26 end-to-end tests. Code is fixed at `123456` in sample mode; real SMS and email not wired |
| Mobile login and home screens | done | Clicked through in Chrome via the browser preview: restaurant code, PIN pad, owner home, staff list, adding a person and seeing their PIN. **Not yet tried on a real Android or iOS phone, and the one-time-code screens were not clicked through** (their API is tested) |
| `packages/api-client` | done | |
| Web console: login, client list, onboarding | done | ECCS staff log in with mobile number + one-time code. Clients page lists every restaurant, its owner, outlets and restaurant codes; "Onboard a restaurant" creates the brand, first outlet, code and owner, then shows what to tell the owner; outlets can be added. Clicked through in Chrome. Super Admin and Ops Manager only; a Supervisor sees a "nothing here" page |
| Web console hardening | not started | The session token is in browser storage. Before real client data, move it to an httpOnly cookie behind a same-site proxy and add a second factor for admins |
| Staff logins screen (Owner and Manager add people, new PIN, remove access) | done | Mobile |
| Console: edit or deactivate a client or outlet, change a restaurant code, unlink phones, manage ECCS users | not started | ECCS users still come from the seed |
| Restaurant codes shown to Owner and Manager | done | Top of the Staff logins screen, and next to each newly generated PIN. Sent by the API only to people who may add staff at that outlet |
| API client shared by web and mobile | not started | |
| CI (GitHub Actions) | not started | No GitHub remote yet |
| Staging environment | not started | Deferred until there is something to deploy |

### Phase 1a: Restaurant loop
| Item | Status | Notes |
|---|---|---|
| SOP library and checklist templates | not started | Sample SOPs |
| Daily checklists, offline, with photos | not started | |
| Checklist reminders and notifications | not started | |
| Issues and ECCS support screen | not started | |
| Licence tracker and document vault | not started | |
| Restaurant dashboard | not started | |
| History calendar (1 year) | not started | |

### Phase 1b: Service loop
| Item | Status | Notes |
|---|---|---|
| Client and outlet management (web) | not started | |
| Service catalogue and one-time booking | not started | Sample prices |
| Recurring schedules and job generation | not started | |
| Supervisor visit flow, offline | not started | |
| Service report and certificate PDFs | not started | Sample formats |
| Scored inspection with FSSAI-style report | not started | |
| ECCS monitoring board | not started | |

### Phase 1c: Billing
| Item | Status | Notes |
|---|---|---|
| Subscription plans and subscriptions | not started | |
| GST invoices | not started | Sample GSTIN |
| Razorpay payments (test mode) and dues | not started | |

### Phase 1d: Staff, labels, QR
| Item | Status | Notes |
|---|---|---|
| Staff list and attendance tracker | not started | |
| Salary tracker (with overtime, bonuses) | not started | |
| Food items and label printing | not started | Needs printer model |
| Customer QR public page | not started | |

### Phase 1e: Hardening
| Item | Status | Notes |
|---|---|---|
| Hygiene score v1 | not started | |
| Telugu and Hindi translations | not started | |
| Field test on low-end Android and an iPhone | not started | |
| Play Store and TestFlight internal releases | not started | |

## 6. Machine and environment

Founder's machine: `C:\Users\eosfera`, Windows 11 Home, x64, Intel i5-13420H, 16 GB RAM. Project at `C:\Users\eosfera\eccs`.

| Tool | State | Notes |
|---|---|---|
| Git 2.55 | installed | Global config set: name `eosfera`, email `eccs2710@outlook.com`, `main`, `autocrlf=input`, `longpaths=true`. The name is a placeholder; change with `git config --global user.name "..."`. |
| fnm 1.39 + Node 24.21 | installed | PowerShell profile loads fnm automatically in new terminals. |
| pnpm 12.9 | installed | |
| VS Code | installed | Extensions: ESLint, Prettier, Prisma, Tailwind, Expo Tools, Containers, Error Lens. `code` is not on PATH; open VS Code from the Start menu. |
| winget 1.6 | present, outdated | Works only with `--source winget` (its Store source fails with a certificate error). Not on PATH; full path is `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe`. Updating "App Installer" in the Microsoft Store fixes both. |
| GitHub CLI | not installed | Needed when we create the GitHub remote. |
| WSL2 | installed | |
| Docker Desktop 29.8 | installed, engine running | Must be started (Start menu) before `pnpm services:up` after a reboot. |
| JDK 17, Android Studio | not installed | Admin. Only needed for a local Android emulator; a real phone with Expo works without them. |
| Windows long paths | not confirmed | Was off on 5 Oct. Admin command below. Needed before local Android builds. |

### Optional admin step for the founder

In PowerShell opened with "Run as administrator" (include the leading `&` where shown):
```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

### Notes for Claude sessions on this machine

- The tool shell does not load the PowerShell profile, so `node`, `pnpm` and `git` are not on PATH by default. Start each command with:
  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); fnm env --shell powershell | Out-String | Invoke-Expression
  ```
- This shell is not elevated. Anything needing admin rights must be handed to the founder as exact commands.
- Edit JSON files with the Edit tool, not PowerShell string replacement (an earlier attempt corrupted `package.json`).
- Next.js 16, Expo SDK 57 and NestJS 12 are newer than Claude's training data. Read `apps/web/AGENTS.md` and `apps/mobile/AGENTS.md` and the docs they point to before writing framework code. NestJS 12 is ESM and uses Vitest and oxlint.
- In `apps/mobile`, add packages with `npx expo install <package>` so versions match the SDK.
- React is pinned to 19.2.3 in both web and mobile to keep one copy under the hoisted layout.
- Prisma is pinned to 7.10.0. `pnpm add prisma` without a version pulls an 8.0 release candidate; do not upgrade until 8 is stable. Prisma 7 keeps the database URL in `packages/db/prisma.config.ts` (read from `packages/db/.env`, not committed), generates the client into `packages/db/generated/prisma` (not committed, run `pnpm --filter @eccs/db generate`), and needs the `@prisma/adapter-pg` driver adapter; use `createPrismaClient()` from `@eccs/db`.
- `prisma init` installs agent "skills" folders (`.agents`, `.claude`, `.windsurf`) as a side effect; they were deleted. Do not re-run `prisma init`.
- `@eccs/db` and `@eccs/shared` compile to `dist/` and apps import the compiled output. After changing either, run `pnpm build` (Turborepo builds them first automatically for `build`, `dev`, `typecheck` and `test`).
- API layout: `apps/api/src/auth` (login, guard, decorators), `src/prisma` (database access via `PrismaService.client`), `src/config/env.ts` (reads the repo-root `.env`), `src/common/zod-validation.pipe.ts`. Every endpoint needs a session unless marked `@Public()`; add `@RequirePermission(resource, action)` for the role check, and narrow rows in the service with `accessScope()` from `@eccs/shared` (see `src/outlets` for the pattern).
- API endpoints so far (prefix `/v1`, port 4000): `GET /health`; `POST /auth/otp/request`; `POST /auth/otp/verify`; `POST /auth/device/link`; `POST /auth/pin/login`; `GET /auth/me`; `PATCH /auth/me`; `POST /auth/logout`; `GET /outlets`; `GET /organizations`; `POST /organizations`; `POST /organizations/:id/outlets`; `GET /restaurant-users`; `POST /restaurant-users`; `POST /restaurant-users/:id/reset-pin`; `PATCH /restaurant-users/:id`.
- API end-to-end tests (`pnpm test:e2e` in `apps/api`) run against the local seeded database, so Docker must be up and `pnpm seed` run at least once. They are not part of `pnpm test`.
- If a package's `tsc` fails with MODULE_NOT_FOUND, delete that package's `node_modules` folder and run `pnpm install` (stale links after dependency changes).
- pnpm blocks dependency install scripts unless listed under `allowBuilds` in `pnpm-workspace.yaml`.
- The `minio/minio` image no longer exists on Docker Hub; local S3 is SeaweedFS on port 8333.
- Database commands, run from `packages/db`: `pnpm migrate` (new migration after a schema change), `pnpm seed` (wipe and reload sample data), `pnpm reset` (drop everything, re-migrate, re-seed), `pnpm studio` (browse the data).
- Sample logins are in the "See it running" table below. `PIN_SECRET` in the root `.env` must match the one used when seeding, or the sample PINs stop working (re-run `pnpm seed`).
- `prisma migrate dev` refuses to run without a terminal when it has warnings. Workaround used for the `pin_login` migration: write the SQL with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` into a new folder under `prisma/migrations`, then `prisma migrate deploy`.
- Mobile: screens live in `apps/mobile/src/app` (`(auth)` before login, `(app)` after; the root layout swaps them). Shared pieces are in `src/components/ui`; login state is `src/lib/session.tsx`; all text goes through `t()` from `@eccs/i18n`. The React Compiler lint rules are on: no reading refs during render, no setState directly in effects.
- Web: `apps/web/src/app/login` and `apps/web/src/app/(console)` (its layout redirects to login). All pages are client components that call the API through `src/lib/api.ts`; shared pieces in `src/components/ui.tsx`. `NEXT_PUBLIC_API_URL` overrides the API address.
- The founder often has the API (4000) and mobile preview (8081) running in their own terminals. Do not stop those. To test, run copies on other ports: `API_PORT=4001` for the API, `NEXT_PUBLIC_API_URL` with `next dev --port 3001`, `EXPO_PUBLIC_API_URL` with `expo start --web --port 8082`, and stop only those afterwards.
- To view the mobile app from a Claude session, start the API and `expo start --web` in the background, then use the Claude in Chrome tools. The API allows any browser origin in development only.
- Do not pass JavaScript to `node -e` from PowerShell when it contains double quotes; write a script file in the scratchpad and run that.

### See it running

Docker Desktop must be running. Open three terminals in VS Code at `C:\Users\eosfera\eccs`. If any are still running from an earlier session, stop them first with Ctrl+C so they pick up new code.

Terminal 1, the API:
```powershell
pnpm build
pnpm --filter @eccs/api start
```
Terminal 2, the mobile app in a browser:
```powershell
pnpm --filter @eccs/mobile web
```
Then open http://localhost:8081 in Chrome. Narrow the window to phone width for a truer picture.

Terminal 3, the ECCS web console:
```powershell
pnpm --filter @eccs/web dev
```
Then open http://localhost:3000 and log in with `9000000001` and code `123456`.

| To log in as | Do this |
|---|---|
| Owner, Spice Route | "I have a restaurant code" → `SPICE-JH2K7M` → PIN `2580` |
| Manager, Jubilee Hills | same code → PIN `4821` |
| Head Chef, Jubilee Hills | same code → PIN `7306` |
| Manager / Head Chef, Gachibowli | code `SPICE-GB4N8P` → PIN `1593` / `6042` |
| Owner / Head Chef, Deccan Biryani | code `DECCA-KP6R3T` → PIN `3917` / `8264` |
| Owner onboarding (one-time code) | "I am the owner" → `9100000001` → code `123456` |
| ECCS Super Admin / Ops Manager / Supervisor | "ECCS staff login" → `9000000001` / `…002` / `…003` → code `123456` |

"Lock" on the home screen returns to the PIN pad for the next person. "Use a different restaurant" on the PIN pad unlinks the browser so another code can be entered. If sample PINs stop working, run `pnpm seed` in `packages/db`.

On a real phone: not set up yet. It needs the phone and this computer on the same Wi-Fi and `EXPO_PUBLIC_API_URL` pointed at this computer's address.

### Everyday commands

| Command (from the repo root) | Does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Run all apps in dev mode |
| `pnpm typecheck` / `pnpm build` / `pnpm lint` / `pnpm test` | Checks across the workspace |
| `pnpm services:up` / `pnpm services:down` | Start or stop local Postgres, Redis, MinIO (needs Docker) |

## 7. Hosting cost estimate (15 to 20 restaurants)

Rough figures from AWS Mumbai list prices as remembered, not a quote; check against the AWS pricing calculator before committing. Development on this machine costs nothing.

| Setup | Monthly | What it is |
|---|---|---|
| **Lean (recommended to start)** | about ₹5,000 to ₹7,000 | One small server running API, worker, web and Redis in containers, plus a managed PostgreSQL database with automatic backups, plus S3 for photos. |
| Fully managed | about ₹10,000 to ₹13,000 | The setup in PROPOSAL.md section 2: separate managed containers, load balancer, managed Redis. |

At this size the load is small: roughly 5 to 6 GB of new photos a month, well under ₹200 of storage. Moving from lean to fully managed later is a deployment change, not a rewrite, because everything already runs in containers.

Other running costs: OTP SMS about ₹0.20 to ₹0.25 each; Razorpay about 2% per transaction plus GST; Apple Developer US$99/year; Google Play US$25 once; a domain about ₹1,000/year; Expo build service free tier to begin, US$19/month if builds become frequent.

## 8. Files in this repo

| Path | What it is |
|---|---|
| `CLAUDE.md` | Instructions loaded automatically by Claude Code. Points here. |
| `docs/STATUS.md` | This tracker. |
| `docs/PROPOSAL.md` | Specification: stack, roles, data model, scope, roadmap, folder structure. |
| `image.png` | Founder's whiteboard photo. Transcribed in PROPOSAL.md section 8. |
| `apps/web` | Next.js: ECCS admin console, restaurant owner dashboard, public QR page. |
| `apps/api` | NestJS REST API. |
| `apps/mobile` | Expo app for restaurant staff and ECCS supervisors. |
| `packages/db` | Prisma schema (`prisma/schema.prisma`), migrations, sample seed (`prisma/seed.ts`), client factory (`src/index.ts`). |
| `packages/shared` | Roles, permission rules, phone number handling, login request and response schemas. Used by API, web and mobile. |
| `packages/api-client` | Typed functions for every API endpoint. Web and mobile call the API only through this. |
| `packages/i18n` | All on-screen text in English (`en.ts`, the source), Telugu and Hindi. |
| `infra/docker-compose.yml` | Local Postgres, Redis, SeaweedFS. |
| `.env.example` | Local environment variables, including the fixed development OTP. |

## 9. Change log

Newest first.

| Date | Change |
|---|---|
| 5 Oct 2026 | Restaurant codes now shown to Owners and Managers in the app. ECCS web console built: login, client list, restaurant onboarding, add outlet. API: `/organizations` endpoints; outlet list carries the code for people who hand it out. 31 end-to-end tests. Clicked through in Chrome on test ports. |
| 5 Oct 2026 | Restaurant login redesigned to the founder's spec: restaurant code links a phone once, then PIN only; Owner onboarded by one-time code; staff logins with generated PINs; no biometrics. Added `packages/api-client` and `packages/i18n`. Built the mobile login, home and staff screens and clicked through them in Chrome. Web login not started. |
| 5 Oct 2026 | Login and roles built in the API: `packages/shared` (roles, permissions, schemas), Session and OtpChallenge tables, phone + code login, PIN, role and scope guard, `GET /v1/outlets`. Unit and end-to-end tests pass; verified against the running API. No screens yet. |
| 5 Oct 2026 | Founder installed WSL2 and Docker. Local Postgres, Redis and SeaweedFS running (MinIO image no longer available). `packages/db` added: full schema, first migration applied, sample data seeded. "Contract" folded into Plan and Subscription in the data model. |
| 5 Oct 2026 | Plan approved. Founder answered open questions (roles, platforms, sample data, languages, salary, QR). Installed Git, fnm, Node 24, pnpm, VS Code extensions. Initialised git. Scaffolded monorepo with Next.js, NestJS and Expo starters; all typecheck. Docker blocked on admin steps. Hosting cost estimate added. |
| 5 Oct 2026 | Founder confirmed whiteboard open points; all twelve items in pilot. PROPOSAL.md updated. STATUS.md and CLAUDE.md created. |
| 5 Oct 2026 | Whiteboard (`image.png`) reviewed; section 8 added to PROPOSAL.md. |
| 5 Oct 2026 | Permission matrix split into company-side and restaurant-side tables. |
| 5 Oct 2026 | PROPOSAL.md first draft written. Machine checked; no dev tools present. |
