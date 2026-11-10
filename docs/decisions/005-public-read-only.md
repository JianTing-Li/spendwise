# 005 — Optional public read-only viewing

Date: 2026-11-10. Owner: Jian Ting ([APP-05](https://github.com/JianTing-Li/spendwise/issues/45)). Changes INV-12 wording in `AGENTS.md` and code in Elliot's paths (`src/server/access.ts`, `src/app/`); authorization and review are on [PR #47](https://github.com/JianTing-Li/spendwise/pull/47).

## Why
SpendWise is a portfolio prototype. The hosted site showed only "SpendWise access required" to anyone outside `SPENDWISE_ACCESS_GRANTS`, so recruiters and other visitors couldn't see it.

## Decision
- A server-only setting, `SPENDWISE_PUBLIC_READ`, turns on public viewing. Only the exact value `1` does; anything else keeps the earlier behaviour. It is off by default.
- When it is on, hosted authentication is fully configured, the request is a `GET`, and there is no signed-in session, `identify()` returns the principal `public:anonymous` with only the `read` permission. Grants only accept `github:<id>` keys, so this subject can never be given more through configuration.
- Nothing else in the access path changes. The cross-site and origin checks run first and still return 403. Without valid hosted authentication every request still returns 401. Signed-out POSTs to `/api/demo` and `/api/demo/retry` return 401, so Simulate, Reset, Retry and Mark reviewed need a signed-in, granted GitHub account.
- Signing in never shows less than the public view. A signed-in account whose grant lacks `read` (including an account with no grant) gains `read` on `GET`s only; its other permissions and run scope are unchanged, and its POSTs are judged on its own grant (403 without the permission). The dashboard tells such an account it is viewing read-only. Added after the code review on PR #47: the sign-in prompt would otherwise send visitors without a grant to the locked page.
- Cross-site requests return 403 except a top-level `GET` navigation to the dashboard (`/`, `Sec-Fetch-Dest: document`), which OAuth returns and portfolio links need. Before this change any cross-site `GET` navigation was exempt, which with public viewing would have served `/api/demo` to a cross-site link or frame (review on PR #47).
- The dashboard receives the principal's permissions. When a request returns 401 (the session ended), the dashboard refreshes the server page, so its controls follow the new permissions: read-only with the sign-in prompt, or the locked page when public viewing is off. Controls the visitor can't use are disabled, and signed-out visitors see "Sign in with GitHub to run investigations" with the sign-in button. This is presentation only; the server check is the control (INV-03).

## What public viewing exposes
- The synthetic dataset, detected exceptions, run states, findings and review acknowledgments returned by `GET /api/demo`: the same payload a `read` grant sees. All of it is synthetic (INV-01).
- No credentials, no session data, no mutation, and no model access: a signed-out visitor cannot start or retry an investigation, so cannot spend model budget (INV-05, INV-08, INV-12).

## Accepted limits
- Visitors see whatever state the last signed-in user left, including real-mode findings.
- Public page loads and progress polls read the database. There is no rate limit beyond the host's.
- Retrieved vendor-note text is shown to the public as it is to signed-in users: escaped, labelled untrusted (INV-07).

## INV-12 wording
"Deployed mode fails closed until authentication is implemented" became "fails closed unless hosted authentication is fully configured", plus a sentence that optional public viewing exposes synthetic state read-only and never grants mutation or model access.
