# APP-01 independent acceptance audit

Audited baseline: PR #26 ca49fa2954fcc460f47d1b80bb19396bf18cdb30; latest main 899512a8a5580d07e7dec10216418c192dfb68c8. Owner Elliot. Issue #4 is authoritative. MET means implementation and relevant local verification; it does not imply live Neon verification. Every row names visible behavior, tests and remaining gate.

| # | Criterion / verdict at baseline | Built and visible evidence | Precise local verification | External gate / explanation |
|---|---|---|---|---|
| 1 | Pooled synthetic Neon + transactional versioned migrations + PGlite: PARTIAL | `src/server/db/{pg,config,migrate,local}.ts`; migration 002, static bundle; explicit modes | `pg-adapter.test.ts`, `db-config.test.ts`, `migrations-retry.test.ts`; `test:pg` concurrent bootstrap and populated 001 upgrade | No live Neon TLS/pool handshake, actual three-login grants or deployed packaging test. Synthetic-only is a human target prerequisite, not something the URL proves. |
| 2 | Parameters, timeouts, safe integer money: MET | `pg.ts` pinned client/bounded options/error classification; `store.ts` parameterized values; `domain/finance.ts` safe arithmetic; generated cents constraints | `pg-adapter.test.ts`, `database-money.test.ts`, `financial.test.ts`; PG lock/statement timeout tests | Neon production capacity not sized; no live verification claimed. |
| 3 | Atomic injection/detection/claims/review/reset across processes: MET | `store.ts` generation row locks and transaction-scoped mutations; bounded predecessor retries | `pg-local.integration.ts`: three cycles, observed lock waits, unique claim winner, durable reviews, stale finish rejection; `store.test.ts` | Actual multi-process local PostgreSQL evidence, not merely PGlite serialization. Whole-server restart untested and not part of this criterion. |
| 4 | Explicit failure, no fallback, hosted disabled: MET | `local.ts` explicit adapter selection; `pg.ts` safe errors; `server/access.ts`; retry route | `store-mode.test.ts`, `safety.test.ts`, `retry-route.test.ts`; PG active/idle failure and recovery | Hosted deployment not performed; local fail-closed tests cover policy, not deployed identity. |
| 5 | Local routine tests + separately authorized Neon fixture/migration check: PARTIAL | CI local/PGlite/fake pools + ephemeral PG17; `neon-check.ts` explicit opt-in, isolated schema, fixture totals/replay | Local suites; baseline checker has no direct offline regression test and does not open application login; reader checked against existing default schema | Must improve checker coverage. Live Neon and actual grants remain unverified. No provision/connect authorization. |
| 6 | Cwd/source-independent migration loading: MET | `migrations/bundled.ts` static SQL strings; no raw-file reads at runtime | `migrations-retry.test.ts`: SQL parity and separate process with temporary cwd | Production build passes; deployed artifact packaging not separately exercised. |
| 7 | Retry-capable run schema: MET | 002 replaces exception uniqueness with (exception,generation,attempt), max 3; predecessor unique; UI latest/history | `migrations-retry.test.ts`, PG cross-process retry/claim; retry E2E 3-attempt limit/reset | No automatic retries; completed/unverified runs ineligible. |
| 8 | Run identity/generation/state stored once: MET | 002 removes JSON keys and rejects duplicates; `store.ts` encode/decode column authority | Populated 001 upgrade tests and retry persistence tests | Add direct SQL constraint rejection regression for stronger evidence. |
| 9 | SQL filter columns and links: MET | 002 generated date/cents/status/type/invoice/reversal columns, note join tables and indexes | Populated upgrade verifies records/note links; financial invalid-data rollback | APP-03 query implementation is separate. Add direct SQL filter/update checks for stronger evidence; column presence alone is weaker than exercising predicates. |
| 10 | Populated local 001 upgrade without deletion: MET | immutable 001 + locked transactional 002; development instructions explicitly preserve directories | PGlite populated upgrade + invalid-data rollback; PG full dataset/results/review equality and replay | No requirement to delete directories. |

Baseline conclusion: the earlier 8 MET / 2 PARTIAL is defensible with the stated local meaning of MET. Challenge: the two PARTIAL rows are not *only* waiting for credentials—the future Neon checker itself lacks application-login verification and direct offline regression coverage. Rows 8/9 merit stronger SQL-boundary regression checks. None of these justify claiming a live result.

CI read November 5, 2026: #26 issue-link, postgres, verify succeeded at ca49fa2. #23 verify/postgres succeeded at cb00749; issue-link initially failed but a later run passed. #23 closes #24 only; overlapping adapter remains under review. Never modify either review branch. Coordinate integration before either merges.

## Follow-up behavior and actual verification

New slice: [APP-01B #27](https://github.com/JianTing-Li/spendwise/issues/27). Branch began at latest main in an isolated worktree; #26's immutable baseline is retained for a focused stacked review. Original checkout was clean and remains untouched. No pre-existing changes were discarded.

- Shared `src/server/db/compatibility.ts:21` runs populated 001 → 002, full baseline/injected record equality and independently calculated expected fixture summaries, three idempotent injection/stub claim/review/replay/reset cycles. `scripts/backend-demo.ts` is a reproducible in-memory demonstration with zero model requests.
- `tests/compatibility.test.ts:7` executes the shared scenario; line 13 rejects unsupported ledgers without changing them; line 24 checks SQL predicates for date/cents/status/invoice/type/reversal, generated cents update, and rejection of all four duplicated run metadata keys.
- `tests/pg-local.integration.ts:366` executes the identical shared procedure on real local PG and tests required app-grant preflight against an owner and existing read-only role. No roles/grants were created. This supplements the populated-results/reviews upgrade test at line 332 and independent-process concurrency tests at lines 134–176 and 292.
- `src/server/db/neon-check.ts:19` now opens configured reader/application logins for read-only preflight; `permissions.ts:29` checks actual required catalog grants. Isolated writes remain migration-owner-only. All three pools close; cleanup errors produce failure. No Neon invocation occurred.

Executed in this session on Node 24.21.0 / npm 11.19.0:

| Check | Result |
|---|---|
| Baseline `npm run check` | Passed before edits |
| Final `npm run check` | Typecheck + lint + 129 tests / 14 files + production build passed |
| Final cleanup/format adjustment | Typecheck and lint rerun passed afterward |
| Local PG17 `PG_TEST_ALLOW_LOCAL=1 PG_TEST_DATABASE=spendwise_app01_test PG_TEST_USER=elliotwatson npm run test:pg` | 13 passed, zero failed/skipped |
| `npm run test:e2e` | 1 passed: inject/inspect/review/reload/reset |
| `npm run test:e2e:retry` | 1 passed: retries/history/three-attempt cap/reset |
| `npm run eval:baseline` | Passed; four synthetic exceptions, zero model calls |
| Workflow-script Python unit tests | 9 passed |
| `node --import tsx scripts/backend-demo.ts` | Passed: 3 cycles, 4 exceptions/cycle, 0 model requests |
| `git diff --check` | Passed |

Initial PG socket and E2E loopback restrictions blocked tests; authorized local-access reruns passed. No server/database/user was provisioned. Existing temporary Chromium and installed dependencies were reused. Browser flows ran before the final checker-only changes; no UI was changed. Full check ran after the shared scenario/PG test additions. Raw local logs remain in the session work directory; do not confuse historical PR evidence with reruns.

Final criterion verdicts remain: **1 PARTIAL; 2–4 MET; 5 PARTIAL; 6–10 MET**. Rows 1/5 lack external Built+Verified+Visible+Explained completion. All rows have implementation and test references and the two external gaps are explicitly visible here. #4 must remain open. The strengthened test logic does not turn an unexecuted remote check into verification.

## Human prerequisites and future procedure

A human must supply an existing synthetic-only Neon target and three distinct preconfigured logins/grants, authorize remote connections and disposable schema creation/drop, and separately authorize migration of the existing app schema if needed. Private environment only: DATABASE_MODE=neon; DATABASE_URL (pooled app endpoint); DATABASE_READONLY_URL; DATABASE_MIGRATION_URL; DATABASE_MIGRATION_ROLE. After that authorization only, set NEON_CHECK_ALLOW_REMOTE=1 and run `npm run test:neon` from the reviewed revision. It performs runtime catalog/version/read-access preflight, isolated populated-001 upgrade, three fixture cycles and migration replay, then drops its schema/closes pools. Publish redacted results and revision only, unset opt-in, remove migration credentials from app runtime. No credentials belong in chat, command arguments or artifacts.

This procedure does not grant roles or exercise application writes as the app login. Actual login permissions, remote TLS/pooling, cleanup and results must be evidenced before changing external verdicts. Deployment/authentication and whole-server restart remain unverified, separately scoped gates. See development guide for exact permission and failure-cleanup requirements.
