# 001 — Setup scope and confirmed conventions

Date: 2026-11-04. Session owner: Jian Ting. Approved in the setup conversation and by Elliot's [PR #1 review](https://github.com/JianTing-Li/spendwise/pull/1), which accepted the application tasks and the conventions below.

- Runnable stub foundation, shared contracts, synthetic fixtures, developer instructions, verification, concise commits, push, and review PR.
- Responsibilities: Elliot application/data, Jian agent/evaluations, planned by task without a fixed contribution target. Current owners are the issue assignees. No calendar commitments. Free tiers only.
- Prior month: September 2026. Current month: October 2026. Fixed reference: 2026-11-01. UTC date-only entries. Month ranges start-inclusive/end-exclusive.
- Duplicate proximity: inclusive seven calendar days; lookback begins 2026-09-24. At least one payment is in October. Payments after October are excluded. Full completed reversals recorded before 2026-11-01 remove the original from duplicate candidates.
- Cash totals use each completed entry's date; outgoing positive, reversal negative. Reversals require an equal-amount completed original, same vendor/currency, and cannot precede the original. At most one reversal record per original. Pending/failed entries do not affect totals.
- Increase thresholds: at least $5,000 and 20%; previous total ≤ 0 uses dollars only and no percentage. Comparison uses integer cross multiplication.
- Local-only PGlite initially; shared SQL shape, future Neon/pg adapter, no live compatibility claim. Single process per local data directory.
- Local development access uses loopback plus same-origin mutation checks; hosted mode fails closed pending identity/authentication.
- Setup checklist is a completion record for SETUP-01. GitHub Issues are the task specification and status source; docs link to them and do not restate status ([OPS-02](https://github.com/JianTing-Li/spendwise/issues/18)).
- v2 pasted prompt governs over the older fourth “Repository Setup Prompt” tab. In particular, no duplicated TASKS.md registry; 10 model requests; SDK retries zero; 60 seconds includes validation and persistence.
- The PRD reserves semantic evidence review for humans; setup conservatively keeps all stub explanation support unverified. Valid IDs alone never yield a verified finding.

Dependency validation found TypeScript 7 unsupported by the Next.js ESLint TypeScript integration. Use TypeScript 6.0.3 and ESLint 9.39.5 for compatible tooling; exact versions are in package.json and package-lock.json.

Use Next.js's supported webpack compiler for local development/build. Turbopack's CSS worker could not bind its internal port in this environment; webpack successfully built the same app.
