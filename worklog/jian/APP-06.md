# APP-06 — Redirect non-canonical hosts to the production domain

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/50. Branch: `app-06-canonical-host`, from `origin/main` at `d6ab7a9`. PR: https://github.com/JianTing-Li/spendwise/pull/51

## Problem
Right after a deploy, signing in from a deployment-specific URL (Vercel's **Visit** button) returned `{"error":"forbidden"}`; reloading on the production domain worked. Checked 2026-11-10 without signing in: the Auth.js sign-in form posts to `AUTH_URL` (`action` is the production domain), and a sign-in POST with any other `Origin` gets 403 from `authenticationRoute`. The deployment URL itself was not fetched, so the first step of the sequence is inferred.

## Changes
- `src/server/access.ts`: `canonicalRedirect(host, path)` returns the same path on `AUTH_URL` when hosted authentication is valid and the host differs; null for the canonical host, local loopback mode and invalid hosted config. Protocol-relative paths fall back to `/`.
- `src/app/page.tsx`: redirects before identifying the visitor.
- `tests/access.test.ts`: one test for the redirect decision. `docs/development.md`: operating note.

## Decisions
- Only the page redirects. API routes keep their existing origin checks, and the sign-in origin check is unchanged.

## Checks
- `npm run check` (Node 24.18.0): passed — typecheck, lint, 245 tests in 24 files, build.
- Local production build, offline hosted settings, no model calls: `/` on another host returned 307 to `https://demo.example/`; on the canonical host 200 with the dashboard; `/api/demo` on another host unchanged (200, public read).
- AI code review (medium): the local-mode check is now shared between `identify()` and the redirect (fixed); the redirect drops any query string (accepted: the dashboard reads none). After the fix, in the worktree: `tsc --noEmit`, ESLint on the changed files, and `tests/access.test.ts` plus `tests/retry-route.test.ts` (21 tests) passed; CI runs the full check.
- Codex review (P2): `/\evil.example/path` resolved off the canonical origin because URL parsing treats a backslash as a slash. Fixed by resolving the path and requiring the canonical origin; tests cover backslash, protocol-relative, absolute, tab-injected and http-canonical paths. Only the unused path argument was exposed. After the fix, in the worktree: `tsc --noEmit`, ESLint on the changed files and `tests/access.test.ts` (19 tests) passed; CI runs the full check.
- Not yet checked on a real deployment URL; that needs the merge and a deploy.
