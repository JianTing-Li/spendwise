# PROC-01 — Update branch and PR rules in AGENTS.md

Owner: Jian Ting. Reviewer: Elliot. Issue: https://github.com/JianTing-Li/spendwise/issues/31
Branch: `process-branch-rules`.

## Changes
- `AGENTS.md`, Branch hygiene:
  - Removed "Never commit to a branch whose PR is merged or under review. Open a new branch and issue instead."
  - Added: one open PR per issue; review fixes and merging `origin/main` stay on that PR's branch; no history rewrites.
  - Added: a replaced PR is closed in the same step with "Superseded by #N".
- `AGENTS.md`, new "Dependencies and combined PRs" section:
  - An issue starts only after its dependencies are merged.
  - No PR is based on another unmerged PR's branch.
  - Dependent work may continue on the same branch and PR, up to 3 issues per PR.
  - Every PR gets an AI code review that the approving human reads before approving.
  - Reviews are prompt on coding days.

## Why
The old rule led to three overlapping PRs for the database work: PR #26, PR #28 (stacked on PR #26), and PR #30 (rebuilt from main). PR #26 and PR #28 were then closed as superseded by PR #30.

## Decisions
- No PR size limit in lines, by Jian's choice. The combined-PR limit is 3 issues.
- With 2 coding days left, the rules allow dependent work to continue on one branch rather than waiting on each merge.

## Checks (actual)
- Docs-only change: no local test run. CI runs on the PR head.

## Next action
- Elliot reviews and approves the PR.
