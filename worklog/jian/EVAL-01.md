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
- Fixes from Elliot's review of PR #33 (`evaluator-v2`):
  - One held-out guard (`splitFrom`, plus a check in the evaluator itself) now covers `eval:score-baseline` as well as `eval:real`.
  - "Any stated business cause" is judged by content as well as by label. Cause wording under a cautious label is listed for human review and left unresolved. An `Explained` label the validator downgraded still counts as made.
  - Offline regressions cover the guard, Elliot's tool-limit reproduction, downgraded claims, and genuine negation or uncertainty.

## Checks (actual)
- `npm run check` (typecheck, lint, 163 tests, build) and `npm run eval:baseline` passed locally.
- `npm run eval:score-baseline` (development): 9/9 labels acceptable, 0 unsupported Explained.
- Paid development run, 2026-11-07, at `37abaf3`: exit 0; model 9/9 labels acceptable, 0 unsupported Explained, 18/18 required evidence, 2 forbidden-claim flags reviewed as attributed reports of the hostile note; about $0.53 list price. Report: `evals/reports/eval-01-development-2026-11-07.json`; summary in decision 004.

- After the review fixes: `npm run check` passed (typecheck, lint, 171 tests, build); `npm run eval:score-baseline` unchanged (9/9, 0 unsupported `Explained`, 0 listed for review); `eval:score-baseline -- --split held-out` refused with nothing scored. The stored paid report was re-scored offline with `evaluator-v2`: 2 stated-cause sentences are listed for review (retrieval-failure, tool-limit); nothing else changes. Held-out was not run.

## Decisions
See [decision 004](../../docs/decisions/004-evaluation.md). Held-out has not been scored for either method.

## Blockers
- None.

## Next action
- A person reviews cause correctness in the development report and decides the 2 stated-cause sentences; Elliot re-reviews the PR (including the `src/agent/loop.ts` change).
- Held-out runs once with `--split held-out --final`, after the prompt and validator are final.
