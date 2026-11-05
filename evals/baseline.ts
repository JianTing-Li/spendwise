import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { detect } from "../src/domain/finance";
import { injectedDataset, FIXTURE_VERSION } from "../src/fixtures/scenarios";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";
import type { Dataset, Exception } from "../src/contracts";

export const BASELINE_VERSION = "rules-v1";

/**
 * Rule-based result for one exception, from the same scoped records as the
 * investigator; no answer labels (INV-11). It reports the triggering rule and
 * the records, and never claims a business cause has been explained.
 */
export async function baselineFor(data: Dataset, exception: Exception) {
  const tools = fixtureRetrieval(data, exception);
  const [payments, invoices, notes] = await Promise.all([
    tools.list_payments(),
    tools.get_invoices(),
    tools.get_vendor_notes(),
  ]);
  return {
    exceptionId: exception.id,
    rule: exception.rule,
    summary: await tools.get_payment_summary(),
    label: "Needs Review" as const,
    explanation:
      exception.rule === "payment_increase"
        ? "The configured cash-payment increase thresholds were met. Review linked records for a cause."
        : "Similar completed payments meet the duplicate-candidate rule. Duplication remains unconfirmed.",
    paymentIds: payments.map((p) => p.id),
    invoiceIds: invoices.map((i) => i.id),
    noteIds: notes.map((n) => n.id),
    records: { payments, invoices, notes },
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
