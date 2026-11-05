# APP-01 — local WIP preparation

Owner: Elliot Watson (0x1Elliot). Task specification: [APP-01 — GitHub Issue #4](https://github.com/JianTing-Li/spendwise/issues/4).

Rebase note (November 5): preserved APP-01 verification history while adopting the current main issue/workflow guidance. Historical status notes below are not the task-status source; GitHub Issue #4 is authoritative.

## Current status — Draft PR preparation, November 4, 2026

This section supersedes historical blocker/status notes below. SETUP-01 (#2) is complete; this branch was synchronized by Elliot to merged main at `abcdd92` and the APP-01 work restored. Owner: Elliot Watson (0x1Elliot). APP-01 remains incomplete and this is adapter-only WIP for Jian's review.

Current candidate: nine files covering the internal database interface, pooled pg adapter, Store type adaptation, adapter/money/real PostgreSQL tests and helpers, and this worklog. Reviewed the complete candidate; no unrelated application, shared contract, SQL migration, manifest/configuration or generated-file changes. Credential-pattern scan across all nine files found no matches for provider tokens, private keys, credential-bearing URLs or literal secrets. The explicit local test database/user names are test configuration, not credentials. Pattern scanning is not a proof that every possible secret format is absent.

Reverified on the current abcdd92 checkout during Draft PR preparation:
- `npm run check`: passed typecheck, lint, 45 tests across five files and production build, exit 0.
- `node --import tsx --test tests/pg-local.integration.ts`: 7 passed, 0 failed/skipped, exit 0, using only the authorized local PostgreSQL database and disposable test schemas.
- Browser regression was not rerun during this preparation; its earlier passing run is recorded below.

Proposed commit: `Add APP-01 PostgreSQL adapter and local integration coverage`. Proposed Draft PR: `APP-01 WIP: PostgreSQL adapter and concurrency tests`; base `main`, head `codex/elliot-app-01-wip`, `Refs #4`. No commit, push, remote PR, merge or deployment performed at this preparation stage.

Pending architecture, not implemented: preserve immutable 001; atomic v1-to-v2 maintenance upgrade under a database migration lock; validate legacy records and adopt the v1 ledger explicitly; bundle a generated SQL/checksum registry for runtime use without cwd/raw source-file dependencies; column-authoritative retryable runs; relational fields and safe bigint decoding for APP-03; explicit database modes, verified TLS and separate migration/runtime credentials. PostgreSQL runtime startup would verify schema version; an explicit migration command would perform upgrades. PGlite would retain local initialization. Jian's agreement is needed on shared SQL/configuration, retry semantics/latest-attempt selection, relational fields, migration packaging/upgrade strategy and credential/TLS boundaries before implementation.

Remaining APP-01 work: versioned migrations and non-destructive legacy upgrades; concurrent bootstrap; authoritative retry/run schema; relational query fields; application configuration/mode/TLS integration; separately authorized Neon compatibility checks. No APP-03 retrieval implementation started. Whole-server restart remains untested; idle-backend termination/fresh-pool recovery is covered. No APP-01 completion or merge readiness claim.

Session owner: Elliot Watson (0x1Elliot), ownership formally accepted in this Codex chat on November 4, 2026. No remote issue or assignment update performed.
Task: https://github.com/JianTing-Li/spendwise/issues/4
Dependency: #2 remains open and PR #1 unmerged.
Branch: codex/elliot-app-01-wip, based on setup commit 5ffc73cd51bb7ef18ca07f71d3b185d34c9cab4d.

## Changes
Isolated checkout prepared. Added `database.ts` internal transaction boundary and `pg.ts` pooled adapter with configurable initial local test defaults. Store now accepts the structural database interface; PGlite conforms directly. Added adapter control-flow and unsafe JSONB money tests. No SQL, contract, manifest, configuration, or remote changes.
Read issue #4 and #2/comments, approved November 3 PRD, working agreement, setup decision, development guidance, contracts, database code and persistence tests.

## Verification
Node 24.21.0 and npm 11.19.0 meet engine ranges; differ from exact setup recommendations.
Offline install failed because zod was not cached. Locked dependency installation succeeded with scripts disabled (`npm ci --ignore-scripts --no-audit --no-fund --cache /private/tmp/spendwise-app01-npm-cache`).
`npm run check` passed after implementation: typecheck, lint, 44 tests across five files, production build. Targeted adapter/store run passed 22 tests before adding two money tests. `git diff --check` passed.
Browser test first failed on sandbox loopback binding, then missing Chromium. Downloaded Chromium to `/private/tmp/spendwise-app01-browsers`; `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/spendwise-app01-browsers npm run test:e2e` passed (one test). Test-generated next-env.d.ts changes restored to the setup version.
No PostgreSQL server/client or Docker found in PATH. Genuine cross-process database tests need a local PostgreSQL test server. PGlite and fake pool tests cannot prove that behavior.

## Approved adapter design / blocked migration design
Preserve Store public methods, contracts, JSONB schema, calculations, PGlite and hosted fail-closed access.
Add an internal database interface and PGlite/pooled-pg adapters. Every transaction pins BEGIN, queries and COMMIT/ROLLBACK to one client, releases it on every path, and discards broken connections. No automatic transaction retries or fallback.
Preserve demo_state row locks across injection, claims, review, reset and finish. Serialize startup/seeding too.
Proposed pg limits: pool 4; connection 5s; statement 5s; lock 3s; idle-in-transaction 5s. Connection-string options must not override these bounds or weaken TLS validation.
Keep JSONB cents validated through existing safe-integer contracts/domain checks. Never globally coerce bigint into Number.
Migration proposal: leave 001 immutable; database-lock startup; validate ordered versions; apply each migration and version marker transactionally. Support fresh and existing version-1 databases. Shared migration/configuration/interface work waits for Jian's coordination.

## Planned checks
Adapter: parameter forwarding, one-client transaction affinity, rollback/release/disposal, acquisition/query/commit/rollback errors, bounded timeouts, no fallback.
Store: fixture totals, three cycles, concurrent duplicate injection/claims/reviews, reset versus stale finish, restart persistence, unsafe money rejection.
Migrations after coordination: fresh/v1 startup, repeat/concurrent startup, failure rollback, unknown/missing versions.
Real local PostgreSQL: independent pools/processes contend on startup/injection/claims/review/reset. Fake pools validate adapter control flow only.
Run npm run check and local stub E2E when available. No Neon/model requests.

## Blockers and next action
Elliot approved adapter-only implementation and configurable initial test defaults in this chat. Jian has not agreed to shared migrations/configuration/interface integration; those changes remain blocked. No message sent on Elliot's behalf.
The pg adapter is deliberately not wired into getStore or routes. Existing startup still runs migration 001; do not claim concurrent pg startup safety. TLS/credential policy and application mode wiring remain configuration coordination work. Pool idle errors fail the adapter explicitly; recreate it after a failure rather than silently reconnecting to another store. No production timeout/capacity validation claimed.
Keep SETUP-01 unresolved and all work WIP. Local PostgreSQL test infrastructure unavailable.
No merge, push, PR, provisioning, paid execution or deployment authorized.

## Follow-up — PostgreSQL concurrency and recovery (November 4, 2026)

Requested scope: real isolated PostgreSQL concurrency, idle-pool failure/recovery, regression checks. Preserved the user's independently verified `tests/database-money.test.ts` without edits.

Availability check: Python `shutil.which` found no postgres, initdb, pg_ctl, psql, docker or podman. No server binaries found under `/opt/homebrew/opt/postgresql*`, `/opt/homebrew/Cellar/postgresql*`, `/usr/local/opt/postgresql*`, `/Applications/Postgres.app/Contents/Versions/*`, or `/Library/PostgreSQL/*`. No `/private/tmp/.s.PGSQL.*` sockets found. Homebrew exists, but no package/service installed or provisioned. Real PostgreSQL testing is blocked by the absent local test server. No live database or credential connection attempted.

Changed only `tests/pg-adapter.test.ts` and this worklog in this follow-up. Added a deterministic fake-pool test establishing successful use, emitting an idle-pool error, verifying repeated rejection before checkout/callback, closing the failed adapter, and explicitly creating/using a fresh adapter. It also verifies the old instance stays unavailable and cleanup removes its error listener. No runtime implementation changes needed. This proves control flow, not real driver/server disconnect recovery.

Checks actually executed:
- `npm test -- tests/pg-adapter.test.ts tests/store.test.ts tests/financial.test.ts tests/safety.test.ts`: passed, 43 tests across four files.
- `npm run check`: 45 tests across five files passed; typecheck/lint passed. Production build passed (exit 0). The two unchanged money tests were included by this standard full check.
- No new browser test run; no PGlite demo or route changes. Prior browser result above remains historical.

Prepared real-database test protocol for when an isolated local server is available:
- Initialize a dedicated temporary cluster/database containing synthetic fixtures only, bind only loopback/private socket, use a unique data directory/port, and stop/remove only that test-owned cluster in cleanup. Do not discover or reuse unrelated local databases.
- Bootstrap Store once sequentially using unchanged 001; create independent pools and child-process workers against that database. Verify distinct backend PIDs/process IDs. Keep concurrent migration/startup testing separate and blocked pending Jian's approval.
- Coordinate workers with IPC ready/start barriers, not timing sleeps. Bound all waits; capture child failures, close pools, and terminate test-owned workers on failure.
- Injection: release multiple workers together; exactly one reports changed=true, others false; assert seven payments, four distinct exceptions/runs, and expected fixture summaries from independent readers.
- Claim: race workers for the same pending run; exactly one receives input and others null; persisted state is running, with no duplicate run rows.
- Reset invalidation: worker A claims and pauses, worker B commits reset and reinjection, then A tries finish; finish must return false, baseline/reset state and subsequent generation must remain intact. Also exercise finish holding the generation lock while reset waits, using explicit lock barriers.
- Review: finish a valid stub run, race review calls across workers; exactly one changed=true, timestamp remains stable on retries; close all adapters, create fresh independent readers and verify timestamp persists.
- Recovery: capture the backend PID after a successful transaction; from a test-owned control connection terminate that idle backend; wait for the actual pool error event, assert the old adapter repeatedly fails closed, explicitly construct a fresh adapter/pool, verify a query and persisted state succeed, and confirm the old instance remains unavailable.
- All real-server expectations above remain UNEXECUTED. No claim of PostgreSQL locking, server timeout, concurrency, or live recovery verification.

Next prerequisite: provide/agree an isolated local PostgreSQL installation or test server. No consequential architecture or runtime behavior changed in this follow-up; no additional implementation approval required for the added test. Installing test infrastructure or changing shared migrations/configuration remains a separate decision. SETUP-01 remains unresolved; no remote writes, Neon, paid calls, deployment or issue switch.

## Real PostgreSQL follow-up — November 4, 2026

The user supplied PostgreSQL 17 and authorized only `/tmp:5432`, database `spendwise_app01_test`, user `elliotwatson`. Identity readback confirmed PostgreSQL 17.11 (Homebrew), server version 170011. Initial sandbox connection failed with socket permission denial; the authorized elevated run connected successfully. No other database, Neon, model service, or credentials used.

### Changes and execution boundaries

Added `tests/pg-local.integration.ts`, `tests/helpers/pg-local.ts`, and `tests/helpers/pg-local-worker.ts`. Integration tests are explicitly opt-in via `node --import tsx --test tests/pg-local.integration.ts`; their filenames are excluded from the routine Vitest test glob. No package scripts or shared configuration changed. Test connections hard-code the authorized socket/database/user and verify database identity/version. Each run creates a uniquely named disposable schema inside that database. A test-only wrapper sets the transaction-local search path on the pinned pg connection. Store initializes once sequentially with unchanged 001, then independent pools/processes use the initialized schema. This does not claim concurrent initialization/migration safety.

No runtime implementation, shared migration, configuration, contract, fixture, or money-test changes made. Restored Next-generated next-env.d.ts changes after E2E. All prior uncommitted work preserved on `codex/elliot-app-01-wip`.

### Actual results

- First integration run: 7 tests, 6 passed, 1 failed. Injection summary assertion compared different vendor array orders; values matched. Corrected the test to compare sorted vendor IDs, without changing financial expectations or application code.
- Final `node --import tsx --test tests/pg-local.integration.ts`: **7 passed, 0 failed, 0 skipped**.
  1. Same backend PID throughout a transaction; SQL failure and application failure both roll back writes, verified from an independent pool.
  2. Two independent worker processes/backend PIDs contend on the real generation row lock; exactly one injection changes state in each of three cycles. Seven payments, four exceptions/runs and fixture totals confirmed.
  3. Two independent processes contend on one pending run; exactly one claim succeeds.
  4. One process claims work, another resets/reinjects, then old finish returns false. Reset baseline and new-generation pending runs remain intact.
  5. Concurrent cross-process reviews produce one changed=true; timestamp persists through independent pools and a newly spawned reader process.
  6. A failed SQL operation rejects with DatabaseUnavailable; subsequent successful identity read still reports the authorized PostgreSQL database, with no local fallback.
  7. A control connection terminates only a test-owned idle backend, selected by PID/database/user/unique application name. The real pool error event is observed. The old adapter repeatedly rejects before invoking work; a fresh pool gets a different backend PID and reads persisted injected state. The old adapter stays unavailable.
- `npm run check`: **45 passed across 5 files**, typecheck/lint/production build passed, exit 0. This routine suite stays local PGlite/fake-pool; the 7 real PostgreSQL tests run separately.
- `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/spendwise-app01-browsers npm run test:e2e`: **1 passed**, exit 0. Preserved PGlite/stub injection, source inspection, review/reload persistence, reset and denied unauthorized mutation.
- Post-run database cleanup verification: **0 leftover app01_test_* schemas, 0 test connections**. No installed service stopped/restarted. `git diff --check` passed.

### Remaining boundaries / APP-01 acceptance

Real PostgreSQL runtime transaction, process concurrency, review persistence and explicit fresh-pool recovery now have passing evidence. Backend termination is NOT a PostgreSQL service restart. Whole-server restart remains unexecuted because the installed instance may serve databases outside the authorized isolated database; stopping it would exceed the database-only scope. No service configuration or data-directory changes made.

APP-01 is **not fully satisfied**. Versioned transactional migration runner, concurrent migration/bootstrap safety, application mode/configuration/TLS integration and any associated shared interface changes still await Jian's agreement. Neon compatibility/live checks remain separately authorized work and were not attempted. Hosted fail-closed behavior is unchanged and covered by existing safety regressions. SETUP-01 remains an unresolved dependency in this WIP; no merge readiness claimed.

No new consequential architecture change or implementation approval is required for these test-only additions. Next action: coordinate the blocked migration/configuration boundaries with Jian; only then implement the remaining APP-01 scope. No push, PR, merge, deployment, service provisioning or other issue work performed.

## Adapter/testing split handoff — November 5

Adapter review fixes and current verification are recorded in [APP-01A](APP-01A.md), [Issue #24](https://github.com/JianTing-Li/spendwise/issues/24) and [PR #23](https://github.com/JianTing-Li/spendwise/pull/23). The parent migration/schema/retry/configuration specification and coordinated policy live in [Issue #4](https://github.com/JianTing-Li/spendwise/issues/4). Earlier descriptions of permanent adapter shutdown and uncoordinated design are historical; the follow-up log records the actual changes and tests. This split does not implement migration 002 or alter public tool contracts.


---

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

Review: [draft PR #28](https://github.com/JianTing-Li/spendwise/pull/28). User subsequently authorized focused follow-up [#27](https://github.com/JianTing-Li/spendwise/issues/27) and a stacked PR against unchanged #26. See [APP-01B log](APP-01B.md) and [acceptance audit](../../docs/app-01-acceptance-audit.md) for actual follow-up checks. #4 external gates remain separate.
