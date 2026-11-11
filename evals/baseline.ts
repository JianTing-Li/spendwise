import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isVerifiedExplanation, validateFinding } from "../src/agent/validation";
import { detect, periods } from "../src/domain/finance";
import { injectedDataset, FIXTURE_VERSION } from "../src/fixtures/scenarios";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";
import type { Retrieval } from "../src/investigation";
import type { Dataset, Exception, Finding, Payment } from "../src/contracts";

export const BASELINE_VERSION = "rules-v3";

type Ref = Finding["evidence"][number];
const inCurrent = (p: Payment) =>
  p.date >= periods.currentStart && p.date < periods.endExclusive;

/**
 * Records a reviewer following the links would open first, from the scoped
 * records only: the payments that carry the exception (current-period cash
 * for an increase, the flagged pair for a duplicate), the invoices those
 * payments reference, and the notes linked to any of them.
 */
function linkedRecords(
  exception: Exception,
  records: { payments: Payment[]; invoices: Dataset["invoices"]; notes: Dataset["notes"] },
): Ref[] {
  const payments = records.payments.filter((p) =>
    exception.rule === "payment_increase"
      ? inCurrent(p) &&
        p.status === "completed" &&
        p.entryType === "outgoing" &&
        p.invoiceId !== null
      : exception.paymentIds.includes(p.id),
  );
  const paymentIds = new Set(payments.map((p) => p.id));
  const invoiceIds = new Set(payments.map((p) => p.invoiceId));
  const invoices = records.invoices.filter((i) => invoiceIds.has(i.id));
  const notes = records.notes.filter(
    (n) =>
      n.paymentIds.some((id) => paymentIds.has(id)) ||
      n.invoiceIds.some((id) => invoiceIds.has(id)),
  );
  return [
    ...payments.map((p) => ({ type: "payment" as const, id: p.id })),
    ...invoices.map((i) => ({ type: "invoice" as const, id: i.id })),
    ...notes.map((n) => ({ type: "note" as const, id: n.id })),
  ];
}

/**
 * Rule-based result for one exception, from the same scoped records and the
 * same retrieval as the investigator; no answer labels (INV-11). rules-v2
 * follows record relationships: it is `Explained` only when the application's
 * own record checks (decision 002) support the linked records, `Insufficient
 * Evidence` when no invoice or note is linked, and `Needs Review` otherwise. It
 * never states a business cause of its own.
 *
 * `retrieval` is what the baseline reads (a harness may make it fail);
 * `validation` is the application-scoped retrieval used only for checking.
 */
export async function baselineFor(
  data: Dataset,
  exception: Exception,
  retrieval: Retrieval = fixtureRetrieval(data, exception),
  validation: Retrieval = fixtureRetrieval(data, exception),
) {
  let records;
  let summary;
  try {
    const [payments, invoices, notes] = await Promise.all([
      retrieval.list_payments(),
      retrieval.get_invoices(),
      retrieval.get_vendor_notes(),
    ]);
    summary = await retrieval.get_payment_summary();
    records = { payments, invoices, notes };
  } catch {
    return {
      exceptionId: exception.id,
      rule: exception.rule,
      state: "incomplete" as const,
      label: "Insufficient Evidence" as const,
      explanation: "Retrieval failed, so the baseline reached no conclusion.",
      evidence: [] as Ref[],
      supportStatus: "missing" as const,
      summary: null,
      records: null,
    };
  }
  const evidence = linkedRecords(exception, records);
  const documented = evidence.some((e) => e.type !== "payment");
  const draft: Finding = {
    exceptionId: exception.id,
    label: documented ? "Explained" : "Insufficient Evidence",
    explanation: documented
      ? "Linked records were checked against the exception."
      : "No invoice or note is linked to the payments behind this exception.",
    evidence: documented ? evidence : [],
    nextStep: documented
      ? "A person reviews the linked records and decides the business reason."
      : "Request the supporting invoice or vendor documentation.",
    referenceStatus: "unchecked",
    supportStatus: "unverified",
  };
  const checked = await validateFinding(draft, exception, validation);
  const finding: Finding =
    !documented || isVerifiedExplanation(checked)
      ? checked
      : {
          ...checked,
          label: "Needs Review",
          explanation:
            exception.rule === "payment_increase"
              ? "The linked records do not pass the application's documented-increase checks. Review them for a cause."
              : "The flagged payments do not pay distinct invoices. Duplication remains unconfirmed.",
        };
  return {
    exceptionId: exception.id,
    rule: exception.rule,
    state: "completed" as const,
    label: finding.label,
    explanation: finding.explanation,
    evidence: finding.evidence,
    supportStatus: finding.supportStatus,
    summary,
    records,
  };
}

async function main() {
  const data = injectedDataset();
  const results = [];
  for (const exception of detect(data))
    results.push(await baselineFor(data, exception));
  console.log(
    JSON.stringify(
      {
        fixtureVersion: FIXTURE_VERSION,
        baselineVersion: BASELINE_VERSION,
        mode: "baseline",
        modelRequests: 0,
        results,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error("Baseline evaluation failed.");
    process.exitCode = 1;
  });
