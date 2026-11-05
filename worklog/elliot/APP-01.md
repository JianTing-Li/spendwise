# APP-01 — Durable PostgreSQL application persistence

Owner: Elliot Watson. Specification: [issue #4](https://github.com/JianTing-Li/spendwise/issues/4). Review: [draft PR #26](https://github.com/JianTing-Li/spendwise/pull/26).

## Changes and decisions

Fresh branch `codex/issue-4-durable-persistence` starts at main `899512a`. Inspected the issue/discussion, AGENTS.md, PRD, development guide, decisions, contracts, fixtures, storage and retry/access boundaries. SETUP-01 (#2) is closed.

PR #23 baseline is open at `cb0074984be843b9f8765e6a880f2d692058942a`. This branch carries its internal Database interface, pooled adapter, error/timeout handling and portable tests forward so the complete APP-01 change can be reviewed against main. It does not modify that branch, Jian's branches, or main. Coordinate overlap with [PR #23](https://github.com/JianTing-Li/spendwise/pull/23) / #24 before a future merge; no merge is authorized here.

- Immutable 001 and bundled 002, version ledger, transaction/advisory lock for concurrent PostgreSQL bootstrap; startup from another working directory requires no raw SQL sources. Existing PGlite and PostgreSQL 001 data upgrades in place. Invalid legacy data rolls back the entire migration.
- Generated relational filter columns and indexes for vendor/category, invoice/payment/note dates, amounts/currency/status/type, invoice/reversal links; normalized note links. Generated columns cannot drift from validated record JSON. Money remains safe integer USD cents.
- Run identity/exception/generation/state now live only in columns, with JSON metadata forbidden by a constraint. Existing results/review timestamps survive upgrade.
- Three attempts per exception/generation; explicit predecessor-named retry only for failed/incomplete/cancelled runs; completed/unverified runs never retry. Shared generation lock, uniqueness and predecessor idempotency protect double clicks, process races and reset. Each attempt receives fresh 8/10/60 limits. UI shows latest attempt, history and limit recovery.
- Dedicated local retry endpoint preserves existing public/agent contracts. Hosted and Neon routes still fail closed. No agent SQL, credentials, provider calls or financial execution are added.
- Explicit local/postgres/neon configuration; loopback-only postgres and verified Neon TLS, pooled application endpoint, matching targets, rejected SSL/startup overrides. No local fallback on database failure.
- Separate application/read-only URLs and migration owner role; migration URL is CLI-only. Runtime permission preflight rejects owner/write retrieval roles and owner/DDL application roles. Application startup checks version only. Actual role/database provisioning remains a human prerequisite.
- Separate opted-in Neon compatibility command tests isolated schema migration/replay, fixture totals and reader permissions. It was not run against Neon.

## Verification actually executed

- `npm run check`: typecheck, lint, **126 tests / 13 files**, production build passed.
- Final script-only Neon comparison adjustment: typecheck/lint passed afterward.
- `PG_TEST_ALLOW_LOCAL=1 PG_TEST_DATABASE=spendwise_app01_test PG_TEST_USER=elliotwatson npm run test:pg`: **12 passed, 0 failed/skipped** on existing local PostgreSQL 17.11. Random disposable schemas only; no database/role creation or server restart. Includes independent-process locks, concurrent bootstrap/retry/claims, reset invalidation, review durability, outages/timeouts, read-only denied DML/DDL, and full populated-001 upgrade equality.
- `npm run test:e2e`: **1 passed**; injection, source records, review, reload persistence, reset and mobile overflow.
- `npm run test:e2e:retry`: **1 passed**; intentional unavailable real entry point, explicit retry, three-attempt stop, history/reload/reset; zero model requests.
- `npm run eval:baseline`: four synthetic exceptions; zero model requests.
- `python3 -m unittest discover -s .github/scripts -p 'test_*.py'`: **9 passed**.
- `git diff --check`: passed. Immutable 001, src/contracts, src/agent and src/fixtures have no changes.

Restricted network/socket access and absent test Chromium initially blocked setup; reran with local access and a temporary Chromium install. A helper/CLI CommonJS top-level-await issue and a migration-config type error were fixed before the passing checks. Actual local tools: Node 24.21.0/npm 11.19.0; CI pins repository Node/npm versions.

## Limits and handoff

Live Neon connectivity/TLS certificate handshake, deployed packaging and actual human-provided three-login grants have not been exercised. No provisioning, secrets, paid calls, deployment or merge occurred. PostgreSQL permission boundaries were tested using an existing built-in read-only role; no runtime logins were created. APP-02 authentication, APP-03 SQL retrieval and INT-01 real investigator integration remain their separate issues; existing real entry point is intentionally unavailable. Whole-server restart remains untested.

Jian review: confirm SQL/generated-column consumer expectations, retry endpoint/UI behavior and role boundaries. The implementation follows the architecture/retry policy recorded in #4; no public contract or fixture ID changes were made. See the draft PR linked from #4 for review/CI and the session evidence report/screenshots for the local demo. Status and approvals live in GitHub, not this log.

## Independent compatibility follow-up — November 5, 2026

Read #4 and both PRs, their discussions/current checks, AGENTS, PRD, decisions and development/handoff docs. Clean original worktree at ca49fa2; refreshed main remains 899512a. New worktree/branch `codex/issue-4-compatibility-audit` starts at latest main and carries forward #26's two commits; neither reviewed PR branch nor Jian's branches was edited.

Independent baseline audit supports eight locally MET criteria and two PARTIAL external criteria. Challenge to prior review: Neon checker also lacked application-login preflight and direct offline coverage. Added a shared isolated compatibility procedure: populated 001 upgrade, full fixture equality, independent expected totals, three inject/claim/stub/review/replay/reset cycles, zero model requests. Future Neon checker now opens actual application login for non-DDL/non-owner/catalog grant/version preflight; it makes no application-record mutations and performs no grants. PGlite and local PG tests execute the same disposable scenario. Additional SQL-boundary regression tests reject duplicated run metadata and unsupported ledgers and exercise relational payment filters/generated updates. Offline backend demo and exact future authorized procedure documented in development guide.

Actual follow-up checks and limits are recorded in the session acceptance report. Live Neon remains unexecuted; actual three-login grants, remote handshake and deployed packaging are unverified. No provisioning, paid models, deployment or merge. #23/#24 adapter overlap must be reconciled before integration; follow-up touches permission verification but leaves pg adapter, contracts, agent, fixtures and migrations unchanged. Repository requires closing references in every PR; #4 cannot honestly be completed with missing external gates. Follow-up issue/PR publication needs a permitted issue scope; do not change #26 or label #4 complete to bypass this rule.

User subsequently authorized focused follow-up [#27](https://github.com/JianTing-Li/spendwise/issues/27) and a stacked PR against unchanged #26. See [APP-01B log](APP-01B.md) and [acceptance audit](../../docs/app-01-acceptance-audit.md) for actual follow-up checks. #4 external gates remain separate.
