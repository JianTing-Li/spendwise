# APP-03 implementation evidence

Owner: Elliot (`0x1Elliot`). Task: [Issue #6](https://github.com/JianTing-Li/spendwise/issues/6).
Branch: `feature/app-03-scoped-db-retrieval`.
Base: `103b3c068437f9612c3740b2169ab152d10cb8ab` (fresh `origin/main` fetched 2026-11-07).
Implementation/test revision: `5a69a3bbf26ab1e0f9eb8a399ab5c25c6a7f603f`.
The later documentation commit records these results; no implementation changes follow that revision.
No PR was opened or branch pushed. GitHub is the source of task status/approval.

## Starting evidence and boundaries

Read current AGENTS, README, development guide, PRD snapshot, decisions 001–003,
handoff index, contracts, fixture retrieval, domain calculations, migrations,
database adapters/permissions/store and tests. Inspected the original uploaded
L2C4 SpendWise PRD, Tech Stack, & Implementation Guide DOCX. Its historical setup
prompt was reference data; current requirements/decisions govern. Read the installed
Next.js data-security guide before implementing the server-only capability.

GitHub Issue #6 was open, assigned to Elliot, with no discussion comments. Its
only dependency #4 was closed as completed, and main includes PR #30's merge
(`3074f45`). GitHub open-PR inspection showed #34 (APP-02) and #33 (Jian/EVAL-01),
no APP-03 PR. PR #34 and its branch were untouched. APP-02 commit
`af9241024a982c1598b741c88e6582b5a0e91c05` is not an ancestor of this branch.
The original populated APP-02 worktree had a clean status; this task used a new
populated worktree, never the old unpopulated audit clone.

No shared schemas, domain rules, fixtures, manifests, configuration, migrations,
CI, agent files, evaluator files, Jian worklogs or PRs changed. No ownership
conflict required affected edits. Existing privilege design is retained: reader
cannot read generation metadata. A control transaction holds generation lock
while a separate restricted reader queries evidence. No new metadata grants or
schema columns were needed. Local PGlite uses a fixed NOLOGIN reader role in the
same transaction; its role/grants are set up only by disposable tests/demo.

## Changes and design

- `src/server/retrieval/database.ts`: all four existing tools, fixed parameterized
  SQL, persisted application-owned exception scope, per-call reader preflight,
  reset lock, domain-calculated summary, safe errors. No HTTP or model integration.
- `src/server/retrieval/bounds.ts`: derived duplicate lookback, shared explicit
  overflow failure and safe retrieval error codes.
- `src/server/retrieval/fixture.ts`: removes hard-coded lookback, bounds arrays,
  intersects note links with scoped record IDs; existing tool schemas unchanged.
- `src/server/retrieval/README.md`: design, scope/financial rules, limits,
  operator grant template, pool lifecycle, safe reproduction/integration notes.
- `tests/retrieval.test.ts`: 21 meaningful retrieval/security tests.
- `tests/retrieval-support.ts`: disposable synthetic-only PGlite with reader role.
- `tests/retrieval-demo.ts`: runnable matching payment/invoice/note, out-of-scope
  exclusion, actual reader write rejection; zero model calls.
- `tests/retrieval-postgres-demo.ts`: actual distinct SCRAM logins, four-method
  fixture parity, forbidden statements and concurrent reset/read verification.
- `worklog/elliot/APP-03.md`: this evidence record.

Scope follows the fixture: vendor, pre-cutoff lookback or stored-exception payment
IDs, original payments referenced by those exception reversals, linked invoices,
and dated linked notes. A model-provided ID can only narrow that scope. Invoice
dates may precede the cash periods when linked; date is not payment date.
Returned note link IDs are also scoped. Summary uses domain validation and
`summarize`: completed outgoing entries minus completed full reversals, by entry
date, safe integer cents, with pending/failed excluded. It ignores asserted
exception-summary amounts. Ground truth is never imported.

Limits: 50 input IDs, 120 characters per ID, 100 output rows, 24,576 UTF-8 bytes
per record and 65,536 bytes per serialized result. SQL returns at most 101 rows
and omits oversized payloads using CASE before application decoding. Summary
requires bounded vendor history (100 payments/linked invoices). No truncation or
partial totals: overflow explicitly rejects with `evidence_limit`. Empty arrays
mean no matching available records, not evidence supporting an explanation.

## Acceptance evidence

| Issue criterion | Concrete evidence |
| --- | --- |
| Four DB-backed application-owned queries matching fixture contracts | PGlite and actual PostgreSQL parity for all four methods across all four current exceptions; strict existing input/output schemas |
| Dedicated read-only role, no SQL/credential exposure | PGlite NOLOGIN role; PostgreSQL separate password logins; 42501 on INSERT/UPDATE/DELETE/DDL, including TEMP; state read and owner escalation denied; returned object has only four tool methods; SQL-field input rejected |
| Vendor/period/link/generation scoping | Cross-vendor IDs excluded; exact lookback/current cutoff tests; unlinked/future notes excluded; note link arrays filtered; stale IDs after reset/reinjection rejected; PostgreSQL reset waits on active read |
| Bounded inputs/results, explicit unavailable evidence | Malformed/empty/overlong IDs and >50 IDs rejected; 101-row, oversized record and aggregate text tests; no partial results; unsafe/missing grants and driver failures sanitized, no fallback |
| Application amounts and reversal conventions, no labels/answers | Domain summary matches fixtures; ignores tampered persisted total; explicit historical original/completed reversal/pending/future rows give expected net cash; no evaluator imports |
| Derive duplicate lookback from domain settings | Date derived from periods.currentStart and settings.duplicateDays; mutation to eight days shifts cutoff; before/on-cutoff retrieval tested |

## Actual verification

All commands below ran from this branch worktree. No provider keys or application
URLs were loaded. Node `v24.21.0`, npm `11.19.0`; repository pins are `24.18.0` /
`11.16.0`. Both actual versions satisfy declared engines, but exact pinned-patch
execution was not performed. Existing installed dependencies were reused without
changing manifests/lockfile. PostgreSQL was 17.11 (Homebrew), disposable local cluster.

```sh
npm run check
```

Exit 0: typecheck, lint, `18 passed` test files / `168 passed` tests, production
webpack build. Existing routes remained `/`, `/_not-found`, `/api/demo`,
`/api/demo/retry`; no retrieval route was introduced.

```sh
./node_modules/.bin/vitest run tests/retrieval.test.ts tests/financial.test.ts tests/permissions.test.ts
```

Exit 0, exact terminal summary: `Test Files  3 passed (3)`; `Tests  39 passed (39)`.
Retrieval alone accounts for 21 tests. Coverage is behavioral as mapped above;
no instrumented line/branch coverage percentage is claimed.

```sh
npm run test:e2e
npm run test:e2e:retry
```

Both exit 0: `1 passed (6.1s)` and `1 passed (5.1s)`, respectively. Existing
inject/inspect/review/persist/reset and retry/history/stale-predecessor flows.
These exercise existing stub/unavailable investigator modes, not DB-to-agent wiring.

```sh
/opt/homebrew/opt/postgresql@17/bin/createdb -h /tmp -p 55439 app03_suite_test
PG_TEST_ALLOW_LOCAL=1 PG_TEST_DATABASE=app03_suite_test PG_TEST_USER=elliotwatson PG_TEST_PORT=55439 npm run test:pg
```

Exit 0. Exact summary: `tests 13`, `pass 13`, `fail 0`, `skipped 0`. Includes
cross-process reset, claims, retries, locks/timeouts, migrations and compatibility.
Username is the disposable cluster's local admin identity, not an application credential.

```sh
node --conditions=react-server --import tsx tests/retrieval-demo.ts
APP03_ALLOW_LOCAL_PG=1 APP03_PG_PORT=55439 node --conditions=react-server --import tsx tests/retrieval-postgres-demo.ts
```

Both exit 0. Full stdout is delivered separately as `APP-03-local-demo.json` and
`APP-03-postgres-demo.json`; full check logs and command headers are delivered in
`APP-03-verification.txt`. Exact local demo stdout follows:

```json
{
  "database": "PGlite",
  "generation": 0,
  "summary": {
    "vendorId": "vendor-renewal",
    "currency": "USD",
    "priorCents": 100000,
    "currentCents": 1300000,
    "differenceCents": 1200000,
    "percentChange": 1200,
    "periods": {
      "priorStart": "2026-09-01",
      "currentStart": "2026-10-01",
      "endExclusive": "2026-11-01",
      "timezone": "UTC"
    }
  },
  "matching": {
    "payment": {
      "id": "pay-renewal-annual",
      "vendorId": "vendor-renewal",
      "invoiceId": "inv-renewal",
      "date": "2026-10-20",
      "amountCents": 1200000,
      "currency": "USD",
      "status": "completed",
      "entryType": "outgoing",
      "reversalReference": null,
      "description": "Synthetic vendor payment"
    },
    "invoice": {
      "id": "inv-renewal",
      "vendorId": "vendor-renewal",
      "number": "NS-2026",
      "date": "2026-10-01",
      "amountCents": 1200000,
      "currency": "USD",
      "lineItems": [
        "Annual software renewal"
      ],
      "servicePeriod": "2026-10-01 / 2027-09-30"
    },
    "note": {
      "id": "note-renewal",
      "vendorId": "vendor-renewal",
      "date": "2026-10-01",
      "text": "Synthetic approval note: annual renewal of $12,000, covering October 2026 through September 2027.",
      "paymentIds": [
        "pay-renewal-annual"
      ],
      "invoiceIds": [
        "inv-renewal"
      ]
    }
  },
  "outOfScope": {
    "requested": "pay-advisory-a",
    "returned": []
  },
  "readerWrite": {
    "rejected": true,
    "sqlstate": "42501"
  },
  "modelRequests": 0
}
```

The PostgreSQL output records `separatePasswordLogins: true`, parity across
4 exceptions × 4 methods, renewal payments/invoice/note, cross-vendor empty
result, `readerDenied: ["INSERT", "UPDATE", "DELETE", "DDL", "TEMP_DDL", "STATE", "ESCALATION"]`,
`sqlstate: "42501"`, `generationRace: "reset waited for evidence read"`, and zero
model requests. It dropped its test database/roles successfully.

Initial sandboxed E2E could not bind loopback (`EPERM`); rerunning with approved
local networking passed. Initial PostgreSQL init required shared-memory access;
approved local execution succeeded. Its first startup used a socket path longer
than PostgreSQL permits; changing to `/tmp` succeeded. An early test incorrectly
assumed the demo contained a reversal; it failed, was replaced with explicit
reversal data, and the final checks above passed. No test was weakened.

## Limits and next integration steps

No live Neon, hosted OAuth, deployment, real model invocation or agent integration
was exercised. PGlite's restricted SET ROLE is local isolation, not an authenticated
network login; PostgreSQL's separate-login path is verified. Reader privileges do
not replace application scope checks or authorize the factory caller. INT-01 must
supply application-authorized exception/generation and manage distinct validated
pools; map safe lookup errors into honest incomplete/unavailable findings and
retain existing tool/time budgets. APP-02 remains its separate PR #34.

The privilege preflight is not an exhaustive function/extension privilege audit.
A reader operator can directly SELECT granted evidence tables; the model has no
SQL interface. Large histories fail explicitly rather than producing partial
summaries. There is no pagination or runtime role provisioning. Grant templates
must be reviewed/adapted before applying to any persistent or hosted database.

Human review and the repository-required AI PR review are still required before
approval/merge. This session did not push, open a PR, merge, deploy, provision a
remote service, change GitHub labels, or use paid calls. Prepared PR description
uses `Closes #6` only for the independently implemented APP-03 scope, subject to
human acceptance; no APP-02 issue reference or workflow change is included.

## Draft messages for Jian (not sent)

Before: Jian — starting APP-03 from main `103b3c0`. I’ll add database retrieval,
dedicated tests, reader-grant documentation and Elliot’s worklog. Tool schemas and
shared contracts stay unchanged; agent integration remains INT-01.

After: Jian — APP-03 is implemented independently of PR #34. All four DB tools
match fixtures; local PostgreSQL verified separate reader credentials, write/DDL
denials and reset safety. Full checks, both browser suites and PG tests pass.
Schemas and your files are untouched. Ready for human review before any push/PR;
INT-01 can consume the server-owned retrieval capability.
