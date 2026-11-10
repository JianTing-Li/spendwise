# SpendWise AI

**Vendor-payment exceptions. Traceable evidence. Human judgment.**

Finance workflow portfolio · **Elliot Watson & Jian Ting Li**.

**Live demo:** https://spendwise-olive-theta.vercel.app. Anyone can view it read-only; running investigations needs an authorized GitHub sign-in. All records are synthetic.

Rules flag unusual vendor payments. One Claude agent investigates each flag using read-only, scoped tools over the payments, invoices and vendor notes. The application checks every citation and claim, and a person reviews the result.

**Flow:** Simulate payments → detect exceptions → investigate → validate evidence → human review → reset.

- **Accurate calculations:** integer USD cents, cash by entry date, explicit reversals. Calculation and detection live in application code, never in the model.
- **AI boundaries:** one agent, read-only scoped retrieval, no SQL or credentials in model input, hard limits of 8 retrievals, 10 model requests and 60 seconds per run.
- **Honest results:** a finding counts as explained only when the cited records support it. Unsupported claims, failures and limits stay visible as such.
- **Repeatable demo:** persistent data; injection and reset are idempotent, and reset stops stale runs from saving.

## Results so far
Development evaluation (9 synthetic cases, one run each, `claude-opus-5-5`; [decision 004](docs/decisions/004-evaluation.md)):

| | Claude investigator | Rule-based baseline |
| --- | --- | --- |
| Acceptable run state and label | 9 / 9 | 9 / 9 |
| Unsupported "Explained" findings | 0 | 0 |
| Required evidence cited | 18 / 18 | 18 / 18 |
| Causes correct (human review) | 8 correct, 1 partly | states no causes |

On these cases the model matches the baseline on every automatic metric; its added value is in the explanations and next steps, which people judge. The validator was tuned on these cases, so they don't show generalization. Analyst review time has not been measured. No savings, customers or production reliability are claimed.

## Stack
Next.js · React · TypeScript · Tailwind · Zod · Claude (Anthropic SDK) · Neon Postgres · Vercel · Auth.js (GitHub) · PGlite locally · Vitest · Playwright.

## Run locally
```sh
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://127.0.0.1:3000**. Local mode uses stub findings and needs no API keys.

[Developer setup](docs/development.md) · [Requirements](docs/prd.md) · [Decisions](docs/decisions/) · [Agent instructions](AGENTS.md)
