# APP-03 scoped database retrieval

`databaseRetrieval({ application, reader }, { exceptionId, generation })` returns only
`Retrieval`'s four existing methods. This is a server-only internal capability,
not an HTTP endpoint or a SQL API. INT-01 creates it after application access
checks authorize the run. Do not let the model choose its exception or generation.
APP-02 authorization and agent integration are deliberately separate tasks.

Use application/reader databases built from the existing validated `databaseConfig`:
same synthetic endpoint/database, distinct logins and existing bounded `PgDatabase`
pools. The caller owns pool lifecycle. Never pass the migration connection to a
runtime caller. Construction does not perform a lookup; every execution resolves
current generation and the persisted exception afresh. It copies the scope, and
model arguments can contain only the existing optional ID filters (maximum 50 IDs,
1–120 characters each). No query text, columns, vendor, periods or generation can
be supplied through a tool.

The application transaction holds `demo_state`'s `FOR SHARE` lock throughout the
reader transaction. Store reset/injection take an exclusive `FOR UPDATE` lock. Thus reset cannot
replace stable IDs while evidence is being read, and a subsequent old-generation
lookup fails. The restricted reader never receives SELECT on state, exceptions,
runs or migration history. Two application transactions are not nested on one
connection. PGlite's local-only path uses the same control transaction, then
`SET LOCAL ROLE spendwise_retrieval_reader` after resolving scope. Local initialization installs/verifies this fixed
NOLOGIN role before serving requests. Missing grants/role fail explicitly; runtime
retrieval never creates users or changes grants. PostgreSQL requires a separate
reader connection; it cannot silently take the PGlite path.

## Scope and amounts

Scope preserves the fixture contract: same vendor; payments before the exclusive
November cutoff, in the domain-derived duplicate lookback or explicitly named by
the **stored application exception**, plus original payments referenced by the
exception's reversals. The model's ID filter intersects this set. Invoices must
belong to the vendor and be linked by scoped payments; their invoice dates can
precede the payment period (invoice date is not cash date). Notes must precede the
cutoff and link to a scoped payment or invoice. Returned note link arrays are
intersected with the scoped IDs, even for malformed cross-vendor links. Unknown
or out-of-scope ID requests return empty arrays. Empty arrays mean no available
records matching the authorized lookup, never an explanation of the exception.

Summary is recalculated by `src/domain/finance.summarize`, not taken on trust from
the exception payload. Completed outgoing cash is positive and completed full
reversals negative on each entry's date. Pending/failed entries do not affect
cash. Domain validation checks original/reversal vendor, currency, equal amount,
chronology and uniqueness. Historical originals are loaded for that validation,
not exposed through summary. Duplicate candidate detection remains entirely in
the domain; a fully completed reversal before the cutoff removes its original
from candidates. Retrieval never supplies evaluation answers or labels.

## Limits and failure behavior

Every record query has `LIMIT 101` to detect overflow beyond 100 rows. Summary
also requires at most 100 historical vendor payments and linked invoices; this
conservative limit makes large histories unavailable instead of calculating
partial cash totals. A SQL CASE omits payloads over 24,576 UTF-8 bytes before they
reach application memory; their byte count causes failure. Validated output is
at most 65,536 serialized UTF-8 bytes. Existing field constraints also apply.
There is no silent truncation, pagination or partial success: an oversized result
throws `RetrievalError("evidence_limit")`; a narrower authorized ID lookup may
succeed. Fixture arrays use the same row/byte bounds. Returned record order is
stable by ID in SQL; callers should treat fixture order as incidental.

Other safe error codes are `invalid_input`, `invalid_scope`, `stale_generation`,
and `unavailable`. Raw driver errors, SQL, record contents and credentials are
never included. A permission, parsing, connection or domain-validation failure
is unavailable, with no fixture fallback. For diagnosis, the server logs only the
error class and SQLSTATE of an unavailable failure. INT-01 must map these rejections to
explicit incomplete/unavailable evidence and count failed calls within its
existing lookup budget. This module does not grant permissions, implement auth,
persist results or call a model.

## Read-only grants

These are reviewable **operator templates**, not an automatic migration. They
preserve the APP-01 schema and privilege split. For the hosted Neon database,
use the LOGIN roles and grants in `docs/development.md` ("Hosted deployment").
An owner must adapt the role/database names for an explicitly
authorized synthetic database; use private credentials, never source literals.
The existing migration owner owns tables and alone runs migrations.

```sql
-- Fresh role, no memberships in owner/write roles. Set LOGIN credentials privately
-- for PostgreSQL; use NOLOGIN for PGlite's fixed spendwise_retrieval_reader role.
CREATE ROLE spendwise_retrieval_reader NOLOGIN NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- Replace synthetic_database with the separately authorized database name.
REVOKE TEMPORARY ON DATABASE synthetic_database FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO spendwise_retrieval_reader;
GRANT SELECT ON vendors, payments, invoices, vendor_notes,
  note_payments, note_invoices TO spendwise_retrieval_reader;
```

Do not grant state/exception/run/history access, schema CREATE, table ownership,
write permissions or membership in privileged roles. On existing roles, audit
and revoke previous direct/inherited grants; this fresh-role template does not
purport to repair arbitrary preexisting permissions. Runtime `assertReadOnly`
checks table/schema privilege and role ownership/membership and SELECT access to
the six evidence tables on every call. It is not an exhaustive audit of all
possible database functions/extensions. The SQL statements used by the tools
are fixed; no arbitrary SQL execution surface is returned to the model. The
reader can of course SELECT its granted evidence tables when used by a trusted
operator; scope is enforced by application queries, not row-level security.

## Reproduce without model calls

```sh
npx vitest run tests/retrieval.test.ts
node --conditions=react-server --import tsx tests/retrieval-demo.ts
```

The demo creates a disposable in-memory PGlite database and the local reader
role, returns a linked payment/invoice/note, rejects a cross-vendor request and
verifies a reader write gets SQLSTATE 42501. It accepts no paths or credentials.

For the separate-login PostgreSQL demo, use a **disposable local PostgreSQL 17
server**, socket `/tmp`, admin OS login, TCP SCRAM enabled on a free port. The
command creates and drops `app03_retrieval_test` and the fresh `app03_owner`,
`app03_app`, `app03_reader` roles. Existing names abort; it never drops a
preexisting database or role. Passwords are random, memory-only and unprinted.
This command requires explicit local opt-in and an administrator that can create
these disposable objects. It never reads application/Neon URLs.

```sh
APP03_ALLOW_LOCAL_PG=1 APP03_PG_PORT=55439 \
  node --conditions=react-server --import tsx tests/retrieval-postgres-demo.ts
```

It verifies all four methods for all demo exceptions, out-of-scope exclusion,
INSERT/UPDATE/DELETE/DDL/temp-DDL/state-read/owner-escalation denial, and reset
waiting for an in-flight evidence read followed by stale-generation rejection.
Cleanup failure fails the command; inspect only these test-owned objects locally.
For a server with preexisting objects of these names use a fresh disposable
cluster; do not delete the existing objects to make the test run.

## INT-01 runtime integration

The runtime keeps both application and restricted reader pools alive. Evidence
reads hold `FOR SHARE` on generation only for the short database work, allowing
other readers concurrently; reset/injection still take `FOR UPDATE`. No model
wait occurs inside either transaction. Local PGlite initialization installs and
validates the fixed NOLOGIN reader role, including on an existing local database.
PostgreSQL/Neon roles and grants remain operator supplied.

See [INT-01 verification](../../../docs/int-01-verification.md) for the fake-model
durable demo, deadlines, conservative counter reservations and user-led checks.
