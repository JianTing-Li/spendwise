import { describe, expect, it } from "vitest";
import { baseline, injectedDataset } from "../src/fixtures/scenarios";
import { detect, summarize, validateDataset } from "../src/domain/finance";
import type { Payment } from "../src/contracts";

const p = (
  id: string,
  date: string,
  amountCents: number,
  overrides: Partial<Payment> = {},
): Payment => ({
  id,
  date,
  amountCents,
  vendorId: "v",
  invoiceId: null,
  currency: "USD",
  status: "completed",
  entryType: "outgoing",
  reversalReference: null,
  description: "Test",
  ...overrides,
});
const data = (payments: Payment[]) => ({
  vendors: [{ id: "v", name: "Test", category: "Test" }],
  invoices: [],
  notes: [],
  payments,
});
describe("INV-04 financial conventions", () => {
  it("matches the prewritten renewal totals and four expected exceptions", () => {
    expect(detect(baseline)).toEqual([]);
    expect(
      summarize(injectedDataset()).find((s) => s.vendorId === "vendor-renewal"),
    ).toMatchObject({
      priorCents: 100000,
      currentCents: 1300000,
      differenceCents: 1200000,
      percentChange: 1200,
    });
    expect(detect(injectedDataset())).toHaveLength(6);
  });
  it.each([
    [2000000, 2500000, true],
    [2000000, 2499999, false],
    [3000000, 3500000, false],
    [0, 500000, true],
    [0, 499999, false],
  ])(
    "applies both inclusive thresholds: %s → %s",
    (prior, current, flagged) => {
      const payments = [
        p("current", "2026-10-10", current),
        ...(prior ? [p("prior", "2026-09-10", prior)] : []),
      ];
      expect(
        detect(data(payments)).some((e) => e.rule === "payment_increase"),
      ).toBe(flagged);
    },
  );
  it("uses reversal date and makes a negative baseline percentage unavailable", () => {
    const payments = [
      p("old", "2026-08-01", 100000),
      p("reversal", "2026-09-10", 100000, {
        entryType: "reversal",
        reversalReference: "old",
      }),
      p("current", "2026-10-10", 400000),
    ];
    expect(summarize(data(payments))[0]).toMatchObject({
      priorCents: -100000,
      differenceCents: 500000,
      percentChange: null,
    });
    expect(detect(data(payments))).toHaveLength(1);
  });
  it.each([
    ["2026-09-24", "2026-10-01", true],
    ["2026-09-23", "2026-10-01", false],
    ["2026-10-01", "2026-10-08", true],
    ["2026-10-01", "2026-10-09", false],
    ["2026-09-25", "2026-09-26", false],
    ["2026-10-31", "2026-11-01", false],
  ])("uses calendar boundaries %s / %s", (a, b, flagged) => {
    expect(
      detect(data([p("a", a, 100), p("b", b, 100)])).some(
        (e) => e.rule === "possible_duplicate",
      ),
    ).toBe(flagged);
  });
  it("excludes pending, failed, and fully reversed duplicate candidates", () => {
    const payments = [
      p("a", "2026-10-01", 100),
      p("b", "2026-10-02", 100),
      p("r", "2026-10-31", 100, {
        entryType: "reversal",
        reversalReference: "a",
      }),
      p("pending", "2026-10-03", 900000, { status: "pending" }),
      p("failed", "2026-10-03", 900000, { status: "failed" }),
    ];
    expect(summarize(data(payments))[0].currentCents).toBe(100);
    expect(detect(data(payments))).toEqual([]);
  });
  it("rejects partial reversals and arithmetic outside safe integer range", () => {
    expect(() =>
      validateDataset(
        data([
          p("a", "2026-10-01", 100),
          p("r", "2026-10-02", 99, {
            entryType: "reversal",
            reversalReference: "a",
          }),
        ]),
      ),
    ).toThrow();
    expect(() =>
      summarize(
        data([
          p("a", "2026-10-01", Number.MAX_SAFE_INTEGER),
          p("b", "2026-10-02", 1),
        ]),
      ),
    ).toThrow();
  });
});
