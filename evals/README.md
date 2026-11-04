# Evaluation boundary

`npm run eval:baseline` emits a rule-based report from the same scoped records available to the investigator. It does not grade model quality or import expected answers.

`ground-truth/cases.json` contains evaluator-only expected findings written before real evaluation. The lookalike case is held out from prompt tuning; access to its source records remains allowed. Add new held-out cases before claiming generalization from this tiny set. Never import ground truth into runtime code, retrieval, or prompts.

`npm run eval:real -- --allow-paid` is reserved for explicit, separately authorized paid evaluation. It currently exits unavailable and makes no call. Stub tests are engineering checks, not model-quality results.

Jian's evaluator task must add missing/conflicting evidence, hostile notes, tool failures, limits, and a separate held-out dataset. Record fixture/ground-truth/prompt versions, exact model ID/configuration, findings and evidence, failure categories, tool executions, model requests, latency, tokens, and available costs. Compare both methods on identical records; score evidence support against independent expected answers. Measure review time rather than promising improvement.

Current baseline: reports triggering rules and source records, with no claim that business causes have been explained. No model quality, savings, ROI, or deployment outcome has been measured.
