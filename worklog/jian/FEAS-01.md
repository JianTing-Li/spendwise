# FEAS-01 — Joint early Claude feasibility check

Owner: Jian Ting. Reviewer: Elliot. Issue: https://github.com/JianTing-Li/spendwise/issues/9
Branch: `feas-01-feasibility`. PR: https://github.com/JianTing-Li/spendwise/pull/25. AI-02 (#22) is merged, and current `main` is merged into this branch.

## Changes
- `evals/feasibility.ts` and `npm run eval:feasibility`: an opted-in command that runs the real loop once on one records-only development case (default `renewal`, demo-v1), validates the findings, and prints a JSON report:
  - versions: fixture, ground truth, prompt
  - configuration: requested and served model, effort, response limit, SDK retries 0, run budget and validation reserve
  - run: state, error, tool executions, model requests, latency, stop reason per request
  - usage: input and output tokens and a list-price cost estimate
  - the model's own findings and the validated findings
  - comparison with the prewritten expected result (run state, acceptable labels, verified explanation, required evidence cited, forbidden claims) and with the rule-based baseline
  - hosting: recorded as unverified
- Without `--allow-paid` it makes no call; without `ANTHROPIC_API_KEY` it makes no call. Held-out cases and harness-condition cases are refused. Credentials never appear in the report or messages.
- `src/agent/loop.ts`: optional `maxTokens` (default unchanged at 8,000) so the run can measure whether the limit cuts responses off; `--max-tokens`, `--effort` and `--model` flags for the comparison runs.
- `tests/feasibility.test.ts` (5 offline tests with a scripted fake client).

## Review changes (2026-11-05)
Elliot's review on #25 asked for two changes before the paid run:
- **Model reasoning vs verified explanation.** Validation replaces a supported finding's explanation with the application's own statement, so a model that gives the wrong cause could still look successful. The report now shows the model's labels and explanations next to the validated ones (`comparison.label`, `comparison.cause.modelExplanations`, `explanationReplacedByApplication`). `recordsSupportExplained` replaces `verifiedExplanation`: it says the records support the label, not that the model found the cause. Cause correctness is always `requires_review`, a human judgment. Regression test: correct citations with "office furniture" as the cause.
- **Real baseline.** `evals/baseline.ts` now exports `baselineFor` and `BASELINE_VERSION` (`rules-v1`); `npm run eval:baseline` output is byte-for-byte unchanged. The report records the baseline's own label, explanation and version for the same case instead of a hardcoded label.
- Report version is now `feasibility-v2`.

## Paid run (2026-11-05)
- Jian approved one paid run. Command: `npm run eval:feasibility -- --allow-paid`, default case `renewal`, `claude-opus-5-5`, medium effort, `max_tokens` 8,000. The key was loaded from the ignored `.env.local` and never printed.
- Result: `completed`, 4 tool executions, 4 model requests, 15.7 s, 10,474 input and 1,448 output tokens, about $0.07 at list price. Total paid spend so far: about $0.07.
- The model labeled the renewal `Explained` with the expected cause and valid citations. The validator downgraded it to `Needs Review` (`contradicted`) because of a negation false positive: "does not establish that the payment was approved" has its "not" 4 words before the claim, one more than the 3-word window allows.
- Full results, decision and blockers: [docs/decisions/003-feasibility.md](../../docs/decisions/003-feasibility.md).

## Validator fix (2026-11-05)
- `src/agent/validation.ts`: a claim inside the complement of a denied verb of showing or knowing ("does not establish that …", "doesn't show whether …") counts as negated. That includes later list items that each open another complement. A denial ends at a sentence end or a contrasting word. A negated noun ("no evidence that …") is still flagged, as in decision 002.
- `tests/evidence.test.ts`: 3 new tests. They cover denied lists, statements a denial must not reach, and the run's exact renewal explanation, which now validates as `Explained` and `supported`. Two of the three failed on the old code.
- Decision 002 rule 3 and decision 003 are updated. No new paid call was made.

## Checks (actual)
- After merging main (PR #30): `npm run typecheck`, `npm run lint`, `npm test` (141 passed), `npm run build` all passed locally.
- After the validator fix: typecheck, lint, `npm test` (144 passed), build and `npm run eval:baseline` all passed locally.

## Decisions
- Default case `renewal` (demo-v1): expected Explained, so it exercises the full path to a verified explanation. Other development cases can be run with `--case`.
- The report prints to stdout, like the baseline, so no generated output is written into the repository.
- Hosting: no deployment target is chosen yet, so the 60-second budget is recorded as unverified against host limits. DEPLOY-01 (#14) is now Jian's.
- Decision: adjust, then proceed. Keep Opus 5.5 medium and `max_tokens` 8,000. Fix the validator negation false positive before EVAL-01. No comparison runs. See decision 003.

## Next action
- Elliot inspects the run and decision 003 on PR #25.
