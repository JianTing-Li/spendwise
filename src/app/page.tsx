"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DemoState, type Run } from "../contracts";
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);

export default function Dashboard() {
  const [data, setData] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/demo", { cache: "no-store" });
    if (!response.ok)
      throw new Error(
        "Local demo unavailable. Start on localhost; hosted access is not configured.",
      );
    setData(DemoState.parse(await response.json()));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/demo", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Local demo unavailable. Start on localhost; hosted access is not configured.",
          );
        return DemoState.parse(await response.json());
      })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function act(action: object, path = "/api/demo") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Spendwise-Demo": "1",
        },
        body: JSON.stringify(action),
      });
      if (!response.ok)
        throw new Error(
          "Action could not be completed. Reload to check the current state.",
        );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const latestRuns = data?.exceptions.flatMap((exception) =>
    data.runs.filter((run) => run.exceptionId === exception.id).slice(-1),
  ) ?? [];
  const reviewed = latestRuns.filter((run) => run.reviewedAt).length;
  const total = data?.summaries.reduce((n, s) => n + s.currentCents, 0) ?? 0;
  function runView(run: Run | undefined, count = 1, historical = false) {
    if (!run) return <p>Investigation not started.</p>;
    return (
      <>
        <div className="tags">
          <span className="tag">
            {run.mode === "stub" ? "Stub · no AI call" : "Real model"}
          </span>
          <span className="tag">{run.state}</span>
          {run.reviewedAt && <span className="tag reviewed">Reviewed</span>}
        </div>
        {run.error && (
          <p role="status">
            Investigation {run.state}: {run.error}.
          </p>
        )}
        {!historical && ["failed", "incomplete", "cancelled"].includes(run.state) && (
          count < 3 ? (
            <button
              disabled={busy}
              onClick={() => act({ predecessorId: run.id }, "/api/demo/retry")}
            >
              Retry investigation ({count}/3 attempts used)
            </button>
          ) : <p>Three attempts used. Reset the demo to start again.</p>
        )}
        {run.findings.map((finding, i) => (
          <div key={i}>
            <h3>{finding.label}</h3>
            <p>{finding.explanation}</p>
            <p className="fine">
              References: {finding.referenceStatus} · Explanation support:{" "}
              {finding.supportStatus}
            </p>
            <p>
              <strong>Next step:</strong> {finding.nextStep}
            </p>
          </div>
        ))}
        {!historical && run.state === "completed" && (
          <button
            className="secondary"
            disabled={busy || Boolean(run.reviewedAt)}
            onClick={() => act({ action: "review", runId: run.id })}
          >
            {run.reviewedAt ? "Reviewed" : "Mark reviewed"}
          </button>
        )}
      </>
    );
  }
  return (
    <main>
      <header>
        <Link className="brand" href="/">
          S<span>SpendWise</span>
        </Link>
        <span className="environment">SYNTHETIC DEMO</span>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">PAYMENT OPERATIONS / OCTOBER 2026</p>
          <h1>
            Every exception.
            <br />
            <span>A clearer next step.</span>
          </h1>
          <p className="lede">
            Review unusual vendor payments with the records behind them.
            <br />
            September → October · USD · All records are fictional.
          </p>
        </div>
        <div className="controls">
          <button
            disabled={busy || !data || data.injected}
            onClick={() => act({ action: "inject", scenarioId: "demo-v1" })}
          >
            {busy
              ? "Working…"
              : data?.injected
                ? "Scenario injected"
                : "Simulate new payments"}
          </button>
          <button
            className="secondary"
            disabled={busy || !data}
            onClick={() => act({ action: "reset" })}
          >
            Reset demo
          </button>
        </div>
      </section>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="secondary"
            onClick={() =>
              load()
                .then(() => setError(""))
                .catch((e) => setError(e.message))
            }
          >
            Reload
          </button>
        </div>
      )}
      {!data && !error && <p role="status">Loading synthetic records…</p>}
      <section className="metrics" aria-label="Payment overview">
        <div>
          <p>October cash paid</p>
          <strong>{money(total)}</strong>
          <small>Net of completed reversals</small>
        </div>
        <div>
          <p>Exceptions to review</p>
          <strong>{data?.exceptions.length ?? "—"}</strong>
          <small>Rule-triggered, not confirmed errors</small>
        </div>
        <div>
          <p>Human review</p>
          <strong>
            {reviewed}
            <span> / {latestRuns.length}</span>
          </strong>
          <small>Review does not approve a payment</small>
        </div>
      </section>
      <section className="panel">
        <div className="section-title">
          <h2>Vendor payments</h2>
          <span>Two complete calendar months</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>September</th>
                <th>October</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {data?.summaries.map((s) => (
                <tr key={s.vendorId}>
                  <td>
                    <strong>
                      {
                        data.dataset.vendors.find((v) => v.id === s.vendorId)
                          ?.name
                      }
                    </strong>
                    <small>
                      {
                        data.dataset.vendors.find((v) => v.id === s.vendorId)
                          ?.category
                      }
                    </small>
                  </td>
                  <td>{money(s.priorCents)}</td>
                  <td>{money(s.currentCents)}</td>
                  <td>
                    {money(s.differenceCents)}
                    <small>
                      {s.percentChange === null
                        ? "Percentage unavailable"
                        : `${s.percentChange.toFixed(1)}%`}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <div className="section-title">
          <h2>Investigation queue</h2>
          <span>Evidence first. Human judgment always.</span>
        </div>
        {data?.exceptions.length === 0 && (
          <div className="empty">
            <span>✓</span>
            <h3>Baseline ready</h3>
            <p>
              Simulate new payments to explore an annual renewal,
              <br />a possible duplicate, and two legitimate similar payments.
            </p>
          </div>
        )}
        <div className="queue">
          {data?.exceptions.map((exception) => {
            const attempts = data.runs.filter((run) => run.exceptionId === exception.id);
            return (
            <article className="finding" key={exception.id}>
              <div className="finding-heading">
                <span className="rule">
                  {exception.rule === "payment_increase"
                    ? "PAYMENT INCREASE"
                    : "POSSIBLE DUPLICATE"}
                </span>
                <h2>
                  {
                    data.dataset.vendors.find(
                      (v) => v.id === exception.vendorId,
                    )?.name
                  }
                </h2>
              </div>
              {runView(attempts.at(-1), attempts.length)}
              {attempts.length > 1 && (
                <details>
                  <summary>Attempt history</summary>
                  {attempts.map((run, index) => (
                    <section key={run.id}>
                      <h3>Attempt {index + 1}</h3>
                      {runView(run, index + 1, true)}
                    </section>
                  ))}
                </details>
              )}
              <details>
                <summary>Inspect source records</summary>
                <p className="fine">
                  Trigger:{" "}
                  {exception.rule === "payment_increase"
                    ? "At least $5,000 and 20% increase (dollar threshold only when prior total ≤ 0)."
                    : "Same vendor, currency and amount; completed outgoing payments within seven calendar days."}
                </p>
                {data.dataset.payments
                  .filter((p) => exception.paymentIds.includes(p.id))
                  .map((p) => (
                    <div className="record" key={p.id}>
                      <strong>{p.id}</strong>
                      <p>
                        {p.date} · {money(p.amountCents)} · {p.status} ·{" "}
                        {p.entryType}
                      </p>
                      {p.invoiceId && <p>Invoice: {p.invoiceId}</p>}
                    </div>
                  ))}
                {data.dataset.invoices
                  .filter((i) => i.vendorId === exception.vendorId)
                  .map((i) => (
                    <div className="record" key={i.id}>
                      <strong>{i.id}</strong>
                      <p>
                        {money(i.amountCents)} · {i.lineItems.join("; ")}
                      </p>
                      <p>{i.servicePeriod}</p>
                    </div>
                  ))}
                {data.dataset.notes
                  .filter((n) => n.vendorId === exception.vendorId)
                  .map((n) => (
                    <div className="record" key={n.id}>
                      <strong>{n.id}</strong>
                      <p>{n.text}</p>
                    </div>
                  ))}
              </details>
            </article>
            );
          })}
        </div>
      </section>
      <footer>
        SpendWise · Portfolio prototype{" "}
        <span>Read-only investigation · No financial execution</span>
      </footer>
    </main>
  );
}
