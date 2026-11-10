"use client";
import { useState } from "react";
import Link from "next/link";
import { useDemo } from "./use-demo";
import { ReviewCard } from "./review-card";
import { money, percent } from "./format";
import { INVESTIGATION_LIMITS } from "../contracts";
import { businessName } from "../fixtures/scenarios";
import type { Permission } from "../server/access-policy";

export default function Dashboard({
  permissions,
  signedOut,
  canSignOut = false,
}: {
  permissions: readonly Permission[];
  signedOut: boolean;
  canSignOut?: boolean;
}) {
  const { data, busy, error, load, act, active } = useDemo(permissions);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const can = (permission: Permission) => permissions.includes(permission);
  const latestRuns = data?.exceptions.flatMap((exception) =>
    data.runs.filter((run) => run.exceptionId === exception.id && run.generation === data.generation).slice(-1),
  ) ?? [];
  const sortedExceptions = [...(data?.exceptions ?? [])].sort((a, b) => {
    if (b.summary.differenceCents !== a.summary.differenceCents) {
      return b.summary.differenceCents - a.summary.differenceCents;
    }
    if (a.rule !== b.rule) {
      return a.rule === "payment_increase" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
  const reviewableRuns = latestRuns.filter(run => run.state === "completed");
  const failedRuns = latestRuns.filter(run => run.state === "failed");
  const reviewed = reviewableRuns.filter((run) => run.reviewedAt).length;
  const reviewTarget = reviewableRuns.length > 0 ? reviewableRuns.length : failedRuns.length;
  const findingCount = latestRuns.reduce((n, r) => n + r.findings.length, 0) || (data?.exceptions.length ?? 0);
  const hasScenarioState = Boolean(data?.injected || active || busy === "inject" || (data?.exceptions.length ?? 0) > 0);
  const total = data?.summaries.reduce((n, s) => n + s.currentCents, 0) ?? 0;
  return (
    <main>
      <header>
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>SpendWise</span>
        </Link>
        <div className="header-actions">
          <span className="environment">Synthetic data</span>
          {canSignOut && (
            <form action="/api/auth/signout" method="get">
              <button type="submit" className="secondary">Sign out</button>
            </form>
          )}
        </div>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">{businessName} · Synthetic data</p>
          <h1>Vendor payment exceptions · October 2026</h1>
        </div>
        <div className="controls">
          <button
            disabled={!can("inject") || Boolean(busy) || Boolean(error) || !data || data.injected}
            onClick={() => {
              setConfirmingReset(false);
              void act({ action: "inject", scenarioId: "demo-v1" });
            }}
          >
            {busy === "inject"
              ? "Starting investigations…"
              : data?.injected
                ? "Payments added"
                : "Simulate new payments"}
          </button>
          {confirmingReset && hasScenarioState ? (
            <div className="reset-confirm" role="group" aria-label="Confirm reset">
              <p className="confirm-prompt">
                Clear {findingCount} {findingCount === 1 ? "finding" : "findings"} and {reviewed} {reviewed === 1 ? "review" : "reviews"}?
              </p>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="danger"
                  disabled={!can("reset") || busy === "reset"}
                  onClick={() => {
                    setConfirmingReset(false);
                    void act({ action: "reset" });
                  }}
                >
                  Confirm reset
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmingReset(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="secondary"
              disabled={!can("reset") || busy === "reset" || (!data && !busy)}
              onClick={() => {
                if (!hasScenarioState) {
                  void act({ action: "reset" });
                } else {
                  setConfirmingReset(true);
                }
              }}
            >
              {busy === "reset" ? "Resetting…" : "Reset demo"}
            </button>
          )}
        </div>
      </section>
      {signedOut && (
        <form className="sign-in-prompt" action="/api/auth/signin" method="get">
          <p>You are viewing the synthetic demo read-only. You can open citations and source records; Simulate, Reset, Retry and Mark reviewed require GitHub sign-in.</p>
          <button type="submit" className="secondary">Sign in with GitHub</button>
        </form>
      )}
      {!signedOut && permissions.every(permission => permission === "read") && (
        <p className="sign-in-prompt">This account is viewing the synthetic demo read-only. You can open citations and source records; Simulate, Reset, Retry and Mark reviewed require an authorized account.</p>
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
      <div className={`status-strip${active || busy === "inject" || busy === "retry" ? " active" : ""}`} role="status">
        {busy === "reset" ? (
          <span>Clearing scenario findings and review acknowledgments…</span>
        ) : !data && !error ? (
          <span>Loading synthetic records…</span>
        ) : active || busy === "inject" || busy === "retry" ? (
          <span>
            {error
              ? "Progress updates are unavailable. Reload to check current run states."
              : `Investigations in progress. Run states and counters refresh automatically. Each attempt is limited to ${INVESTIGATION_LIMITS.toolExecutions} retrievals, ${INVESTIGATION_LIMITS.modelRequests} model requests and ${INVESTIGATION_LIMITS.runMs / 1000} seconds.`}
          </span>
        ) : (
          <span>
            Sep 1–30 vs Oct 1–31, 2026 · October cash paid <strong className="num">{data ? money(total) : "—"}</strong> (completed payments net of reversals)
          </span>
        )}
      </div>
      <div className={busy === "reset" ? "dashboard-body dimmed" : "dashboard-body"}>
        <section className="metrics" aria-label="Payment overview">
          <div>
            <p>Exceptions to review</p>
            <strong>{data?.exceptions.length ?? "—"}</strong>
            <small>Flagged by rules for analyst review</small>
          </div>
          <div>
            <p>Human review</p>
            <strong>
              {data ? (
                <>
                  {reviewed} of {reviewTarget} reviewed
                  {failedRuns.length > 0 && <span> · {failedRuns.length} failed</span>}
                </>
              ) : (
                "—"
              )}
            </strong>
            <small>Completed runs only · Acknowledgment, not payment approval or evidence verification</small>
          </div>
        </section>
      <section className="queue-section">
        <div className="section-title">
          <h2>Investigation queue</h2>
          <span>{data ? `${data.exceptions.length} ${data.exceptions.length === 1 ? "exception" : "exceptions"} · ${reviewed} reviewed` : "Loading…"}</span>
        </div>
        {data?.exceptions.length === 0 && (
          <div className="empty">
            <h3>Baseline ready</h3>
            <p>Adds three October scenarios: one large increase and two pairs of same-amount payments.</p>
          </div>
        )}
        <div className="queue">
          {data && sortedExceptions.map((exception) => (
            <ReviewCard
              key={`${data.generation}:${exception.id}`}
              exception={exception}
              relatedExceptions={sortedExceptions.filter(e => e.vendorId === exception.vendorId && e.id !== exception.id)}
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
      <section className="panel">
        <div className="section-title">
          <h2>Vendor payments</h2>
          <span>Two complete calendar months</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Vendor</th>
                <th scope="col" className="num">September</th>
                <th scope="col" className="num">October</th>
                <th scope="col" className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {data?.summaries.map((s) => (
                <tr key={s.vendorId}>
                  <td className="vendor-cell">
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
                  <td className="num" data-label="September">{money(s.priorCents)}</td>
                  <td className="num" data-label="October">{money(s.currentCents)}</td>
                  <td className="num" data-label="Change">
                    <span className="num-value">
                      {money(s.differenceCents)}
                      <small>{percent(s.percentChange)}</small>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </div>
      <footer>
        SpendWise · Portfolio prototype{" "}
        <span>Read-only investigation · No financial execution</span>
      </footer>
    </main>
  );
}
