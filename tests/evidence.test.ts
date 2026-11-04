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
import { Dataset, type Finding } from "../src/contracts";

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
