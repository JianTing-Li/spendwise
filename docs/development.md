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

Development binds to `127.0.0.1:3000`. E2E uses port 3100 and a separate `.data/e2e` directory. Stop any process using that test database before running E2E. `npm start` serves a production build locally. Hosted requests fail closed.

## Local storage
PGlite stores records in `.data/spendwise` by default; override with `PGLITE_DATA_DIR`. One application process may own a database directory at a time. Tests create separate memory/temp databases. Do not run CLI migrations while the server has the database open.

Startup applies `src/server/db/migrations/001_initial.sql` and seeds only an empty database. Migration 001 is idempotent; future migrations must add a versioned runner rather than editing an applied migration. Typed record payloads are stored as JSONB with stable IDs and vendor foreign keys; Zod and domain validation enforce payloads/relationships. This lightweight foundation intentionally leaves further relational constraints to the data implementation task.

Injection, reset, run claiming, and review use transactions. A durable generation and row lock protect reset/result races. Expired pending/running runs become incomplete on the next state read. Completed stub runs have **unverified** explanation support. Review records a human acknowledgment, not financial approval or evidence verification.

## Access and environment
Local development is a trusted, loopback-only single-user mode. Requests require the expected host; mutations additionally require the same origin, JSON, and a custom header. This is not deployed identity/authentication. Never expose the local server through a tunnel or bind it to a public interface. `VERCEL` or `DATABASE_MODE=neon` disables the local flow. Deployed authentication is future work.

- `INVESTIGATOR_MODE=stub`: default; never calls an external model.
- `INVESTIGATOR_MODE=real`: explicit failed/`unavailable` result until INT-01 wires the real loop to database-scoped retrieval; no fallback.
- `DATABASE_MODE=local`: PGlite. Neon adapter is not implemented.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DATABASE_URL`, `DATABASE_READONLY_URL`: server-only placeholders for future work. Never use `NEXT_PUBLIC_` for these.

Enter future credentials locally or through hosting secret settings, never chat or source files. Git ignores all `.env*` except `.env.example`, key files, local DBs, and generated reports. Check staged files before every commit; ignore rules alone are not a secret scanner.

## Integration boundaries
`Investigator` receives an exception, generation, acceptance time, deadline and cancellation signal. Retrieval is scoped by application-owned records. UI and agent consume the same contracts. The real loop (`createRealInvestigator` in `src/agent/loop.ts`, `realInvestigatorFromEnv` in `src/agent/client.ts`) charges every model request and attempted retrieval to `Budget`, sets SDK `maxRetries: 0`, and stops 10 seconds before the run deadline to leave time for validation and persistence. `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`. The exported `realInvestigator` still returns `unavailable` until INT-01 supplies scoped retrieval.

Evidence validation (`src/agent/validation.ts`) checks existence and scope, strips self-asserted support, flags human-only conclusions and unknown amounts, and keeps `Explained` only when the exception's claim category is objectively supported by the records. A completed run means the investigation finished with valid references, not that it was verified; see [decision 002](decisions/002-evidence-validation.md). Ground truth stays in `evals/ground-truth/`, outside all runtime imports.

## Deployment prerequisites — not exercised
Free tiers only; the deployment lead and projects are tracked in DEPLOY-01 (#14). Before deployment: configure authentication, Neon pooled `pg` connection, separate read-only retrieval role, SQL compatibility tests and connection/statement timeouts. No production database credentials or live connections are used during setup.

Vercel Fluid Compute documents a 300-second Hobby maximum. The route's proposed 90-second host duration leaves room around the application's **60-second total** investigation deadline; the application does not receive a larger investigation budget. Verify actual project settings and current free-tier limits before deployment. PGlite is local-only and is not a deployed persistence fallback.

Sources checked 2026-11-04: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [PGlite](https://pglite.dev/docs/filesystems), [Neon pooling](https://neon.com/docs/connect/connection-pooling), [Vercel limits](https://vercel.com/docs/functions/limitations).

## Dependency limitations
`npm audit --omit=dev --audit-level=moderate` reported zero production vulnerabilities during setup. Full `npm audit` reports moderate development-tooling advisories (16 at setup, 8 on 2026-11-04), including transitive minimatch denial-of-service exposure; OPS-01 (#13) tracks them. ESLint 9.39.5 is deprecated upstream but passes with this Next.js lint integration; review a supported lint-stack upgrade before expanding CI to untrusted inputs. No force downgrade or cross-major transitive override was applied just to hide audit findings. These findings are not claimed resolved.

## APP-01A adapter checks (PR #23 / Issue #24)

Routine `npm run check` still uses PGlite/fake pools, without a server or credentials.
Real PostgreSQL 17 checks are separate and local-only:

```sh
PG_TEST_ALLOW_LOCAL=1 PG_TEST_HOST=/tmp PG_TEST_PORT=5432 \
PG_TEST_DATABASE=spendwise_app01_test PG_TEST_USER=elliotwatson npm run test:pg
```

Use `127.0.0.1` (or `localhost`/`::1`) for local TCP, or `/var/run/postgresql` for a Linux socket. Set `PG_TEST_PASSWORD` in your local environment when required; never paste a real password into tracked files or chat. Explicit database/user values are required; the database name must end in `_test`. The harness ignores application `DATABASE_URL` and ambient pg host/user/database settings. It verifies target identity and PostgreSQL 17 before creating a disposable schema. It drops only its unique test schema and terminates only its own test idle backend. It never restarts a PostgreSQL service. Start the local server yourself before running; an unavailable server is a test failure, not a skip or a PGlite fallback.

GitHub's separate `postgres` job provisions an ephemeral PostgreSQL 17 container on its runner and executes the same npm command. Its fixed test-only password is disposable container configuration, not an application credential. No Neon/model services are used.

Adapter error classes are internal: `DatabaseTimeout` for lock/statement timeouts, `DatabaseConflict` for serialization/deadlock conflicts, `DatabaseQueryError` for other SQL errors, and `DatabaseUnavailable` for connection failures. Error messages omit driver SQL, data and credentials. Healthy connections are reused after rollback; broken clients and failed rollbacks are discarded. Connection loss during commit reports `outcomeUnknown=true`; callers must not automatically replay work. A failed idle client is removed by pg-pool, and the next explicit transaction can acquire another client without restarting the application. No transaction is automatically retried. `PGOPTIONS` and startup URL timeout overrides are rejected; explicit inert startup options also prevent later environment changes from overriding limits.

Production database modes/TLS/role configuration, versioned migrations and retryable run persistence remain part of Issue #4. This adapter slice does not change public contracts or hosted access checks.
