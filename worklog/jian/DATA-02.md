# DATA-02 — More vendors and cases that show the agent's value

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/61 (same branch and PR as UI-05, https://github.com/JianTing-Li/spendwise/issues/60)

## Changes
- Each company now has 11–12 vendors: 6–7 everyday vendors (rent, payroll, utilities, suppliers) with invoiced September and October payments that never trigger a flag, plus two new cases. Original scenario records and IDs are unchanged. Roast's monthly POS fees now have invoices.
- New case **late bill**: an August invoice paid with the October run (Valley Dairy, Clearview Legal, Swift Temp Staffing). Expected Needs Review: payments before September are outside the scoped records, so an earlier payment of the same invoice can't be ruled out (corrected after the AI code review; first drafted as Explained).
- New case **re-issued invoice**: a quarterly bill re-sent under a new number and paid again (Summit Espresso, Bluebird Laptop Leasing, Keystone Safety Inspections). The 7-day duplicate rule misses it; the increase rule flags it. Expected Needs Review.
- Validator: invoiced payments must cover an increase on their own (a cited unchanged monthly fee no longer blocks Explained); two paid invoices for the same amount and service period block Explained; every unsupported finding gets an application-written reason. Baseline is now `rules-v3`; ground truth `ground-truth-v3` adds `late-bill` and `reissued-invoice` (dev split).
- "Northgate Pallet Co." replaces the approved "Keystone Pallet Co." to avoid two Keystone vendors in one company.

## Checks (2026-11-11)
- Unit tests 266 passed, including new validator tests (reasons, invoiced-only coverage, same-period double billing, late-bill wording, summary checks) and an activity-recording assertion.
- **Paid development evaluation** (approved by Jian in the session): `evals/reports/eval-02-development-2026-11-11.json`, commit `64fb86f`. Model 11/11 acceptable labels, 0 unsupported Explained, 23/24 evidence; baseline 11/11, 22/24. List-price estimate $0.61. Details and items needing Jian's review: decision 004 addendum.
- **Live local check**, real mode, Roast: 6 of 6 completed; results matched expected labels (details in decision 004). About $0.35.
- Paid spend this session: about $0.96 list price; running total about $2.86 of the $40 budget.

## Code review fixes (2026-11-11)
All 10 findings from the AI review of PR #63 fixed: pre-September invoices never verify; re-issued check limited to earlier-month payments; evidence chips per finding; run `startedAt` drives the progress timer; percent label for negative priors; progress stored in the charge write; tab switch clears a hidden selection; UI reuses `isVerifiedExplanation`; unused `money()`/`excerpt()` removed; runbook Reset sentence corrected. Saved eval findings re-validated offline: 11/11 acceptable, 1 verified, 0 unsupported.

## Needs Jian's review
- Forbidden-claim flags and cause-correctness drafts in the decision 004 addendum.

## Not done
- Held-out not re-run (results describe prompt v1).
- DATA-03 (#62, structured quantities and prices) parked.
