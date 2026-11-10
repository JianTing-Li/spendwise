"use client";
import Link from "next/link";
import { useDemo } from "./use-demo";
import { ReviewCard } from "./review-card";
import { money } from "./format";
import { INVESTIGATION_LIMITS } from "../contracts";
import type { Permission } from "../server/access-policy";

export default function Dashboard({ permissions, signedOut }: { permissions: readonly Permission[]; signedOut: boolean }) {
  const { data, busy, error, load, act, active } = useDemo(permissions);
  const can = (permission: Permission) => permissions.includes(permission);
  const latestRuns = data?.exceptions.flatMap((exception) =>
    data.runs.filter((run) => run.exceptionId === exception.id && run.generation === data.generation).slice(-1),
  ) ?? [];
  const reviewableRuns = latestRuns.filter(run => run.state === "completed");
  const reviewed = reviewableRuns.filter((run) => run.reviewedAt).length;
  const total = data?.summaries.reduce((n, s) => n + s.currentCents, 0) ?? 0;
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
            disabled={!can("inject") || Boolean(busy) || Boolean(error) || !data || data.injected}
            onClick={() => act({ action: "inject", scenarioId: "demo-v1" })}
          >
            {busy === "inject"
              ? "Starting investigations…"
              : data?.injected
                ? "Scenario injected"
                : "Simulate new payments"}
          </button>
          <button
            className="secondary"
            disabled={!can("reset") || busy === "reset" || (!data && !busy)}
            onClick={() => act({ action: "reset" })}
          >
            {busy === "reset" ? "Resetting…" : "Reset demo"}
          </button>
        </div>
      </section>
      {signedOut && (
        <form className="sign-in-prompt" action="/api/auth/signin" method="get">
          <p>Sign in with GitHub to run investigations. You are viewing the synthetic demo read-only.</p>
          <button type="submit" className="secondary">Sign in with GitHub</button>
        </form>
      )}
      {!signedOut && permissions.every(permission => permission === "read") && (
        <p className="sign-in-prompt">This account is not authorized to run investigations. You are viewing the synthetic demo read-only.</p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="secondary"
            onClick={() => void load()}
          >
            Reload
          </button>
        </div>
      )}
      {!data && !error && <p role="status">{busy === "reset" ? "Clearing scenario findings and review acknowledgments…" : "Loading synthetic records…"}</p>}
      {(active || busy === "inject" || busy === "retry") && <div className="progress" role="status">
        {error ? "Progress updates are unavailable. Reload to check current run states." : `Investigations in progress. Run states and counters refresh automatically. Each attempt is limited to ${INVESTIGATION_LIMITS.toolExecutions} retrievals, ${INVESTIGATION_LIMITS.modelRequests} model requests and ${INVESTIGATION_LIMITS.runMs / 1000} seconds.`}
        <p className="fine">Keep this page open while it runs. Reset stops the scenario and clears its findings and human review acknowledgments.</p>
      </div>}
      <section className="metrics" aria-label="Payment overview">
        <div>
          <p>October cash paid</p>
          <strong>{data ? money(total) : "—"}</strong>
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
            {data ? reviewed : "—"}
            <span> / {data ? reviewableRuns.length : "—"}</span>
          </strong>
          <small>Completed runs only · Acknowledgment, not payment approval or evidence verification</small>
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
          {data?.exceptions.map((exception) => (
            <ReviewCard
              key={`${data.generation}:${exception.id}`}
              exception={exception}
              dataset={data.dataset}
              attempts={data.runs.filter(run => run.exceptionId === exception.id && run.generation === data.generation)}
              busy={Boolean(busy) || Boolean(error)}
              canRetry={can("retry")}
              canReview={can("review")}
              act={act}
            />
          ))}
        </div>
      </section>
      <footer>
        SpendWise · Portfolio prototype{" "}
        <span>Read-only investigation · No financial execution</span>
      </footer>
    </main>
  );
}
