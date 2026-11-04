# SETUP-01

Owner: Jian Ting. Date: 2026-11-04. Branch: `codex/repo-setup`.

## Changes
Runnable local synthetic demo, shared schemas and investigator interface, fixture retrieval, budget scaffolding, PGlite persistence, reset-generation protection, stub findings, human review acknowledgment, tests, CI, and documentation.

Follow-up: added `worklog/elliot/APP-01.md`, the missing starter log referenced by the handoff. It records no implementation or verification claims and leaves Elliot's ownership pending agreement. Documentation-only change; checked with `git diff --check`.

## Decisions
See `docs/decisions/001-setup.md`. Elliot's ownership is proposed, not agreed. No deadlines or deployment owner. Free tiers only. GitHub Issues are future implementation status/specification source; drafts await creation approval.

## Verification
- `npm run typecheck`: passed.
- `npm run lint`: passed, no lint errors/warnings.
- `npm test`: 24 tests passed across 3 files. Includes financial boundaries, evidence scope, budgets, access, concurrent injection, reset races, expired runs, three service-level demo cycles, and database close/reopen persistence.
- `npm run build`: passed using webpack.
- `npm run test:e2e`: 1 browser flow passed, including injection, source inspection, human review, reload persistence, denied mutation, reset, and mobile overflow check. Desktop/mobile screenshots inspected locally; generated artifacts ignored.
- `npm run eval:baseline`: emitted four exception reports from demo-v1, zero model requests. Not a model-quality evaluation.
- `npm audit --omit=dev --audit-level=moderate`: zero production vulnerabilities. Full install still reports 16 moderate development-tooling advisories; ESLint 9 is deprecated. See developer docs.
- `git diff --check`, exclusion checks, and credential-pattern scan: passed. `.env.local` ignored and mode 0600. No credential values entered or printed. Pattern scanning is not a guarantee against every secret format.
- No live model calls, Neon connections, deployed authentication checks, deployment, or paid evaluation. Hosted persistence/read-only-role compatibility remains unverified. CI is reported separately after PR creation.

## Remaining work / next action
Review [setup PR #1](https://github.com/JianTing-Li/spendwise/pull/1), then agree ownership and initial issue drafts in `docs/handoff.md`. Real agent behavior, semantic support validation, hosted auth, and Neon integration remain explicit implementation tasks. No GitHub issues, repository settings, deployment projects, or model budgets were changed.

## Remote state
Branch pushed; PR #1 opened against main for review, not merged. Implementation commit: `2b6b93a` (Set up local demo). Handoff commit: `09a61d9` (Finalize setup handoff). CI runs are visible on the PR and are distinct from the verified local checks above.
