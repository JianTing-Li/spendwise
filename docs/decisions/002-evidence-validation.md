# 002 — Evidence validation and the INV-06 run rule

Date: 2026-11-04. Owner: Jian Ting ([AI-02](https://github.com/JianTing-Li/spendwise/issues/8)). Needs Elliot's review because `src/server/investigation/run.ts` and `tests/safety.test.ts` are shared.

## Run state vs finding support
- A run's state says whether the investigation finished: `completed` means it ended within its limits and every finding passed reference validation. It does not mean any explanation is verified.
- Each finding carries its own `supportStatus`. A **verified successful finding** is exactly `label: Explained`, `referenceStatus: valid`, `supportStatus: supported` (`isVerifiedExplanation`). Nothing else counts as explained.
- So a real run whose findings are valid but `unverified`, `missing` or `contradicted` is `completed`. A run with any invalid reference is `incomplete/invalid_evidence`, as before. This replaces the setup rule that required `supported` on every real finding; no validator produced that status, so every real run with findings ended incomplete.
- Stub runs are unchanged: their findings stay `unverified`, and stub completion never means an investigation was verified.

## What the validator checks (application code, `src/agent/validation.ts`)
1. **References.** The finding is for this exception, and every cited ID exists in the application-scoped records. Otherwise: `invalid`, `missing`, `Insufficient Evidence`.
2. **Citing nothing.** Valid only for `Insufficient Evidence` (records are missing): `valid` + `missing`. Any other label with no citations is invalid.
3. **Human-only conclusions.** Asserting a confirmed duplicate or overpayment, recoverability, payment approval, payment release or execution, or expense recognition or accounting treatment makes support `contradicted`. A negated mention ("not a confirmed duplicate") is allowed. Pattern matching can only downgrade a finding, never upgrade one.
4. **Amounts.** Every dollar amount in the explanation must be an application total, a scoped record amount, a sum of the cited payments or invoices, the dollar threshold, or an amount stated in a scoped note. Otherwise: `contradicted`.
5. **Objective support**, only for findings labeled `Explained`, by exception rule:
   - `payment_increase` → **documented_increase**. Cited current-month cash (completed, outgoing, not reversed). Each such payment references a cited invoice. Each of those invoices is paid exactly once in full by all scoped cash, not just the cited payments. Linked notes that state amounts match a linked record or the totals. The cited cash covers the increase.
   - `possible_duplicate` → **distinct_invoices**. Both flagged payments are cited. Each pays a different cited invoice, exactly and alone. The invoice numbers differ and the line items differ. Linked notes are consistent.
   - Pass → `supported`. A failed record relationship → `contradicted`. Absent or uncited records → `missing`.
6. **Labels.** An `Explained` finding that is not `supported` becomes `Needs Review`. Other labels are kept. The model's own reference and support status is always replaced.

Whether a business reason is legitimate, whether something was approved, and how to treat it in the accounts remain human judgments. No check marks them supported.

## Known limits
- The amount check cannot tell a correct figure used in the wrong role (for example, the $6,000 total paid described as the excess). Reviewers and the evaluator still score that.
- Note consistency only compares dollar amounts; it does not interpret prose.
- The rules are tuned only on demo and development records, never on held-out cases.
