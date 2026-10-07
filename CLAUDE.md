# ECCS Platform

Enterprise platform for ECCS (Eosfera Commercial Cleaning Services), Hyderabad: a restaurant-side app and a company-side app for commercial kitchen cleaning, hygiene and compliance.

## Start here

1. Read `docs/STATUS.md` before doing anything. It holds the current phase, decisions, open questions and build progress.
2. Read `docs/PROPOSAL.md` for the specification: stack, roles, data model, scope, roadmap, folder structure.
3. Skim the latest entries in `docs/DAILY_LOG.md` for what happened recently and what was left open.
4. Sample logins for testing are in `docs/TEST_LOGINS.md`; keep it in step with the seed.
5. `docs/NOTIFICATIONS.md` lists every notification the platform should send; `docs/UI_REVIEW.md` is the screen review and what is left of it.

## Rules

- **Keep `docs/STATUS.md` current.** In the same session as any change that affects it (feature started or finished, decision made, question answered, tool installed), update the relevant section and add a change-log line. The founder relies on this file to hand the project to new Claude sessions.
- **Keep `docs/DAILY_LOG.md`.** It records what was done each day. At the end of each working day (or when the founder says the day is done), write that day's entry in the same format as the earlier ones: what was built, what the founder decided, how it was tested, problems found, what was left open. Check today's date before writing; add a new dated section if the day has changed. Do not rewrite past days.
- When scope or design changes, update `docs/PROPOSAL.md` too so the two files never disagree.
- The plan is approved (5 Oct 2026). Build in the order of the phases in STATUS.md section 5.
- The team is the founder and Claude only. Commit after each working step with a clear message so progress is recoverable.
- **Push to GitHub (`origin`, https://github.com/abdmath-eso/eccs) once a day, at end of day, when the founder says the day is done.** Do not push at other times unless asked. End of day means: write the day's entry in `docs/DAILY_LOG.md`, update `docs/STATUS.md`, commit, then push.
- Use sample data for company details, prices, SOPs and certificates until the founder supplies real ones. No real SMS or payments.
- Read STATUS.md section 6 "Notes for Claude sessions on this machine" before running commands.
- Record the founder's decisions in STATUS.md section 3 with the date; move answered questions out of section 4.
- **Keep `docs/NOTIFICATIONS.md` current (founder's rule, 7 Oct 2026).** Whenever a feature is built or changed, add or update the notifications it should send, in the same session. None is built yet; the founder will have them built and tested together later, so do not build one unless asked.
- **Research the design first, and build to the industry standard (founder's rule, 7 Oct 2026).** Before building or changing any screen in the app or the console, look up how established apps and current UI/UX guidance handle that kind of screen (search the web, do not rely on memory alone), and build the common pattern rather than inventing one. When reporting the work, say briefly what pattern was followed and where it comes from. This applies to everything from now on, not only when asked.
- The founder is not a full-time developer. Explain choices in plain language and give exact commands.
