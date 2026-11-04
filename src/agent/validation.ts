import {
  Finding,
  type Dataset,
  type Exception,
  type Payment,
} from "../contracts";
import type { Retrieval } from "../investigation";
import { periods } from "../domain/finance";

type Support = Finding["supportStatus"];
type Records = {
  payments: Payment[];
  invoices: Dataset["invoices"];
  notes: Dataset["notes"];
};

/**
 * Human-only judgments. Asserting any of these is never supportable from the
 * records (INV-04/05/06): duplication, overpayment, recovery, approval,
 * payment execution and accounting treatment. Negated mentions are allowed.
 */
const OVERCLAIMS = [
  /\bconfirmed (?:an? )?(?:duplicate|double|overpayment)/i,
  /\b(?:is|are|was|were) (?:an? )?(?:duplicate|duplicated) payments?\b/i,
  /\boverpa(?:id|yment) (?:is|was|has been) confirmed\b/i,
  /\bpayments? (?:is|are|was|were|has been|have been) approved\b/i,
  /\bapproved? (?:the |this |these |both )?payments?\b/i,
  /\b(?:is|are) recoverable\b/i,
  /\b(?:refund|recovery) (?:is |will be )?(?:due|owed)\b/i,
  /\bexpense (?:is|was|should be|has been) recogni[sz]ed\b/i,
  /\baccounting treatment (?:is|was) (?:correct|approved|appropriate|confirmed)\b/i,
  /\b(?:release|execute|issue|send) (?:the )?(?:remaining )?(?:payment|balance|refund)\b/i,
];
const NEGATION =
  /\b(?:not|no|never|cannot|can't|don't|doesn't|does not|do not|without|neither|nor)\b[^.;]*$/i;

export function overclaims(text: string): boolean {
  return OVERCLAIMS.some((pattern) => {
    const global = new RegExp(pattern.source, "gi");
    for (const match of text.matchAll(global)) {
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      if (!NEGATION.test(before)) return true;
    }
    return false;
  });
}

/** Dollar amounts written as $1,234 or $1,234.56, in cents. */
export function dollarAmounts(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g)].map(
    (m) => Number(m[1].replaceAll(",", "")) * 100 + Number(m[2] ?? 0),
  );
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const inCurrent = (p: Payment) =>
  p.date >= periods.currentStart && p.date < periods.endExclusive;

function reversedIds(scoped: Records) {
  return new Set(
    scoped.payments
      .filter(
        (p) =>
          p.entryType === "reversal" &&
          p.status === "completed" &&
          p.date < periods.endExclusive,
      )
      .map((p) => p.reversalReference),
  );
}

/** Completed, unreversed outgoing cash: what actually counts as paid. */
function paid(scoped: Records) {
  const reversed = reversedIds(scoped);
  return (p: Payment) =>
    p.entryType === "outgoing" &&
    p.status === "completed" &&
    !reversed.has(p.id);
}

/** Amounts the application calculated or a scoped record states. */
function knownAmounts(exception: Exception, scoped: Records, cited: Records) {
  const s = exception.summary;
  const known = new Set<number>([
    Math.abs(s.priorCents),
    Math.abs(s.currentCents),
    Math.abs(s.differenceCents),
    exception.settings.minimumIncreaseCents,
    sum(cited.payments.map((p) => p.amountCents)),
    sum(cited.invoices.map((i) => i.amountCents)),
  ]);
  for (const r of [...scoped.payments, ...scoped.invoices])
    known.add(r.amountCents);
  for (const n of scoped.notes)
    for (const a of dollarAmounts(n.text)) known.add(a);
  return known;
}

/**
 * A linked note that states amounts, none of which matches a linked record or
 * the application totals, contradicts the documents it is attached to.
 */
function notesContradict(
  exception: Exception,
  scoped: Records,
  cited: Records,
) {
  const paymentIds = new Set(cited.payments.map((p) => p.id));
  const invoiceIds = new Set(cited.invoices.map((i) => i.id));
  const s = exception.summary;
  const expected = new Set([
    ...cited.payments.map((p) => p.amountCents),
    ...cited.invoices.map((i) => i.amountCents),
    Math.abs(s.differenceCents),
    Math.abs(s.currentCents),
  ]);
  return scoped.notes
    .filter(
      (n) =>
        n.paymentIds.some((id) => paymentIds.has(id)) ||
        n.invoiceIds.some((id) => invoiceIds.has(id)),
    )
    .some((n) => {
      const amounts = dollarAmounts(n.text);
      return amounts.length > 0 && !amounts.some((a) => expected.has(a));
    });
}

/** Every invoice must be paid exactly once in full by the scoped cash. */
function invoiceBalanced(invoiceId: string, scoped: Records) {
  const invoice = scoped.invoices.find((i) => i.id === invoiceId);
  const counts = paid(scoped);
  const total = sum(
    scoped.payments
      .filter((p) => counts(p) && p.invoiceId === invoiceId)
      .map((p) => p.amountCents),
  );
  return invoice !== undefined && total === invoice.amountCents;
}

/**
 * Category "documented_increase": cited current-month cash, each payment tied
 * to a cited invoice that it pays exactly, together covering the increase.
 */
function documentedIncrease(
  exception: Exception,
  scoped: Records,
  cited: Records,
): Support {
  const counts = paid(scoped);
  const current = cited.payments.filter((p) => counts(p) && inCurrent(p));
  if (!current.length) return "missing";
  const invoiceIds = new Set(cited.invoices.map((i) => i.id));
  if (current.some((p) => !p.invoiceId || !invoiceIds.has(p.invoiceId)))
    return "missing";
  if (current.some((p) => !invoiceBalanced(p.invoiceId!, scoped)))
    return "contradicted";
  if (notesContradict(exception, scoped, cited)) return "contradicted";
  if (
    sum(current.map((p) => p.amountCents)) < exception.summary.differenceCents
  )
    return "missing";
  return "supported";
}

/**
 * Category "distinct_invoices": the two flagged payments each pay, exactly
 * and alone, a different cited invoice for a different service.
 */
function distinctInvoices(
  exception: Exception,
  scoped: Records,
  cited: Records,
): Support {
  const flagged = exception.paymentIds.map((id) =>
    cited.payments.find((p) => p.id === id),
  );
  if (flagged.some((p) => !p)) return "missing";
  const [a, b] = flagged as Payment[];
  if (!a.invoiceId || !b.invoiceId) return "missing";
  if (a.invoiceId === b.invoiceId) return "contradicted";
  const ia = cited.invoices.find((i) => i.id === a.invoiceId);
  const ib = cited.invoices.find((i) => i.id === b.invoiceId);
  if (!ia || !ib) return "missing";
  if (ia.number === ib.number) return "contradicted";
  if (
    ia.lineItems.join("\n").trim().toLowerCase() ===
    ib.lineItems.join("\n").trim().toLowerCase()
  )
    return "missing";
  if (!invoiceBalanced(ia.id, scoped) || !invoiceBalanced(ib.id, scoped))
    return "contradicted";
  if (notesContradict(exception, scoped, cited)) return "contradicted";
  return "supported";
}

/**
 * Application validation of one finding (INV-06). Checks reference existence
 * and scope, then objective support for the claim category the exception rule
 * allows, then overclaims and amounts. Only "supported" findings may stay
 * Explained; the model's own reference/support status is always replaced.
 * See docs/decisions/002-evidence-validation.md.
 */
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
  const scoped: Records = { payments, invoices, notes };
  const byType = {
    payment: new Map(payments.map((p) => [p.id, p])),
    invoice: new Map(invoices.map((i) => [i.id, i])),
    note: new Map(notes.map((n) => [n.id, n])),
  };
  const refsExist = finding.evidence.every((ref) =>
    byType[ref.type].has(ref.id),
  );
  // Missing records are a legitimate reason to cite nothing, for that label only.
  const citesNothingHonestly =
    finding.evidence.length === 0 && finding.label === "Insufficient Evidence";
  if (
    finding.exceptionId !== exception.id ||
    !refsExist ||
    (finding.evidence.length === 0 && !citesNothingHonestly)
  )
    return {
      ...finding,
      referenceStatus: "invalid",
      supportStatus: "missing",
      label: "Insufficient Evidence",
    };
  if (citesNothingHonestly)
    return { ...finding, referenceStatus: "valid", supportStatus: "missing" };

  const ids = (type: "payment" | "invoice" | "note") =>
    new Set(finding.evidence.filter((r) => r.type === type).map((r) => r.id));
  const cited: Records = {
    payments: payments.filter((p) => ids("payment").has(p.id)),
    invoices: invoices.filter((i) => ids("invoice").has(i.id)),
    notes: notes.filter((n) => ids("note").has(n.id)),
  };
  const text = `${finding.explanation}\n${finding.nextStep}`;
  const known = knownAmounts(exception, scoped, cited);
  let support: Support = "unverified";
  if (
    overclaims(text) ||
    dollarAmounts(finding.explanation).some((a) => !known.has(a))
  )
    support = "contradicted";
  else if (finding.label === "Explained")
    support =
      exception.rule === "payment_increase"
        ? documentedIncrease(exception, scoped, cited)
        : distinctInvoices(exception, scoped, cited);
  return {
    ...finding,
    referenceStatus: "valid",
    supportStatus: support,
    // Anything short of objective support goes to a person, never Explained.
    label:
      finding.label === "Explained" && support !== "supported"
        ? "Needs Review"
        : finding.label,
  };
}

/** A verified successful finding: the only kind that counts as explained. */
export const isVerifiedExplanation = (f: Finding) =>
  f.label === "Explained" &&
  f.referenceStatus === "valid" &&
  f.supportStatus === "supported";
