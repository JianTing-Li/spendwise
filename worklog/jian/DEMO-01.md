# DEMO-01 — Validate three demo cycles and publish an honest handoff

Owner: Jian Ting (moved from Elliot on 2026-11-10, https://github.com/JianTing-Li/spendwise/issues/15#issuecomment-6760735751). Issue: https://github.com/JianTing-Li/spendwise/issues/15
Branch: `demo-01`, from `origin/main` at `2ca6d6f`. PR: https://github.com/JianTing-Li/spendwise/pull/49

No URLs with credentials, passwords or keys appear here.

## Plan
1. Local stub and zero-call checks (free).
2. README and handoff docs.
3. Paid, each needing Jian's approval: three consecutive real-mode cycles on the live site (inject → detect → investigate → validate → review → reset); live failure recovery and reset during a run; the one-time held-out evaluation (`--split held-out --final`).

## Checks
- Local, on `demo-01` (Node 24.18.0), zero model calls: `npm run test:e2e` 8 of 8 passed (inject, review, persist and reset; reset during execution rejects late responses; incomplete, cancelled and failed states; 401/403 handling). `npm run test:e2e:retry` 1 of 1 passed (real mode with no key: failed runs, retry history, three-attempt limit, stale retry after reset returns 409).
- Live site, signed out, after APP-05 (#45, deploy of `2ca6d6f`): recorded at https://github.com/JianTing-Li/spendwise/issues/45#issuecomment-6760758557. The live state is still the DEPLOY-01 real-mode run (generation 2, 4 real runs).

- Held-out evaluation, run once (2026-11-10, approval: https://github.com/JianTing-Li/spendwise/issues/15#issuecomment-6761337409, $0.23 list price): `evals/reports/eval-01-held-out-2026-11-10.json`, results in decision 004. Human cause review accepted at https://github.com/JianTing-Li/spendwise/issues/15#issuecomment-6761214393.

- **Three consecutive live real-mode cycles** (2026-11-10, approval: https://github.com/JianTing-Li/spendwise/issues/15#issuecomment-6761337409; deploy of `2ca6d6f`, `INVESTIGATOR_MODE=real`, `claude-opus-5-5`). Driven from Jian's signed-in Chrome session with the same requests the dashboard buttons send (`POST /api/demo` with the CSRF header), checking `GET /api/demo` after every step. A baseline Reset first cleared the DEPLOY-01 state (generation 2 → 3).

  | Cycle | Inject | Runs | Model requests / retrievals | Inject again | Review | After Reset |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | 200, 17.1 s | 4 completed, real | 16 / 24 | 200, `changed: false`, no new runs or calls | 4 × 200 | generation 3 → 4, 2 baseline payments, 0 runs |
  | 2 | 200, 16.3 s | 4 completed, real | 16 / 24 | same | 4 × 200 | 4 → 5, same |
  | 3 | 200, 17.9 s | 4 completed, real | 16 / 24 | same | 4 × 200 | 5 → 6, same |

  - Payment IDs were unique at every step: 7 while injected (2 baseline + 5 scenario), 2 after each Reset. No exception, run or review survived a Reset.
  - Every run stayed within limits (4 of 10 model requests, 6 of 8 retrievals). Findings varied between cycles, as model output does: verified explanations (`Explained/supported`) were 2, 1 and 2; one finding in cycle 2 was downgraded to `Needs Review/contradicted` by validation. Every other finding was `Needs Review` or `Insufficient Evidence`.
  - Cost: 48 model requests, estimated about $0.80 at list price from the earlier per-request cost (not confirmed against the Anthropic console). The demo ends at baseline (generation 6), which public visitors now see.
  - Sign-in: Claude clicked "Sign in with GitHub" in Jian's Chrome at Jian's request; GitHub returned straight to the app with the existing GitHub session and prior authorization. Nothing was typed.

## Decisions
- The held-out validator false positive is recorded, not fixed: held-out cases are never used for tuning.
- README rewritten for recruiters: live link, what the agent may and may not do, development results with their limits, no savings or reliability claims.

## Not verified live
- Failure, incomplete and retry recovery, and Reset during a running investigation, were not exercised on the live site: forcing a failure needs a Vercel configuration change, and each attempt costs model calls. Local evidence, zero model calls: `npm run test:e2e:retry` (real mode without a key: failed runs, retry history, three-attempt limit, stale retry after Reset returns 409) and `tests/e2e/review.spec.ts` (Reset during execution rejects late read and mutation responses; incomplete, cancelled and failed states).
- Analyst review time: not measured (protocol in `evals/README.md`).

## Continuity and unresolved risks
- Owners: Jian (hosting, agent, evaluation); Elliot (application paths). Vercel team Calm Forge and the Neon project are in Jian's accounts; the GitHub OAuth app and `SPENDWISE_ACCESS_GRANTS` decide who can run investigations.
- Risks: the validator's negation gap (decision 004); public reads have no rate limit (decision 005); real mode spends model budget on every Simulate and Retry by a granted user; sessions end one hour after sign-in; free-tier Neon and Vercel limits.

## Next action
- Review of the DEMO-01 PR.
