# Initial implementation tasks — drafts for review

Session owner: Jian Ting. Elliot's GitHub account is [0x1Elliot](https://github.com/0x1Elliot); application issues #4, #5, #6, and #11 are assigned to him for planning. The ownership split remains proposed pending his agreement. Shared coordination issues #9, #10, #13, #14, and #15 are assigned to both `JianTing-Li` and `0x1Elliot`; agree the lead before implementation. For deployment, assignment covers planning, not selection of the operator or authorization to deploy. No deadlines. Free tiers only; deployment operator and hosting projects undecided.

Issue creation is not authorized yet. On approval, move these specifications into GitHub Issues and replace the drafts with issue links. Use Ready → In Progress → Review → Done, with one active implementation task per person. No remote issues/settings were changed by setup.

## APP-01 — Implement the Neon data adapter (Elliot, proposed)
- Milestone: finish M1 persistence. Depends on reviewed setup contracts and Elliot accepting ownership.
- Files: `src/server/db/`, `src/server/retrieval/`, related tests. Coordinate migrations/shared contracts.
- Implement the Neon/pg adapter with pooled application access, a separate read-only retrieval role, and a versioned migration runner. Preserve the local stub flow and approved financial rules. Hosted UI/API stays disabled until the later authentication task is complete.
- Acceptance: same fixture totals on the local adapter and Neon when separately authorized; parameterized scoped queries; no credentials returned; concurrent injection/reset/review behavior remains safe; database failure cannot silently switch to local data.
- Invariants: INV-01, 03, 04, 05, 10, 12.
- Checks: `npm run check`, `npm run test:e2e`; separate explicitly configured integration checks, never routine Neon access.
- Handoff: document schema/adapter/auth decisions and test evidence in `worklog/elliot/APP-01.md`; link issue/PR after creation.

## AI-01 — Implement the bounded investigator (Jian)
- Milestone: M2. Depends on reviewed `Investigator`, retrieval contracts, stable fixture IDs, and both owners agreeing to material contract changes.
- Files: `src/agent/`, `evals/`, agent tests. Coordinate shared budget/interface changes.
- Implement an explicit Claude loop and system prompt; tools derive from `src/contracts`. Use fixture retrieval initially. Configure SDK automatic retries to zero; enforce 8 tool executions, 10 model requests, cancellation, and the total 60-second budget including validation/persistence.
- Acceptance: fake-response tests cover successful structured output, invalid output, unsupported/missing/contradictory evidence, hostile text, request/tool limits, errors, deadline, and cancellation. No arbitrary SQL or evaluator answers in model context. No unverified explanation labeled Explained. Failed real runs never return stub findings.
- Invariants: INV-02, 06, 07, 08, 09, 11, 12.
- Checks: `npm run check`, `npm run eval:baseline`. Real evaluation only through a separate opted-in command after authorization.
- Handoff: document supported-claim validation design and model-call accounting in `worklog/jian/AI-01.md`; link issue/PR after creation.

## Joint next checkpoint
Before substantial feature expansion, jointly run one explicitly authorized real-Claude scenario against its prewritten expectation and the baseline. Record evidence quality, latency, token/cost usage, failure behavior, and actual hosting feasibility. One success is not evidence of reliability. Integrate at each milestone, then rebalance work.
