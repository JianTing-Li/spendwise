# OPS-01 — Upgrade lint tooling and resolve dependency advisories

Owner: Jian Ting (assignee moved from Elliot on 2026-11-09). Issue: https://github.com/JianTing-Li/spendwise/issues/13
Branch: `ops-01-lint-tooling`, from `origin/main` at `5b6bcb6`. PR: https://github.com/JianTing-Li/spendwise/pull/38

## Changes
- `eslint` 9.39.5 → 10.14.0, exact pin, lockfile updated. ESLint 9 is marked unsupported on npm.
- `eslint-config-next` stays at 16.4.5. The Next.js ESLint guide states it supports ESLint 9 and 10, and the package has a compatibility layer for the older plugin rules. `eslint.config.mjs` did not need changes.
- `next-env.d.ts` is untracked and ignored, as the Next.js TypeScript guide recommends. It stays in `tsconfig.json`; `npm run typecheck` regenerates it.
- `docs/development.md` and `docs/decisions/001-setup.md` updated for the above.

## Decisions
- Kept the Next.js preset instead of replacing it with only the plugins that list ESLint 10. Replacing it would have dropped `jsx-a11y` and `import` rules, and `react` rules without adding a new dependency.
- No `overrides` and no `legacy-peer-deps`.

## Checks (Node 24.18.0, npm 11.16.0)
- Clean `rm -rf node_modules && npm ci`: passed, with 3 `ERESOLVE` peer warnings for `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react`.
- `npm run check` starting with `next-env.d.ts` absent: passed (typecheck, lint, 205 tests, build). The tree stayed clean of it afterwards.
- `npm run test:e2e`: 1 passed. `npm run test:e2e:retry`: 1 passed. `npm run eval:baseline`: passed.
- Effective rules for `src/app/page.tsx` compared between ESLint 9 and 10: 87 and 87, none added or removed, no severity changes.
- A throwaway file with deliberate violations under ESLint 10 reported `@next/next/no-html-link-for-pages`, `@next/next/no-img-element`, `@typescript-eslint/no-explicit-any`, `import/no-anonymous-default-export`, `jsx-a11y/alt-text`, `jsx-a11y/aria-props`, `react/display-name`, `react/jsx-key`, `react/jsx-no-duplicate-props`, `react/no-children-prop` and `react/no-unescaped-entities`, with no rule crashes. The `INV-11` ESLint regressions in `tests/fixtures.test.ts` pass.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm audit`: 10 moderate packages, exit 1 (8 before this change).

## Remaining advisory
All 10 packages trace to one advisory, minimatch denial of service, GHSA-g3hv-75wg-m249, affecting versions below 11.0.1. It is not fixed.
- The count rose from 8 to 10 because ESLint 10 depends on `minimatch@^10.2.6`; ESLint 9 used `minimatch@^3`, outside the affected range. `eslint` and `@eslint/config-array` are the two additions.
- `typescript-eslint` already pulled in `minimatch@^10` through `@typescript-eslint/typescript-estree`, so the advisory was present before and staying on ESLint 9 would not have removed it.
- Impact: development tooling only. minimatch processes glob patterns from lint configuration and the command line, not application input. The production audit is clean.
- Options rejected: `npm audit fix --force` (downgrades to unsupported ESLint 9 or `eslint-config-next` 15, which targets an older Next.js) and overriding minimatch to 11 (cross-major, which this issue rules out).

## Not done
- `npm run test:pg` was not run; no database code changed. CI runs it.
- `npm ls` exits non-zero because of the three plugin peer ranges. No script or CI step uses it.
- Issue #13's body still names `worklog/elliot/OPS-01.md`; this worklog follows the current owner.

## Next action
Re-check whether `eslint` and `typescript-eslint` accept a fixed minimatch, and whether the three plugins list ESLint 10, at the next dependency update.
