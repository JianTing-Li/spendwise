# SETUP-01

Owner: Jian Ting. Date: 2026-11-04. Branch: `codex/repo-setup`.

## Changes
Runnable local synthetic demo, shared schemas and investigator interface, fixture retrieval, budget scaffolding, PGlite persistence, reset-generation protection, stub findings, human review acknowledgment, tests, CI, and documentation.

Follow-up: added `worklog/elliot/APP-01.md`, the missing starter log referenced by the handoff. It records no implementation or verification claims and leaves Elliot's ownership pending agreement. Documentation-only change; checked with `git diff --check`.

## Decisions
See `docs/decisions/001-setup.md`. Elliot accepted the application tasks in his PR #1 review. GitHub Issues hold task specifications and status.

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
None for SETUP-01. Real agent behavior, semantic support validation, hosted auth, and Neon integration are tracked in the [issue index](../../docs/handoff.md).

## Remote state
[PR #1](https://github.com/JianTing-Li/spendwise/pull/1) merged after Elliot's approval. Implementation commit: `2b6b93a` (Set up local demo). Handoff commit: `09a61d9` (Finalize setup handoff).

Two later local commits (`50958de` issue-link check and PR template, `f2f35ba` startup routine) failed to push and were not in the merged PR. They are restored, revised, by [OPS-02 #18](https://github.com/JianTing-Li/spendwise/issues/18).
