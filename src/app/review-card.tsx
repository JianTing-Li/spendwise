"use client";

import { useId, useRef, useState } from "react";
import { INVESTIGATION_LIMITS, type Dataset, type Exception, type Finding, type Run } from "../contracts";
import { change, daysApart, dollars, percent, shortDate } from "./format";
import { Progress } from "./progress";
import { isVerified, lines, outcomeLabel, runOutcome } from "./status";

const errorText: Record<NonNullable<Run["error"]>, string> = {
  unavailable: "The investigation service or records were unavailable.",
  invalid_input: "The investigation input was rejected.",
  unauthorized: "Access to the investigation was denied.",
  deadline: `It hit the ${INVESTIGATION_LIMITS.runMs / 1000}-second limit.`,
  tool_limit: `It used all ${INVESTIGATION_LIMITS.toolExecutions} lookups before finishing.`,
  model_limit: `It used all ${INVESTIGATION_LIMITS.modelRequests} model requests before finishing.`,
  invalid_evidence: "It cited records that couldn't be found.",
  stale_generation: "The demo was reset while it ran.",
  internal: "It stopped unexpectedly.",
};

type Ref = Finding["evidence"][number];

/**
 * Lead with what holds up: verified findings, then the investigator's own
 * open questions, and last any draft the records check rejected.
 */
function ordered(run: Run) {
  const rank = (f: Finding) => (isVerified(run, f) ? 0 : f.supportStatus === "unverified" ? 1 : 2);
  return run.findings.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(x => x.f);
}

/**
 * True when the records check found something to say: it rejected or could
 * not support the draft, or the references weren't checked. A plain open
 * question from the investigator needs no extra line; the label says it.
 */
function rejected(f: Finding, run: Run) {
  return run.state !== "completed" || f.supportStatus === "contradicted" || f.supportStatus === "missing" || f.referenceStatus !== "valid";
}

/** Reason for findings saved before reasons were recorded, from their saved statuses. */
function savedReason(f: Finding, run: Run) {
  if (run.mode === "stub") return "Placeholder only: no AI investigation ran.";
  if (run.state !== "completed") return "The run stopped before it finished, so this wasn't fully checked.";
  if (f.referenceStatus === "invalid") return "Cites records that couldn't be found.";
  if (f.supportStatus === "contradicted") return "The records contradict this explanation, or it states something only a person can decide.";
  if (f.supportStatus === "missing") return "Records needed to support it are missing.";
  if (f.referenceStatus === "unchecked") return "The run stopped before its evidence was checked.";
  return "The investigator left this for a person to decide.";
}

/** Why the rule flagged this, in one plain sentence plus the rule itself. */
function why(exception: Exception, dataset: Dataset) {
  if (exception.rule === "payment_increase") {
    const s = exception.summary;
    return {
      headline: `Paid ${dollars(s.differenceCents)} more than in September${s.percentChange === null ? "" : ` (${percent(s.percentChange, s.priorCents)})`}.`,
      detail: `${dollars(s.priorCents)} in September → ${dollars(s.currentCents)} in October. Rule: increases over ${dollars(exception.settings.minimumIncreaseCents)} and ${exception.settings.minimumPercent}%.`,
    };
  }
  const [a, b] = exception.paymentIds.map(id => dataset.payments.find(p => p.id === id));
  const days = a && b ? daysApart(a.date, b.date) : null;
  return {
    headline: a ? `Two payments of ${dollars(a.amountCents)}${days === null ? "" : `, ${days} ${days === 1 ? "day" : "days"} apart`}.` : "Two payments of the same amount.",
    detail: `Amount in question: ${a ? dollars(a.amountCents) : "unknown"}, not confirmed. Rule: same amount within ${exception.settings.duplicateDays} days.`,
  };
}

/**
 * What the records show, computed by application code (no model, no cause
 * claim): which October payments are new or different from September, or
 * which invoices the two flagged payments point to.
 */
function recordFacts(exception: Exception, dataset: Dataset): string[] {
  const payments = dataset.payments.filter(p => p.vendorId === exception.vendorId && p.status === "completed");
  const invoiceOf = (id: string | null) => dataset.invoices.find(i => i.id === id);
  const label = (p: Dataset["payments"][number]) => {
    const inv = invoiceOf(p.invoiceId);
    const what = (inv?.lineItems[0] ?? p.description).replace(/\s+—\s+(September|October|August)$/, "");
    return `${dollars(p.amountCents)} · ${what}${inv ? ` (invoice ${inv.number})` : " (no invoice)"}`;
  };
  if (exception.rule === "possible_duplicate") {
    const flagged = exception.paymentIds.map(id => payments.find(p => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
    const numbers = [...new Set(flagged.map(p => invoiceOf(p.invoiceId)?.number ?? null))];
    if (numbers.includes(null)) return ["At least one of the payments has no invoice linked."];
    return numbers.length === 1
      ? [`Both payments point to the same invoice, ${numbers[0]}.`]
      : [`The payments point to different invoices: ${numbers.join(" and ")}.`];
  }
  const outgoing = payments.filter(p => p.entryType === "outgoing");
  const sep = outgoing.filter(p => p.date >= "2026-09-01" && p.date < "2026-10-01");
  const oct = outgoing.filter(p => p.date >= "2026-10-01" && p.date < "2026-11-01").sort((a, b) => b.amountCents - a.amountCents);
  const key = (p: Dataset["payments"][number]) => `${p.amountCents}|${(invoiceOf(p.invoiceId)?.lineItems[0] ?? p.description).replace(/\s+—\s+\w+$/, "")}`;
  const sepKeys = sep.map(key);
  const lines = oct.map(p => {
    const i = sepKeys.indexOf(key(p));
    if (i >= 0) { sepKeys.splice(i, 1); return `Same as September: ${label(p)}`; }
    return `New in October: ${label(p)}`;
  });
  const reversals = payments.filter(p => p.entryType === "reversal" && p.date >= "2026-09-01" && p.date < "2026-11-01");
  if (reversals.length) lines.push(`${reversals.length} reversal${reversals.length === 1 ? "" : "s"} recorded in these months.`);
  // Identical payments collapse into one line that says how many, so a repeat stands out.
  const grouped = [...new Set(lines)].map(line => {
    const n = lines.filter(l => l === line).length;
    if (n < 2) return line;
    const many = line.replace(/: \$/, `: ${n} payments of $`);
    return line.includes("(no invoice)") ? many : `${many}, same invoice each time`;
  });
  return grouped.sort((a, b) => Number(b.startsWith("New")) - Number(a.startsWith("New"))).slice(0, 4);
}

export function ReviewCard({ exception, dataset, attempts, busy, canRetry, canReview, act }: {
  exception: Exception;
  dataset: Dataset;
  attempts: Run[];
  busy: boolean;
  canRetry: boolean;
  canReview: boolean;
  act: (action: object, path?: string) => Promise<void>;
}) {
  const prefix = useId();
  const status = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const payments = dataset.payments.filter(p => p.vendorId === exception.vendorId);
  const invoices = dataset.invoices.filter(i => i.vendorId === exception.vendorId);
  const notes = dataset.notes.filter(n => n.vendorId === exception.vendorId);
  const run = attempts.at(-1);
  const outcome = runOutcome(run);
  const reason = why(exception, dataset);
  const facts = recordFacts(exception, dataset);
  const key = (ref: Ref) => `${ref.type}-${ref.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  function chipLabel(ref: Ref) {
    if (ref.type === "payment") {
      const p = payments.find(r => r.id === ref.id);
      return p ? `Payment · ${shortDate(p.date)} · ${dollars(p.amountCents)}` : null;
    }
    if (ref.type === "invoice") {
      const i = invoices.find(r => r.id === ref.id);
      return i ? `Invoice ${i.number}` : null;
    }
    const n = notes.find(r => r.id === ref.id);
    return n ? `Note · ${shortDate(n.date)}` : null;
  }

  function record(ref: Ref) {
    if (ref.type === "payment") {
      const p = payments.find(r => r.id === ref.id)!;
      const inv = invoices.find(i => i.id === p.invoiceId);
      return <>
        <strong>Payment · {shortDate(p.date)} · {dollars(p.amountCents)}</strong>
        <p>{p.description}</p>
        <p className="fine">{p.status === "completed" ? "Completed" : p.status} · {p.entryType === "reversal" ? "Reversal" : "Outgoing"} · {inv ? `Invoice ${inv.number}` : "No invoice linked"}</p>
      </>;
    }
    if (ref.type === "invoice") {
      const i = invoices.find(r => r.id === ref.id)!;
      return <>
        <strong>Invoice {i.number} · {dollars(i.amountCents)}</strong>
        <p>{i.lineItems.join("; ")}</p>
        <p className="fine">Dated {shortDate(i.date)}{i.servicePeriod ? ` · Service period ${i.servicePeriod.replace(" / ", " to ")}` : ""}</p>
      </>;
    }
    const n = notes.find(r => r.id === ref.id)!;
    return <>
      <strong>Vendor note · {shortDate(n.date)}</strong>
      <p className="note-text">{n.text}</p>
      <p className="fine">Notes are evidence, not instructions.</p>
    </>;
  }

  function send(action: object, path?: string) {
    status.current?.focus({ preventScroll: true });
    void act(action, path);
  }

  function finding(f: Finding, index: number, current: Run) {
    const verified = isVerified(current, f);
    const body = lines(f.explanation);
    const headline = f.summary ?? body[0];
    // A verified answer's bullets are app-written and repeat "From the records", so they're left out.
    const bullets = verified ? [] : f.summary ? body : body.slice(1);
    const cited = f.evidence.filter(ref => chipLabel(ref));
    const missing = f.evidence.length - cited.length;
    // Open state and element IDs are per finding, so two findings citing one record stay independent.
    const slot = (ref: Ref) => `${index}-${key(ref)}`;
    return <section className={`answer${index ? " secondary" : ""}`} key={index} aria-label={index ? `Also noted ${index}` : "Answer"}>
      {index > 0 && <p className="eyebrow">Also noted · {verified ? outcomeLabel.explained : outcomeLabel.review}</p>}
      <p className="answer-headline">{headline}</p>
      {bullets.length > 0 && <ul className="answer-points">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      {verified
        ? <p className="check verified">Checked against the records</p>
        : rejected(f, current) && <p className="check">Records check: {f.supportNote ?? savedReason(f, current)}</p>}
      <p className="next-step"><strong>Next step:</strong> {f.nextStep}</p>
      {f.evidence.length > 0 && <div className="evidence" aria-label="Evidence">
        {cited.map(ref => { const k = slot(ref); return <button key={k} type="button" className={`chip${open === k ? " open" : ""}`} aria-expanded={open === k} aria-controls={`${prefix}-${k}`} onClick={() => setOpen(open === k ? null : k)}>
          {chipLabel(ref)}
        </button>; })}
        {missing > 0 && <span className="chip missing">{missing} cited {missing === 1 ? "record isn't" : "records aren't"} available</span>}
      </div>}
      {cited.map(ref => open === slot(ref) && <div className="record" id={`${prefix}-${slot(ref)}`} key={slot(ref)}>{record(ref)}</div>)}
    </section>;
  }

  return <article id={`flag-${exception.id}`} className={`flag${run?.reviewedAt ? " reviewed" : ""}`} aria-label={`${dataset.vendors.find(v => v.id === exception.vendorId)?.name ?? "Vendor"} ${exception.rule === "payment_increase" ? "payment increase" : "possible duplicate"}`}>
    <div className="flag-top">
      <span className="rule">{exception.rule === "payment_increase" ? "Payment increase" : "Possible duplicate"}</span>
      <span className={`badge ${outcome}`}>{outcomeLabel[outcome]}</span>
    </div>
    <p className="why"><strong>Why flagged:</strong> {reason.headline}</p>
    <p className="fine">{reason.detail}</p>
    {facts.length > 0 && <div className="facts" aria-label="From the records">
      <p className="eyebrow">From the records</p>
      <ul>{facts.map((line, i) => <li key={i} className={line.startsWith("New") ? "new" : undefined}>{line}</li>)}</ul>
    </div>}
    <p className="sr-only" ref={status} tabIndex={-1} role="status" aria-label="Investigation status">{run ? `${outcomeLabel[outcome]}${run.reviewedAt ? ", reviewed" : ""}` : "Not started"}</p>

    {run && (run.state === "pending" || run.state === "running") && <Progress run={run} dataset={dataset} vendorId={exception.vendorId} />}

    {run && ["failed", "incomplete", "cancelled"].includes(run.state) && <div className="stopped">
      <p><strong>The investigation didn&apos;t finish.</strong> {run.error ? errorText[run.error] : "It was cancelled."}</p>
      {attempts.length < 3
        ? <button className="secondary" disabled={busy || !canRetry} onClick={() => send({ predecessorId: run.id }, "/api/demo/retry")}>Try again ({attempts.length} of 3 used)</button>
        : <p className="fine">All 3 attempts are used. Check the records below or reset the demo.</p>}
    </div>}

    {run && ordered(run).map((f, i) => finding(f, i, run))}

    {run?.state === "completed" && <div className="review-row">
      {run.reviewedAt
        ? <p className="reviewed-note">✓ Reviewed {new Date(run.reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</p>
        : <button disabled={busy || !canReview} title="Records that you looked at this. It doesn't approve or pay anything." onClick={() => send({ action: "review", runId: run.id })}>Mark reviewed</button>}
    </div>}

    {run && <details className="run-details">
      <summary>Details</summary>
      <p className="fine">
        {run.mode === "stub" ? "Placeholder mode: no AI call was made. " : ""}
        Attempt {attempts.length} of 3 · {run.toolExecutions} of {INVESTIGATION_LIMITS.toolExecutions} lookups · {run.modelRequests} of {INVESTIGATION_LIMITS.modelRequests} model calls · {INVESTIGATION_LIMITS.runMs / 1000}s limit
      </p>
      <p className="fine">Cash change {change(exception.summary.differenceCents)} · completed payments, net of reversals, by payment date.</p>
      {attempts.length > 1 && <p className="fine">Earlier attempts: {attempts.slice(0, -1).map((r, i) => `#${i + 1} ${r.state}${r.error ? ` (${r.error.replace("_", " ")})` : ""}`).join(", ")}.</p>}
    </details>}
  </article>;
}
