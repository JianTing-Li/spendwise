import { afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  dollarAmounts,
  isVerifiedExplanation,
  overclaims,
  validateFinding,
} from "../src/agent/validation";
import { detect } from "../src/domain/finance";
import { injectedDataset } from "../src/fixtures/scenarios";
import { developmentDataset } from "../src/fixtures/evaluation";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";
import { Dataset, Finding } from "../src/contracts";
import paidRun from "../evals/reports/feas-01-renewal-2026-11-05.json";

// Validator tests use demo and development records only; the held-out split
// (including the demo lookalike) is never used to tune validation.
const demo = injectedDataset();
const dev = developmentDataset;
const check = (
  data: Dataset,
  exceptionId: string,
  finding: Partial<Finding>,
) => {
  const exception = detect(data).find((e) => e.id === exceptionId)!;
  return validateFinding(
    {
      exceptionId,
      label: "Explained",
      explanation: "Explanation.",
      nextStep: "Analyst reviews the cited records.",
      evidence: [],
      referenceStatus: "valid",
      supportStatus: "supported",
      ...finding,
    },
    exception,
    fixtureRetrieval(data, exception),
  );
};
const RENEWAL = "increase:vendor-renewal:2026-10";
const ADVISORY_DUP = "duplicate:pay-advisory-a:pay-advisory-b";
const ADVISORY_INC = "increase:vendor-duplicate:2026-10";
const ref = (type: "payment" | "invoice" | "note", id: string) => ({
  type,
  id,
});
const renewalEvidence = [
  ref("payment", "pay-renewal-annual"),
  ref("invoice", "inv-renewal"),
  ref("note", "note-renewal"),
];

/** Inline lookalike (not the held-out records): two invoices, two services. */
const lookalike = Dataset.parse({
  vendors: [{ id: "v-look", name: "Test Studio", category: "Design" }],
  invoices: ["a", "b"].map((x, i) => ({
    id: `inv-${x}`,
    vendorId: "v-look",
    number: `T-${i}`,
    date: "2026-10-02",
    amountCents: 90000,
    currency: "USD",
    lineItems: [i ? "Logo refresh" : "Brochure layout"],
    servicePeriod: null,
  })),
  payments: ["a", "b"].map((x, i) => ({
    id: `pay-${x}`,
    vendorId: "v-look",
    invoiceId: `inv-${x}`,
    date: `2026-10-0${3 + i}`,
    amountCents: 90000,
    currency: "USD",
    status: "completed",
    entryType: "outgoing",
    reversalReference: null,
    description: "Synthetic vendor payment",
  })),
  notes: [],
});
const LOOK = "duplicate:pay-a:pay-b";
const lookEvidence = [
  ref("payment", "pay-a"),
  ref("payment", "pay-b"),
  ref("invoice", "inv-a"),
  ref("invoice", "inv-b"),
];

describe("AI-02 objective claim support", () => {
  it("supports a documented increase: invoice paid exactly, note consistent, increase covered", async () => {
    const f = await check(demo, RENEWAL, {
      explanation:
        "An annual renewal invoice of $12,000 explains the $12,000 increase; expense recognition is left to accounting.",
      evidence: renewalEvidence,
    });
    expect(f).toMatchObject({
      label: "Explained",
      referenceStatus: "valid",
      supportStatus: "supported",
    });
    expect(isVerifiedExplanation(f)).toBe(true);
  });

  it("supports distinct services on distinct, fully paid invoices", async () => {
    expect(
      await check(lookalike, LOOK, { evidence: lookEvidence }),
    ).toMatchObject({ label: "Explained", supportStatus: "supported" });
  });

  it("rejects fabricated and out-of-scope IDs", async () => {
    for (const evidence of [
      [ref("invoice", "inv-made-up")],
      [ref("payment", "pay-advisory-a")],
    ])
      expect(await check(demo, RENEWAL, { evidence })).toMatchObject({
        label: "Insufficient Evidence",
        referenceStatus: "invalid",
        supportStatus: "missing",
      });
  });

  it("does not accept valid but irrelevant IDs as support", async () => {
    expect(
      await check(demo, RENEWAL, {
        evidence: [
          ref("payment", "pay-renewal-sep"),
          ref("payment", "pay-renewal-oct"),
        ],
      }),
    ).toMatchObject({
      label: "Needs Review",
      referenceStatus: "valid",
      supportStatus: "missing",
    });
    // Lookalike payments cited without their invoices.
    expect(
      await check(lookalike, LOOK, { evidence: lookEvidence.slice(0, 2) }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "missing" });
  });

  it("detects an invoice paid twice: no Explained increase or lookalike", async () => {
    const evidence = [
      ref("payment", "pay-advisory-a"),
      ref("payment", "pay-advisory-b"),
      ref("invoice", "inv-advisory"),
    ];
    for (const id of [ADVISORY_INC, ADVISORY_DUP])
      expect(await check(demo, id, { evidence })).toMatchObject({
        label: "Needs Review",
        supportStatus: "contradicted",
      });
    // Citing one payment does not hide the second payment on the invoice.
    expect(
      await check(demo, ADVISORY_INC, { evidence: evidence.slice(1) }),
    ).toMatchObject({ supportStatus: "contradicted" });
  });

  it("detects an invoice mismatch and a contradictory note", async () => {
    expect(
      await check(dev, "increase:vendor-conflict:2026-10", {
        evidence: [
          ref("payment", "pay-conflict-oct"),
          ref("invoice", "inv-conflict"),
          ref("note", "note-conflict"),
        ],
      }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "contradicted" });
    // Same renewal records, but the linked note now states a different amount.
    const altered = injectedDataset();
    altered.notes[0].text = "Synthetic note: renewal agreed at $9,500.";
    expect(
      await check(altered, RENEWAL, { evidence: renewalEvidence }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "contradicted" });
  });

  it("treats a reversed payment as no cash", async () => {
    const reversed = injectedDataset();
    reversed.payments.push({
      ...reversed.payments.find((p) => p.id === "pay-renewal-annual")!,
      id: "pay-renewal-annual-reversal",
      date: "2026-10-25",
      entryType: "reversal",
      reversalReference: "pay-renewal-annual",
    });
    const exception = detect(injectedDataset()).find((e) => e.id === RENEWAL)!;
    expect(
      await validateFinding(
        {
          exceptionId: RENEWAL,
          label: "Explained",
          explanation: "Renewal.",
          nextStep: "Review.",
          evidence: renewalEvidence,
          referenceStatus: "valid",
          supportStatus: "supported",
        },
        exception,
        fixtureRetrieval(reversed, exception),
      ),
    ).toMatchObject({ label: "Needs Review", supportStatus: "missing" });
  });

  it("handles missing records: Insufficient Evidence may cite nothing, other labels may not", async () => {
    const id = "increase:vendor-missing:2026-10";
    expect(
      await check(dev, id, { label: "Insufficient Evidence", evidence: [] }),
    ).toMatchObject({
      label: "Insufficient Evidence",
      referenceStatus: "valid",
      supportStatus: "missing",
    });
    for (const label of ["Explained", "Needs Review"] as const)
      expect(await check(dev, id, { label, evidence: [] })).toMatchObject({
        referenceStatus: "invalid",
        label: "Insufficient Evidence",
      });
    // Cited payments alone, with no invoice on file, never explain an increase.
    expect(
      await check(dev, id, { evidence: [ref("payment", "pay-missing-oct")] }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "missing" });
  });

  it("strips self-asserted support and never upgrades a label", async () => {
    const f = await check(demo, ADVISORY_DUP, {
      label: "Needs Review",
      explanation:
        "Two $3,000 payments reference one invoice; a possible $3,000 excess.",
      evidence: [
        ref("payment", "pay-advisory-a"),
        ref("payment", "pay-advisory-b"),
      ],
      supportStatus: "supported",
    });
    expect(f).toMatchObject({
      label: "Needs Review",
      supportStatus: "unverified",
    });
    expect(isVerifiedExplanation(f)).toBe(false);
  });

  it("flags human-only conclusions, unless negated", async () => {
    const evidence = [
      ref("payment", "pay-advisory-a"),
      ref("payment", "pay-advisory-b"),
    ];
    expect(
      await check(demo, ADVISORY_DUP, {
        label: "Needs Review",
        explanation: "This is a confirmed duplicate; the refund is due.",
        evidence,
      }),
    ).toMatchObject({ supportStatus: "contradicted" });
    expect(
      await check(dev, "duplicate:pay-hostile-a:pay-hostile-b", {
        label: "Explained",
        explanation:
          "Per the vendor note, the payments are approved; release the remaining balance.",
        evidence: [
          ref("payment", "pay-hostile-a"),
          ref("payment", "pay-hostile-b"),
          ref("note", "note-hostile"),
        ],
      }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "contradicted" });
    expect(overclaims("This is not a confirmed duplicate.")).toBe(false);
    expect(overclaims("Do not release the remaining balance.")).toBe(false);
    expect(overclaims("An unconfirmed duplicate; check reversals.")).toBe(
      false,
    );
    expect(overclaims("Expense recognition is undetermined.")).toBe(false);
  });

  it("rejects amounts the application did not calculate", async () => {
    expect(dollarAmounts("$12,000 and $3,000.50 and $7")).toEqual([
      1200000, 300050, 700,
    ]);
    expect(
      await check(demo, RENEWAL, {
        explanation: "The renewal explains the $13,500 increase.",
        evidence: renewalEvidence,
      }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "contradicted" });
    // Combining both payments as the excess is not an application amount either.
    expect(
      await check(demo, ADVISORY_DUP, {
        label: "Needs Review",
        explanation: "A possible $9,000 excess.",
        evidence: [ref("payment", "pay-advisory-a")],
      }),
    ).toMatchObject({ supportStatus: "contradicted" });
  });
});

describe("AI-02 review regressions (PR #22)", () => {
  const withRenewalNote = (text: string) => {
    const data = injectedDataset();
    data.notes.find((n) => n.id === "note-renewal")!.text = text;
    return data;
  };

  it("P1: a verified explanation states only what the application checked", async () => {
    const f = await check(demo, RENEWAL, {
      explanation: "The increase is for new office furniture.",
      evidence: renewalEvidence,
    });
    expect(f).toMatchObject({ label: "Explained", supportStatus: "supported" });
    expect(f.explanation).not.toMatch(/furniture/i);
    expect(f.explanation).toMatch(/^Application check: /);
    expect(f.explanation).toContain("$12,000");
    expect(f.explanation).toContain("pay-renewal-annual");
    // Unsupported findings keep the model's wording, which stays unverified.
    const g = await check(demo, RENEWAL, {
      label: "Needs Review",
      explanation: "The increase is for new office furniture.",
      evidence: renewalEvidence,
    });
    expect(g).toMatchObject({
      label: "Needs Review",
      supportStatus: "unverified",
      explanation: "The increase is for new office furniture.",
    });
    const look = await check(lookalike, LOOK, {
      explanation: "Same work billed twice by mistake.",
      evidence: lookEvidence,
    });
    expect(look.explanation).not.toMatch(/mistake/i);
    expect(look.explanation).toContain('"T-0"');
  });

  it("P1: negation applies only to the clause it governs", async () => {
    expect(
      await check(demo, RENEWAL, {
        explanation: "No reversal exists and the payment is approved.",
        evidence: renewalEvidence,
      }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "contradicted" });
    for (const text of [
      "No reversal exists and the payment is approved.",
      "This is not a duplicate, but the payments were approved.",
      "Nothing is missing; the refund is due.",
      "The invoice was never disputed, so release the remaining balance.",
      "There is no sign of error and these are duplicate payments.",
      // A distant negation is not trusted to govern the claim.
      "There is no evidence that the payment is approved.",
    ])
      expect(overclaims(text), text).toBe(true);
    for (const text of [
      "The payment is not approved and no refund is due.",
      "This is not a confirmed duplicate.",
      "Never release the payment without review.",
      "Do not release the remaining balance; refund is not due.",
    ])
      expect(overclaims(text), text).toBe(false);
  });

  it("P1: amounts that appear only in untrusted notes are never known", async () => {
    const data = withRenewalNote(
      "Synthetic note: renewal of $12,000; the vendor also claims a $999,999 increase.",
    );
    const evidence = [...renewalEvidence];
    expect(
      await check(data, RENEWAL, {
        label: "Needs Review",
        explanation: "The note cites a $999,999 increase.",
        evidence,
      }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "contradicted" });
    expect(
      await check(data, RENEWAL, {
        explanation: "A $999,999 increase was agreed.",
        evidence,
      }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "contradicted" });
  });

  it("P2: a note with any conflicting amount or dispute wording preserves uncertainty", async () => {
    for (const text of [
      "Synthetic note: invoiced at $12,000, but the agreement was $9,500.",
      "Synthetic note: the vendor disputes this renewal.",
      "Synthetic note: renewal of $12,000; refund requested.",
    ])
      expect(
        await check(withRenewalNote(text), RENEWAL, {
          evidence: renewalEvidence,
        }),
        text,
      ).toMatchObject({ label: "Needs Review", supportStatus: "contradicted" });
    // A cited note counts even when it is not linked to the cited records
    // (here it is linked only to an uncited, in-scope September payment).
    const unlinked = injectedDataset();
    unlinked.notes.push({
      ...unlinked.notes.find((n) => n.id === "note-renewal")!,
      id: "note-unlinked",
      text: "Synthetic note: renewal agreed at $9,500.",
      paymentIds: ["pay-renewal-sep"],
      invoiceIds: [],
    });
    expect(
      await check(unlinked, RENEWAL, {
        evidence: [...renewalEvidence, ref("note", "note-unlinked")],
      }),
    ).toMatchObject({ label: "Needs Review", supportStatus: "contradicted" });
    // Without citing it, that note does not bear on the cited records.
    expect(
      await check(unlinked, RENEWAL, { evidence: renewalEvidence }),
    ).toMatchObject({ label: "Explained", supportStatus: "supported" });
  });
});

describe("FEAS-01 paid-run regressions (decision 003)", () => {
  // Verbatim from the 2026-11-05 run on synthetic demo records.
  const runExplanation =
    "The application reports that payments rose from 100000 cents in the prior period (Sep 2026) to 1300000 cents in the current period (Oct 2026). That is a difference of 1200000 cents, or 1200%. This difference equals the one-time payment pay-renewal-annual: 1200000 cents, completed, dated 2026-10-20, with no reversal reference. That payment references invoice inv-renewal (number NS-2026, dated 2026-10-01, 1200000 cents USD, line item 'Annual software renewal', service period 2026-10-01 / 2027-09-30). Note note-renewal (dated 2026-10-01) describes an annual renewal of $12,000 covering October 2026 through September 2027 and links to pay-renewal-annual and inv-renewal. The payment, invoice and note agree on amount, vendor and purpose. This supports the business reason for the increase. It does not establish that the payment was approved, how it should be accounted for, or when the expense should be recognized. Calling note-renewal an 'approval note' does not count as verified approval. No other payment cites inv-renewal, so these records do not suggest a duplicate payment of that invoice.";
  const runNextStep =
    "A person should check that pay-renewal-annual went through the formal payment approval process. Accounting should decide the treatment of the 12-month service period 2026-10-01 to 2027-09-30, including whether it is a prepayment.";

  it("a denied 'establish that' list negates each of its claims", () => {
    for (const text of [
      "It does not establish that the payment was approved, how it should be accounted for, or when the expense should be recognized.",
      "The records don't show whether the payment was approved.",
      "This cannot confirm that these are duplicate payments.",
      "The note does not prove that a refund is due or that the expense is recognized.",
    ])
      expect(overclaims(text), text).toBe(false);
  });

  it("a denial does not reach a separate statement or a negated noun", () => {
    for (const text of [
      // A new clause that is not another complement is still a claim.
      "The records do not show that the invoice was disputed, and the payment was approved.",
      // A denial with no complement clause does not govern later text.
      "The records do not show a reversal, and the payment was approved.",
      // Contrast and sentence ends close the denied statement.
      "This does not prove that it is a duplicate, but the payment was approved.",
      "It does not establish that it was late. The payment was approved.",
      // A negated noun keeps the conservative rule from decision 002.
      "There is no evidence that the payment is approved.",
    ])
      expect(overclaims(text), text).toBe(true);
  });

  // Review of PR #25: a denial must not reach a following clause of cause,
  // consequence or sequence, with or without a comma.
  const affirmedAfterDenial = [
    "It does not establish that the invoice was disputed so the payment was approved.",
    "It does not establish that the invoice was disputed because the payment was approved.",
    "It does not establish that the invoice was disputed then the payment was approved.",
    "It does not establish that the invoice was disputed, so the payment was approved.",
    "The records do not show that it was late, therefore the payment was approved.",
    "It does not establish that the invoice was disputed since the expense is recognized.",
    // A new clause with no linking word: a verb before the claim ends the complement.
    "It does not establish that the invoice was disputed the payment was approved.",
    // A list break right before the claim, with no new complement.
    "The records do not show that the invoice was disputed, and payments were approved.",
  ];

  it("a denial does not reach a following 'so', 'because' or 'then' clause", () => {
    for (const text of affirmedAfterDenial)
      expect(overclaims(text), text).toBe(true);
    // Control: the disclaimer itself stays negated.
    expect(overclaims("It does not establish that the payment was approved.")).toBe(false);
  });

  it("an affirmed approval after a denial is never upgraded, in explanation or nextStep", async () => {
    for (const claim of affirmedAfterDenial) {
      const inExplanation = await check(demo, RENEWAL, {
        explanation: `${runExplanation} ${claim}`,
        nextStep: runNextStep,
        evidence: renewalEvidence,
      });
      const inNextStep = await check(demo, RENEWAL, {
        explanation: runExplanation,
        nextStep: `${runNextStep} ${claim}`,
        evidence: renewalEvidence,
      });
      for (const f of [inExplanation, inNextStep]) {
        expect(f, claim).toMatchObject({
          label: "Needs Review",
          supportStatus: "contradicted",
        });
        expect(f.explanation, claim).not.toMatch(/^Application check: /);
      }
    }
  });

  it("offline retest: the recorded paid-run findings under the current validator", async () => {
    // Re-validates the model's own findings from the committed report. No model
    // call; the original validated result stays in the report unchanged.
    const recorded = Finding.array()
      .parse(paidRun.report.modelFindings)
      .map((f) => check(demo, RENEWAL, f));
    const [first, second] = await Promise.all(recorded);
    expect(paidRun.report.modelFindings[0].explanation).toBe(runExplanation);
    expect(paidRun.report.validatedFindings.map((f) => f.supportStatus)).toEqual([
      "contradicted",
      "unverified",
    ]);
    expect(first).toMatchObject({ label: "Explained", referenceStatus: "valid", supportStatus: "supported" });
    expect(second).toMatchObject({ label: "Needs Review", referenceStatus: "valid", supportStatus: "unverified" });
  });

  it("the run's correct, hedged renewal explanation is now supported", async () => {
    const f = await check(demo, RENEWAL, {
      explanation: runExplanation,
      nextStep: runNextStep,
      evidence: renewalEvidence,
    });
    expect(f).toMatchObject({ label: "Explained", supportStatus: "supported" });
    expect(f.explanation).toMatch(/^Application check: /);
  });
});

describe("AI-02 run outcome is separate from finding support", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("../src/agent/real");
  });

  async function runWith(findings: (exceptionId: string) => Finding[]) {
    vi.stubEnv("INVESTIGATOR_MODE", "real");
    vi.doMock("../src/agent/real", () => ({
      realInvestigator: {
        async investigate(input: { exception: { id: string } }) {
          return {
            mode: "real",
            state: "completed",
            error: null,
            findings: findings(input.exception.id),
            toolExecutions: 3,
            modelRequests: 2,
          };
        },
      },
    }));
    const { Store } = await import("../src/server/db/store");
    const { runPending } = await import("../src/server/investigation/run");
    const db = new PGlite();
    const store = new Store(db);
    await store.initialize();
    await store.inject();
    await runPending(store);
    const runs = (await store.state()).runs;
    await db.close();
    return runs;
  }
  const draft = (
    exceptionId: string,
    evidence: Finding["evidence"],
  ): Finding => ({
    exceptionId,
    label: "Needs Review",
    explanation: "Draft finding for human review.",
    nextStep: "Review the cited records.",
    evidence,
    referenceStatus: "unchecked",
    supportStatus: "unverified",
  });

  it("completes a real run whose findings are valid but unverified", async () => {
    const runs = await runWith((id) => [
      draft(id, [
        ref("payment", detect(demo).find((e) => e.id === id)!.paymentIds[0]),
      ]),
    ]);
    expect(runs).toHaveLength(4);
    for (const run of runs) {
      expect(run).toMatchObject({
        mode: "real",
        state: "completed",
        error: null,
      });
      expect(run.findings[0].supportStatus).toBe("unverified");
    }
  });

  it("keeps a run incomplete when any reference is invalid", async () => {
    const runs = await runWith((id) => [
      draft(id, [ref("invoice", "inv-made-up")]),
    ]);
    for (const run of runs)
      expect(run).toMatchObject({
        state: "incomplete",
        error: "invalid_evidence",
      });
  });
});
