import {
  Finding,
  type Dataset,
  type Exception,
  type Payment,
} from "../contracts";
import type { Retrieval } from "../investigation";
import { periods } from "../domain/finance";

type Support = Finding["supportStatus"];
/** A support result and, when it is not supported, the plain reason why. */
type Check = { support: Support; note?: string };
const fail = (support: Support, note: string): Check => ({ support, note });
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
  return (
    before
      .slice(start)
      .split(/\s+/)
      .filter(Boolean)
      .slice(-NEGATION_WINDOW)
      .some((word) => NEGATORS.has(word.toLowerCase().replace(/[^a-z']/g, ""))) ||
    deniedComplement(before)
  );
}

/** Sentence ends and contrasting words end a denied statement's scope. */
const SCOPE_BREAK =
  /[.;:!?\n]|\b(?:but|however|although|though|yet|whereas|while)\b/gi;
/**
 * A negated verb of showing or knowing, followed by its complement clause:
 * "does not establish that", "doesn't show whether", "cannot confirm how".
 */
const DENIED_VERB =
  /(?:\bnot|\bnever|\bcannot|n['’]t)\s+(?:\w+\s+){0,2}?(?:establish|show|prove|confirm|demonstrate|indicate|imply|verify|determine)(?:s|es|ed|ing)?\s+(?:that|whether|if|how|when|why)\b/gi;
/** A further item in a denied list must itself be a complement clause. */
const COMPLEMENT = /^\s*(?:(?:and|or)\s+)?(?:that|whether|if|how|when|why|who|what|which)\b/i;
/** Words that start a new clause of consequence, cause or sequence. */
const CLAUSE_LINK =
  /\b(?:so|because|since|then|thus|hence|therefore|consequently|accordingly|meaning|means|thereby)\b/i;
/** A verb between a complement's opener and the claim means a new clause began. */
const VERB =
  /\b(?:is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|shall|should|can|could|may|might|must)\b/i;
/** Most words allowed between a complement's opener and the claim. */
const MAX_GAP_WORDS = 4;

/**
 * True only when the claim is the subject matter of a denied verb's complement:
 * "does not establish that the payment was approved", including later items of
 * a list ("…, how it is accounted for, or when the expense should be
 * recognized"). Anything that could start a separate statement ends the
 * denial, so the claim stays flagged:
 * - a clause link anywhere after the verb ("so", "because", "then", …);
 * - a list break not followed by another complement ("…, and the payment was
 *   approved"), including a break right before the claim;
 * - more than four words, or any verb, between the complement's opener and the
 *   claim ("that the invoice was disputed the payment was approved").
 * A negated noun ("there is no evidence that the payment is approved") is not
 * a denied verb and stays a claim. Ambiguity resolves to flagged.
 */
function deniedComplement(before: string): boolean {
  let start = 0;
  for (const m of before.matchAll(SCOPE_BREAK)) start = m.index + m[0].length;
  const sentence = before.slice(start);
  const denial = [...sentence.matchAll(DENIED_VERB)].at(-1);
  if (!denial) return false;
  const tail = sentence.slice(denial.index + denial[0].length);
  if (CLAUSE_LINK.test(tail)) return false;
  const items = tail.split(/,|\b(?:and|or)\b/i);
  const last = items.length - 1;
  // Empty items come from ", or"; the claim's own item must open a complement.
  const listOk = items.every((item, i) =>
    i === 0 || (i < last && !item.trim()) || COMPLEMENT.test(item),
  );
  if (!listOk) return false;
  const gap = last === 0 ? items[0] : items[last].replace(COMPLEMENT, "");
  const words = gap.split(/\s+/).filter(Boolean);
  return words.length <= MAX_GAP_WORDS && !VERB.test(gap);
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
 * Another paid invoice in scope bills the same amount for the same service
 * period: possibly the same work billed twice under a new number. This only
 * blocks a verified explanation; it never asserts a duplicate.
 */
function sameWorkBilledTwice(invoiceId: string, scoped: Records) {
  const invoice = scoped.invoices.find((i) => i.id === invoiceId);
  if (!invoice?.servicePeriod) return false;
  const counts = paid(scoped);
  const paidInvoices = new Set(
    scoped.payments.filter(counts).map((p) => p.invoiceId),
  );
  return scoped.invoices.some(
    (other) =>
      other.id !== invoice.id &&
      paidInvoices.has(other.id) &&
      other.amountCents === invoice.amountCents &&
      other.servicePeriod === invoice.servicePeriod,
  );
}

/**
 * Category "documented_increase": cited current-month cash tied to cited
 * invoices that it pays exactly, together covering the increase. Cited
 * current payments without an invoice (for example an unchanged monthly fee
 * cited as context) are not counted toward the increase; the invoiced ones
 * must cover it on their own, so un-invoiced cash can never explain it.
 */
function documentedIncrease(
  exception: Exception,
  scoped: Records,
  cited: Records,
): Check {
  const counts = paid(scoped);
  const invoiceIds = new Set(cited.invoices.map((i) => i.id));
  const current = cited.payments.filter(
    (p) => counts(p) && inCurrent(p) && p.invoiceId && invoiceIds.has(p.invoiceId),
  );
  if (!cited.payments.some((p) => counts(p) && inCurrent(p)))
    return fail("missing", "No completed October payment is cited.");
  if (!current.length)
    return fail("missing", "No cited invoice matches the October payments.");
  if (current.some((p) => !invoiceBalanced(p.invoiceId!, scoped)))
    return fail("contradicted", "An invoice is not paid exactly once and in full.");
  if (current.some((p) => sameWorkBilledTwice(p.invoiceId!, scoped)))
    return fail("contradicted", "Two invoices bill the same amount for the same service period.");
  if (notesContradict(exception, scoped, cited))
    return fail("contradicted", "A linked note mentions a different amount or a dispute.");
  const covered = sum(current.map((p) => p.amountCents));
  if (covered < exception.summary.differenceCents)
    return fail("missing", `Invoiced payments cover ${usd(covered)} of the ${usd(exception.summary.differenceCents)} increase.`);
  return { support: "supported" };
}

/**
 * Category "distinct_invoices": the two flagged payments each pay, exactly
 * and alone, a different cited invoice for a different service.
 */
function distinctInvoices(
  exception: Exception,
  scoped: Records,
  cited: Records,
): Check {
  const flagged = exception.paymentIds.map((id) =>
    cited.payments.find((p) => p.id === id),
  );
  if (flagged.some((p) => !p))
    return fail("missing", "Both flagged payments must be cited.");
  const [a, b] = flagged as Payment[];
  if (!a.invoiceId || !b.invoiceId)
    return fail("missing", "A flagged payment has no linked invoice.");
  if (a.invoiceId === b.invoiceId)
    return fail("contradicted", "Both payments point to the same invoice.");
  const ia = cited.invoices.find((i) => i.id === a.invoiceId);
  const ib = cited.invoices.find((i) => i.id === b.invoiceId);
  if (!ia || !ib)
    return fail("missing", "Each payment's invoice must be cited.");
  if (ia.number === ib.number)
    return fail("contradicted", "Both invoices share the same number.");
  if (
    ia.lineItems.join("\n").trim().toLowerCase() ===
    ib.lineItems.join("\n").trim().toLowerCase()
  )
    return fail("missing", "Both invoices describe the same work.");
  if (!invoiceBalanced(ia.id, scoped) || !invoiceBalanced(ib.id, scoped))
    return fail("contradicted", "An invoice is not paid exactly once and in full.");
  if (sameWorkBilledTwice(ia.id, scoped) || sameWorkBilledTwice(ib.id, scoped))
    return fail("contradicted", "Two invoices bill the same amount for the same service period.");
  if (notesContradict(exception, scoped, cited))
    return fail("contradicted", "A linked note mentions a different amount or a dispute.");
  return { support: "supported" };
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

/** "Mar 1, 2026" style date from an ISO date, in UTC. */
function day(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/** "Aug 1 – Aug 31, 2026" from "2026-08-01 / 2026-08-31"; null when unparseable. */
function period(servicePeriod: string | null) {
  const m = servicePeriod?.match(/^(\d{4}-\d{2}-\d{2})\s*\/\s*(\d{4}-\d{2}-\d{2})$/);
  return m ? { start: m[1], end: m[2], text: `${day(m[1])} – ${day(m[2])}` } : null;
}

function describeInvoice(invoice: Records["invoices"][number]) {
  return `invoice ${invoice.number} for ${usd(invoice.amountCents)} (${quoted(invoice.lineItems)})`;
}

/**
 * The summary and explanation of a verified finding, written by the
 * application from the records it checked. The model's own wording is free
 * text that cannot be verified (review P1: valid renewal citations could carry
 * an unrelated cause), so it never stands as a verified explanation.
 */
function verifiedExplanation(
  exception: Exception,
  scoped: Records,
  cited: Records,
) {
  const counts = paid(scoped);
  const invoiceIds = new Set(cited.invoices.map((i) => i.id));
  const invoiceOf = (p: Payment) =>
    cited.invoices.find((i) => i.id === p.invoiceId)!;
  const lines: string[] = [];
  let summary: string;
  if (exception.rule === "payment_increase") {
    const current = cited.payments.filter(
      (p) => counts(p) && inCurrent(p) && p.invoiceId && invoiceIds.has(p.invoiceId),
    );
    const invoices = [...new Set(current.map(invoiceOf))];
    for (const p of current)
      lines.push(`${usd(p.amountCents)} paid ${day(p.date)} pays ${describeInvoice(invoiceOf(p))} in full.`);
    for (const invoice of invoices) {
      const span = period(invoice.servicePeriod);
      if (span && span.end < periods.currentStart)
        lines.push(`Invoice ${invoice.number} covers earlier work (${span.text}), paid in October.`);
      else if (span) lines.push(`Invoice ${invoice.number} covers ${span.text}.`);
    }
    lines.push(`Together these cover the ${usd(exception.summary.differenceCents)} increase over September.`);
    const late = invoices.find((i) => { const span = period(i.servicePeriod); return span && span.end < periods.currentStart; });
    const main = [...invoices].sort((a, b) => b.amountCents - a.amountCents)[0];
    summary = late
      ? `October includes a late payment of invoice ${late.number} for earlier work, which covers the ${usd(exception.summary.differenceCents)} increase.`
      : `The ${usd(exception.summary.differenceCents)} increase is paid against invoice ${main.number}: ${quoted(main.lineItems).slice(1, -1)}.`;
  } else {
    const [a, b] = exception.paymentIds.map(
      (id) => cited.payments.find((p) => p.id === id)!,
    );
    const [ia, ib] = [invoiceOf(a), invoiceOf(b)];
    lines.push(`${usd(a.amountCents)} paid ${day(a.date)} pays ${describeInvoice(ia)}.`);
    lines.push(`${usd(b.amountCents)} paid ${day(b.date)} pays ${describeInvoice(ib)}.`);
    lines.push("Different invoice numbers and different work; each is paid once in full.");
    summary = `Two separate bills: the payments match different invoices (${ia.number} and ${ib.number}) for different work.`;
  }
  lines.push("No linked note states another amount or a dispute.");
  return {
    summary: summary.slice(0, 300),
    explanation: lines.map((l) => `- ${l}`).join("\n").slice(0, 4000),
  };
}

/**
 * Application validation of one finding (INV-06). Checks reference existence
 * and scope, then objective support for the claim category the exception rule
 * allows, then overclaims and amounts. Only "supported" findings may stay
 * Explained; the model's own reference/support status is always replaced, and
 * every unsupported finding carries an application-written reason.
 * See docs/decisions/002-evidence-validation.md.
 */
export async function validateFinding(
  input: unknown,
  exception: Exception,
  retrieval: Retrieval,
): Promise<Finding> {
  const { supportNote: _ignored, ...finding } = Finding.parse(input);
  void _ignored;
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
      supportNote: finding.evidence.length === 0
        ? "No records were cited."
        : "Cites records that are not part of this vendor's scoped records.",
    };
  if (citesNothingHonestly)
    return { ...finding, referenceStatus: "valid", supportStatus: "missing",
      supportNote: "The investigator reports the needed records are missing." };

  const ids = (type: "payment" | "invoice" | "note") =>
    new Set(finding.evidence.filter((r) => r.type === type).map((r) => r.id));
  const cited: Records = {
    payments: payments.filter((p) => ids("payment").has(p.id)),
    invoices: invoices.filter((i) => ids("invoice").has(i.id)),
    notes: notes.filter((n) => ids("note").has(n.id)),
  };
  const prose = `${finding.summary ?? ""}\n${finding.explanation}`;
  const text = `${prose}\n${finding.nextStep}`;
  const known = knownAmounts(exception, scoped, cited);
  let check: Check = {
    support: "unverified",
    note: "The investigator left this for a person to decide.",
  };
  if (overclaims(text))
    check = fail("contradicted", "States something only a person can decide, such as approval or a confirmed duplicate.");
  else if (dollarAmounts(prose).some((a) => !known.has(a)))
    check = fail("contradicted", "Mentions a dollar amount that is not in the records.");
  else if (finding.label === "Explained")
    check =
      exception.rule === "payment_increase"
        ? documentedIncrease(exception, scoped, cited)
        : distinctInvoices(exception, scoped, cited);
  // A verified finding carries only what the application checked; the model's
  // unverifiable prose stays only on findings that are not supported.
  if (check.support === "supported")
    return {
      ...finding,
      ...verifiedExplanation(exception, scoped, cited),
      referenceStatus: "valid",
      supportStatus: "supported",
    };
  return {
    ...finding,
    referenceStatus: "valid",
    supportStatus: check.support,
    supportNote: check.note,
    // Anything short of objective support goes to a person, never Explained.
    label: finding.label === "Explained" ? "Needs Review" : finding.label,
  };
}

/** A verified successful finding: the only kind that counts as explained. */
export const isVerifiedExplanation = (f: Finding) =>
  f.label === "Explained" &&
  f.referenceStatus === "valid" &&
  f.supportStatus === "supported";
