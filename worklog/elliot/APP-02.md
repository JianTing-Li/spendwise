# APP-02 — access design and verification

Issue: https://github.com/JianTing-Li/spendwise/issues/5
Owner: Elliot (`0x1Elliot`). Base: fresh clean clone of remote main `103b3c068437f9612c3740b2169ab152d10cb8ab` on 2026-11-07. No existing APP-02 PR found. Original uploaded PRD and current requirements/decisions inspected. Session explicitly resolves shared 401/403 tests and Auth.js/GitHub choice. No deployment or provider provisioning.

## Design recorded before provider integration

- Use Auth.js `next-auth@5.0.0-beta.32` (explicit pinned upstream App Router release; beta limitation), peer support Next.js 14/15/16 and React 18/19 verified against registry; project pins Next.js 16.4.5/React 19.3.1. Follow installed Next.js async headers and Route Handler docs. No framework upgrade.
- Auth.js is self-hosted open source, without a separate paid auth service/database adapter. GitHub OAuth app registration is an external operator step; callback `https://<canonical-host>/api/auth/callback/github`. One canonical HTTPS origin; separate OAuth app for local provider testing. Hosting/database free-tier capacity remains DEPLOY-01, not verified here.
- Only Auth.js-verified encrypted session cookies establish hosted identity. Stable subject is `github:<numeric provider account id>`, never login/email/header/body/model text. Never retain OAuth access tokens in session output. JWT session maximum one hour; server-owned allowlist re-read every request provides immediate identity/grant revocation after config update/restart; rotate AUTH_SECRET to revoke all cookies. No claim of detecting GitHub account revocation before session expiry.
- Server-only grants explicitly name read/inject/reset/review/retry; default deny. One synthetic demo business. Read/inject/reset are whole-demo privileges; review/retry can additionally restrict exact run IDs. Run lookup and current-generation checks stay in existing transactional store. Reusable pure authorization supports exact resource/generation constraints for future APP-03 callers using trusted server-loaded scope; it does not implement retrieval endpoints.
- HTTPS Auth.js cookies: Secure, HttpOnly, SameSite=Lax; Auth.js manages OAuth state/PKCE and double-submit CSRF for its own endpoints. Application mutations independently require canonical Origin, JSON, same-origin custom header; reject cross-site Fetch Metadata. Never trust forwarded host to select OAuth origin. Callback has provider-specific OAuth protections instead of application POST header.
- Stream-read at most 2048 bytes, reject oversized declared or actual body, cancel reader on overflow and time bound reading. Parse existing strict contracts. Authenticate before body/storage; authorize action/resource before storage. Generic 401 identity, 403 scope/origin, 400 input, 503 dependency failures. Never expose caught errors.
- All secrets/config in server-only modules/env; no NEXT_PUBLIC secrets. Missing/invalid origin, secret, GitHub config or grants disables hosted auth before provider/network/DB work. Redacted logger. Local synthetic mode remains loopback host/origin only, no proxy/tunnel, no VERCEL/Neon; explicit scripts bind loopback.

## External operator step (never supply credentials in chat)

DEPLOY-01 operator creates/configures the GitHub OAuth application and privately sets AUTH_GITHUB_ID, AUTH_GITHUB_SECRET, AUTH_SECRET (at least 32 random characters), AUTH_URL (canonical HTTPS origin), and SPENDWISE_ACCESS_GRANTS (JSON map from github numeric subjects to explicit permissions and optional runIds). No default identities or grants are installed. Use GitHub's numeric account ID, not mutable username. Removal of a subject revokes app access; cookie sign-out clears that browser's session. Keep secret/config changes coordinated with the deployment owner. Live OAuth/hosted end-to-end remains unverified without operator setup.

Sources: https://authjs.dev/getting-started/installation ; https://authjs.dev/reference/nextjs ; https://authjs.dev/guides/configuring-github ; installed Next.js docs. Verification and handoff results follow after implementation.

## Implementation

- `src/server/authentication.ts`: pinned Auth.js/GitHub integration, canonical HTTPS configuration, PKCE + state, redacted logging, cookie-verified numeric subject, one-hour encrypted sessions, safe session output, bounded auth POSTs, operator configuration guard.
- `src/server/access.ts`, `access-policy.ts`, `request-body.ts`: loopback/proxy isolation, identity and application permission boundary, exact run-ID grants, future trusted resource/generation scope helper, same-origin/custom-header checks, byte/time bounds. Top-level GET navigation is permitted with Lax cookies on OAuth return; cross-site fetches and mutations are rejected.
- `src/app/page.tsx` now checks read access on the server; existing dashboard moves to `dashboard.tsx`, with hosted sign-out entry. Both demo routes authenticate and authorize before storage. Review's invalid resource response is 403; retry's existing 409 invalid-retry contract stays intact. Existing store transactions constrain review/retry to the current generation and invalidate stale work after reset; no database or financial changes.
- `src/app/api/auth/[...nextauth]/route.ts`: Auth.js endpoints. No application-created login tokens/protocol.
- `tests/access.test.ts`, `tests/access-http-demo.mjs`, agreed `tests/retry-route.test.ts` updates; minimal `vitest.config.mts` Auth.js transform. Existing include/timeout/serial execution settings preserved.
- Shared configuration handoff: exact `next-auth` dependency plus lockfile, blank `.env.example` fields, Vitest transform and concise README/development corrections. No contracts, fixtures, agent/evaluator code, Jian worklogs, provisioning or deployment changed.

## Actual verification — 2026-11-07

- `npm run check`: PASS (typecheck, lint, 157 tests in 18 files, production webpack build).
- `npx vitest run tests/access.test.ts tests/retry-route.test.ts tests/safety.test.ts`: PASS, 17 tests. Includes actual Auth.js encrypted-cookie validation, tampering/wrong-key/expiry, same-cookie grant revocation, wrong permission/run ID, no storage on denials, streamed/declared caps, type checks, secure HttpOnly/Lax cookies, missing CSRF, offline mocked GitHub code exchange/profile callback, rejected OAuth state, numeric subject and successful CSRF-protected sign-out. Provider fetches mocked; no live GitHub/model/database services.
- `npm run test:e2e`: PASS, dashboard injection/evidence/review/persistence/reset with stub investigator; desktop/mobile screenshots.
- `npm run test:e2e:retry`: PASS, unavailable-real-entry-point fixture with empty model key, retry history/attempt limit/stale predecessor after reset; zero model calls.
- `node tests/access-http-demo.mjs` after production build: PASS. Actual loopback HTTP: missing identity 401; read-only identity reset 403; permitted reset/inject/read 200 against isolated PGlite; four synthetic exceptions/stub runs; cross-origin mutation 403; dashboard sign-in boundary; missing hosted config 401. AUTH_URL selects hosted auth while VERCEL is unset, because existing database policy correctly prohibits local PGlite on Vercel. This is not Vercel/Neon verification.
- Production client bundle scan: 22 JavaScript files; no AUTH_SECRET/AUTH_GITHUB_SECRET/SPENDWISE_ACCESS_GRANTS names or offline secret markers. Server-only import boundary enforced by successful build. Generic dependency error response tested for secret redaction.
- Initial checks exposed a test typing issue, an auth navigation lint issue and a test-runner config omission; corrected. Initial browser run lacked Chromium; installed and reran successfully. Initial HTTP fixture used VERCEL with PGlite and correctly got 503; corrected the fixture rather than weakening database policy.
- Remote main rechecked unchanged at `103b3c0`. SETUP-01 #2 closed; #25 and #32 merge commits are ancestors. Issue discussion had zero comments. One existing open PR (#33) belongs to EVAL-01; untouched.

## Acceptance and limits

All five Issue #5 implementation/offline acceptance criteria are covered above; PR text can use `Closes #5`. Hosted E2E is explicitly UNVERIFIED: operator OAuth app/secrets/grants, real GitHub redirects, Vercel/Neon configuration and network remain external. Auth.js App Router package is a pinned beta. GitHub account/provider authorization revocation is not polled; session lifetime caps it at one hour, while application allowlist removal denies access on the next request after environment update/restart. Sign-out revokes the current browser cookie, not a stolen cookie elsewhere; rotate AUTH_SECRET for global session revocation. A future APP-03 endpoint must load scope from trusted records and use the helper under its own transaction/generation safeguards.

No Anthropic paid calls, live Neon calls, provider provisioning, push, PR creation, merge or deployment. Local branch: `feature/app-02-access-security`. Prepared PR needs explicit push/open authorization. Repository requires AI review before human approval; no independent PR review or CI result is claimed before a PR exists.

## Reproduce and hand off

1. `npm ci`, then `npm run check`.
2. `npx playwright install chromium` if needed, then `npm run test:e2e` and `npm run test:e2e:retry` sequentially (isolated databases, same port).
3. Rebuild after dev runs if necessary, then `node tests/access-http-demo.mjs`; it owns loopback port 3197 and cleans its disposable database. Never expose that fixture server via tunnel. It uses clearly fake offline session fixtures, never operator secrets.
4. Local UI: `npm run dev` on 127.0.0.1 only, blank AUTH_* fields, local database/stub mode. Inject, inspect evidence, review, reset. Hosted setup follows the external operator section above; do not test live OAuth until that step is separately authorized/configured.
5. After authorization, push this branch and open the prepared PR against main. Do not merge/deploy. Coordinate shared config with Jian during review. PR link: none created.
