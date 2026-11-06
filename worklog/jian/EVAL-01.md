# EVAL-01 — Fair baseline comparisons and held-out evaluations

Owner: Jian Ting. Reviewer: Elliot. Issue: https://github.com/JianTing-Li/spendwise/issues/12
Branch: `eval-01-evaluation`, from `main` at `103b3c0` (PR #25 merged). PR: https://github.com/JianTing-Li/spendwise/pull/33.

## Changes
- `evals/evaluate.ts`: evaluator for the investigator and the baseline on identical records and harness conditions; scoring independent of model self-assessment; failure categories; versions, configuration, counts, latency, tokens and cost estimates; review time recorded as unavailable.
- `evals/real.ts`: `npm run eval:real -- --allow-paid` now runs the evaluator. No call without the flag and a server-side key; held-out also needs `--final`; prints a worst-case cost estimate first.
- `evals/score-baseline.ts` and `npm run eval:score-baseline`: offline baseline scoring.
- `evals/baseline.ts`: `rules-v2`, which follows record links and uses the application's record checks (see decision 004). FEAS-01's report now shows `rules-v2`.
- `src/agent/loop.ts`: optional `toolLimit` for the `tool_limit` harness condition; it can only lower the 8-execution budget.
- `tests/evaluation.test.ts`: 16 offline tests (scoring rules, both harness conditions, the paired report, the budget cap, baseline scoring, CLI refusals). `tests/feasibility.test.ts` updated for `rules-v2`.
- Docs: `evals/README.md` (commands, scoring, review-time protocol), decision 004.

## Checks (actual)
- `npm run check` (typecheck, lint, 163 tests, build) and `npm run eval:baseline` passed locally.
- `npm run eval:score-baseline` (development): 9/9 labels acceptable, 0 unsupported Explained.

## Decisions
See [decision 004](../../docs/decisions/004-evaluation.md). Held-out has not been scored for either method.

## Blockers
- The paid development run needs Jian's approval for the spend.

## Next action
- Jian approves (or not) one paid development run; then Elliot reviews the PR.
