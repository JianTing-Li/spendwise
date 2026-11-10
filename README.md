# SpendWise AI

**An AI investigator that helps finance analysts tell a duplicate vendor payment from an expected contract change — and can't claim an explanation the records don't support.**

**Live demo:** [spendwise-olive-theta.vercel.app](https://spendwise-olive-theta.vercel.app) *(anyone can view; running investigations needs an authorized GitHub sign-in; all data is synthetic)* · Built by **Jian Ting Li & Elliot Watson**

![SpendWise AI walkthrough](docs/demo.gif)

When reviewing monthly vendor payments, finance analysts cross-check payment runs against invoices and vendor notes by hand to decide whether an unusual outflow is a possible duplicate or an expected change. A missed duplicate is cash that has already left the business.

**Example:** Two $3,000 payments reference the same invoice → SpendWise flags a possible duplicate → Claude pulls the related payments, invoices, and vendor notes → the analyst reviews the cited records and decides whether to follow up.

- **Code does the math, not the AI.** Every dollar figure and flag is calculated by application code; the model never computes totals.
- **No unsupported answers.** A finding is marked "Explained" only when the cited records actually cover the cash change — 0 unsupported "Explained" findings across 13 test cases.
- **The analyst stays in control.** The AI only reads records. It never approves, pays, refunds, or edits anything.

**Who built what**
- **Jian Ting Li:** Claude investigator and evidence validation, financial calculation and detection rules, synthetic scenarios, evaluation against a rule-based baseline, Vercel/Neon deployment, dashboard polish.
- **Elliot Watson:** Postgres persistence and migrations, authentication and access control, scoped retrieval tools, durable investigation runs, evidence-review interface.

---

## How it works

1. **Application code** calculates net cash paid (integer USD cents, entry-date cash basis, explicit reversals) and flags payment increases (`≥ $5,000` and `≥ 20%`) and possible duplicate payments (same vendor and amount within 7 days).
2. **Claude (`claude-opus-5-5`)** investigates each exception through 4 scoped, read-only tools (`get_payment_summary`, `list_payments`, `get_invoices`, `get_vendor_notes`) under hard per-run limits: `≤ 8` tool calls, `≤ 10` model calls, `60s`.
3. **Application validation** checks every cited ID, screens for overclaims and unsupported dollar figures, and marks a finding **Explained** only when the cited invoices and notes cover the cash change.
4. **A finance analyst** inspects the linked source records and clicks **Mark reviewed** — an acknowledgment, never a payment approval.

## Design choices

- **Code does the math.** All currency math uses safe integer cents in application code; the model never computes totals or modifies records.
- **Evidence is checked, not trusted.** Valid record IDs alone can't produce a verified finding. Code checks invoice balances, note consistency, and overclaim rules before showing **Explained**.
- **Untrusted input and hard limits.** Retrieved vendor notes are passed to the model as data, not instructions (capped at 4,000 characters), and SDK retries are set to `0` under the per-run limits.
- **Safe resets.** Resetting the demo advances a database generation inside a transaction, so an in-flight run can never save results over a fresh reset.

## Demo scenarios — *Roast & Co. Coffee*, October 2026 close

| Vendor | Sep → Oct cash | What triggered it | Evidence and expected pattern |
| --- | --- | --- | --- |
| **Northstar POS Cloud** | $1,000 → $13,000 | $12,000 increase | **Explained** — normal $1,000 terminal usage plus a $12,000 annual platform subscription (`Invoice NS-2026`, `note-renewal`) covering Oct 2026–Sep 2027. |
| **Harbor Tax & Advisory** | $0 → $6,000 | Two $3,000 payments 2 days apart | **Needs review** — both payments reference the same $3,000 Q3 sales-tax invoice (`HA-101`): $3,000 in question, not confirmed. |
| **Fieldwork Creative Studio** | $0 → $3,000 | Two $1,500 payments 2 days apart | **Lookalike** — the payments cover two different invoices (`FS-201` coffee-bag artwork, `FS-202` menu boards). Explained in the baseline; *Needs review* when Claude hedges cautiously. |

Local `stub` mode returns unverified placeholder drafts without calling the model.

## Evaluation

The goal is an investigator that never overclaims: across 13 synthetic cases (9 development, 4 held out — [decision 004](docs/decisions/004-evaluation.md)), Claude produced **zero unsupported "Explained" findings** and cited every required record.

| Metric | Claude (dev, 9) | Baseline (dev) | Claude (held-out, 4) | Baseline (held-out) |
| --- | --- | --- | --- | --- |
| Unsupported "Explained" findings | **0** | 0 | **0** | 0 |
| Acceptable label after validation | 9 / 9 | 9 / 9 | 3 / 4 | 4 / 4 |
| Required evidence cited | 18 / 18 | 18 / 18 | 11 / 11 | 11 / 11 |
| Causes correct (human review) | 8 correct, 1 partly | Not human-scored | 4 / 4 | Not human-scored |

Three consecutive live cycles on the deployed site (inject → detect → investigate → validate → review → reset) all completed within limits — see the [DEMO-01 worklog](worklog/jian/DEMO-01.md).

## Limitations

- **The rule-based baseline matched or beat Claude's automatic label scores.** The one held-out miss was the validator rejecting a correct but cautiously worded answer on the lookalike case.
- **Live results vary with model phrasing:** three consecutive live runs produced 2, 1, and 2 verified explanations.
- **Analyst review time and time savings are not measured**, and neither is the relative usefulness of model-written next steps.
- **13 synthetic cases is a small sample**, and each case ran once.
- **New-payee detection is not implemented**; the MVP detects payment increases and possible duplicates only.

## Stack & local setup

**Stack:** Next.js 16 (App Router, Node Route Handlers) · React 19 · TypeScript · Tailwind · Zod · Claude (`@anthropic-ai/sdk`) · Neon Postgres (`pg`) & local PGlite · Auth.js (GitHub OAuth) · Vercel · Vitest · Playwright

```sh
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://127.0.0.1:3000**. It runs offline out of the box with local PGlite and stub mode — no API keys required.

[Developer setup](docs/development.md) · [Product requirements](docs/prd.md) · [Architecture decisions](docs/decisions/) · [Working agreement](AGENTS.md)
