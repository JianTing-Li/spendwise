# DOCS-03 — README rewrite for a 30-second recruiter read

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/57
Branch: `docs-03-readme-recruiter`. PR: https://github.com/JianTing-Li/spendwise/pull/58

## Changes
Rewrote `README.md` so the opening reads in about 30 seconds: a one-line pitch, the live demo link, the existing GIF, a two-sentence problem statement, the two $3,000 payments example (from PR #54), three benefit bullets and a who-built-what split. The heading-free opening drops the "30-Second Overview" and "Why It's Production-Minded" labels. Technical depth now sits below under plain headings: How it works, Design choices, Demo scenarios, Evaluation, Limitations, Stack & local setup. Every caveat moved into one Limitations section. PR #54's SSON statistic and screenshot were not carried over: the statistic measures invoice processing, not exception review, and the GIF stays. Added the DOCS-03 row to `docs/handoff.md`.

## Verification
`git diff --check`; checked that every relative link and the GIF path exist; checked DEMO-01 figures (limits, 2/1/2 verified explanations) and package versions against the repository. Docs only, so application tests were not run.

## Decisions / next action
Supersedes DOCS-02 (#53) and PR #54 by agreement between Jian and Elliot. Elliot should confirm that the who-built-what lines are accurate. The "Who built what" split was drawn from the worklogs and issue assignments.

## Update after UI-03 (#56) merged
Merged main into the branch and kept both the UI-03 and DOCS-03 rows in `docs/handoff.md`. The README now mentions the three fictional demo companies and the vendor-cash chart, queue filter and guided tour. It does not name HubSpot or GXO. UI-03's About dialog quotes the README verbatim, and its parity test failed once the old tagline was removed. `src/app/about-content.ts` now quotes the new README lines and links to the README on `main`. The About fine print no longer names revision 180871a. `tests/brief.test.ts` and `tests/e2e/insights.spec.ts` follow the new link. Elliot should review these UI-03 file changes. Checks run: `npm run typecheck`, `npm run lint`, `npm test` (27 files, 259 tests passed) and the About Playwright test (1 passed). The full Playwright suite was not run.
