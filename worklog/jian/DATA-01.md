# DATA-01 — Synthetic scenarios and evaluator-only ground truth

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/3
Branch: `data-01-scenarios`, from `origin/main` at `7c4306b`.

## Changes
- `src/fixtures/evaluation.ts`: two evaluation datasets, separate from the demo injection.
  - `eval-dev-v1` (development): missing evidence (Lumen Facilities), contradictory invoice and note (Cobalt Logistics), hostile note on two payments for one invoice (Quill Print Co.).
  - `eval-heldout-v1` (held out): annual premium with invoice and note (Atlas Insurance), lookalike payments with distinct invoices (Birchline Translation), a possible duplicate with no invoices (Maple Cleaning), a fully reversed second payment (Juniper Catering) and a failed attempt followed by a retry (Ridge Electrical). The last two must detect nothing.
- `demo-v1` is unchanged: same records, same four exceptions, so the app, UI and E2E are unaffected.
- `evals/ground-truth/` is now `ground-truth-v2` in two files (`development.json`, `held-out.json`) with a Zod loader (`index.ts`). The 13 cases are keyed by dataset + exception ID + harness condition. Each has an expected run state, an expected label and acceptable alternatives, the cause, required evidence, application amounts and forbidden claims. Adds the `increase:vendor-duplicate:2026-10` case v1 omitted. Retrieval failure and execution limits are harness conditions on the renewal exception, applied by the evaluator. `cases.json` (v1) is removed; history is in `evals/README.md`.
- `eslint.config.mjs`: `no-restricted-imports` rejects `ground-truth` imports from `src/**` and `evals/baseline.ts` (INV-11). This is also EVAL-01's setup-audit item.
- `tests/fixtures.test.ts` (new): dataset validation and determinism; ground truth covers exactly what `detect()` produces per dataset; required evidence is retrievable in scope and amounts match; splits are separate; reversal dated before its original and a second reversal are rejected; a same-day reversal listed first is accepted; the lint rule rejects ground-truth imports from runtime and baseline paths.

## Checks (actual)
- `npm run check`: typecheck, lint, 39 tests (15 new), build — passed.
- `npm run eval:baseline`: see PR checks. No paid calls, no Neon.

## Decisions
- Evaluation datasets are separate from `demo-v1` so the shared demo fixture IDs and Elliot's UI/E2E do not change. If the demo should show more scenarios, that is a separate coordinated change.
- `allowNoFindings` lets failure/limit cases pass with no findings, since an honest incomplete run may return none.
- Two cases accept a second label (contradictory evidence and the undocumented duplicate accept `Needs Review` as well as `Insufficient Evidence`); every other case accepts exactly one.

## Not done / requests
- `validateDataset` already enforced reversal ordering and single reversals; only tests were added.
- `eslint.config.mjs` is shared (OPS-01 owns the lint stack); Elliot, please review the added rule.
- The evaluator that runs these cases is EVAL-01 (#12).
