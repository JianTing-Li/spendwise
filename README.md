# SpendWise AI

**Vendor-payment exceptions. Traceable evidence. Human judgment.**

Finance workflow portfolio · **Elliot Watson & Jian Ting Li**.

Investigate unusual payments using synthetic records, invoices, and vendor notes.

**Flow:** Simulate payments → detect exceptions → investigate → review evidence → reset.

- **Accurate calculations:** Integer cents; explicit reversals.
- **AI boundaries:** Read-only tools; scoped evidence.
- **Repeatable demo:** Persistent data; safe injection/reset.
- **Team workflow:** Shared contracts; independent development.

**Status:** Working local demo; **stub findings**. Claude, hosted authentication, and Neon integration pending. Synthetic data only; no financial execution.

**Stack:** Next.js · React · TypeScript · Tailwind · Zod · PGlite locally · Vitest · Playwright. Planned: Claude + Neon + Vercel.

```sh
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://127.0.0.1:3000**. No API keys required.

[Developer setup](docs/development.md) · [Requirements](docs/prd.md) · [Setup checklist](docs/setup-checklist.md) · [Agent instructions](AGENTS.md)
