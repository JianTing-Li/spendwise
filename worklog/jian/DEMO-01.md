# DEMO-01 — Validate three demo cycles and publish an honest handoff

Owner: Jian Ting (moved from Elliot on 2026-11-10, https://github.com/JianTing-Li/spendwise/issues/15#issuecomment-6760735751). Issue: https://github.com/JianTing-Li/spendwise/issues/15
Branch: `demo-01`, from `origin/main` at `2ca6d6f`. PR: (added when opened)

No URLs with credentials, passwords or keys appear here.

## Plan
1. Local stub and zero-call checks (free).
2. README and handoff docs.
3. Paid, each needing Jian's approval: three consecutive real-mode cycles on the live site (inject → detect → investigate → validate → review → reset); live failure recovery and reset during a run; the one-time held-out evaluation (`--split held-out --final`).

## Checks
- Local, on `demo-01` (Node 24.18.0), zero model calls: `npm run test:e2e` 8 of 8 passed (inject, review, persist and reset; reset during execution rejects late responses; incomplete, cancelled and failed states; 401/403 handling). `npm run test:e2e:retry` 1 of 1 passed (real mode with no key: failed runs, retry history, three-attempt limit, stale retry after reset returns 409).
- Live site, signed out, after APP-05 (#45, deploy of `2ca6d6f`): recorded at https://github.com/JianTing-Li/spendwise/issues/45#issuecomment-6760758557. The live state is still the DEPLOY-01 real-mode run (generation 2, 4 real runs).

- Held-out evaluation, run once (2026-11-10, approved by Jian, $0.23 list price): `evals/reports/eval-01-held-out-2026-11-10.json`, results in decision 004. Human cause review accepted at https://github.com/JianTing-Li/spendwise/issues/15#issuecomment-6761214393.

## Decisions
- The held-out validator false positive is recorded, not fixed: held-out cases are never used for tuning.
- README rewritten for recruiters: live link, what the agent may and may not do, development results with their limits, no savings or reliability claims.

## Next action
- Three live real-mode cycles (approved by Jian 2026-11-10), after Jian signs in on the live site.
