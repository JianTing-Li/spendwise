# APP-04 — Retrieval and access follow-ups

Owner: Jian Ting (assignee moved from Elliot on 2026-11-09, with Elliot's agreement as relayed by Jian). Issue: https://github.com/JianTing-Li/spendwise/issues/36
Branch: `app-04-retrieval-follow-ups`, from `origin/main` at `5e10d8f`.

## Criteria already met by INT-01 (PR #37)
- Reader role at runtime: `Store.initialize` calls `initializeLocalReader`. Neon steps are in `src/server/retrieval/README.md`. This branch adds the missing fresh-database test.
- `FOR SHARE` on the generation check. This branch adds the missing automated concurrency test; only a manual demo covered it.
- `invalid_review` returns 409, covered by `tests/investigation-api.test.ts`.

## Changes
- `databaseRetrieval` logs the error class and SQLSTATE of an unavailable failure, and nothing else.
- `projection` takes its parameter position, replacing `replaceAll("$6", "$3")`.
- Removed `permitsResource` and its assertions; it had no production caller.
- `anthropicModelClient` in `src/agent/client.ts` is the one SDK client setup, used by `realInvestigatorFromEnv` and the durable runtime. Still loaded lazily, with `maxRetries: 0`.
- `INVESTIGATION_LIMITS` in `src/contracts/index.ts` is the one definition of 8 retrievals, 10 requests and 60 seconds, used by the budget, loop, contract schema, store and runtime. Values unchanged.
- Corrected the stale comment on `realInvestigator`.
- `npm run test:pg` now passes `--conditions=react-server`, because the suite imports the `server-only` retrieval module.

## Decisions
- The concurrency test uses real PostgreSQL for the application locks and a gated fake reader. It proves the lock behaviour without provisioning a role, which the suite must not do.
- `INVESTIGATION_LIMITS` lives in contracts because the schema needs it and contracts should not import from `src/investigation/`.

## Checks (Node 24.18.0, npm 11.16.0; no API key or database URL in the environment)
- `npm run check`: passed (typecheck, lint, 230 tests in 23 files, build).
- `npm run test:e2e`: 1 passed. `npm run test:e2e:retry`: 1 passed. `npm run eval:baseline`: exit 0.
- Existing budget and durable-run tests are unmodified.

## Not done
- `npm run test:pg`, including the new concurrency test, has not been run: PostgreSQL is not installed here. It type-checks; CI is its first real run.
- The prompt's "at most 8 retrievals" and the evaluators' own `RUN_MS` are still literals. The issue does not list them, and the prompt should not change before the held-out run.

## Next action
Push, open the PR, and confirm `test:pg` in CI. Run the AI review before approval.
