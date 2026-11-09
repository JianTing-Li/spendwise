# DEPLOY-03 — Keep the connection error code in the unavailable log

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/43
Branch: `deploy-03-connection-error-code`, from `origin/main` at `81664c2`. PR: PR_LINK

## Changes
- `DatabaseUnavailable` takes an optional `driverCode`. `PgDatabase` sets it when acquiring a connection fails and when a query fails with a connection-class code.
- `safeDriverCode` keeps only 2 to 40 uppercase letters, digits and underscores, such as `28P01`, `ECONNREFUSED` or a TLS code.
- `logDemoUnavailable` names the error by `error.name` and logs `driverCode`.

## Decisions
- `error.name` replaces `constructor.name`: the deployed log showed `errorClass: 'h'`, a minified class name.
- Classification and HTTP responses are unchanged; only what the error carries and what the log prints changed.

## Checks (Node 24.18.0; no API key or database URL in the environment)
- `npm run typecheck`: passed. `npm run lint`: passed. `npm test`: 238 passed in 24 files. `npm run build`: passed.
- `npm run test:e2e` and `npm run test:pg` were not run locally.

## Blockers and next action
- After DEPLOY-02 (#41), the hosted route fails while connecting, about 96ms after the request, and logs `errorClass: 'h'` with no code.
- Next: read the deployed log under DEPLOY-01 (#14) and fix the reported connection failure.
