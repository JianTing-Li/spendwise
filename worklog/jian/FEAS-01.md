# FEAS-01 — Joint early Claude feasibility check

Owner: Jian Ting. Reviewer: Elliot. Issue: https://github.com/JianTing-Li/spendwise/issues/9
Branch: `feas-01-feasibility`, stacked on `ai-02-evidence-validation` (AI-02, #8, PR #22), which this issue depends on. Merge after #22.

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

## Checks (actual)
- See the PR for `npm run check` results. No paid calls have been made.

## Decisions
- Default case `renewal` (demo-v1): expected Explained, so it exercises the full path to a verified explanation. Other development cases can be run with `--case`.
- The report prints to stdout, like the baseline, so no generated output is written into the repository.
- Hosting: no deployment target is chosen (DEPLOY-01 is on hold), so the 60-second budget is recorded as unverified against host limits.

## Still to do in this issue
- Jian: create an Anthropic API key with a spend limit (planned budget: $40 for ~1.5 weeks) and keep it in `.env.local` only; confirm the paid run.
- Joint session with Elliot: run the default case, inspect the report together, and optionally compare `--effort low` and `--model claude-sonnet-5-5`.
- Record the sanitized report, the proceed/adjust decision, the response-limit decision, and shared blockers in `docs/decisions/` and this worklog.
