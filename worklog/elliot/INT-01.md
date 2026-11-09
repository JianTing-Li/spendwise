# INT-01 implementation evidence

Owner: Elliot (`0x1Elliot`). [Issue #10](https://github.com/JianTing-Li/spendwise/issues/10).
Branch: `int-01-durable-investigations`.
Draft review: [PR #37](https://github.com/JianTing-Li/spendwise/pull/37).
Implementation/check revision: `64cd81142ccd48bc79afbd263d63b639ebf8e95c`.
Base: `5b6bcb689d216d0283de149f45f2c0b22e63844a`, freshly fetched origin/main.
GitHub holds task/review status. This file records implementation evidence only.

Read AGENTS, README, development, complete PRD snapshot, decisions 001–004,
handoff, live issue/discussion, current PR metadata, contracts, tool/loop/validator
interfaces, existing architecture/tests, database schemas/adapters/permissions,
retrieval code/grants and relevant installed Next.js Route Handler documentation.
Issue #10 is Elliot's. Dependencies #4/#6/#7/#8/#9 were closed as completed;
PRs #33/#34/#35 were verified merged and ancestral to the branch base. No existing
open PR for #10 was found. Used an isolated checkout and fresh feature branch;
no main editing or Jian-owned file editing occurred.

## Changes and rationale

- Explicit runtime construction wraps the existing real loop with scoped DB
  retrieval and fake-client injection for tests. Stub builds/runs without secrets;
  unknown configuration fails, and missing real configuration remains unavailable.
- Concurrent execution retains the acceptance deadline rather than postponing it
  until claim. Durable pre-dispatch reservations enforce 8 retrievals/10 requests;
  validation SQL uses the same budget and caches complete scoped record sets.
- Request cancellation, deadline and cross-process reset observation stop work;
  generation is rechecked with final persistence. Retries retain existing mode,
  bounded history and predecessor idempotency. Per-run failures cannot stop peers.
  Logs contain sanitized application error name/message only.
- GET is a coherent read-only snapshot deriving expiry; retry persists expiry.
  Invalid review conflicts now return 409. Empty/inconsistent completion is refused.
- Local PGlite reader setup is automatic and verified. PostgreSQL reader pools
  remain live. Evidence reads share generation locks, allowing concurrent readers
  while reset/injection retain exclusive coordination.
- Added fake-model integration/API tests and a visible offline three-cycle demo.
  Fixed offline HTTP cookie fixture to include APP-02's required sign-in timestamp.
  Corrected schema helpers to SET search_path before read-only isolation begins.

Architecture, acceptance evidence, limitations, commands and teach-back exercise:
[INT-01 verification](../../docs/int-01-verification.md).

## Actual checks and corrected failures

- Full `npm run check`: typecheck/lint/tests/production build; final counts in the
  linked verification document. Initial 205 existing tests were preserved.
- New integration and API tests pass, including fake model failure, persistence
  failure, forced expiry, killed-worker durable counters, reset race and cancellation.
- Local PostgreSQL suite: 13 passed, 0 failed/skipped. The initial suite exposed
  SQLSTATE 25001 because SELECT set_config established a snapshot before SET
  TRANSACTION; changed to SET LOCAL and reran successfully.
- Extended separate-login PostgreSQL demo passed: four durable real/fake runs,
  eight fake requests, concurrent readers/reset exclusion, seven denied operations,
  no open transaction during the four-model wait barrier; cleanup succeeded.
- Both Playwright suites passed; offline baseline and the built-app offline
  HTTP authorization demo passed (401/403/200 and protected dashboard). Visible HTML/JSON demo
  asserted three full cycles, persisted review after reopen, cancellation, retry
  idempotency and stale-result rejection, with zero paid requests.
- Initial server-only test import failure was fixed through the server-test marker
  alias; Jian's tests were not edited. First test data regression was not masked.
- Sandbox initially blocked local PostgreSQL shared memory setup; authorized local
  execution succeeded. Automatic approval review later misclassified Elliot's
  retrieval test as Jian-owned in a combined edit/test command. Git provenance
  (5a69a3b, author 0x1Elliot) and APP-03 ownership were inspected; separate local test
  execution then passed review. No ownership restriction was bypassed.

No credentials were read or copied. Disposable local test roles use an internally
generated password that is never printed. No paid model calls, Neon calls,
held-out scoring, deployments, merges, main commits or protection changes.
No agent/evaluator, contract, fixture, migration, manifest/dependency or CI edits.
Shared coordination: review the Vitest marker alias and documentation in the draft
PR. Existing unavailable real export stays unchanged as a compatibility boundary.

GitHub run 42545016780 passed typecheck/lint/219 tests/build and PostgreSQL,
but its browser check timed out on initial dashboard readiness before injection.
The E2E now awaits and asserts the initial GET response (bounded at 20 seconds)
instead of relying on the default five-second UI wait across cold compilation
and PGlite initialization. No investigation deadline or financial assertion was
changed. The branch's next CI run supplies the final result.

Next action: user-led reproduction/teach-back and normal AI/Jian/human PR review.
Live hosting/SDK verification remains separately authorized DEPLOY-01 work.
