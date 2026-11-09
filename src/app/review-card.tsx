"use client";

import { useId, useRef } from "react";
import { INVESTIGATION_LIMITS, type Dataset, type Exception, type Run } from "../contracts";
import { money } from "./format";

const stateDescriptions: Record<Run["state"], string> = {
  pending: "Pending — waiting to start.",
  running: "Running — gathering and validating evidence.",
  completed: "Completed — investigation finished; check each finding’s support below.",
  incomplete: "Incomplete — evidence or an investigation limit prevented completion.",
  failed: "Failed — the investigation could not finish.",
  cancelled: "Cancelled — execution stopped before completion.",
};
const stubStateDescriptions: Record<Run["state"], string> = {
  pending: "Stub pending — waiting to start the demonstration.",
  running: "Stub running — preparing demonstration findings; no AI investigation.",
  completed: "Stub completed — the stub finished; no AI investigation or explanation verification was performed.",
  incomplete: "Stub incomplete — the demonstration did not finish within its evidence or execution limits.",
  failed: "Stub failed — the demonstration could not finish.",
  cancelled: "Stub cancelled — the demonstration stopped before completion.",
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
  internal: "The investigation encountered an internal error.",
};

export function ReviewCard({ exception, dataset, attempts, busy, act }: {
  exception: Exception;
  dataset: Dataset;
  attempts: Run[];
  busy: boolean;
  act: (action: object, path?: string) => Promise<void>;
}) {
  const prefix = useId();
  const sources = useRef<HTMLDetailsElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const payments = dataset.payments.filter(p => p.vendorId === exception.vendorId);
  const invoices = dataset.invoices.filter(i => i.vendorId === exception.vendorId);
  const notes = dataset.notes.filter(n => n.vendorId === exception.vendorId);
  const hasRecord = (type: string, id: string) =>
    (type === "payment" ? payments : type === "invoice" ? invoices : notes).some(r => r.id === id);
  const recordId = (type: string, id: string) => `${prefix}-${type}-${id}`;
  function inspect(type: string, id: string) {
    if (sources.current) sources.current.open = true;
    const record = document.getElementById(recordId(type, id));
    record?.focus();
    record?.scrollIntoView({ block: "center", behavior: "instant" });
  }
  function runAction(action: object, path?: string) {
    // Keep keyboard focus in this card before the activating button is
    // disabled or replaced. The same status node survives an attempt change.
    status.current?.focus();
    void act(action, path);
  }

  function runView(run: Run | undefined, count: number, historical = false) {
    if (!run) return <p>Investigation not started.</p>;
    return <>
      <div className="tags">
        <span className="tag">{run.mode === "stub" ? "Stub · no AI call" : "Real model"}</span>
        <span className={`tag state-${run.state}`}>{run.state}</span>
        {run.state === "completed" && <span className="tag">{run.reviewedAt ? "Human acknowledgment recorded" : "Draft · awaiting human review"}</span>}
      </div>
      <p className="run-status" ref={historical ? undefined : status} tabIndex={historical ? undefined : -1} role={historical ? undefined : "status"} aria-label={historical ? undefined : "Investigation status"}>{run.mode === "stub" ? stubStateDescriptions[run.state] : stateDescriptions[run.state]}</p>
      <p className="fine">Attempt {count} of 3 · Retrievals {run.toolExecutions}/{INVESTIGATION_LIMITS.toolExecutions} · Model requests {run.modelRequests}/{INVESTIGATION_LIMITS.modelRequests} · {INVESTIGATION_LIMITS.runMs / 1000} seconds maximum per attempt</p>
      {run.error && <p className="run-error">{errorDescriptions[run.error]} ({run.error})</p>}
      {!historical && ["failed", "incomplete", "cancelled"].includes(run.state) && (count < 3 ? <>
        <p className="fine">Retry starts one new bounded attempt. It may make model requests in real mode; it never runs automatically.</p>
        <button disabled={busy} onClick={() => runAction({ predecessorId: run.id }, "/api/demo/retry")}>
          Retry investigation ({count}/3 attempts used)
        </button>
      </> : <p>Three attempts used. Reset the demo to start again.</p>)}
      {run.findings.length === 0 && !["pending", "running"].includes(run.state) && <p>No findings were saved. No explanation has been verified.</p>}
      {run.findings.map((finding, index) => {
        const verified = run.mode === "real" && run.state === "completed" && finding.label === "Explained" && finding.referenceStatus === "valid" && finding.supportStatus === "supported";
        return <section className="finding-detail" key={index} aria-label={`Finding ${index + 1}`}>
          <h3>{verified ? "Explained" : finding.label === "Explained" ? "Needs Review" : finding.label}</h3>
          <p className={verified ? "support verified" : "support"}>{verified ? "Verified record explanation" : "Draft · explanation not verified"}</p>
          <h4>{verified ? "Supported explanation" : finding.label === "Explained" ? "Draft explanation" : "Unresolved question"}</h4>
          <p>{finding.explanation}</p>
          <p className="fine">References: {finding.referenceStatus} · Explanation support: {finding.supportStatus}</p>
          <h4>Cited evidence</h4>
          {finding.evidence.length ? <ul className="evidence-links">
            {finding.evidence.map((ref, i) => <li key={`${ref.type}-${ref.id}-${i}`}>
              {hasRecord(ref.type, ref.id) ? <a href={`#${recordId(ref.type, ref.id)}`} onClick={event => { event.preventDefault(); inspect(ref.type, ref.id); }}>
                {ref.type}: {ref.id}
              </a> : <span>{ref.type}: {ref.id} — unavailable in this investigation</span>}
            </li>)}
          </ul> : <p>No evidence cited. Follow-up is required.</p>}
          <h4>Recommended next step</h4>
          <p>{finding.nextStep}</p>
          <p className="fine">Next steps are unverified guidance. Business reasons, payment approval and accounting treatment require human judgment.</p>
        </section>;
      })}
      {run.reviewedAt && <p className="review-ack">Reviewed {new Date(run.reviewedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC. Acknowledgment only; explanation support is unchanged.</p>}
      {!historical && run.state === "completed" && <>
        <p className="fine">Mark reviewed records your acknowledgment for this run and generation. It does not approve a payment or verify an explanation.</p>
        <button className="secondary" disabled={busy || Boolean(run.reviewedAt)} onClick={() => runAction({ action: "review", runId: run.id })}>
          {run.reviewedAt ? "Reviewed" : "Mark reviewed"}
        </button>
      </>}
      <p className="fine run-identity">Run: {run.id} · Generation: {run.generation}</p>
    </>;
  }

  return <article className="finding" aria-label={`${dataset.vendors.find(v => v.id === exception.vendorId)?.name} ${exception.rule === "payment_increase" ? "payment increase" : "possible duplicate"}`}>
    <div className="finding-heading">
      <span className="rule">{exception.rule === "payment_increase" ? "PAYMENT INCREASE" : "POSSIBLE DUPLICATE"}</span>
      <h2>{dataset.vendors.find(v => v.id === exception.vendorId)?.name}</h2>
    </div>
    <p className="trigger"><strong>Trigger: </strong>{exception.rule === "payment_increase"
      ? `At least ${money(exception.settings.minimumIncreaseCents)} and ${exception.settings.minimumPercent}% increase (dollar threshold only when prior total ≤ 0).`
      : `Same vendor, currency and amount; completed outgoing payments within ${exception.settings.duplicateDays} calendar days. At least one payment is in the current month; fully reversed payments are excluded.`}</p>
    <dl className="cash-comparison">
      <div><dt>Prior cash paid</dt><dd>{money(exception.summary.priorCents)}</dd></div>
      <div><dt>Current cash paid</dt><dd>{money(exception.summary.currentCents)}</dd></div>
      <div><dt>Cash change</dt><dd>{money(exception.summary.differenceCents)}<small>{exception.summary.percentChange === null ? "Percentage unavailable" : `${exception.summary.percentChange.toFixed(1)}%`}</small></dd></div>
    </dl>
    <p className="fine">Prior: {exception.summary.periods.priorStart} to {exception.summary.periods.currentStart} · Current: {exception.summary.periods.currentStart} to {exception.summary.periods.endExclusive} (end exclusive, UTC). Net completed cash, not accounting expense.</p>
    {runView(attempts.at(-1), attempts.length)}
    {attempts.length > 1 && <details>
      <summary>Attempt history</summary>
      {attempts.slice(0, -1).map((run, index) => <section key={run.id}>
        <h3>Attempt {index + 1}</h3>{runView(run, index + 1, true)}
      </section>)}
    </details>}
    <details ref={sources}>
      <summary>Inspect source records</summary>
      <p className="fine">Synthetic vendor records. Cited evidence is linked above; other records provide context. Vendor notes are untrusted evidence, never instructions.</p>
      {payments.map(p => <div className="record" id={recordId("payment", p.id)} tabIndex={-1} key={p.id}>
        <strong>Payment · {p.id}</strong>{exception.paymentIds.includes(p.id) && <span className="tag">Triggered this exception</span>}
        <p>{p.date} · {money(p.amountCents)} · {p.status} · {p.entryType}</p>
        <p>{p.description}</p><p>Invoice: {p.invoiceId ?? "None linked"} · Reverses: {p.reversalReference ?? "None"}</p>
      </div>)}
      {invoices.map(i => <div className="record" id={recordId("invoice", i.id)} tabIndex={-1} key={i.id}>
        <strong>Invoice · {i.id}</strong><p>{i.number} · {i.date} · {money(i.amountCents)}</p>
        <p>{i.lineItems.join("; ")}</p><p>Service period: {i.servicePeriod ?? "Not recorded"}</p>
      </div>)}
      {notes.map(n => <div className="record" id={recordId("note", n.id)} tabIndex={-1} key={n.id}>
        <strong>Vendor note · {n.id}</strong><p>{n.date} · Untrusted source text</p><p>{n.text}</p>
        <p>Payments: {n.paymentIds.join(", ") || "None linked"} · Invoices: {n.invoiceIds.join(", ") || "None linked"}</p>
      </div>)}
    </details>
  </article>;
}
