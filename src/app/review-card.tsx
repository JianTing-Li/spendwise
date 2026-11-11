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

/** Why the rule flagged this, in one plain sentence plus the rule itself. */
function why(exception: Exception, dataset: Dataset) {
  if (exception.rule === "payment_increase") {
    const s = exception.summary;
    return {
      headline: `Paid ${dollars(s.differenceCents)} more than in September${s.percentChange === null ? "" : ` (${percent(s.percentChange)})`}.`,
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
  const key = (ref: Ref) => `${ref.type}:${ref.id}`;

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
    const label = verified ? "Explained" : f.label === "Explained" ? "Needs Review" : f.label;
    const body = lines(f.explanation);
    const headline = f.summary ?? body[0];
    const bullets = f.summary ? body : body.slice(1);
    const cited = f.evidence.filter(ref => chipLabel(ref));
    const missing = f.evidence.length - cited.length;
    return <section className={`answer${index ? " secondary" : ""}`} key={index} aria-label={index ? `Also noted ${index}` : "Answer"}>
      {index > 0 && <p className="eyebrow">Also noted · {label}</p>}
      <p className="answer-headline">{headline}</p>
      {bullets.length > 0 && <ul className="answer-points">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      <p className={verified ? "check verified" : "check"}>
        {verified ? "Checked against the records" : `Not verified: ${f.supportNote ?? (current.mode === "stub" ? "placeholder only, no AI investigation ran." : "the run stopped before its evidence was checked.")}`}
      </p>
      <p className="next-step"><strong>Next step:</strong> {f.nextStep}</p>
      {f.evidence.length > 0 && <div className="evidence" aria-label="Evidence">
        {cited.map(ref => <button key={key(ref)} type="button" className={`chip${open === key(ref) ? " open" : ""}`} aria-expanded={open === key(ref)} aria-controls={`${prefix}-${key(ref)}`} onClick={() => setOpen(open === key(ref) ? null : key(ref))}>
          {chipLabel(ref)}
        </button>)}
        {missing > 0 && <span className="chip missing">{missing} cited {missing === 1 ? "record isn't" : "records aren't"} available</span>}
      </div>}
      {cited.map(ref => open === key(ref) && <div className="record" id={`${prefix}-${key(ref)}`} key={key(ref)}>{record(ref)}</div>)}
    </section>;
  }

  return <article id={`flag-${exception.id}`} className={`flag${run?.reviewedAt ? " reviewed" : ""}`} aria-label={`${dataset.vendors.find(v => v.id === exception.vendorId)?.name ?? "Vendor"} ${exception.rule === "payment_increase" ? "payment increase" : "possible duplicate"}`}>
    <div className="flag-top">
      <span className="rule">{exception.rule === "payment_increase" ? "Payment increase" : "Possible duplicate"}</span>
      <span className={`badge ${outcome}`}>{outcomeLabel[outcome]}</span>
    </div>
    <p className="why"><strong>Why flagged:</strong> {reason.headline}</p>
    <p className="fine">{reason.detail}</p>
    <p className="sr-only" ref={status} tabIndex={-1} role="status" aria-label="Investigation status">{run ? `${outcomeLabel[outcome]}${run.reviewedAt ? ", reviewed" : ""}` : "Not started"}</p>

    {run && (run.state === "pending" || run.state === "running") && <Progress run={run} dataset={dataset} />}

    {run && ["failed", "incomplete", "cancelled"].includes(run.state) && <div className="stopped">
      <p><strong>The investigation didn&apos;t finish.</strong> {run.error ? errorText[run.error] : "It was cancelled."}</p>
      {attempts.length < 3
        ? <button className="secondary" disabled={busy || !canRetry} onClick={() => send({ predecessorId: run.id }, "/api/demo/retry")}>Try again ({attempts.length} of 3 used)</button>
        : <p className="fine">All 3 attempts are used. Check the records below or reset the demo.</p>}
    </div>}

    {run && run.findings.map((f, i) => finding(f, i, run))}

    {run?.state === "completed" && <div className="review-row">
      {run.reviewedAt
        ? <p className="reviewed-note">✓ Reviewed {new Date(run.reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</p>
        : <button disabled={busy || !canReview} onClick={() => send({ action: "review", runId: run.id })}>Mark reviewed</button>}
      <span className="fine">Marking reviewed doesn&apos;t approve or pay anything.</span>
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
