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
Evaluation on 13 synthetic cases, one run each, `claude-opus-5-5`, scored by the same evaluator for both methods ([decision 004](docs/decisions/004-evaluation.md)):

| | Claude, development (9) | Baseline, development | Claude, held-out (4) | Baseline, held-out |
| --- | --- | --- | --- | --- |
| Unsupported "Explained" findings | **0** | 0 | **0** | 0 |
| Acceptable label after validation | 9 / 9 | 9 / 9 | 3 / 4 | 4 / 4 |
| Required evidence cited | 18 / 18 | 18 / 18 | 11 / 11 | 11 / 11 |
| Causes correct (human review) | 8 correct, 1 partly | states no causes | 4 / 4 | states no causes |

The held-out label miss is the validator rejecting a correct, cautiously worded answer: a conservative error, recorded rather than tuned away. The model doesn't beat the rule-based baseline on automatic labels; what it adds is explanations and next steps, which people judge. Held-out cases were run once, after the prompt and validator were final. 13 small cases establish no generalization, analyst review time has not been measured, and no savings, customers or production reliability are claimed.

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
