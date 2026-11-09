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

Startup applies bundled, versioned migrations under a transaction lock and seeds only an empty database. Immutable 001 upgrades through 002 in place; **do not delete existing data directories**. Migration strings are statically bundled in `src/server/db/migrations/bundled.ts`; parity tests compare them with the SQL review copies, and a separate-process test starts from another working directory. Update the bundle when adding a new migration, never an applied migration.

002 adds typed/generated relational filter columns (vendor category, invoice/payment/note dates, safe integer cents, currency, payment status/type, invoice/reversal links), indexes and note link tables. Generated columns stay synchronized with validated JSON record payloads. Run identity, exception, generation and status are authoritative columns and forbidden in run payload JSON. Existing records, findings and review timestamps survive the upgrade. Invalid legacy data aborts the entire upgrade for investigation; no deletion or automatic repair occurs.

Injection, reset, run claiming, and review use transactions. A durable generation and row lock protect reset/result races. State reads derive expired pending/running runs as incomplete without writes or row locks; a retry mutation materializes expiry. Retries are explicit user actions: at most three attempts per exception/generation, only after failed/incomplete/cancelled attempts. A predecessor ID makes repeat clicks idempotent. Completed attempts cannot retry, including unverified findings. Each attempt gets fresh 8 lookup / 10 model request / 60 second limits; reset clears history and starts a new generation. The dashboard shows the latest attempt and expandable history. Completed stub runs have **unverified** explanation support. Review records a human acknowledgment, not financial approval or evidence verification.

## Access and environment
Local development is a trusted, loopback-only single-user mode. Requests require the expected host; mutations additionally require the same origin, JSON, and a custom header. This is not deployed identity/authentication. Never expose the local server through a tunnel or bind it to a public interface. `VERCEL`, `DATABASE_MODE=neon`, or a configured `AUTH_URL` disables the local flow. Hosted access uses Auth.js/GitHub OAuth and explicit server-owned grants. See [APP-02 access design and operator setup](../worklog/elliot/APP-02.md). Never supply credentials in chat.

- `INVESTIGATOR_MODE=stub`: default; never calls an external model.
- `INVESTIGATOR_MODE=real`: official SDK loop through scoped database retrieval; server-side credentials are required for live calls. Missing configuration produces failed/`unavailable`; no fallback. Use the [offline INT-01 demo](int-01-verification.md) for fake-client verification without credentials.
- `DATABASE_MODE=local`: default, single-process PGlite, migrations at startup.
- `DATABASE_MODE=postgres`: explicit loopback-only PostgreSQL development, pooled `pg`; no fallback.
- `DATABASE_MODE=neon`: pooled Neon application URL, verified TLS (`rejectUnauthorized: true`); HTTP routes, including retry, require configured hosted authentication and application grants. All URLs must identify the same endpoint/database. URL SSL/startup/timeout overrides and PGOPTIONS are rejected.
- PostgreSQL/Neon require separate application and read-only URLs plus `DATABASE_MIGRATION_ROLE` (the owner role name). Runtime verifies retrieval cannot write/own tables/create schema objects and application cannot own tables/create schema objects. Failure is explicit. Default limits are pool 4, connection/statement 5s, lock 3s, idle transaction 5s; these are initial test defaults, not production sizing.
- `DATABASE_MIGRATION_URL` is **CLI-only**, using the distinct schema owner login. Never put its password in the application runtime. After a human supplies an existing synthetic-only database and logins, load the private CLI environment and run `npm run db:migrate`; application startup checks version 002 and never runs DDL through the app login. No credentials are printed by these commands.
- Human database setup must give only the migration owner DDL/ownership. Revoke schema CREATE from PUBLIC and both runtime logins; grant schema USAGE. Grant application SELECT on schema_migrations and SELECT/INSERT/UPDATE/DELETE on demo_state, vendors, invoices, payments, vendor_notes, note_payments, note_invoices, exceptions, investigation_runs. Grant reader SELECT only on vendors, invoices, payments, vendor_notes, note_payments, note_invoices. Neither runtime role may inherit migration/owner or write roles. These grants/roles are a human prerequisite, not executed by migrations or tests.
- SQL-scoped retrieval uses APP-03 capabilities. INT-01 retains the restricted reader pool and wraps the existing real loop; neither raw SQL nor database clients/credentials enter the model input. Local PGlite initialization creates/verifies its fixed NOLOGIN reader role and evidence-only grants. PostgreSQL/Neon roles remain operator provisioned.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DATABASE_URL`, `DATABASE_READONLY_URL`: server-only settings. Never use `NEXT_PUBLIC_` for these.

Enter future credentials locally or through hosting secret settings, never chat or source files. Git ignores all `.env*` except `.env.example`, key files, local DBs, and generated reports. Check staged files before every commit; ignore rules alone are not a secret scanner.

## Integration boundaries
`Investigator` receives an exception, generation, acceptance time, deadline and cancellation signal. Retrieval is scoped by application-owned records. UI and agent consume the same contracts. The real loop (`createRealInvestigator` in `src/agent/loop.ts`, `realInvestigatorFromEnv` in `src/agent/client.ts`) charges every model request and attempted retrieval to `Budget`, sets SDK `maxRetries: 0`, and stops 10 seconds before the run deadline to leave time for validation and persistence. `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`. The application selects the loop in `src/server/investigation/runtime.ts`; the old standalone `realInvestigator` export remains an unavailable compatibility boundary when no client is configured. Durable counters reserve attempts before dispatch, including failed/invalid tool batches; a killed batch may conservatively overcount. Validation reuses full scoped responses and charges any additional database retrievals against the same eight-execution budget. Four runs execute concurrently with their original acceptance deadlines.

Evidence validation (`src/agent/validation.ts`) checks existence and scope, strips self-asserted support, flags human-only conclusions and unknown amounts, and keeps `Explained` only when the exception's claim category is objectively supported by the records. A completed run means the investigation finished with valid references, not that it was verified; see [decision 002](decisions/002-evidence-validation.md). Ground truth stays in `evals/ground-truth/`, outside all runtime imports.

## Deployment prerequisites — not exercised
Free tiers only; the deployment lead and projects are tracked in DEPLOY-01 (#14). Before deployment: configure authentication, Neon pooled `pg` connection, separate read-only retrieval role, SQL compatibility tests and connection/statement timeouts. No production database credentials or live connections are used during setup.

Vercel Fluid Compute documents a 300-second Hobby maximum. The route's proposed 90-second host duration leaves room around the application's **60-second total** investigation deadline; the application does not receive a larger investigation budget. Verify actual project settings and current free-tier limits before deployment. PGlite is local-only and is not a deployed persistence fallback.

Sources checked 2026-11-04: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [PGlite](https://pglite.dev/docs/filesystems), [Neon pooling](https://neon.com/docs/connect/connection-pooling), [Vercel limits](https://vercel.com/docs/functions/limitations).

## Dependency limitations
Linting uses ESLint 10 with `eslint-config-next`, which Next.js documents as supported. `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react` do not list ESLint 10 in their peer dependencies yet, so npm prints `ERESOLVE` peer warnings and `npm ls` marks them invalid; the preset's compatibility layer runs them, and no overrides are used.

`npm audit --omit=dev --audit-level=moderate` reports zero production vulnerabilities. Full `npm audit` reports one moderate development-tooling advisory, minimatch denial of service ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), affecting versions below 11.0.1). npm lists 10 affected packages because `eslint` and `typescript-eslint` depend on `minimatch@^10`, and their current releases do not accept a fixed version. It is limited to lint tooling: minimatch handles glob patterns from lint configuration and the command line, not application input. The fixes `npm audit` offers are downgrades to unsupported ESLint 9 or to `eslint-config-next` 15, which targets an older Next.js. Neither those nor a cross-major override are applied. This finding is not resolved.

## PostgreSQL and Neon verification

Routine `npm test` uses local PGlite/fake pools. `npm run test:pg` requires explicit `PG_TEST_ALLOW_LOCAL=1`, `PG_TEST_DATABASE` ending in `_test`, and `PG_TEST_USER`; optional `PG_TEST_HOST`, `PG_TEST_PORT`, `PG_TEST_PASSWORD` configure only a local socket/loopback target. The suite verifies PostgreSQL 17 target identity, uses random disposable schemas, and tests real independent processes/locks. It never restarts the server or provisions a database/role. CI runs the same suite on ephemeral PostgreSQL 17.

`npm run test:e2e:retry` uses an isolated local PGlite directory and the intentionally unavailable real investigator entry point: failures/retries/history are exercised with zero model calls. Stop any process owning that directory before testing. Its explicitly empty key keeps this fixture unavailable after INT-01 wiring; it cannot call a model.

`npm run test:neon` is separate and **must not run without specific human authorization**. It requires `DATABASE_MODE=neon`, private CLI credentials, existing roles, and `NEON_CHECK_ALLOW_REMOTE=1`. It creates/drops one random isolated test schema, compares synthetic fixture totals, verifies migration replay/version and injection idempotency, and checks the configured read-only login. It does not provision projects, databases or roles, call models, or modify application records. Live Neon TLS/connectivity/permissions remain unverified until this opted-in check is authorized. Never paste URLs or driver errors into worklogs.

### Reproducible offline backend demonstration

Run `node --import tsx scripts/backend-demo.ts` from the repository root. It uses a new in-memory PGlite instance, upgrades a populated immutable 001 database, then asserts three cycles of injection/idempotency, four detections, explicit stub claims/completion, review persistence through migration replay, and reset/generation advancement. Expected output: `{"cycles":3,"exceptionsPerCycle":4,"modelRequests":0}`. It imports the stub directly; environment investigator settings cannot select a model. All data is disposable and synthetic. The identical compatibility procedure is regression-tested with PGlite and local PostgreSQL.

### Future authorized Neon procedure (not executed)

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
