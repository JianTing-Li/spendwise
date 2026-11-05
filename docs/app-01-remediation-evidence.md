# APP-01 remediation evidence index

Live requirements, acceptance verdicts and approvals belong in [issue #4](https://github.com/JianTing-Li/spendwise/issues/4) and the [#26](https://github.com/JianTing-Li/spendwise/pull/26) / [#28](https://github.com/JianTing-Li/spendwise/pull/28) review conversations. This document indexes implementation and reproducible verification; it does not record acceptance or review status.

| Requirement | Implementation | Verification |
|---|---|---|
| Pooled pg, versioned transactional migrations, retained PGlite | `PgDatabase.transaction` in `src/server/db/pg.ts`; `migrate` in `migrate.ts`; `getStore` in `local.ts` | `pg-adapter.test.ts`; local `pg-local.integration.ts` concurrent bootstrap and populated 001 upgrade |
| Parameters, bounded timeouts, safe integer money | `pgPoolOptions`; Store parameterized queries; `validateDataset`/`summarize`; generated cents constraints in 002 | `pg-adapter.test.ts`, `database-money.test.ts`, `financial.test.ts`; PG lock/statement timeout tests |
| Atomic injection/detection/claim/review/reset | `Store.inject`, `claim`, `finish`, `review`, `reset` | Independent-process PG lock waits, three cycles, one claim winner, review persistence, stale result rejection |
| Explicit failure, no local fallback, hosted disabled | `getStore`, `PgDatabase.transaction`, `localRequestAllowed` | `store-mode.test.ts`, `safety.test.ts`, `retry-route.test.ts`; PG active/idle failures |
| Local routine tests and separate remote checks | CI local/PGlite/fake pools and ephemeral PG17; `neon-check.ts` opt-in CLI | `compatibility.test.ts`, `review-regressions.test.ts`; shared scenario in local PG suite |
| Cwd/source-independent migration loading | Static `migrations/bundled.ts` | SQL parity and separate-process temporary-cwd tests in `migrations-retry.test.ts` |
| Retry-capable run schema | 002 `run_attempt` key and predecessor uniqueness; `Store.retry` | Retry unit/PG race tests and retry E2E |
| Column-authoritative run metadata | 002 `run_payload_metadata`; Store encode/decode | Successful SQL insert positive control then SQLSTATE 23514 / named constraint checks for all four forbidden keys |
| Relational filter columns and links | 002 generated columns, note tables, indexes | SQL date/cents/status/invoice/type/reversal predicates and generated updates; note-link preservation checks |
| Populated local 001 upgrade | Immutable 001; locked transactional 002; `seedLegacy001` verification helper | Full PG record/result/review equality, invalid-data rollback, shared legacy scenario |

The separate backend demo is `node --import tsx scripts/backend-demo.ts`. The empty-schema guard and legacy seed live under `scripts/db-verification/`; they are verification-only code. Runtime request handlers do not import them.

The future remote procedure and human prerequisites are in [development](development.md#future-authorized-neon-procedure-not-executed). Local simulations cannot establish actual Neon negotiation, configured least-privilege login behavior, or deployed packaging. A catalog check under a test owner is only a syntax/control check, not proof of application-role grants.

## Integration choices requiring human review

The new remediation branch is a candidate based on main after #23. It carries #26 and #28 with explicit cherry-pick provenance so the combined behavior can be reviewed and tested without modifying either original PR or changing #28's base. The existing acceptance audit is preserved byte-for-byte from #28 at 51574d8; it remains a historical audit, not a claim about this revision. The new review/demo/check evidence is supplied separately.

The candidates are alternative landing paths, not three additive implementations:

1. If reviewers choose the consolidated candidate, only the new candidate's combined change should eventually land. #26 and #28 must not also be merged independently. Any later supersession/closure of those PRs needs separate human authorization; no such action is performed here. #4 remains referenced, not closed.
2. If reviewers choose the dependency-first path, integrate #26 against main and then #28 once, under separate branch-change/merge authorization. Do not merge this carried-stack candidate afterward. Create a fresh successor from the resulting main and apply only the remediation delta (guard/reader/constraint/cleanup/location/docs) with the source-stack commits omitted. Re-run checks and compare the diff against both landed PRs before review. Because force-push/reviewed-branch edits are prohibited here, use a new successor branch/PR rather than rewriting any existing reviewed branch without new authorization.

Before either path lands: refresh main and source heads, verify only the intended remediation/required dependency diff remains, preserve APP-01A and original contracts/fixtures/001, and run exact-head CI. This document does not authorize merging, retargeting, closing or rewriting any PR.
