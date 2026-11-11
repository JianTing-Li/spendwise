"use client";

import { useEffect, useState } from "react";
import { INVESTIGATION_LIMITS, type Activity, type Dataset, type Run } from "../contracts";
import { dollars, shortDate } from "./format";

/** Plain-English step from a recorded lookup. Uses record numbers, never model text. */
function describe(step: Activity, dataset: Dataset): string {
  const invoice = (id: string) => dataset.invoices.find(i => i.id === id)?.number;
  const payment = (id: string) => {
    const p = dataset.payments.find(r => r.id === id);
    return p ? `${shortDate(p.date)} ${dollars(p.amountCents)}` : null;
  };
  switch (step.tool) {
    case "get_payment_summary":
      return "Checked September and October totals";
    case "list_payments": {
      const known = step.ids.map(payment).filter(Boolean);
      return known.length === 1 ? `Looked up the ${known[0]} payment` : known.length ? `Looked up ${known.length} payments` : "Listed the vendor's payments";
    }
    case "get_invoices": {
      const numbers = step.ids.map(invoice).filter(Boolean);
      return numbers.length ? `Read invoice ${numbers.slice(0, 3).join(", ")}` : "Read the linked invoices";
    }
    case "get_vendor_notes":
      return "Read the vendor notes";
    case "submit_findings":
      return "Wrote up the answer";
    default:
      return "Tried a lookup that isn't allowed";
  }
}

/** Live view of one running investigation: what it has looked at, and what it is doing now. */
export function Progress({ run, dataset }: { run: Run; dataset: Dataset }) {
  // Time since the server started the run, so it survives reloads and vendor switches.
  const [mounted] = useState(() => Date.now());
  const started = run.startedAt ? Math.min(Date.parse(run.startedAt), mounted) : mounted;
  const [now, setNow] = useState(mounted);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const steps = run.activity.map(step => describe(step, dataset));
  const last = run.activity.at(-1)?.tool;
  const current = run.mode === "stub"
    ? "Preparing a placeholder (no AI call in this mode)"
    : run.state === "pending"
      ? "Waiting to start"
      : last === "submit_findings"
        ? "Checking the answer against the records"
        : steps.length
          ? "Deciding what to check next"
          : "Starting the investigation";
  return (
    <div className="progress" role="status" aria-live="polite" aria-label="Investigation progress">
      <div className="progress-bar" aria-hidden="true"><span /></div>
      <ol className="progress-steps">
        {steps.map((text, i) => <li key={i} className="done">{text}</li>)}
        <li className="now">{current}…</li>
      </ol>
      <p className="fine">
        {run.toolExecutions}/{INVESTIGATION_LIMITS.toolExecutions} lookups · {seconds}s
        {seconds >= 20 && " · usually done within a minute"}
      </p>
    </div>
  );
}
