# Developer setup

Requires Node 24.18.0 and npm 11.16.0. Use `nvm use`, then `npm ci`.
Copy `.env.example` to `.env.local` only if it does not already exist; never overwrite existing credentials. The example has placeholders, and local stub mode needs no secrets. `.env.local` is ignored; `.env.example` is intentionally tracked.

## Run and check
```sh
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run eval:baseline
```

Development binds to `127.0.0.1:3000`. E2E uses port 3100 and a separate `.data/e2e` directory. Stop any process using that test database before running E2E. `npm start` serves a production build locally. Hosted requests fail closed. `next-env.d.ts` is generated and ignored, so on a fresh clone run `npm run typecheck` or `npm run dev` before using `tsc` or an editor's TypeScript checks.

## Local storage
PGlite stores records in `.data/spendwise` by default; override with `PGLITE_DATA_DIR`. One application process may own a database directory at a time. Tests create separate memory/temp databases. Do not run CLI migrations while the server has the database open.

Startup applies bundled, versioned migrations under a transaction lock and seeds only an empty company. Immutable 001 upgrades through 002 and 003 in place; **do not delete existing data directories**. Migration strings are statically bundled in `src/server/db/migrations/bundled.ts`; parity tests compare them with the SQL review copies, and a separate-process test starts from another working directory. Update the bundle when adding a new migration, never an applied migration.

002 adds typed/generated relational filter columns (vendor category, invoice/payment/note dates, safe integer cents, currency, payment status/type, invoice/reversal links), indexes and note link tables. Generated columns stay synchronized with validated JSON record payloads. Run identity, exception, generation and status are authoritative columns and forbidden in run payload JSON. Existing records, findings and review timestamps survive the upgrade. Invalid legacy data aborts the entire upgrade for investigation; no deletion or automatic repair occurs.

003 preserves existing Roast records/IDs and adds a generated `vendors.company_id` from server-owned ID prefixes (`hubspot:`, `gxo:`, otherwise Roast), an ownership index and independent demo-state rows (1 Roast, 2 HubSpot, 3 GXO). The new profiles use invented USD records and vendors. Their internal IDs (`hubspot`, `gxo`) are storage keys only; the UI shows the fictional names Larkspur Software and Ironbridge Logistics, and page links use the slugs `larkspur` and `ironbridge` (old `?company=hubspot|gxo` links still work). The original Roast fixtures and evaluator IDs remain exact.

Company selection only reads: `/api/demo` without `company` retains Roast behavior; `?company=hubspot` and `?company=gxo` select the other profiles for GET and authorized POST/retry. Duplicate or unknown selectors return 400. Run ownership and retrieval capabilities are also company-checked, including equal generation numbers. Existing grants remain action/run scoped; selection grants no new permission. A never-initialized profile exposes an immutable baseline fixture view without writing on GET; its first authorized injection/reset persists it. Each company’s records, findings, review timestamps, retry history and reset generation remain independent, but are shared between visitors viewing that same demo. Switching is disabled during an active operation to preserve request-owned execution.

**Hosted release prerequisite:** before running this application version against PostgreSQL/Neon, a separately authorized operator must apply migration 003 through the existing migration-owner CLI, with the app stopped as described below. Runtime stays DML-only and fails closed on an older version. No hosted migration, role/permission change or deployment is performed by this feature PR. Migration 003 adds no tables or new grants; existing table-level grants cover its generated column and state rows. Preserve the existing database and never delete it to upgrade.

Injection, reset, run claiming, and review use transactions. A durable generation and row lock per company protect reset/result races. State reads derive expired pending/running runs as incomplete without writes or row locks; a retry mutation materializes expiry. Retries are explicit user actions: at most three attempts per exception/generation, only after failed/incomplete/cancelled attempts. A predecessor ID makes repeat clicks idempotent. Completed attempts cannot retry, including unverified findings. Each attempt gets fresh 8 lookup / 10 model request / 60 second limits; reset clears only the selected company’s history and starts its new generation. The dashboard shows the latest attempt and expandable history. Completed stub runs have **unverified** explanation support. Review records a human acknowledgment, not financial approval or evidence verification.

## Access and environment
Local development is a trusted, loopback-only single-user mode. Requests require the expected host; mutations additionally require the same origin, JSON, and a custom header. This is not deployed identity/authentication. Never expose the local server through a tunnel or bind it to a public interface. `VERCEL`, `DATABASE_MODE=neon`, or a configured `AUTH_URL` disables the local flow. Hosted access uses Auth.js/GitHub OAuth and explicit server-owned grants. See [APP-02 access design and operator setup](../worklog/elliot/APP-02.md). Never supply credentials in chat.

- `INVESTIGATOR_MODE=stub`: default; never calls an external model.
- `INVESTIGATOR_MODE=real`: official SDK loop through scoped database retrieval; server-side credentials are required for live calls. Missing configuration produces failed/`unavailable`; no fallback. Use the [offline INT-01 demo](int-01-verification.md) for fake-client verification without credentials.
- `DATABASE_MODE=local`: default, single-process PGlite, migrations at startup.
- `DATABASE_MODE=postgres`: explicit loopback-only PostgreSQL development, pooled `pg`; no fallback.
- `DATABASE_MODE=neon`: pooled Neon application URL, verified TLS (`rejectUnauthorized: true`); HTTP routes, including retry, require configured hosted authentication and application grants. All URLs must identify the same endpoint/database. URL SSL/startup/timeout overrides and PGOPTIONS are rejected.
- PostgreSQL/Neon require separate application and read-only URLs plus `DATABASE_MIGRATION_ROLE` (the owner role name). Runtime verifies retrieval cannot write/own tables/create schema objects and application cannot own tables/create schema objects. Failure is explicit. Default limits are pool 4, connection/statement 5s, lock 3s, idle transaction 5s; these are initial test defaults, not production sizing.
- `DATABASE_MIGRATION_URL` is **CLI-only**, using the distinct schema owner login. Never put its password in the application runtime. After a human supplies an existing synthetic-only database and logins, load the private CLI environment and run `npm run db:migrate`; application startup checks version 003 and never runs DDL through the app login. No credentials are printed by these commands.
- Human database setup must give only the migration owner DDL/ownership. Revoke schema CREATE from PUBLIC and both runtime logins; grant schema USAGE. Grant application SELECT on schema_migrations and SELECT/INSERT/UPDATE/DELETE on demo_state, vendors, invoices, payments, vendor_notes, note_payments, note_invoices, exceptions, investigation_runs. Grant reader SELECT only on vendors, invoices, payments, vendor_notes, note_payments, note_invoices. Neither runtime role may inherit migration/owner or write roles. These grants/roles are a human prerequisite, not executed by migrations or tests.
- SQL-scoped retrieval uses APP-03 capabilities. INT-01 retains the restricted reader pool and wraps the existing real loop; neither raw SQL nor database clients/credentials enter the model input. Local PGlite initialization creates/verifies its fixed NOLOGIN reader role and evidence-only grants. PostgreSQL/Neon roles remain operator provisioned.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DATABASE_URL`, `DATABASE_READONLY_URL`: server-only settings. Never use `NEXT_PUBLIC_` for these.

Enter future credentials locally or through hosting secret settings, never chat or source files. Git ignores all `.env*` except `.env.example`, key files, local DBs, and generated reports. Check staged files before every commit; ignore rules alone are not a secret scanner.

## Integration boundaries
`Investigator` receives an exception, generation, acceptance time, deadline and cancellation signal. Retrieval is scoped by application-owned records. UI and agent consume the same contracts. The real loop (`createRealInvestigator` in `src/agent/loop.ts`, `realInvestigatorFromEnv` in `src/agent/client.ts`) charges every model request and attempted retrieval to `Budget`, sets SDK `maxRetries: 0`, and stops 10 seconds before the run deadline to leave time for validation and persistence. The INV-08 limits are defined once as `INVESTIGATION_LIMITS` in `src/contracts/index.ts`. `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`. The application selects the loop in `src/server/investigation/runtime.ts`, which builds its SDK client with the same `anthropicModelClient` factory; the standalone `realInvestigator` export remains an unavailable boundary when no client is configured. Durable counters reserve attempts before dispatch, including failed/invalid tool batches; a killed batch may conservatively overcount. Validation reuses full scoped responses and charges any additional database retrievals against the same eight-execution budget. Four runs execute concurrently with their original acceptance deadlines.

Evidence validation (`src/agent/validation.ts`) checks existence and scope, strips self-asserted support, flags human-only conclusions and unknown amounts, and keeps `Explained` only when the exception's claim category is objectively supported by the records. A completed run means the investigation finished with valid references, not that it was verified; see [decision 002](decisions/002-evidence-validation.md). Ground truth stays in `evals/ground-truth/`, outside all runtime imports.

## Hosted deployment (Vercel + Neon)
Free tiers only, synthetic data only. Setup and verification evidence are in DEPLOY-01 (#14) and `worklog/jian/DEPLOY-01.md`; demo validation in DEMO-01 (#15).

- **Vercel:** team Calm Forge (Hobby), project `spendwise`, Git import of `main` (each merge deploys to Production). Next.js preset with the repository's own `npm run build`. Function region `iad1`, Fluid Compute on, Node.js 24.x to match `.nvmrc` (the project defaulted to 26.x; set it under Build and Deployment).
- **Neon:** project `spendwise`, AWS `us-east-1`, database `neondb`. The function region matches the database region.
- **Duration:** the demo routes request `maxDuration = 90`. The deployed functions show `/api/demo` and `/api/demo/retry` at a 90-second maximum (other functions 300 seconds; deployment Resources tab, 2026-11-10), leaving 30 seconds after the deadline for validation and persistence. The application keeps its own **60-second total** investigation deadline. PGlite is local-only and is never a hosted fallback.

### Database logins
| Login | Used by | Where its URL lives |
| --- | --- | --- |
| `neondb_owner` (Neon's default owner) | `npm run db:migrate` and `npm run test:neon` | Private CLI file only, as `DATABASE_MIGRATION_URL`; never in Vercel |
| `spendwise_app` | Application runtime | Vercel `DATABASE_URL` (pooled host) |
| `spendwise_retrieval_reader` | Scoped retrieval | Vercel `DATABASE_READONLY_URL` (pooled host) |

Create the runtime logins in SQL so they don't join `neon_superuser`, then run the migrations, then grant table access (the tables must exist first):

```sql
-- Before migrating; set each password privately.
CREATE ROLE spendwise_app LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE spendwise_retrieval_reader LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE neondb FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO spendwise_app, spendwise_retrieval_reader;
-- After npm run db:migrate.
GRANT SELECT ON schema_migrations TO spendwise_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON demo_state, vendors, invoices, payments, vendor_notes, note_payments, note_invoices, exceptions, investigation_runs TO spendwise_app;
GRANT SELECT ON vendors, invoices, payments, vendor_notes, note_payments, note_invoices TO spendwise_retrieval_reader;
```

Neon can't display passwords set in SQL; to replace one, run `ALTER ROLE ... PASSWORD` as the owner or use **Reset password** in Neon's Connect dialog, then update every place that URL is stored.

### Vercel environment variables (Production scope only)
- Config: `DATABASE_MODE=neon`, `DATABASE_MIGRATION_ROLE=neondb_owner`, `INVESTIGATOR_MODE` (`stub` or `real`), `AUTH_URL` (the production origin, no trailing slash), `AUTH_GITHUB_ID`, `SPENDWISE_ACCESS_GRANTS`, and optionally `SPENDWISE_PUBLIC_READ` (below).
- Secret: `DATABASE_URL`, `DATABASE_READONLY_URL`, `AUTH_SECRET`, `AUTH_GITHUB_SECRET`, `ANTHROPIC_API_KEY`. `ANTHROPIC_MODEL` is optional.
- Database URLs must end at `/neondb`: the app rejects Neon's `?sslmode=...` suffix and enforces verified TLS itself.
- GitHub OAuth app callback: `<AUTH_URL>/api/auth/callback/github`. Sessions last at most one hour from sign-in, so sign in shortly before a demo.

### Public read-only viewing
`SPENDWISE_PUBLIC_READ=1` (server-only, Config type, off by default) lets signed-out visitors load the dashboard and `GET /api/demo` with only the `read` permission. See [decision 005](decisions/005-public-read-only.md).

- Only the exact value `1` turns it on. Unset, `0`, `true` or a typo keeps sign-in required.
- It needs fully valid hosted authentication (`AUTH_*` and `SPENDWISE_ACCESS_GRANTS`); otherwise every request still returns 401.
- Load October payments, Reset, Try again and Mark reviewed still need a signed-in, granted GitHub account. Signed-out POSTs return 401. Cross-site requests return 403, except a top-level link to the dashboard page. Visitors see a short read-only notice with a sign-in button and disabled buttons. When a signed-in session ends, the next 401 switches an open dashboard to that view.
- A signed-in account without a grant sees the same read-only dashboard, with a note that it is not authorized to run investigations; its POSTs return 403.
- Visitors see whatever state the last signed-in user left, including real-mode findings, and each page load or poll reads the database. Reset before sharing the link if the state should be the baseline.

### Running the live demo
1. Sign in with a GitHub account listed in `SPENDWISE_ACCESS_GRANTS`, shortly before the demo (sessions last one hour).
2. Confirm the vendor list says **No flags yet**. If it shows flags, select **Reset demo** first. After deploying UI-05/DATA-02, Reset each company once. Existing databases show the old three-vendor baseline until then; loading payments without a Reset adds the new vendors, so the baseline and loaded views would disagree.
3. **Load October payments**: six flags are detected and six bounded investigations run, with live progress on each flag. In real mode each load costs model calls (about 24 requests, roughly $0.35 at list price); stub mode costs nothing.
4. Open a flagged vendor, read why it was flagged and the answer, open the evidence chips, and **Mark reviewed** to record a human acknowledgment.
5. **Reset demo** at the end so public visitors see the baseline.

Three consecutive real-mode cycles passed on the live site on 2026-11-10. Locally, `npm run test:e2e` covers the stub flow and uses intercepted responses to check failure states and how the UI handles late responses after Reset. `npm run test:e2e:retry` covers failed retries and attempt history in real mode with no API key. The investigation integration tests use a synthetic model client to exercise successful retry after failure, retry eligibility after expiry, and Reset during a running investigation. See the [DEMO-01 worklog](../worklog/jian/DEMO-01.md).

### Operating notes
- Pages opened on any other host, such as a Vercel deployment-specific URL from the **Visit** button, redirect to the `AUTH_URL` domain (APP-06). Without it, signing in there failed with `{"error":"forbidden"}` because the sign-in form posts to `AUTH_URL` from a different origin.
- Changing a variable needs a new Production deployment. For a secret, **Edit** opens an inline form whose **Save** is below the value box. Saves and redeploys don't happen if Vercel's identity prompt is dismissed; confirm "Updated just now" and a new Production deployment.
- When `/api/demo` returns `unavailable`, search the Vercel runtime logs for `DemoUnavailable`. `reason` names a startup check (for example `Invalid database configuration`), and `driverCode` names a connection failure (for example `28P01`, a rejected password).

Sources checked 2026-11-04: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [PGlite](https://pglite.dev/docs/filesystems), [Neon pooling](https://neon.com/docs/connect/connection-pooling), [Vercel limits](https://vercel.com/docs/functions/limitations).

## Dependency limitations
Linting uses ESLint 10 with `eslint-config-next`, which Next.js documents as supported. `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react` do not list ESLint 10 in their peer dependencies yet, so npm prints `ERESOLVE` peer warnings and `npm ls` marks them invalid; the preset's compatibility layer runs them, and no overrides are used.

`npm audit --omit=dev --audit-level=moderate` reports zero production vulnerabilities. Full `npm audit` reports one moderate development-tooling advisory, minimatch denial of service ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), affecting versions below 11.0.1). npm lists 10 affected packages because `eslint` and `typescript-eslint` depend on `minimatch@^10`, and their current releases do not accept a fixed version. It is limited to lint tooling: minimatch handles glob patterns from lint configuration and the command line, not application input. The fixes `npm audit` offers are downgrades to unsupported ESLint 9 or to `eslint-config-next` 15, which targets an older Next.js. Neither those nor a cross-major override are applied. This finding is not resolved.

## PostgreSQL and Neon verification

Routine `npm test` uses local PGlite/fake pools. `npm run test:pg` requires explicit `PG_TEST_ALLOW_LOCAL=1`, `PG_TEST_DATABASE` ending in `_test`, and `PG_TEST_USER`; optional `PG_TEST_HOST`, `PG_TEST_PORT`, `PG_TEST_PASSWORD` configure only a local socket/loopback target. The suite verifies PostgreSQL 17 target identity, uses random disposable schemas, and tests real independent processes/locks. It never restarts the server or provisions a database/role. CI runs the same suite on ephemeral PostgreSQL 17.

`npm run test:e2e:retry` uses an isolated local PGlite directory and the intentionally unavailable real investigator entry point: failures/retries/history are exercised with zero model calls. Stop any process owning that directory before testing. Its explicitly empty key keeps this fixture unavailable after INT-01 wiring; it cannot call a model.

`npm run test:neon` is separate and **must not run without specific human authorization**. It requires `DATABASE_MODE=neon`, private CLI credentials, existing roles, and `NEON_CHECK_ALLOW_REMOTE=1`. It creates/drops one random isolated test schema, compares synthetic fixture totals, verifies migration replay/version and injection idempotency, and checks the configured read-only login. It does not provision projects, databases or roles, call models, or modify application records. Never paste URLs or driver errors into worklogs.

### Reproducible offline backend demonstration

Run `node --import tsx scripts/backend-demo.ts` from the repository root. It uses a new in-memory PGlite instance, upgrades a populated immutable 001 database, then asserts three cycles of injection/idempotency, four detections, explicit stub claims/completion, review persistence through migration replay, and reset/generation advancement. Expected output: `{"cycles":3,"exceptionsPerCycle":4,"modelRequests":0}`. It imports the stub directly; environment investigator settings cannot select a model. All data is disposable and synthetic. The identical compatibility procedure is regression-tested with PGlite and local PostgreSQL.

### Authorized Neon procedure

1. Obtain explicit authorization for remote connections and creation/drop of an isolated test schema. A human must identify an existing synthetic-only Neon database, validate its data classification, supply three existing distinct logins, and arrange the grants documented above. No app command provisions projects, databases, users or grants. Keep URLs/passwords in private CLI environment only; do not paste them into chat, logs or command arguments.
2. With the application stopped, load the private CLI environment: `DATABASE_MODE=neon`, `DATABASE_URL` (pooled app endpoint), `DATABASE_READONLY_URL`, `DATABASE_MIGRATION_URL`, and `DATABASE_MIGRATION_ROLE`. The existing application schema must already be migrated by a separately authorized `npm run db:migrate` and have human-configured grants. The compatibility check does not initialize or alter application records. The migration login must be able to create/drop the isolated schema; any additional permission is a human prerequisite.
3. Set `NEON_CHECK_ALLOW_REMOTE=1` only in that authorized private session, then run `npm run test:neon`. It opens all three configured connections with verified TLS, checks reader restrictions/SELECT access and application non-ownership/non-DDL boundaries plus required table grants/version using read-only queries. It then runs the shared populated-001 upgrade and three-cycle fixture/migration scenario as the migration owner in one random schema, with transaction-local search paths suitable for pooling. It drops that schema in cleanup and closes all pools. It never grants privileges or calls models.
4. Record only exit status, check revision, tool versions and redacted pass/fail stage. A generic failure must remain a failure; inspect private diagnostics without publishing URLs/driver messages. If cleanup fails, a human should inspect only `app01_check_*` schemas and remove the confirmed test-owned schema under separate authorization. Do not repeat uncertain operations against application records.
5. Unset the opt-in and remove migration credentials from the runtime environment. A successful check proves the checks it performed: it does **not** prove deployed authentication/packaging, least privilege beyond the catalog checks, or real application writes under the app login. Those need separately scoped verification. Keep acceptance rows 1/5 PARTIAL until the remote check and actual role evidence exist; merely having this command or passing local PostgreSQL is insufficient.

### Verification safety and privilege-test limits

The shared destructive scenario and legacy seeder live under `scripts/db-verification/`, outside the application request module graph. `seedLegacy001` checks `current_schema()` for existing relations before its first write and rejects a nonempty schema. Its local default is a fresh in-memory database; the remote caller supplies a random isolated schema with transaction-local search paths. Never substitute an application schema.

Reader preflight rejects SELECT access to migration/state/exception/run tables, as well as write/DDL/ownership privileges. Owner-membership checks use MEMBER rather than only immediately inherited privileges, conservatively rejecting a login that could assume an owner role. These catalog checks do not establish an exhaustive privilege audit across arbitrary functions/views/schemas.

The local PostgreSQL negative tests use the existing `pg_read_all_data` role and require the test login to be able to SET ROLE to it (CI uses its disposable service owner). They do not create roles or change grants. The test-owner application-grant query is only a catalog-query syntax/control check. A positive, realistically restricted application/reader/migration-login integration test requires human-provided roles and separately authorized permission setup. Do not create a disposable role just to make this test appear complete under a no-provisioning/no-grants request.

Verification cleanup preserves the original check failure and reports schema/pool cleanup failures separately without driver details. If the check itself succeeds but cleanup fails, the command fails. Do not publish driver errors or private URLs while investigating.
