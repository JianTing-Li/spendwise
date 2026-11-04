import { Dataset, Summary, Exception, type Payment } from "../contracts";

export const periods = {
  priorStart: "2026-09-01",
  currentStart: "2026-10-01",
  endExclusive: "2026-11-01",
  timezone: "UTC" as const,
};
export const settings = {
  minimumIncreaseCents: 500000,
  minimumPercent: 20,
  duplicateDays: 7,
};
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const safe = (n: number) => {
  if (!Number.isSafeInteger(n)) throw new Error("Unsafe money total");
  return n;
};

export function validateDataset(input: Dataset): Dataset {
  const data = Dataset.parse(input);
  for (const collection of [
    data.vendors,
    data.invoices,
    data.payments,
    data.notes,
  ]) {
    if (new Set(collection.map((x) => x.id)).size !== collection.length)
      throw new Error("Duplicate record ID");
  }
  const vendors = new Set(data.vendors.map((v) => v.id));
  const invoices = new Map(data.invoices.map((i) => [i.id, i]));
  const payments = new Map(data.payments.map((p) => [p.id, p]));
  const reversed = new Set<string>();
  for (const record of [...data.invoices, ...data.payments, ...data.notes])
    if (!vendors.has(record.vendorId)) throw new Error("Unknown vendor");
  for (const p of data.payments) {
    if (p.invoiceId && invoices.get(p.invoiceId)?.vendorId !== p.vendorId)
      throw new Error("Invalid invoice relationship");
    if (p.entryType === "outgoing" && p.reversalReference !== null)
      throw new Error("Outgoing payment cannot reverse another");
    if (p.entryType === "reversal") {
      const original = payments.get(p.reversalReference ?? "");
      if (
        !original ||
        original.entryType !== "outgoing" ||
        original.status !== "completed" ||
        original.vendorId !== p.vendorId ||
        original.currency !== p.currency ||
        original.amountCents !== p.amountCents ||
        p.date < original.date ||
        reversed.has(original.id)
      )
        throw new Error("Invalid full reversal");
      reversed.add(original.id);
    }
  }
  for (const note of data.notes) {
    if (
      note.paymentIds.some(
        (id) => payments.get(id)?.vendorId !== note.vendorId,
      ) ||
      note.invoiceIds.some((id) => invoices.get(id)?.vendorId !== note.vendorId)
    )
      throw new Error("Invalid note relationship");
  }
  return data;
}

export function summarize(input: Dataset): Summary[] {
  const data = validateDataset(input);
  return data.vendors.map((vendor) => {
    const total = (start: string, end: string) =>
      data.payments
        .filter(
          (p) =>
            p.vendorId === vendor.id &&
            p.status === "completed" &&
            p.date >= start &&
            p.date < end,
        )
        .reduce(
          (sum, p) =>
            safe(
              sum +
                (p.entryType === "outgoing" ? p.amountCents : -p.amountCents),
            ),
          0,
        );
    const priorCents = total(periods.priorStart, periods.currentStart);
    const currentCents = total(periods.currentStart, periods.endExclusive);
    const differenceCents = safe(currentCents - priorCents);
    return Summary.parse({
      vendorId: vendor.id,
      currency: "USD",
      priorCents,
      currentCents,
      differenceCents,
      percentChange:
        priorCents > 0 ? (differenceCents / priorCents) * 100 : null,
      periods,
    });
  });
}

export function detect(data: Dataset): Exception[] {
  const summaries = summarize(data);
  const result: Exception[] = [];
  const reversals = new Set(
    data.payments
      .filter(
        (p) =>
          p.entryType === "reversal" &&
          p.status === "completed" &&
          p.date < periods.endExclusive,
      )
      .map((p) => p.reversalReference),
  );
  const current = (p: Payment) =>
    p.date >= periods.currentStart && p.date < periods.endExclusive;
  for (const summary of summaries) {
    const payments = data.payments.filter(
      (p) => p.vendorId === summary.vendorId,
    );
    // Integer cross multiplication avoids floating-point threshold errors.
    const percentageMet =
      summary.priorCents <= 0 ||
      BigInt(summary.differenceCents) * 100n >=
        BigInt(summary.priorCents) * BigInt(settings.minimumPercent);
    if (
      summary.differenceCents >= settings.minimumIncreaseCents &&
      percentageMet
    ) {
      result.push(
        Exception.parse({
          id: `increase:${summary.vendorId}:2026-10`,
          vendorId: summary.vendorId,
          rule: "payment_increase",
          paymentIds: payments
            .filter(
              (p) =>
                p.status === "completed" &&
                p.date >= periods.priorStart &&
                p.date < periods.endExclusive,
            )
            .map((p) => p.id)
            .sort(),
          summary,
          settings,
        }),
      );
    }
    const candidates = payments
      .filter(
        (p) =>
          p.status === "completed" &&
          p.entryType === "outgoing" &&
          !reversals.has(p.id) &&
          day(p.date) >= day(periods.currentStart) - settings.duplicateDays &&
          p.date < periods.endExclusive,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < candidates.length; i++)
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i],
          b = candidates[j];
        if (
          a.currency === b.currency &&
          a.amountCents === b.amountCents &&
          Math.abs(day(a.date) - day(b.date)) <= settings.duplicateDays &&
          (current(a) || current(b))
        ) {
          result.push(
            Exception.parse({
              id: `duplicate:${a.id}:${b.id}`,
              vendorId: summary.vendorId,
              rule: "possible_duplicate",
              paymentIds: [a.id, b.id],
              summary,
              settings,
            }),
          );
        }
      }
  }
  return result;
}
