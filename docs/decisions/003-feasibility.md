# 003 — FEAS-01 feasibility check result

Date: 2026-11-05. Owner: Jian Ting ([FEAS-01](https://github.com/JianTing-Li/spendwise/issues/9), PR [#25](https://github.com/JianTing-Li/spendwise/pull/25)). Joint inspection: Elliot reviews this record and the run on PR #25.

One run is an example, not a reliability claim. This record has two parts that must not be confused:
- **Original paid run** (2026-11-05, commit `13f8499`): the only model call. Its full report is kept unchanged in [`evals/reports/feas-01-renewal-2026-11-05.json`](../../evals/reports/feas-01-renewal-2026-11-05.json): configuration, both model findings with their evidence, the validated findings, and the expected-result and baseline comparison.
- **Offline validator retest** (later commits on PR #25): the same recorded model findings re-validated with the fixed validator. No model call.

## Original paid run
### What was run
- Commit: `13f8499` (branch head when the report was written). Command: `npm run eval:feasibility -- --allow-paid` (report `feasibility-v2`), with the key loaded server-side from the ignored `.env.local`. No credential appears in the report.
- Case: `renewal` (development set, records-only). Versions: fixture `demo-v1`, ground truth `ground-truth-v2`, prompt `prompt-v1`, baseline `rules-v1`.
- Configuration: `claude-opus-5-5` (requested and served), effort `medium`, `max_tokens` 8,000, SDK retries 0, run budget 60 s with a 10 s validation reserve.

### Result
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

**After validation (original result, unchanged):** both findings are `Needs Review`. Finding 1 became `contradicted` and finding 2 stayed `unverified`, so the run produced no verified explanation.

**Baseline:** `Needs Review` ("thresholds were met; review linked records"). Not an acceptable label for this case.

**Cause correctness (human judgment):** finding 1 states the expected cause.

### Why finding 1 was downgraded
This is a validator false positive, not a model error. The explanation says "It does not establish that the payment was approved". The approval-claim pattern matches "payment was approved", but the negator "not" sits 4 words before it, and decision 002 only looks 3 words back in the clause. So the disclaimer the prompt asks for was treated as an approval claim.

## Offline validator retest
- **What:** the two model findings from the report, re-validated with the current validator by `tests/evidence.test.ts` ("offline retest"). It reads the committed report, so anyone can repeat it. No model call, no new spend.
- **Result:** finding 1 is `Explained`, `valid`, `supported`, with the application's own explanation. Finding 2 stays `Needs Review`, `valid`, `unverified`. This is what the run would have produced with the fixed validator. It is not a second run, and it says nothing about how the model would answer again.
- **Fix, first version (commit `1e3675c`):** treated a claim inside the complement of a denied verb ("does not establish that …") as negated. Elliot's review on PR #25 showed it also accepted affirmative claims after "so", "because" or "then" ("It does not establish that the invoice was disputed so the payment was approved").
- **Fix, current version:** the denial ends at any clause link, at a list break not followed by another complement, and at a verb or more than four words between the complement's opener and the claim (decision 002, rule 3). New tests put each of these affirmative claims into the run's explanation and into its `nextStep`; every one stays `Needs Review` / `contradicted` and keeps the model's wording.

## Decision: adjust, then proceed
- **Proceed** with the single Claude investigator, Opus 5.5 at medium effort. The loop completed well inside every budget, cited valid evidence, stated the right cause, and avoided human-only conclusions.
- **Keep `max_tokens` at 8,000.** Output was 1,448 tokens across 4 requests, and no request stopped on the limit.
- **Adjust before EVAL-01:** fix the negation false positive in `src/agent/validation.ts`. Otherwise EVAL-01 would score correct, hedged explanations as failures. Done in this PR (see the offline retest above). Real approval claims are still flagged, including after "so", "because" and "then" (decision 002, rule 3). No new paid call was made.
- No model or effort comparison runs yet. The default configuration met the bar, so the remaining budget goes to EVAL-01.

## Shared blockers
- **Hosting is unverified.** No deployment target exists yet. DEPLOY-01 ([#14](https://github.com/JianTing-Li/spendwise/issues/14)) is now Jian's. 15.7 s fits the 60 s budget, but host limits have not been checked.
- **Retrieval is fixture-based.** Real database retrieval is APP-03 ([#6](https://github.com/JianTing-Li/spendwise/issues/6)).
- **Validator false positive:** fixed in this PR (see the offline retest). A narrower negation rule could still flag other correct hedges; EVAL-01 should report any finding downgraded only by an overclaim match.
