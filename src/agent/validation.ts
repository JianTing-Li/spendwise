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
/** Words that negate the claim right after them, within the same clause. */
const NEGATORS = new Set([
  "not", "no", "never", "cannot", "can't", "don't", "doesn't", "isn't",
  "aren't", "wasn't", "weren't", "hasn't", "haven't", "without", "nor",
  "neither",
]);
/** Clause boundaries: punctuation and coordinating or contrasting words. */
const CLAUSE_BREAK =
  /[.;:,!?\n]|\b(?:and|but|or|while|whereas|although|though|however|because|so|yet|then)\b/gi;
/** How many words before a claim a negator may sit and still govern it. */
const NEGATION_WINDOW = 3;

/**
 * A claim counts as negated only when a negator appears within the last few
 * words of its own clause ("is not a confirmed duplicate", "do not release").
 * A negation elsewhere in the sentence does not apply ("No reversal exists
 * and the payment is approved" is still an approval claim). Over-flagging only
 * downgrades a finding, so ambiguity resolves to flagged.
 */
function negated(text: string, index: number): boolean {
  const before = text.slice(0, index);
  let start = 0;
  for (const m of before.matchAll(CLAUSE_BREAK)) start = m.index + m[0].length;
  return before
    .slice(start)
    .split(/\s+/)
    .filter(Boolean)
    .slice(-NEGATION_WINDOW)
    .some((word) => NEGATORS.has(word.toLowerCase().replace(/[^a-z']/g, "")));
}

export function overclaims(text: string): boolean {
  return OVERCLAIMS.some((pattern) => {
    const global = new RegExp(pattern.source, "gi");
    for (const match of text.matchAll(global))
      if (!negated(text, match.index)) return true;
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

/**
 * Amounts the application calculated or a structured payment or invoice record
 * states. Note text is untrusted: a figure that appears only in a note is never
 * a known amount, so it can never make a finding look supported (INV-07).
 */
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
  return known;
}

/** Note wording that disputes or questions the records it is attached to. */
const DISPUTE =
  /\b(?:disput|contest|unauthori[sz]|overcharg|incorrect|wrong|error|mistake|duplicat|refund|chargeback|reversal|cancel)/i;

/**
 * Notes that bear on the finding: every cited note, plus every scoped note
 * linked to a cited payment or invoice. One of them contradicts the records
 * when it states any amount that is not a cited record amount or an
 * application total, or when it uses dispute wording. A note that mixes a
 * matching amount with a different one ("$12,000 invoiced; $9,500 agreed") is
 * contradictory, not consistent.
 */
function notesContradict(
  exception: Exception,
  scoped: Records,
  cited: Records,
) {
  const paymentIds = new Set(cited.payments.map((p) => p.id));
  const invoiceIds = new Set(cited.invoices.map((i) => i.id));
  const noteIds = new Set(cited.notes.map((n) => n.id));
  const s = exception.summary;
  const expected = new Set([
    ...cited.payments.map((p) => p.amountCents),
    ...cited.invoices.map((i) => i.amountCents),
    Math.abs(s.priorCents),
    Math.abs(s.currentCents),
    Math.abs(s.differenceCents),
  ]);
  return scoped.notes
    .filter(
      (n) =>
        noteIds.has(n.id) ||
        n.paymentIds.some((id) => paymentIds.has(id)) ||
        n.invoiceIds.some((id) => invoiceIds.has(id)),
    )
    .some(
      (n) =>
        DISPUTE.test(n.text) ||
        dollarAmounts(n.text).some((a) => !expected.has(a)),
    );
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

/** $12,000 or $12,000.50, from integer cents. */
function usd(cents: number) {
  const dollars = Math.trunc(cents / 100).toLocaleString("en-US");
  const rest = cents % 100;
  return `$${dollars}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** Invoice line items, quoted as record content and bounded in length. */
function quoted(lineItems: string[]) {
  const text = lineItems.join("; ").replace(/\s+/g, " ").trim();
  return JSON.stringify(text.length > 160 ? `${text.slice(0, 157)}...` : text);
}

function describeInvoice(invoice: Records["invoices"][number]) {
  return `invoice ${JSON.stringify(invoice.number)} for ${usd(invoice.amountCents)}, whose line items read ${quoted(invoice.lineItems)}`;
}

/**
 * The explanation of a verified finding, written by the application from the
 * records it checked. The model's own wording is free text that cannot be
 * verified (review P1: valid renewal citations could carry an unrelated
 * cause), so it never stands as a verified explanation.
 */
function verifiedExplanation(
  exception: Exception,
  scoped: Records,
  cited: Records,
) {
  const counts = paid(scoped);
  const invoiceOf = (p: Payment) =>
    cited.invoices.find((i) => i.id === p.invoiceId)!;
  let text: string;
  if (exception.rule === "payment_increase") {
    const current = cited.payments.filter((p) => counts(p) && inCurrent(p));
    const invoices = [...new Set(current.map(invoiceOf))];
    text =
      `Application check: completed October 2026 payments of ${usd(sum(current.map((p) => p.amountCents)))} ` +
      `(${current.map((p) => p.id).join(", ")}) pay ${invoices.map(describeInvoice).join(" and ")} exactly once and in full, ` +
      `and cover the ${usd(exception.summary.differenceCents)} increase over September 2026. ` +
      "Linked notes state no other amount and no dispute.";
  } else {
    const [a, b] = exception.paymentIds.map(
      (id) => cited.payments.find((p) => p.id === id)!,
    );
    text =
      `Application check: payment ${a.id} (${usd(a.amountCents)}) pays ${describeInvoice(invoiceOf(a))}; ` +
      `payment ${b.id} (${usd(b.amountCents)}) pays ${describeInvoice(invoiceOf(b))}. ` +
      "Each invoice is paid exactly once and in full, the invoice numbers and line items differ, and linked notes state no other amount and no dispute.";
  }
  return `${text} Whether the business reason is legitimate remains a human judgment.`;
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
  // A verified finding carries only what the application checked; the model's
  // unverifiable prose stays only on findings that are not supported.
  if (support === "supported")
    return {
      ...finding,
      explanation: verifiedExplanation(exception, scoped, cited).slice(0, 4000),
      referenceStatus: "valid",
      supportStatus: "supported",
    };
  return {
    ...finding,
    referenceStatus: "valid",
    supportStatus: support,
    // Anything short of objective support goes to a person, never Explained.
    label: finding.label === "Explained" ? "Needs Review" : finding.label,
  };
}

/** A verified successful finding: the only kind that counts as explained. */
export const isVerifiedExplanation = (f: Finding) =>
  f.label === "Explained" &&
  f.referenceStatus === "valid" &&
  f.supportStatus === "supported";
