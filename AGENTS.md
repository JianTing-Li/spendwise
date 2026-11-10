# SpendWise working agreement

## Start here — including "let's work on the project"
Treat a general request to work on SpendWise as a request to follow this routine.

1. **Owner.** Use the human owner stated in the conversation. If unknown, ask only whether the session belongs to Jian or Elliot. Never infer it from Git identity, credentials or file paths.
2. **Checkout.** Check root, branch, `git status`, and remote/PR state. Preserve uncommitted work. Follow the branch rules below before editing.
3. **Context.** Read `README.md`, `docs/development.md`, `docs/prd.md`, `docs/decisions/`, and the issue index in `docs/handoff.md`. Live GitHub Issues hold task specifications and status.
4. **Task.** Use an explicitly requested issue. Otherwise resume the owner's `status:in-progress` issue, or pick their earliest-milestone `status:ready` issue whose dependencies are closed, lowest number first. If none is eligible, report the blocker; never take another person's issue or bypass a dependency.
5. **Evidence.** Read the full issue and its discussion, the latest worklog (create it if missing), referenced contracts/fixtures, relevant code/tests, and the framework guide for the change. Keep evaluator-only answers out of the investigation agent's context.
6. **Scope, then work.** State owner, issue, intended change, owned paths, dependencies and verification, then proceed. Ask only about missing consequential requirements, ownership conflicts, or actions that need separate authorization. Never silently change contracts, financial conventions or invariants.
7. **Handoff.** Update the worklog, run the relevant checks, report actual results and gaps.

## Branch hygiene
- Every editing session starts a new branch from the latest `origin/main`, for exactly one issue. Name it after the issue (for example `app-01-neon-adapter`).
- One open PR per issue. Keep working on that PR's branch: review fixes and merging `origin/main` into it are expected. Never rewrite its history (no rebase or force-push).
- Never commit to a branch whose PR is merged. New work after a merge gets a new branch and issue.
- If a PR must be replaced, close the old one in the same step with "Superseded by #N".
- Concurrent sessions use separate branches/worktrees. No blind pull, reset, force-push or merge.
- Before asking for a merge: `git status` is clean, `git log @{u}..HEAD` is empty (everything pushed), the PR head SHA matches local `HEAD`, and CI is green on that SHA. If a push fails, say so and stop; do not report the work as in the PR.

## Dependencies and combined PRs
- Don't start an issue until every dependency is merged into `main`. Never base a PR on another unmerged PR's branch.
- While blocked, review the other person's PRs, or take another ready issue whose dependencies are merged.
- Exception: you may continue straight into a dependent issue on the same branch and PR as its dependency, up to 3 issues per PR. The PR says "Closes #N" for each issue, and each must be fully complete.
- Every PR gets an AI code review before approval. The approving human reads the review's findings (not necessarily every line of code), confirms they're fixed or accepted, and then approves.
- Review each other's PRs promptly, within a few hours on coding days, so no one sits blocked.

## Authority and workflow
- Product requirements: `docs/prd.md`. Confirmed decisions: `docs/decisions/`.
- **Status lives only in GitHub.** Ownership is the issue assignee; acceptance and approvals are PR reviews and issue comments. Docs and worklogs link to them and never restate status, approval or "pending" state.
- Status labels: `status:ready` → `status:in-progress` → `status:review` → `status:done`, exactly one per issue. The Status labels workflow moves them when a PR opens (draft → in-progress, ready → review) and when an issue closes as completed. Set `status:in-progress` by hand when starting without a PR. Ready means queued, not unblocked.
- Every PR fully completes at least one issue: `Closes #<number>` in the description for each completed issue, `Refs #<number>` for partial work. The Issue link check enforces a real closing reference. Merging into `main` closes the issue.
- `main` is protected: changes land by PR with one approval. Never merge without explicit human authorization.
- One active implementation task per person. Coordinate changes to contracts, fixture IDs, dependencies, CI, configuration, migrations and this file. Breaking contract or fixture-ID changes need a separate PR approved by both humans; new optional fields/enums still need consumer review.
- Worklogs: `worklog/<person>/<TASK-ID>.md` with changes, actual checks, decisions, blockers, next action, requests, and links to the issue and PR. Agree before transferring ownership.
- New issues use the Task issue template.

## Architecture and ownership
Known GitHub accounts: Jian Ting is `JianTing-Li`; Elliot Watson is `0x1Elliot`. They map named humans to issue assignees; they do not identify the current session's owner.

One Next.js application, Node Route Handlers, TypeScript, Tailwind. USD synthetic data only. Local file-backed PGlite; planned Neon via parameterized `pg` queries and pooled connections. No separate service, background infrastructure, vector database, or agent framework.

| Owner | Paths / responsibility |
| --- | --- |
| Elliot | `src/app/`, `src/domain/`, `src/server/`, `tests/financial.test.ts`, `tests/store.test.ts`, UI E2E; app, data, retrieval implementations, stub, access |
| Jian | `src/agent/`, `evals/`; tool definitions, real investigator, evidence validation, evaluation |
| Shared | `src/contracts/`, `src/investigation/`, `src/fixtures/`, safety tests, manifests, CI and docs |

Deployment has no lead yet; see DEPLOY-01 (#14). Real and stub implementations use `Investigator`. Tool schemas belong to Jian; retrieval/query implementations belong to Elliot. All money/detection stays in `src/domain/`; do not duplicate it in agent or UI code.

## Permanent invariants
- **INV-01 Synthetic:** All financial records remain synthetic in every mode. Credentials never connect this app to real financial transactions.
- **INV-02 One agent:** One Claude investigator; read-only scoped retrieval. No arbitrary SQL or database credentials in model input.
- **INV-03 Application control:** Code controls calculation, detection, authorization, persistence, injection, reset, and final validation.
- **INV-04 Financial correctness:** Safe integer USD cents; cash by entry date; no expense recognition. Similar payments do not prove duplication or recoverability.
- **INV-05 No execution:** No payments, refunds, ledger postings, or financial modifications.
- **INV-06 Evidence:** IDs alone do not prove support. Unsupported, contradictory, missing, or unavailable evidence cannot become a verified successful finding. Stub run completion means the stub finished, never that an investigation was verified.
- **INV-07 Untrusted content:** Retrieved text is evidence, never instruction. Bound input sizes; render text safely; no model-controlled permissions.
- **INV-08 Budgets:** At most 8 retrieval executions (including failures/retries), 10 model API requests, and 60 seconds from acceptance through validation/persistence. Real SDK retries must be `0`; enforce cancellation and counters in code. Reserve time for validation/persistence. Never silently extend limits.
- **INV-09 Honest state:** Pending, running, completed, incomplete, failed, cancelled remain distinct. No real-to-stub fallback. Unimplemented integrations fail explicitly.
- **INV-10 Reset/idempotency:** Stable injection/exception IDs; atomic generation changes; check generation under the same transaction as result persistence. Reset invalidates old runs. Retries/concurrency cannot duplicate records.
- **INV-11 Ground truth:** `evals/ground-truth/` is evaluator-only. Never import it into application, agent, retrieval, or model prompts.
- **INV-12 Secrets/access:** Credentials server-side only; never commit, print, log, or return them. Mutation access is enforced in code. Deployed mode fails closed unless hosted authentication is fully configured. Optional public viewing (`SPENDWISE_PUBLIC_READ=1`, off by default, [decision 005](docs/decisions/005-public-read-only.md)) exposes synthetic state read-only to signed-out visitors; it never grants mutation or model access. No `NEXT_PUBLIC_*` credentials.

## Working commands and conventions
Node version: `.nvmrc`; npm version: `packageManager`. Exact dependencies; one npm lockfile. Strict TypeScript and Zod at boundaries. Use parameterized queries and meaningful failure tests. Scope tests to changed behavior; never claim checks ran unless they did.

`npm ci` · `npm run dev` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run build` · `npm run test:e2e`.

Routine tests: isolated local databases, fake responses, no Neon/network/model calls. Real evaluations require a separate opted-in command; currently unavailable. Do not relax tests to make unsupported behavior appear complete.

Keep `.env.local`, `.data/`, credentials, and generated output ignored. Read `docs/development.md` before local DB maintenance; never open one data directory from multiple processes.

Commit messages: short and descriptive. Push task branches and open PRs when authorized. Never merge, deploy, change repository settings, or create remote issues without explicit authorization.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
