# APP-01A — adapter, recovery and portable tests

Task specification/status: https://github.com/JianTing-Li/spendwise/issues/24
Parent requirements: https://github.com/JianTing-Li/spendwise/issues/4
Review/handoff: https://github.com/JianTing-Li/spendwise/pull/23
Session: Elliot Watson, November 5, 2026.

## Changes

Rebased the existing feature branch onto main `7c4306b`, preserving a backup at `backup/app01-before-approved-rebase`. Resolved the worklog-only conflict by preserving verification history and adopting main's issue/workflow guidance. The existing branch/PR is continued at Elliot's explicit instruction rather than opening a duplicate PR.

- Idle pool errors no longer permanently disable the adapter: pg-pool removes the dead idle client; the next explicit request acquires another. Active operations and uncertain commits are never automatically replayed.
- Internal safe errors distinguish DatabaseTimeout (55P03/57014), DatabaseConflict (class 40), DatabaseQueryError (other SQL errors), and DatabaseUnavailable (connection failure). Safe SQLSTATE values are retained; SQL/driver messages/data/credentials are not returned.
- Successful rollback retains a healthy client; broken clients and failed rollbacks are discarded. Connection failure during COMMIT reports outcomeUnknown=true. Swallowed SQL errors cannot commit partial work; transaction handles expire after completion.
- PGOPTIONS and connection-string startup/timeout overrides are rejected. An explicit inert startup-options value prevents environment mutations after pool construction from overriding timeouts. Unit tests inspect the installed pg client's effective options.
- Configurable local-only PostgreSQL test settings use PG_TEST_ALLOW_LOCAL/HOST/PORT/DATABASE/USER/PASSWORD and npm run test:pg. Database/user are explicit; database ends in _test; host is an allowlisted socket/loopback endpoint. Application DATABASE_URL is ignored. Unit tests cover opt-in/endpoint validation.
- Added the isolated PostgreSQL 17 service job to GitHub CI and documented local/CI reproduction in docs/development.md. CI's fixed password is disposable container configuration, not an application credential.
- Store's public methods, public/agent tool contracts, SQL migrations, financial rules, hosted access and PGlite demo behavior are unchanged.

## Verification

- Initial npm run check failed typecheck because Next augments NodeJS.ProcessEnv to require NODE_ENV. Corrected the test helper's environment argument to a readonly string/undefined map, matching its actual requirements.
- Final npm run check: 68 tests across six files, typecheck, lint, production build passed (exit 0).
- PGlite browser E2E initially failed because temporary Chromium files had been removed. Downloaded Chromium again; PLAYWRIGHT_BROWSERS_PATH=/private/tmp/spendwise-app01-browsers npm run test:e2e passed (1 test).
- npm run eval:baseline passed, four synthetic exceptions, zero model requests.
- python3 -m unittest discover -s .github/scripts -p 'test_*.py': 9 passed.
- Initial real PG attempt: 0/8 tests passed because the before hook could not find /tmp/.s.PGSQL.5432 (ENOENT). This was environment setup failure, not an observed application defect. No migration/schema operations ran. A ninth active-disconnect case was added subsequently.
- After Elliot started the existing PostgreSQL 17 service: PG_TEST_ALLOW_LOCAL=1 PG_TEST_HOST=/tmp PG_TEST_PORT=5432 PG_TEST_DATABASE=spendwise_app01_test PG_TEST_USER=elliotwatson npm run test:pg — 9 passed, 0 failed, 0 skipped, exit 0.
- The nine real tests cover transaction affinity/rollback; three idempotent injection cycles; exclusive claims; stale-result invalidation; durable idempotent reviews; explicit SQL failure; idle connection replacement plus fresh-pool recovery; lock/statement timeout classification and retained backend PID; active connection loss without replay or residual writes.
- Test schemas are unique and disposable within the existing named database; the database/cluster was not recreated, configured, restarted or deployed. Bootstrap remains sequential using unchanged 001; concurrent migration safety is not claimed.
- Diff reviewed for credentials/unrelated work; no provider-token/private-key/credential-URL matches. Restored Next-generated next-env.d.ts after E2E. Test money validation file is unchanged by this follow-up.

## Decisions / next action

The focused adapter issue and parent scope are defined in GitHub #24 and #4. PR #23 targets main and closes only #24. APP-01's versioned/bundled migrations, legacy upgrades, relational fields/note links, authoritative retry persistence, application modes/TLS and separate migration/application/read-only credentials remain outside this slice. The approved three-attempt/user-click-only retry policy is recorded in #4, not implemented here. No APP-03 work or Neon/model/provisioning operations performed.

GitHub CI results are read from PR #23's latest head. No merge or deployment authorized. Verify CI on the pushed head before requesting merge; keep #4 open.
