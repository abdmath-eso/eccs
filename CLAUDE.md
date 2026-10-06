# ECCS Platform

Enterprise platform for ECCS (Eosfera Commercial Cleaning Services), Hyderabad: a restaurant-side app and a company-side app for commercial kitchen cleaning, hygiene and compliance.

## Start here

1. Read `docs/STATUS.md` before doing anything. It holds the current phase, decisions, open questions and build progress.
2. Read `docs/PROPOSAL.md` for the specification: stack, roles, data model, scope, roadmap, folder structure.
3. Skim the latest entries in `docs/DAILY_LOG.md` for what happened recently and what was left open.

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
- The founder is not a full-time developer. Explain choices in plain language and give exact commands.
