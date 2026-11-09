# DEPLOY-02 — Log why the demo route is unavailable

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/41
Branch: `deploy-02-demo-error-log`, from `origin/main` at `32200af`. PR: https://github.com/JianTing-Li/spendwise/pull/42

## Changes
- `/api/demo` logs an unavailable failure through `logDemoUnavailable`, in both `GET` and `POST`. The HTTP response is unchanged.
- `src/server/db/unavailable-log.ts` logs the error class, a well-formed SQLSTATE, and a reason only from a fixed list of startup validation messages.

## Decisions
- The reason list is an allowlist, so an unexpected message can't reach the logs. Startup checks throw plain `Error`s, so the class alone can't tell them apart.

## Checks (Node 24.18.0; no API key or database URL in the environment)
- `npm run typecheck`: passed. `npm run lint`: passed. `npm test`: 234 passed in 24 files.
- `npm run test:e2e` and `npm run test:pg` were not run locally.

## Blockers and next action
- Found during DEPLOY-01 (#14): the hosted route returns 503 to a signed-in user. It responds as fast as a route that never reaches the database (47ms vs 52ms median), so startup validation is the likely failure.
- Next: read the deployed log under #14 and correct what it reports.
