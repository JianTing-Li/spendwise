import { Finding, type Exception } from "../contracts";
import type { Retrieval } from "../investigation";

/** References and scope can be checked mechanically; prose support needs separate adjudication. */
export async function validateFinding(
  input: unknown,
  exception: Exception,
  retrieval: Retrieval,
): Promise<Finding> {
  const finding = Finding.parse(input);
  const [payments, invoices, notes] = await Promise.all([
    retrieval.list_payments(),
    retrieval.get_invoices(),
    retrieval.get_vendor_notes(),
  ]);
  const ids = {
    payment: new Set(payments.map((p) => p.id)),
    invoice: new Set(invoices.map((i) => i.id)),
    note: new Set(notes.map((n) => n.id)),
  };
  const valid =
    finding.exceptionId === exception.id &&
    finding.evidence.length > 0 &&
    finding.evidence.every((ref) => ids[ref.type].has(ref.id));
  return {
    ...finding,
    referenceStatus: valid ? "valid" : "invalid",
    // Never trust a model's self-reported support status.
    supportStatus: valid ? "unverified" : "missing",
    label: valid
      ? finding.label === "Explained"
        ? "Needs Review"
        : finding.label
      : "Insufficient Evidence",
  };
}
