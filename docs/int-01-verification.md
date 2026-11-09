# INT-01 architecture and verification

Owner: Elliot (`0x1Elliot`). Specification: [Issue #10](https://github.com/JianTing-Li/spendwise/issues/10).
Base: `5b6bcb689d216d0283de149f45f2c0b22e63844a` (fresh origin/main).
Review and task status live in GitHub, not this document.

## What runs

An authorized inject/retry request accepts a durable attempt before dispatch. All
four investigations run concurrently, retaining the **original acceptance-time**
deadline. Each attempt has at most 60 seconds, 8 retrieval reservations (including
validation reads), and 10 model requests. The existing real loop keeps its
10-second validation reserve; the application stops work one second before the
original deadline for terminal persistence. Neither reserve extends the budget.

`src/server/investigation/runtime.ts` supplies APP-03's scoped DB capability to
Jian's existing loop. Stub mode uses no SDK or credentials. Real mode dynamically
constructs the official SDK with retries zero, and each request also has retries
zero. An absent client/key yields real failed/unavailable; unknown mode fails
visibly. A fake client is a trusted server/test argument, never an HTTP parameter
or environment-selectable backdoor. Routine tests and the demo always pass it.

Counters are committed **before** the request/dispatch, in short transactions.
Tool batches reserve even unknown tools and malformed inputs before Jian's loop
processes them. A process killed midway through a batch can leave a conservative
upper bound, rather than an exact billing/executed-call count. Counters never go
backwards. Repeated model lookups still cost attempts. Validation reuses complete
scoped responses; a filtered response cannot masquerade as the full evidence set.
Any extra validation SQL consumes the same eight-attempt allowance. Exhaustion
produces incomplete/tool_limit, never an unchecked completed finding.

The investigator and application validate results separately. Nonterminal output,
empty completion, mismatched mode, and inconsistent completion/error combinations
cannot become completed. Findings with valid references may remain unverified,
missing or contradicted; see decision 002. Stub support always stays unverified.

## Persistence and races

No transaction spans a model/network wait. Claims, counter reservations, finish,
reset, retry and review use short transactions. Reset changes generation and
clears old runs atomically. Finish checks generation under the **same** exclusive
lock as its result write. Each attempt is uniquely identified; duplicate workers
cannot both claim it. Retry names its predecessor, stays in the same mode, is
idempotent under double clicks, and remains limited to three attempts.

APP-03 evidence reads now hold `FOR SHARE` on generation while the restricted
reader executes fixed queries. Multiple readers can proceed together; reset and
injection still wait for them using `FOR UPDATE`. Only short SQL work holds this
lock. The PostgreSQL demo holds two reader transactions open, observes both enter,
checks reset waits, releases both, and checks old-generation retrieval rejects.

State uses a repeatable-read, read-only snapshot with no row lock. It projects
expired pending/running rows as incomplete/deadline, including after process death.
Retry mutations materialize expiry. There is no new background worker or scheduler:
an unavailable database cannot be promised an immediate terminal write, but a
reopened/readable database cannot display an expired run as indefinitely running.
Request abort cancels current work; one shared sequential poll every 500 ms detects
reset from other processes (at most two observation transactions per second per
`runPending` batch, independent of its number of runs). Observation failures are
logged and retried; only a definite inactive answer aborts work. Local deadline
timers and generation guards remain effective during observation outages.
An abort race bounds even a deliberately noncooperative fake
model, while checks around dispatch/SQL and generation-guarded persistence prevent
late work from being accepted. The real SDK receives the abort signal too.

Validation preloads the three full evidence sets sequentially, charging fresh
reads to the existing eight-retrieval limit. Cached full sets cost no extra read;
filtered results are never substituted. If a read is unavailable or the budget
cannot cover validation, the run stays incomplete and retains every submitted
finding as unchecked/unverified; any Explained label becomes Needs Review. An
existing investigator error (for example unavailable) is preserved. These findings
cannot be treated as verified or mark the run completed. No extra read or model
retry is granted to obtain validation capacity.

The runtime keeps both application and reader pools. Local PGlite initialization
creates/verifies its fixed NOLOGIN reader and evidence-only grants, including on
an existing migrated directory. PostgreSQL/Neon initialization never provisions
roles or grants. Permission preflight remains fail-closed. The existing separate
password-login PostgreSQL demo proves seven forbidden operations return 42501.

## Ownership and coordination

No `src/agent/`, `evals/`, Jian worklog, shared contract, fixture, migration, package
manifest, dependency or CI file is changed. The existing unavailable agent export
remains intact for callers without a configured client. The existing evidence
regressions pass without editing Jian's tests.

Elliot's application/server/retrieval code, integration tests and local demo are
the implementation. Shared changes for Jian's consumer review are documentation
and Vitest's server-only marker alias. The alias only makes the marker empty in
the server test runtime; production keeps the server-only import guard. Existing
schema-isolation helpers use `SET LOCAL search_path` instead of a preliminary
`SELECT set_config`, which otherwise establishes a snapshot too early for
repeatable-read. The future Neon verifier receives the same compatibility fix;
it was not run against Neon.

## Actual verification

- `npm run check`: typecheck, lint, 219 tests and production build.
- INT-01 tests: successful real-loop/fake-client DB runs; close/reopen and review;
  four simultaneous waits; durable counters; duplicate workers; request abort;
  noncooperative late model; reset/reinjection; independent model/persistence
  failure; explicit retry; invalid calls; both budgets; forced deadline; killed
  worker recovery; read-only GET; invalid configuration; honest terminal results.
- API tests use actual handlers, Store and runner with a fake client: 400 input,
  401 missing hosted identity, 403 origin/permission denial, 409 review/retry
  conflicts, 503 unavailable configuration, 200 durable inject/read/review/reset.
  Existing APP-02 tests cover real offline Auth.js cookies/grants and resource IDs.
- Local PostgreSQL 17: `npm run test:pg`, 13 passed, 0 failed/skipped; independent
  connections/processes, claims, reset, retry, migration replay and recovery.
- Extended `tests/retrieval-postgres-demo.ts`: distinct restricted logins; four
  completed durable real-mode runs; eight fake requests across duplicate workers;
  no transaction held while all four models wait; two simultaneous evidence reads
  with reset blocking; seven denied reader operations; disposable cleanup.
- Both browser suites passed, including stub demo/review/reset and unavailable
  real-mode retry/history. Retry browser configuration explicitly empties the key.
- Built-app loopback HTTP demo passed: missing identity 401, denied permissions
  403, authorized reset/inject/read 200, cross-origin 403, missing configuration
  401 and protected dashboard. Offline baseline and the visible demo passed.
  No held-out scoring occurred.

## User-led demo

Run from this feature checkout, without copying any private environment file:

```sh
nvm use
npm ci
node --conditions=react-server --import tsx scripts/investigation-demo.ts
open .data/int01-demo/investigation-demo.html
```

The executable always uses a fake model and a new disposable file-backed PGlite
database. It asserts three complete inject → investigate → review → reopen → reset
cycles, cancellation of four concurrent waits, one successor after duplicate retry,
and rejection of a stale result. It writes HTML plus full synthetic JSON to the
ignored `.data/int01-demo` directory. The displayed results come from that run.

Inspect the boundary yourself:

```sh
./node_modules/.bin/vitest run tests/investigation-integration.test.ts tests/investigation-api.test.ts
npm run check
npm run test:e2e
npm run test:e2e:retry
npm run eval:baseline
node tests/access-http-demo.mjs
```

For a local PostgreSQL 17 server you control (never a hosted endpoint):

```sh
PG_TEST_ALLOW_LOCAL=1 PG_TEST_DATABASE=YOUR_SYNTHETIC_test PG_TEST_USER=YOUR_LOCAL_USER PG_TEST_PORT=55440 npm run test:pg
APP03_ALLOW_LOCAL_PG=1 APP03_PG_PORT=55440 APP03_PG_USER=YOUR_LOCAL_USER node --conditions=react-server --import tsx tests/retrieval-postgres-demo.ts
```

The second command intentionally creates/drops only `app03_retrieval_test` and
three `app03_*` test roles. Existing names make it stop; it never overwrites an
existing database. Use a disposable local server with role/database creation
permissions. Its generated test password is never printed. The first command
requires an existing database ending in `_test` and uses random disposable schemas.

For a visible application demo with no model call:

```sh
INVESTIGATOR_MODE=stub DATABASE_MODE=local PGLITE_DATA_DIR=.data/int01-user npm run dev
```

Open http://127.0.0.1:3000, simulate payments, inspect source records, mark a finding
reviewed, refresh, and reset. Use this dedicated directory in only one process.
The fake-client HTML demo exercises the integrated real loop; this browser flow
exercises the ordinary application in explicitly labeled stub mode.

**Teach-back:** Why must generation validation and the result write share one
transaction? Predict the state after reset during a model wait. Run the test
named “reset aborts model waits” and explain why an old result cannot reappear.

## Limits and remaining external work

Hosted OAuth/Neon connectivity, live SDK behavior, deployment settings and model
quality/cost are unverified here and belong to separately authorized work. No
paid call, secret loading, remote database access, held-out evaluation, deployment,
merge, or protection bypass occurred. Cancellation is through request abort/reset;
a dedicated dashboard cancel button remains UI work. This PR requires the normal
AI review, Jian's consumer review of the shared test/documentation changes, and
human review before approval or merge. Local versions were Node 24.21.0,
npm 11.19.0 and PostgreSQL 17.11, differing from the pinned Node/npm patch versions.

### Disposition of Jian's review on head 4d2c94c

The [review](https://github.com/JianTing-Li/spendwise/pull/37#pullrequestreview-5821937614)
identified three blocking findings and seven nonblocking considerations.

- 1–3: corrected transient observation handling and preservation of unchecked
  findings on validation outages/exhaustion, with durable fake-model regressions.
- 5: consolidated four per-run polls into the shared observation above.
- 7: logs distinguish typed retrieval/database failures and safe SQLSTATEs, while
  arbitrary errors keep the generic classification; no raw driver/SDK text.
- 8: startup calls the same strict mode parser as injection. Blank and unknown
  settings fail before adapter creation; unset still selects stub.
- 4: request cancellation is retained for this bounded, request-owned runner.
  Refresh/close can therefore cancel paid work and consume the attempt. This is a
  demo limitation, not the desired final UX. Refresh-safe execution needs an
  explicit cancel control and a verified host lifecycle; removing the abort
  listener alone would neither provide durable background execution nor prove
  interruption safety. Carry that decision into UI-01/DEPLOY-01 review.
- 6: four-way paid concurrency/rate limits remain unmeasured. Zero SDK retries is
  required by INV-08; failures remain explicit unavailable outcomes, with only
  user-initiated bounded retries. Measuring capacity or changing scheduling belongs
  to a separately authorized live verification; no limits are relaxed here.
- 9: retain Jian's offered SDK factory cleanup as an agent-side follow-up; the
  server runtime/client duplication and stale agent comment remain documented.
- 10: centralized INV-08 constants across the agent/shared budget/durable runtime
  remain a coordinated follow-up. Existing hard limits stay at 8/10/60 seconds,
  enforced independently by schema, loop and durable reservations and regression
  checks. No contract or Jian-owned module changes accompany these review fixes.
