# 004 — EVAL-01 evaluator, scoring and baseline

Date: 2026-11-06. Owner: Jian Ting ([EVAL-01](https://github.com/JianTing-Li/spendwise/issues/12)). Details of commands and scoring: [`evals/README.md`](../../evals/README.md).

## Decisions
- **One evaluator for both methods.** `evals/evaluate.ts` runs the investigator and the rule-based baseline on the same case, the same records and the same harness condition, and scores both with the same function. Labels are scored after application validation; the model's own labels count only to show overclaims the validator caught.
- **Label acceptance with side questions.** A run passes when at least one finding has an acceptable label and no finding is `Explained` unless the case allows it. The FEAS-01 run showed why: a correct `Explained` finding came with a reasonable `Needs Review` side question. Requiring every finding to match would score that as a failure.
- **Unsupported `Explained` is the headline safety metric**, with a target of zero: an `Explained` finding where the case does not allow it, or that is not a verified explanation.
- **Cause correctness stays a human judgment.** The report keeps the model's own explanations next to the expected cause. No automatic text similarity is used.
- **Forbidden claims** are literal matches, with one proxy: "any stated business cause" means any validated `Explained` finding. Reworded claims need human review.
- **Harness conditions in code.** `retrieval_failure` makes every retrieval throw. `tool_limit` allows one retrieval through a new `toolLimit` option on the loop, which can only lower the 8-execution budget (INV-08). The baseline gets the same conditions.
- **Baseline `rules-v2`** follows record links and uses the application's record checks: `Explained` only when they pass, `Insufficient Evidence` when nothing is linked, otherwise `Needs Review`. It states no cause of its own. `rules-v1` always answered `Needs Review`, which made any comparison meaningless.
- **Held-out runs need `--final`** and run once, after the prompt and validator are final. Nothing is tuned on them, including the baseline.
- **Review time is not measured.** Reports say `unavailable`; the protocol is in `evals/README.md`.
- **INV-11 enforcement** was already in place from setup: ESLint rejects `ground-truth` imports from `src/` and `evals/baseline.ts`, and `tests/fixtures.test.ts` checks the rule. The baseline still imports no expected answers.

## Results so far (offline only)
- Baseline `rules-v2`, development split (9 cases): 9 of 9 run states and labels acceptable, 1 verified explanation, 0 unsupported `Explained`, 18 of 18 required evidence cited (`npm run eval:score-baseline`). Its record checks are the validator's, which were tuned on these cases, so this shows the checks agree with the expected labels, not that they generalize.
- So on development cases the model can only add value beyond the baseline through the quality of its own explanations and next steps, which are judged by people. Held-out cases are the real comparison.
- No paid evaluation has run yet under EVAL-01. Held-out has not been scored for either method.

## Open
- One approved paid development run (`npm run eval:real -- --allow-paid`, 9 cases; worst-case list-price estimate printed before the run, expected nearer $1 from FEAS-01 usage).
- After the prompt and validator are final: one held-out run with `--split held-out --final`.
- Hosting is unverified (DEPLOY-01, [#14](https://github.com/JianTing-Li/spendwise/issues/14)).
