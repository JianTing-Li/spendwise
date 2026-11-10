# APP-05 — Public read-only viewing of the hosted demo

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/45
Branch: `app-05-public-read-only`, from `origin/main` at `1eb5c55`. PR: https://github.com/JianTing-Li/spendwise/pull/47

Decision record: `docs/decisions/005-public-read-only.md`. Operator notes: `docs/development.md`, "Public read-only viewing".

## Changes
- `src/server/access.ts`: `identify()` returns `public:anonymous` with only `read` for a signed-out `GET` when `SPENDWISE_PUBLIC_READ` is exactly `1` and hosted authentication is valid. Everything else in the access path is unchanged.
- `src/app/page.tsx`, `dashboard.tsx`, `review-card.tsx`, `use-demo.ts`: the dashboard gets the principal's permissions; Simulate, Reset, Retry and Mark reviewed are disabled without the matching permission, `act` sends nothing without it, and signed-out visitors see a sign-in prompt. `globals.css`: one rule for the prompt.
- `tests/access.test.ts`: six tests for the setting.
- `AGENTS.md` (INV-12), `docs/decisions/005-public-read-only.md`, `docs/development.md`, `.env.example`.

## Decisions
- A signed-in account with no grant keeps zero permissions (403, "SpendWise access required") even with public viewing on, as the agreed design says "no signed-in principal". A visitor who signs in without a grant therefore loses the public view until the session ends (at most one hour).
- Invalid, expired or forged cookies count as signed out.

## Checks
- `npm run check` on the branch (Node 24.18.0): passed — typecheck, lint, 244 tests in 24 files (18 in `tests/access.test.ts`), build.
- Local production build (`next start`, loopback, disposable PGlite, stub mode, offline Auth.js settings, `SPENDWISE_PUBLIC_READ=1`), zero model calls: signed-out `GET /api/demo` 200 with four stub runs seeded by an offline signed-in session; signed-out POST inject, reset, review and retry all 401; cross-origin GET and POST 403. The page showed the dashboard with the sign-in prompt, no Sign out, and Simulate, Reset and all four Mark reviewed buttons disabled.
- Not run: `npm run test:e2e`, `npm run test:pg`, `npm run test:neon`. The disabled Retry button was not seen in a browser (no failed run in the stub state); it uses the same permission check. No check of the live site yet: that follows the merge and the Vercel change.

## Code review (2026-11-10, medium)
Findings are on the PR. Fixed: tests now pin the setting off. Left for a decision or accepted: the sign-in prompt leads accounts without a grant to the locked page; an expired session keeps enabled controls until a page reload; public reads have no rate limit; `HEAD /api/demo` stays 401; per-run grants and read-only copy are not reflected in the buttons.

## Next action
- After merge Jian sets `SPENDWISE_PUBLIC_READ=1` in Vercel (Config, Production only), redeploys, and the live site is checked signed out.
- Tell Elliot about the INV-12 change.
