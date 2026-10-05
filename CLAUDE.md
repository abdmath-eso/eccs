# ECCS Platform

Enterprise platform for ECCS (Eosfera Commercial Cleaning Services), Hyderabad: a restaurant-side app and a company-side app for commercial kitchen cleaning, hygiene and compliance.

## Start here

1. Read `docs/STATUS.md` before doing anything. It holds the current phase, decisions, open questions and build progress.
2. Read `docs/PROPOSAL.md` for the specification: stack, roles, data model, scope, roadmap, folder structure.

## Rules

- **Keep `docs/STATUS.md` current.** In the same session as any change that affects it (feature started or finished, decision made, question answered, tool installed), update the relevant section and add a change-log line. The founder relies on this file to hand the project to new Claude sessions.
- When scope or design changes, update `docs/PROPOSAL.md` too so the two files never disagree.
- The plan is approved (5 Oct 2026). Build in the order of the phases in STATUS.md section 5.
- The team is the founder and Claude only. Commit after each working step with a clear message so progress is recoverable.
- Use sample data for company details, prices, SOPs and certificates until the founder supplies real ones. No real SMS or payments.
- Read STATUS.md section 6 "Notes for Claude sessions on this machine" before running commands.
- Record the founder's decisions in STATUS.md section 3 with the date; move answered questions out of section 4.
- The founder is not a full-time developer. Explain choices in plain language and give exact commands.
