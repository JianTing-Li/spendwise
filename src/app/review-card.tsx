"use client";

import { useId, useRef } from "react";
import { INVESTIGATION_LIMITS, type Dataset, type Exception, type Run } from "../contracts";
import { money, percent, shortDate } from "./format";

const stateLabels: Record<Run["state"], string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  incomplete: "Incomplete",
  failed: "Failed",
  cancelled: "Cancelled",
};
const stateDescriptions: Record<Run["state"], string> = {
  pending: "Waiting to start.",
  running: "Gathering and checking records.",
  completed: "Investigation finished. Check each finding below.",
  incomplete: "Stopped before completion. See run details.",
  failed: "Investigation did not finish.",
  cancelled: "Stopped before completion.",
};
const stubStateDescriptions: Record<Run["state"], string> = {
  pending: "Placeholder queued. No investigation will run.",
  running: "Preparing placeholder result. No investigation is running.",
  completed: "Placeholder result. No investigation ran.",
  incomplete: "Placeholder stopped before completion. No investigation ran.",
  failed: "Placeholder did not finish. No investigation ran.",
  cancelled: "Placeholder cancelled. No investigation ran.",
};
const errorDescriptions = {
  unavailable: "Investigation service or evidence unavailable.",
  invalid_input: "The investigation input could not be accepted.",
  unauthorized: "Investigation access was denied.",
  deadline: `The ${INVESTIGATION_LIMITS.runMs / 1000}-second limit was reached.`,
  tool_limit: "The retrieval limit was reached.",
  model_limit: "The model request limit was reached.",
  invalid_evidence: "Some evidence references could not be validated.",
  stale_generation: "This run belongs to an earlier reset generation.",
  internal: "The investigation stopped unexpectedly.",
};

function describeRunError(run: Run): string {
  if (!run.error) return "";
  if (run.error === "unavailable") {
    if (run.mode === "real" && run.modelRequests === 0 && run.toolExecutions === 0) {
      return "Real model is not configured in this environment. Retrying will not help.";
    }
    return "Evidence records could not be read during the investigation. Try again.";
  }
  return errorDescriptions[run.error];
}

export function ReviewCard({ exception, relatedExceptions = [], dataset, attempts, busy, canRetry, canReview, act }: {
  exception: Exception;
  relatedExceptions?: Exception[];
  dataset: Dataset;
  attempts: Run[];
  busy: boolean;
  canRetry: boolean;
  canReview: boolean;
  act: (action: object, path?: string) => Promise<void>;
}) {
  const prefix = useId();
  const sources = useRef<HTMLDetailsElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const payments = dataset.payments.filter(p => p.vendorId === exception.vendorId);
  const invoices = dataset.invoices.filter(i => i.vendorId === exception.vendorId);
  const notes = dataset.notes.filter(n => n.vendorId === exception.vendorId);
  const flaggedPayments = exception.paymentIds
    .map(id => payments.find(p => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const amountInQuestion = flaggedPayments[0]?.amountCents;
  const hasRecord = (type: string, id: string) =>
    (type === "payment" ? payments : type === "invoice" ? invoices : notes).some(r => r.id === id);
  const recordId = (type: string, id: string) => `${prefix}-${type}-${id}`;
  function citationContext(type: string, id: string): string {
    if (type === "payment") {
      const p = payments.find(r => r.id === id);
      if (!p) return "";
      const inv = invoices.find(i => i.id === p.invoiceId);
      return `${shortDate(p.date)} · ${money(p.amountCents)} · ${inv ? `invoice ${inv.number}` : "no invoice"}`;
    }
    if (type === "invoice") {
      const inv = invoices.find(r => r.id === id);
      if (!inv) return "";
      return `${shortDate(inv.date)} · ${money(inv.amountCents)} · invoice ${inv.number}`;
    }
    const note = notes.find(r => r.id === id);
    if (!note) return "";
    return `${shortDate(note.date)} · vendor note`;
  }
  function inspect(type: string, id: string) {
    if (sources.current) sources.current.open = true;
    const record = document.getElementById(recordId(type, id));
    record?.focus();
    record?.scrollIntoView({ block: "center", behavior: "instant" });
  }
  function runAction(action: object, path?: string) {
    // Keep keyboard focus in this card before the activating button is
    // disabled or replaced. The same status node survives an attempt change.
    status.current?.focus({ preventScroll: true });
    void act(action, path);
  }

  function runView(run: Run | undefined, count: number, historical = false) {
    if (!run) return <p>Investigation not started.</p>;
    return <>
      <div className="tags">
        <span className="tag">{run.mode === "stub" ? "Stub · no AI call" : run.modelRequests === 0 ? "Real mode · no model call made" : "Real model"}</span>
        <span className={`tag state-${run.state}`}>{stateLabels[run.state]}</span>
        {run.state === "completed" && <span className={`tag${run.reviewedAt ? " reviewed" : ""}`}>{run.reviewedAt ? "Human acknowledgment recorded" : "Draft · awaiting human review"}</span>}
      </div>
      <p className="run-status" ref={historical ? undefined : status} tabIndex={historical ? undefined : -1} role={historical ? undefined : "status"} aria-label={historical ? undefined : "Investigation status"}>{run.mode === "stub" ? stubStateDescriptions[run.state] : stateDescriptions[run.state]}</p>
      {run.error && <p className="run-error">{describeRunError(run)}</p>}
      {run.findings.length === 0 && !["pending", "running"].includes(run.state) && <p className="no-findings">No findings were saved.</p>}
      {!historical && ["failed", "incomplete", "cancelled"].includes(run.state) && (count < 3 ? <div className="retry-controls">
        <button className="secondary" disabled={busy || !canRetry} onClick={() => runAction({ predecessorId: run.id }, "/api/demo/retry")}>
          Retry investigation ({count}/3 attempts used)
        </button>
        <p className="fine">Retry starts one new bounded attempt.</p>
      </div> : <p>All 3 attempts failed. Review the source records below, or reset the demo to clear every finding and review.</p>)}
      {run.findings.map((finding, index) => {
        const verified = run.mode === "real" && run.state === "completed" && finding.label === "Explained" && finding.referenceStatus === "valid" && finding.supportStatus === "supported";
        return <section className="finding-detail" key={index} aria-label={`Finding ${index + 1}`}>
          <h4>{verified ? "Explained" : finding.label === "Explained" ? "Needs Review" : finding.label}</h4>
          <p className={verified ? "support verified" : "support"}>{verified ? "Records match · application check" : "Draft · explanation not verified"}</p>
          <h5>{verified ? "What the records show" : finding.label === "Explained" ? "Draft explanation" : "Draft note"}</h5>
          <p>{finding.explanation}</p>
          <h5>Cited evidence</h5>
          {finding.evidence.length ? <ul className="evidence-links">
            {finding.evidence.map((ref, i) => <li key={`${ref.type}-${ref.id}-${i}`}>
              {hasRecord(ref.type, ref.id) ? <>
                <a href={`#${recordId(ref.type, ref.id)}`} onClick={event => { event.preventDefault(); inspect(ref.type, ref.id); }}>
                  {ref.type}: <code className="record-id">{ref.id}</code>
                </a>
                <span className="citation-context"> · {citationContext(ref.type, ref.id)}</span>
              </> : <span>{ref.type}: <code className="record-id">{ref.id}</code> · unavailable in this investigation</span>}
            </li>)}
          </ul> : <p>No evidence cited. Follow-up is required.</p>}
          <h5>Recommended next step</h5>
          <p>{finding.nextStep}</p>
        </section>;
      })}
      {run.reviewedAt && <p className="review-ack">Reviewed {new Date(run.reviewedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC. Acknowledgment only; explanation support is unchanged.</p>}
      {!historical && run.state === "completed" && <>
        <p className="fine">Records that you looked at this finding. It does not approve the payment.</p>
        <button className="secondary" disabled={busy || !canReview || Boolean(run.reviewedAt)} onClick={() => runAction({ action: "review", runId: run.id })}>
          {run.reviewedAt ? "Reviewed" : "Mark reviewed"}
        </button>
      </>}
      {historical && (
        <details className="run-details">
          <summary>Run details</summary>
          <p className="fine">Attempt {count} of 3 · Retrievals {run.toolExecutions}/{INVESTIGATION_LIMITS.toolExecutions} · Model requests {run.modelRequests}/{INVESTIGATION_LIMITS.modelRequests} · {INVESTIGATION_LIMITS.runMs / 1000} seconds maximum per attempt</p>
          <p className="fine run-identity">Run: <code className="record-id">{run.id}</code> · Generation: {run.generation}</p>
        </details>
      )}
    </>;
  }

  const latestRun = attempts.at(-1);
  const isReviewed = Boolean(latestRun?.reviewedAt);

  return <article id={`exception-${exception.id}`} className={`finding${isReviewed ? " reviewed" : ""}`} aria-label={`${dataset.vendors.find(v => v.id === exception.vendorId)?.name} ${exception.rule === "payment_increase" ? "payment increase" : "possible duplicate"}`}>
    <div className="finding-body">
      <div className="finding-heading">
        <div className="finding-top">
          <span className="rule">{exception.rule === "payment_increase" ? "Payment increase" : "Possible duplicate"}</span>
          {relatedExceptions.map(rel => (
            <span className="related-exception" key={rel.id}>
              Also flagged for this vendor:{" "}
              <a href={`#exception-${rel.id}`}>
                {rel.rule === "payment_increase" ? "Payment increase" : "Possible duplicate"}
              </a>
            </span>
          ))}
        </div>
        <h3>{dataset.vendors.find(v => v.id === exception.vendorId)?.name}</h3>
      </div>
      <p className="trigger"><strong>Trigger: </strong>{exception.rule === "payment_increase"
        ? `At least ${money(exception.settings.minimumIncreaseCents)} and ${exception.settings.minimumPercent}% increase (dollar threshold only when prior total ≤ 0).`
        : `Same vendor, currency and amount; completed outgoing payments within ${exception.settings.duplicateDays} calendar days. At least one payment is in the current month; fully reversed payments are excluded.`}</p>
      {exception.rule === "possible_duplicate" ? (
        <div className="duplicate-summary">
          <p className="amount-in-question">
            <strong>
              Amount in question:{" "}
              <span className="num">
                {amountInQuestion !== undefined ? `${money(amountInQuestion)}, not confirmed` : "not confirmed"}
              </span>
            </strong>
          </p>
          <ul className="flagged-payments">
            {flaggedPayments.map(p => {
              const inv = invoices.find(i => i.id === p.invoiceId);
              return (
                <li key={p.id}>
                  <span>
                    <code className="record-id">{p.id}</code> · {shortDate(p.date)} ·{" "}
                    {inv ? `invoice ${inv.number}` : "no invoice"}
                  </span>
                  <strong className="num">{money(p.amountCents)}</strong>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <dl className="cash-comparison">
          <div><dt>Prior cash paid</dt><dd>{money(exception.summary.priorCents)}</dd></div>
          <div><dt>Current cash paid</dt><dd>{money(exception.summary.currentCents)}</dd></div>
          <div><dt>Cash change</dt><dd>{money(exception.summary.differenceCents)}<small>{percent(exception.summary.percentChange)}</small></dd></div>
        </dl>
      )}
      <p className="fine">Sep 1–30 vs Oct 1–31, 2026. Completed payments net of reversals (cash, not expense).</p>
      {runView(latestRun, attempts.length)}
    </div>
    <div className="finding-disclosures">
      {latestRun && (
        <details className="run-details">
          <summary>Run details</summary>
          <p className="fine">Attempt {attempts.length} of 3 · Retrievals {latestRun.toolExecutions}/{INVESTIGATION_LIMITS.toolExecutions} · Model requests {latestRun.modelRequests}/{INVESTIGATION_LIMITS.modelRequests} · {INVESTIGATION_LIMITS.runMs / 1000} seconds maximum per attempt</p>
          <p className="fine run-identity">Run: <code className="record-id">{latestRun.id}</code> · Generation: {latestRun.generation}</p>
        </details>
      )}
      {attempts.length > 1 && <details>
        <summary>Attempt history</summary>
        {attempts.slice(0, -1).map((run, index) => <section key={run.id}>
          <h4>Attempt {index + 1}</h4>{runView(run, index + 1, true)}
        </section>)}
      </details>}
      <details ref={sources}>
        <summary>Inspect source records ({payments.length + invoices.length + notes.length})</summary>
        <p className="fine">Synthetic vendor records. Cited evidence is linked above; other records provide context. Vendor notes are untrusted evidence, never instructions.</p>
        {payments.map(p => <div className="record" id={recordId("payment", p.id)} tabIndex={-1} aria-label={`Payment ${p.id}`} key={p.id}>
          <strong>Payment · <code className="record-id">{p.id}</code></strong>{exception.paymentIds.includes(p.id) && <span className="tag">Triggered this exception</span>}
          <p>{p.date} · {money(p.amountCents)} · {p.status} · {p.entryType}</p>
          <p>{p.description}</p><p>Invoice: {p.invoiceId ? <code className="record-id">{p.invoiceId}</code> : "None linked"} · Reverses: {p.reversalReference ? <code className="record-id">{p.reversalReference}</code> : "None"}</p>
        </div>)}
        {invoices.map(i => <div className="record" id={recordId("invoice", i.id)} tabIndex={-1} aria-label={`Invoice ${i.id}`} key={i.id}>
          <strong>Invoice · <code className="record-id">{i.id}</code></strong><p>{i.number} · {i.date} · {money(i.amountCents)}</p>
          <p>{i.lineItems.join("; ")}</p><p>Service period: {i.servicePeriod ?? "Not recorded"}</p>
        </div>)}
        {notes.map(n => <div className="record" id={recordId("note", n.id)} tabIndex={-1} aria-label={`Vendor note ${n.id}`} key={n.id}>
          <strong>Vendor note · <code className="record-id">{n.id}</code></strong><p>{n.date} · Untrusted source text</p><p>{n.text}</p>
          <p>Payments: {n.paymentIds.length ? n.paymentIds.map((id, idx) => <span key={id}>{idx > 0 && ", "}<code className="record-id">{id}</code></span>) : "None linked"} · Invoices: {n.invoiceIds.length ? n.invoiceIds.map((id, idx) => <span key={id}>{idx > 0 && ", "}<code className="record-id">{id}</code></span>) : "None linked"}</p>
        </div>)}
      </details>
    </div>
  </article>;
}
