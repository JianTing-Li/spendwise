# DEPLOY-01 — Prepare and verify free-tier deployment

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/14
Branch: `deploy-01`, from `origin/main` at `a806e06`. PR: https://github.com/JianTing-Li/spendwise/pull/46

Setup details are in `docs/development.md` under "Hosted deployment (Vercel + Neon)". No URLs, passwords or keys appear here.

## Setup (2026-11-09 to 2026-11-10)
- Neon project `spendwise` (free, AWS `us-east-1`, database `neondb`). Runtime logins `spendwise_app` and `spendwise_retrieval_reader` created in SQL; `neondb_owner` is the migration owner. Grants applied after `db:migrate`.
- Vercel project `spendwise` in team Calm Forge (Hobby): Git import of `main`, region `iad1`, Fluid Compute on, Node.js 24.x. Production URL https://spendwise-olive-theta.vercel.app.
- GitHub OAuth app "SpendWise" with the production callback. `SPENDWISE_ACCESS_GRANTS` lists Jian (`github:43770333`) and Elliot (`github:301371041`) with all five permissions.
- Twelve Production-only variables: six Config values, and the database URLs, auth secrets, API key and optional `ANTHROPIC_MODEL` as Vercel secrets. `DATABASE_MIGRATION_URL` stays in the git-ignored local `.env.neon.local`.

## Checks
- Local, on `deploy-01` (Node 24.18.0): `npm run check` passed — typecheck, lint, 238 tests in 24 files, build.
- `npm run db:migrate` (owner login): applied.
- `npm run test:neon` (authorized): passed — runtime-login preflight, isolated migration replay and three-cycle fixture check; zero model calls.
- Deployed function limits (Resources tab): `/api/demo` and `/api/demo/retry` at most 90 seconds, other functions 300 seconds; all `iad1`, Node.js 24.x.
- Signed out: `/` shows the sign-in page; `GET /api/demo` 401; `POST /api/demo` and `/api/demo/retry` 403. `/api/auth/providers` lists GitHub with the production callback.
- Browser bundle scan: no database passwords, Neon host, `sk-ant-` pattern or secret variable names in the five public scripts.
- Signed in, stub mode: load 200; Simulate created 4 exceptions and 4 runs, all `completed`, labelled "Stub · no AI call", 0/10 model requests; reload kept them; Reset cleared them and advanced the generation from 0 to 1, and a reload did not bring them back.
- Signed in, real mode: Simulate ran 4 real investigations, all `completed`, 6/8 retrievals and 3–4/10 model requests each (15 requests in all, estimated about $0.25, not confirmed against the Anthropic console). Every run is labelled Draft awaiting human review; explanation support shows supported, unverified or missing as validated. No runtime errors or warnings.

## Decisions
- Production scope only for every variable, so preview builds can't reach the database or API key.
- Vercel set to Node.js 24.x rather than moving the repository to 26.
- Sessions end one hour after sign-in by design (`src/server/authentication.ts`); sign in shortly before a demo.

## Problems found and fixed
- First hosted load returned 503 with no log. DEPLOY-02 (#41, PR #42) added safe logging; it showed `Invalid database configuration` (malformed URLs in Vercel).
- After the URLs were fixed, the log showed a minified class name. DEPLOY-03 (#43, PR #44) kept the driver code; it showed `28P01`, a rejected password. Resetting both runtime passwords in Neon and re-saving them in Vercel fixed it.
- Several Vercel saves and redeploys silently didn't happen because the inline Save sat below the fold or the identity prompt was dismissed. Recorded under "Operating notes" in `docs/development.md`.

## Not done
- Hosted failed, incomplete and retry states were not exercised on the live site. Locally, `npm run test:e2e:retry` covers retry history, the three-attempt limit and stale retries after reset (zero model calls); `tests/e2e/review.spec.ts` shows incomplete, cancelled and failed runs from mocked state; unit tests in `agent`, `store` and `investigation-integration` produce incomplete results. An invalid `ANTHROPIC_MODEL` produces a hosted `failed` run (`src/agent/loop.ts`); incomplete comes only from the deadline, budget, tool limit or invalid evidence, which configuration can't force.
- `npm run test:e2e` and `npm run test:pg` were not run locally for this branch.

## Next action
- Hosted state checks: decision recorded at https://github.com/JianTing-Li/spendwise/issues/14#issuecomment-6760278675.
- PRs #42 and #44 change Elliot's paths (`src/app/api/demo/route.ts`, `src/server/db/`); review history is on those PRs.
