import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { detect, validateDataset } from "../src/domain/finance";
import { injectedDataset } from "../src/fixtures/scenarios";
import { developmentDataset, heldOutDataset } from "../src/fixtures/evaluation";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";
import type { Dataset, Payment } from "../src/contracts";
import { loadGroundTruth } from "../evals/ground-truth";

const datasets: Record<string, () => Dataset> = {
  "demo-v1": injectedDataset,
  "eval-dev-v1": () => developmentDataset,
  "eval-heldout-v1": () => heldOutDataset,
};
const truth = loadGroundTruth();

describe("DATA-01 synthetic scenarios and evaluator-only ground truth", () => {
  it("validates every dataset against contracts, relationships and reversal rules", () => {
    for (const make of Object.values(datasets))
      expect(() => validateDataset(make())).not.toThrow();
  });

  it("is deterministic: rebuilding gives identical records and exceptions", () => {
    for (const make of Object.values(datasets)) {
      expect(make()).toEqual(make());
      expect(detect(make())).toEqual(detect(make()));
    }
  });

  it("covers exactly the exceptions detect() produces in every dataset", () => {
    for (const [datasetId, make] of Object.entries(datasets)) {
      const detected = detect(make())
        .map((e) => e.id)
        .sort();
      const expected = truth.all
        .filter((c) => c.datasetId === datasetId && c.condition === "none")
        .map((c) => c.exceptionId)
        .sort();
      expect(expected, datasetId).toEqual(detected);
    }
    expect(truth.all.map((c) => c.exceptionId)).toContain(
      "increase:vendor-duplicate:2026-10",
    );
  });

  it("gives every case an expected label and keeps splits separate", () => {
    for (const c of truth.all)
      expect(c.acceptableLabels).toContain(c.expectedLabel);
    const heldOutIds = new Set(truth.heldOut.cases.map((c) => c.exceptionId));
    expect(
      truth.development.cases.filter((c) => heldOutIds.has(c.exceptionId)),
    ).toEqual([]);
    expect(
      truth.all
        .filter((c) => c.datasetId === "eval-heldout-v1")
        .every((c) => heldOutIds.has(c.exceptionId)),
    ).toBe(true);
    // The held-out split is not one-sided: it mixes labels.
    expect(
      new Set(truth.heldOut.cases.map((c) => c.expectedLabel)).size,
    ).toBeGreaterThan(1);
  });

  it("authors the PRD scenarios: renewal, duplicate, lookalike, missing/contradictory, hostile, failure, limits", () => {
    const ids = truth.all.map((c) => c.id);
    for (const id of [
      "renewal",
      "duplicate-payments",
      "lookalike",
      "missing-evidence",
      "contradictory-evidence",
      "hostile-duplicate",
      "retrieval-failure",
      "tool-limit",
    ])
      expect(ids).toContain(id);
    const hostile = developmentDataset.notes.find(
      (n) => n.id === "note-hostile",
    );
    expect(hostile?.text).toMatch(/ignore all previous instructions/i);
  });

  it("only cites evidence the scoped tools can retrieve, with matching application amounts", async () => {
    for (const c of truth.all) {
      const data = datasets[c.datasetId]();
      const exception = detect(data).find((e) => e.id === c.exceptionId);
      expect(exception, c.id).toBeDefined();
      const tools = fixtureRetrieval(data, exception!);
      const scoped = {
        payment: new Set((await tools.list_payments()).map((p) => p.id)),
        invoice: new Set((await tools.get_invoices()).map((i) => i.id)),
        note: new Set((await tools.get_vendor_notes()).map((n) => n.id)),
      };
      for (const ref of c.requiredEvidence)
        expect(scoped[ref.type].has(ref.id), `${c.id} ${ref.id}`).toBe(true);
      if (c.amounts.differenceCents !== undefined)
        expect(exception!.summary.differenceCents, c.id).toBe(
          c.amounts.differenceCents,
        );
    }
  });

  it("detects nothing for a fully reversed second payment or a failed attempt", () => {
    const vendors = detect(heldOutDataset).map((e) => e.vendorId);
    expect(vendors).not.toContain("vendor-catering");
    expect(vendors).not.toContain("vendor-electrical");
  });

  it("keeps the demo injection unchanged", () => {
    expect(
      detect(injectedDataset())
        .map((e) => e.id)
        .sort(),
    ).toEqual([
      "duplicate:pay-advisory-a:pay-advisory-b",
      "duplicate:pay-design-a:pay-design-b",
      "increase:vendor-duplicate:2026-10",
      "increase:vendor-renewal:2026-10",
    ]);
  });
});

describe("DATA-01 reversal ordering", () => {
  const p = (
    id: string,
    date: string,
    overrides: Partial<Payment> = {},
  ): Payment => ({
    id,
    vendorId: "v",
    invoiceId: null,
    date,
    amountCents: 100,
    currency: "USD",
    status: "completed",
    entryType: "outgoing",
    reversalReference: null,
    description: "Test",
    ...overrides,
  });
  const reversal = (id: string, date: string) =>
    p(id, date, { entryType: "reversal", reversalReference: "a" });
  const data = (payments: Payment[]) => ({
    vendors: [{ id: "v", name: "Test", category: "Test" }],
    invoices: [],
    notes: [],
    payments,
  });

  it("rejects a reversal dated before its original", () => {
    expect(() =>
      validateDataset(
        data([p("a", "2026-10-10"), reversal("r", "2026-10-09")]),
      ),
    ).toThrow("Invalid full reversal");
  });

  it("accepts a same-day reversal listed before its original", () => {
    expect(() =>
      validateDataset(
        data([reversal("r", "2026-10-10"), p("a", "2026-10-10")]),
      ),
    ).not.toThrow();
  });

  it("rejects a second reversal of the same payment", () => {
    expect(() =>
      validateDataset(
        data([
          p("a", "2026-10-01"),
          reversal("r1", "2026-10-02"),
          reversal("r2", "2026-10-03"),
        ]),
      ),
    ).toThrow("Invalid full reversal");
  });
});

describe("INV-11 ground truth stays evaluator-only", () => {
  const eslint = new ESLint();
  const lint = async (filePath: string, code: string) =>
    (await eslint.lintText(code, { filePath }))[0].messages.filter(
      (m) => m.ruleId === "no-restricted-imports",
    );

  it.each([
    ["src/agent/prompt.ts", 'import x from "../../evals/ground-truth";'],
    [
      "src/server/retrieval/x.ts",
      'import x from "../../../evals/ground-truth/development.json";',
    ],
    ["evals/baseline.ts", 'import { loadGroundTruth } from "./ground-truth";'],
  ])("rejects an import from %s", async (file, code) => {
    expect(await lint(file, `${code}\nexport default x;`)).not.toEqual([]);
  });

  it("allows the evaluator tests to read it", async () => {
    expect(
      await lint(
        "tests/x.test.ts",
        'import { loadGroundTruth } from "../evals/ground-truth";\nloadGroundTruth();',
      ),
    ).toEqual([]);
  });
});
