# OPS-02 — Restore and harden the issue workflow

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/18
Branch: `ops-02-workflow-hardening`, from `origin/main` at `abcdd92`. PR: https://github.com/JianTing-Li/spendwise/pull/19

## Why
PR #1 merged without two commits that failed to push (`50958de` closing-reference check and PR template, `f2f35ba` startup routine and AI-01 worklog). Status and approval text was copied into many docs and issue bodies, so it went stale after Elliot accepted ownership in his PR #1 review. Closed issues kept `status:review` because label moves were manual.

## Changes
- Restored the closing-reference check in its own "Issue link" workflow, revised: all GitHub closing keywords, optional colon, same-repository references only, inline code ignored, with unit tests.
- PR template: `Closes #` section plus a merge checklist (everything pushed and PR head matches local, CI green on the latest commit, no pending notes, worklog linked).
- New "Status labels" workflow and script: draft PR → `status:in-progress`, ready PR → `status:review`, issue closed as completed → `status:done`. Keeps exactly one status label; closed issues are not moved back by PR events. PR text is passed as environment data and to `gh` as argument lists.
- Task issue template holding the shared fields, so issue bodies carry only task-specific content.
- AGENTS.md: short startup routine, new branch-hygiene section, "status lives only in GitHub" rule, label and merge rules; removed setup-stage and "pending" text. Invariants, commands and the Next.js block are unchanged.
- `docs/handoff.md` is now a link table. The decision record notes Elliot's acceptance once, linking his review. Stale status text was removed from the setup checklist, the SETUP-01 and APP-01 worklogs, the development guide (advisory count now 8, was 16) and the PRD snapshot header. Restored `worklog/jian/AI-01.md`.

GitHub changes (authorized in the session):
- Created OPS-02 #18 and milestones M1–M4; assigned every issue to a milestone.
- Relabeled closed #2 and #16 to `status:done`.
- Trimmed all 13 open issue bodies: removed repeated workflow/authorization boilerplate and the stale "pending agreement" / "remains unassigned" lines; ownership is the assignee. AI-01 #7 no longer depends on DATA-01 (it can start on the three existing fixtures). OPS-01 #13 cites the current advisory count.

## Verification
- `python3 -m unittest discover -s .github/scripts -p 'test_*.py'`: 9 passed.
- All workflow YAML parses; `git diff --check` clean.
- `npm run check`: passed (24 tests, build). No application code changed.
- The new workflows first run on PR #19; see its checks.

## Not done / requests
- Splitting UI-01 #11 into a stub-backed review issue (UI-02) was not done: the permission check blocked creating a new issue assigned to Elliot. Needs Jian's explicit go-ahead and Elliot's agreement.
- The `main` ruleset requires a PR and one approval but no status checks. Adding `verify` and `issue-link` as required checks is a repository setting for a human to change.
- Elliot: please review the AGENTS.md changes; it is a shared file.
