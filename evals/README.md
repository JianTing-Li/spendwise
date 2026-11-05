# Evaluation boundary

`npm run eval:baseline` emits a rule-based report from the same scoped records available to the investigator. It does not grade model quality or import expected answers.

## Datasets and ground truth

Investigator inputs (records the tools may retrieve) live in `src/fixtures/`: the demo injection `demo-v1` (`scenarios.ts`) and the evaluation datasets `eval-dev-v1` and `eval-heldout-v1` (`evaluation.ts`). They contain no answers.

Expected findings are evaluator-only, in `ground-truth/development.json` and `ground-truth/held-out.json`, loaded and schema-checked by `ground-truth/index.ts`. Each case is keyed by dataset, exception ID (as `detect()` produces it) and harness condition (`none`, `retrieval_failure`, `tool_limit`), and records the expected run state, an expected label plus any acceptable alternatives, the expected cause, required evidence, application amounts and forbidden claims. `tests/fixtures.test.ts` checks that the cases cover exactly the exceptions each dataset produces and that required evidence is retrievable in scope.

Held-out cases (`held-out.json`, including the demo lookalike) are never used to tune prompts or validators; their source records remain accessible to the tools like any other. Thirteen small cases do not establish generalization. ESLint rejects any import of `ground-truth` from `src/` or `evals/baseline.ts` (INV-11); never paste its contents into prompts.

Version history: `ground-truth-v1` (setup) was keyed by vendor and omitted `increase:vendor-duplicate:2026-10` and two expected labels. `ground-truth-v2` (DATA-01) keys cases by exception ID, adds that case, sets a label on every case and adds the missing/contradictory, hostile, failure, limit and held-out cases. Correct an expectation only by bumping the version with a rationale here.

`npm run eval:real -- --allow-paid` is reserved for explicit, separately authorized paid evaluation. It currently exits unavailable and makes no call. Stub tests are engineering checks, not model-quality results.

The evaluator (EVAL-01) must record fixture/ground-truth/prompt versions, exact model ID/configuration, findings and evidence, failure categories, tool executions, model requests, latency, tokens, and available costs. Compare both methods on identical records; score evidence support against independent expected answers. Measure review time rather than promising improvement.

Current baseline: reports triggering rules and source records, with no claim that business causes have been explained. No model quality, savings, ROI, or deployment outcome has been measured.
