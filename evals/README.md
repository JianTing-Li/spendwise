# Evaluation boundary

`npm run eval:baseline` emits a rule-based report from the same scoped records available to the investigator. It does not grade model quality or import expected answers.

## Datasets and ground truth

Investigator inputs (records the tools may retrieve) live in `src/fixtures/`: the demo injection `demo-v1` (`scenarios.ts`) and the evaluation datasets `eval-dev-v1` and `eval-heldout-v1` (`evaluation.ts`). They contain no answers.

Expected findings are evaluator-only, in `ground-truth/development.json` and `ground-truth/held-out.json`, loaded and schema-checked by `ground-truth/index.ts`. Each case is keyed by dataset, exception ID (as `detect()` produces it) and harness condition (`none`, `retrieval_failure`, `tool_limit`), and records the expected run state, an expected label plus any acceptable alternatives, the expected cause, required evidence, application amounts and forbidden claims. `tests/fixtures.test.ts` checks that the cases cover exactly the exceptions each dataset produces and that required evidence is retrievable in scope.

Held-out cases (`held-out.json`, including the demo lookalike) are never used to tune prompts or validators; their source records remain accessible to the tools like any other. Thirteen small cases do not establish generalization. ESLint rejects any import of `ground-truth` from `src/` or `evals/baseline.ts` (INV-11); never paste its contents into prompts.

Version history: `ground-truth-v1` (setup) was keyed by vendor and omitted `increase:vendor-duplicate:2026-10` and two expected labels. `ground-truth-v2` (DATA-01) keys cases by exception ID, adds that case, sets a label on every case and adds the missing/contradictory, hostile, failure, limit and held-out cases. Correct an expectation only by bumping the version with a rationale here.

`npm run eval:feasibility -- --allow-paid` (FEAS-01) runs the real loop once on one development case and prints a report comparing it with the expected result and the baseline. It refuses held-out cases and makes no call without the flag and a server-side key. The report goes to stdout; a run kept as evidence for a decision is saved under `evals/reports/` with its commit and configuration (generated output stays in the ignored `evals/results/`).

## Evaluator (EVAL-01, `evaluate.ts`)
- `npm run eval:score-baseline [-- --split development|held-out --final]` scores the rule-based baseline against the expected answers. No model call, no credentials. Held-out needs `--final`, the same guard as `eval:real`.
- `npm run eval:real -- --allow-paid [--split development] [--case id ...] [--model ID] [--effort medium] [--max-tokens N] > report.json` runs the real investigator and the baseline on the same records, one case at a time, and scores both. It needs a server-side `ANTHROPIC_API_KEY` and separate approval for the spend; it prints a worst-case list-price estimate first. `--split held-out` also needs `--final`: held-out runs once, after the prompt and validator are final.
- Stub tests and `tests/evaluation.test.ts` (scripted fake clients) are engineering checks, not model-quality results.

**Harness conditions.** `retrieval_failure`: every retrieval throws, for both methods. `tool_limit`: one retrieval is allowed (`TOOL_LIMIT_CONDITION`); the loop's `toolLimit` option can only lower the 8-execution budget, never raise it (INV-08). Validation always reads the application-scoped records, not the harness view.

**Scoring** never uses the model's self-assessment. Per case, for each method:
- run state vs expected;
- labels after application validation: acceptable when at least one finding has an acceptable label and no finding is `Explained` unless `Explained` is acceptable (a correct main finding plus a cautious side question passes);
- unsupported `Explained` findings: `Explained` when the case does not allow it, or not a verified explanation. **Target: zero.** Overclaims the validator caught are counted separately;
- required evidence cited, invalid references;
- forbidden claims: literal, case-insensitive matches in the method's own wording. "any stated business cause" is made by any `Explained` label, before or after validation, so a claim the validator downgraded still counts. Under any other label, sentences in the explanation or next step with cause, explanation or suggestion wording ("caused by", "due to", "explains", "suggests", …) that is not directly negated or put as a question are listed in `forbiddenClaimsNeedReview`, and the case's `needsReview` holds `forbidden_claim`. That is unresolved, neither clean nor failed, until a person decides. "Nothing explains the increase" is not listed. A reworded claim needs human review, and so does a match where the method attributes the claim to a record and rejects it (for example "the note claims the payments are approved"); the automatic score is kept as printed and the review is recorded next to it;
- failure categories: `run_state_mismatch`, `run_failed`, `no_findings`, `label_unacceptable`, `unsupported_explained`, `invalid_reference`, `missing_required_evidence`, `forbidden_claim`;
- cause correctness is always `requires_review`: a person compares the model's own explanations (kept in the report) with the expected cause.

The report records ground-truth, prompt, baseline and fixture versions; the requested and served model, effort, response limit, SDK retries, run budget and validation reserve; per case the tool executions, model requests, latency, stop reasons, tokens and list-price cost estimate; and totals. One run per case on 13 synthetic cases is not a reliability or generalization claim.

**Baseline `rules-v2`** (`baseline.ts`) reads the same scoped records through the same retrieval. It takes the records a reviewer would open first by following links (current-period cash with an invoice for an increase, or the flagged pair for a duplicate; their invoices; linked notes). It is `Insufficient Evidence` when no invoice or note is linked, `Explained` only when the application's record checks (decision 002) support those records, and `Needs Review` otherwise. It never states a cause of its own. `rules-v1` always answered `Needs Review`. Because those record checks were tuned on the development cases, the baseline's development score is not evidence of generalization.

## Review-time protocol
No analyst has been timed, so every report says `reviewTime: unavailable`. When people take part:
1. Use participants who did not write the cases or see the expected answers.
2. Give each participant the same exceptions, half with the rule-based report and half with the investigator's findings, alternating which comes first.
3. Time from opening an exception to recording a review decision. Record the decision and whether it matches the expected label.
4. Report the median time and accuracy per method and the number of participants. Claim no improvement beyond what is measured.

Current results: see decision 004. No model quality, savings, ROI, or deployment outcome has been measured.
