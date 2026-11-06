# 003 — FEAS-01 feasibility check result

Date: 2026-11-05. Owner: Jian Ting ([FEAS-01](https://github.com/JianTing-Li/spendwise/issues/9), PR [#25](https://github.com/JianTing-Li/spendwise/pull/25)). Joint inspection: Elliot reviews this record and the run on PR #25.

One run is an example, not a reliability claim.

## What was run
- Command: `npm run eval:feasibility -- --allow-paid` (report `feasibility-v2`), with the key loaded server-side from the ignored `.env.local`. No credential appears in the report.
- Case: `renewal` (development set, records-only). Versions: fixture `demo-v1`, ground truth `ground-truth-v2`, prompt `prompt-v1`, baseline `rules-v1`.
- Configuration: `claude-opus-5-5` (requested and served), effort `medium`, `max_tokens` 8,000, SDK retries 0, run budget 60 s with a 10 s validation reserve.

## Result
| Measure | Value |
| --- | --- |
| Run state | `completed`, no error |
| Tool executions / model requests | 4 / 4 (limits 8 / 10) |
| Latency | 15.7 s total; requests 2.0, 1.4, 1.4 and 10.9 s |
| Tokens | 10,474 input, 1,448 output |
| Cost | about $0.07 at list price (check the Console for billed cost) |
| Stop reasons | `tool_use` on all 4 requests; none hit `max_tokens` |

**Model findings.**
1. `Explained`. It cites `pay-renewal-annual`, `inv-renewal` (NS-2026) and `note-renewal`. It gives the expected cause: a $12,000 annual software renewal explains the increase from $1,000 to $13,000. It says approval, accounting treatment and expense recognition are not established. All references are valid, no required evidence is missing, and no forbidden claim was made.
2. `Needs Review`. The monthly payments `pay-renewal-sep` and `pay-renewal-oct` have no invoice, and the October one may overlap the annual coverage. It says the records neither confirm nor rule this out. This is a reasonable extra question, not a claim.

**After validation:** both findings are `Needs Review`. Finding 1 became `contradicted`, so it was not a verified explanation.

**Baseline:** `Needs Review` ("thresholds were met; review linked records"). Not an acceptable label for this case.

**Cause correctness (human judgment):** finding 1 states the expected cause.

## Why finding 1 was downgraded
This is a validator false positive, not a model error. The explanation says "It does not establish that the payment was approved". The approval-claim pattern matches "payment was approved", but the negator "not" sits 4 words before it, and decision 002 only looks 3 words back in the clause. So the disclaimer the prompt asks for was treated as an approval claim.

## Decision: adjust, then proceed
- **Proceed** with the single Claude investigator, Opus 5.5 at medium effort. The loop completed well inside every budget, cited valid evidence, stated the right cause, and avoided human-only conclusions.
- **Keep `max_tokens` at 8,000.** Output was 1,448 tokens across 4 requests, and no request stopped on the limit.
- **Adjust before EVAL-01:** fix the negation false positive in `src/agent/validation.ts`. Otherwise EVAL-01 would score correct, hedged explanations as failures. Done in this PR: a claim inside the complement of a denied verb of showing or knowing ("does not establish that …") now counts as negated, including later items of the same list. Real approval claims are still flagged (decision 002, rule 3). Regression tests in `tests/evidence.test.ts` use the run's exact text: it now validates as `Explained` and `supported`, with the application's own explanation. This was not re-run against the model, so no new paid call was made.
- No model or effort comparison runs yet. The default configuration met the bar, so the remaining budget goes to EVAL-01.

## Shared blockers
- **Hosting is unverified.** No deployment target exists yet. DEPLOY-01 ([#14](https://github.com/JianTing-Li/spendwise/issues/14)) is now Jian's. 15.7 s fits the 60 s budget, but host limits have not been checked.
- **Retrieval is fixture-based.** Real database retrieval is APP-03 ([#6](https://github.com/JianTing-Li/spendwise/issues/6)), which depends on [#4](https://github.com/JianTing-Li/spendwise/issues/4).
- **Validator false positive:** fixed in this PR (see the adjustment above). A narrower negation rule could still flag other correct hedges; EVAL-01 should report any finding downgraded only by an overclaim match.
