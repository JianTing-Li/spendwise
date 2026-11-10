# DOCS-03 — README rewrite for a 30-second recruiter read

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/57
Branch: `docs-03-readme-recruiter`. PR: https://github.com/JianTing-Li/spendwise/pull/58

## Changes
Rewrote `README.md` so the opening reads in about 30 seconds: a one-line pitch, the live demo link, the existing GIF, a two-sentence problem statement, the two $3,000 payments example (from PR #54), three benefit bullets and a who-built-what split. The heading-free opening drops the "30-Second Overview" and "Why It's Production-Minded" labels. Technical depth now sits below under plain headings: How it works, Design choices, Demo scenarios, Evaluation, Limitations, Stack & local setup. Every caveat moved into one Limitations section. PR #54's SSON statistic and screenshot were not carried over: the statistic measures invoice processing, not exception review, and the GIF stays. Added the DOCS-03 row to `docs/handoff.md`.

## Verification
`git diff --check`; checked that every relative link and the GIF path exist; checked DEMO-01 figures (limits, 2/1/2 verified explanations) and package versions against the repository. Docs only, so application tests were not run.

## Decisions / next action
Supersedes DOCS-02 (#53) and PR #54 by agreement between Jian and Elliot. Elliot should confirm that the who-built-what lines are accurate. The "Who built what" split was drawn from the worklogs and issue assignments.
