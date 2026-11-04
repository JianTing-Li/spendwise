import { detect } from "../src/domain/finance";
import { injectedDataset, FIXTURE_VERSION } from "../src/fixtures/scenarios";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";

// Baseline uses the same scoped records as the future investigator; no answer labels.
async function main() {
  const data = injectedDataset();
  const results = [];
  for (const exception of detect(data)) {
    const tools = fixtureRetrieval(data, exception);
    const [payments, invoices, notes] = await Promise.all([
      tools.list_payments(),
      tools.get_invoices(),
      tools.get_vendor_notes(),
    ]);
    results.push({
      exceptionId: exception.id,
      rule: exception.rule,
      summary: await tools.get_payment_summary(),
      label: "Needs Review",
      explanation:
        exception.rule === "payment_increase"
          ? "The configured cash-payment increase thresholds were met. Review linked records for a cause."
          : "Similar completed payments meet the duplicate-candidate rule. Duplication remains unconfirmed.",
      paymentIds: payments.map((p) => p.id),
      invoiceIds: invoices.map((i) => i.id),
      noteIds: notes.map((n) => n.id),
      records: { payments, invoices, notes },
    });
  }
  console.log(
    JSON.stringify(
      {
        fixtureVersion: FIXTURE_VERSION,
        baselineVersion: "rules-v1",
        mode: "baseline",
        modelRequests: 0,
        results,
      },
      null,
      2,
    ),
  );
}
main().catch(() => {
  console.error("Baseline evaluation failed.");
  process.exitCode = 1;
});
