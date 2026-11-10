"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDemo } from "./use-demo";
import { ReviewCard } from "./review-card";
import { money } from "./format";
import { VendorInsights } from "./vendor-insights";
import { LearningCenter } from "./learning-center";
import { INVESTIGATION_LIMITS, type CompanyId } from "../contracts";
import { companies } from "../companies";
import type { Permission } from "../server/access-policy";

type DashboardProps = { permissions: readonly Permission[]; signedOut: boolean; canSignOut?: boolean; initialCompany?: CompanyId };

export default function Dashboard(props: DashboardProps) {
  const [selection, setSelection] = useState({ id: props.initialCompany ?? "roast", focus: false });
  const companyId = selection.id;
  function selectCompany(id: CompanyId) {
    setSelection({ id, focus: true });
    const url = new URL(window.location.href);
    if (id === "roast") url.searchParams.delete("company"); else url.searchParams.set("company", id);
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  return <CompanyDashboard key={companyId} {...props} companyId={companyId} onCompanyChange={selectCompany} focusCompanyOnLoad={selection.focus} />;
}

function CompanyDashboard({
  permissions,
  signedOut,
  canSignOut = false,
  companyId,
  onCompanyChange,
  focusCompanyOnLoad,
}: DashboardProps & { companyId: CompanyId; onCompanyChange: (id: CompanyId) => void; focusCompanyOnLoad: boolean }) {
  const { data, busy, error, load, act, active } = useDemo(permissions, companyId);
  const companySelector = useRef<HTMLSelectElement>(null);
  const restoreSelectionFocus = useRef(focusCompanyOnLoad);
  useEffect(() => {
    if (data && !busy && !active && restoreSelectionFocus.current) {
      companySelector.current?.focus({ preventScroll: true });
      restoreSelectionFocus.current = false;
    }
  }, [data, busy, active]);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [vendorFilter, setVendorFilter] = useState<{ generation: number; vendorId: string } | null>(null);
  const selectedVendor = vendorFilter?.generation === data?.generation ? vendorFilter?.vendorId : undefined;
  function reviewVendor(vendorId: string) {
    if (data) setVendorFilter({ generation: data.generation, vendorId });
    const queue = document.getElementById("investigation-queue");
    queue?.focus({ preventScroll: true });
    queue?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmingReset) {
      confirmButtonRef.current?.focus({ preventScroll: true });
    }
  }, [confirmingReset]);
  const can = (permission: Permission) => permissions.includes(permission);
  const currentRuns = data?.runs.filter((run) => run.generation === data.generation) ?? [];
  const latestRuns = data?.exceptions.flatMap((exception) =>
    currentRuns.filter((run) => run.exceptionId === exception.id).slice(-1),
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
  const savedFindings = currentRuns.reduce((n, r) => n + r.findings.length, 0);
  const exceptionCount = data?.exceptions.length ?? 0;
  const hasScenarioState = Boolean(data?.injected || active || busy === "inject" || exceptionCount > 0);
  const total = data?.summaries.reduce((n, s) => n + s.currentCents, 0) ?? 0;
  const company = companies.find(c => c.id === companyId)!;
  return (
    <main>
      <header>
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>SpendWise</span>
        </Link>
        <div className="header-actions">
          <span className="environment">Synthetic data</span>
          <LearningCenter />
          {canSignOut && (
            <form action="/api/auth/signout" method="get">
              <button type="submit" className="secondary">Sign out</button>
            </form>
          )}
        </div>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">{company.name}</p>
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
          {confirmingReset ? (
            <div className="reset-confirm" role="group" aria-label="Confirm reset">
              <p className="confirm-prompt">
                {!hasScenarioState
                  ? "Reset to baseline?"
                  : savedFindings > 0
                    ? `Clear ${savedFindings} ${savedFindings === 1 ? "finding" : "findings"} and ${reviewed} ${reviewed === 1 ? "review" : "reviews"}?`
                    : `Clear ${exceptionCount} ${exceptionCount === 1 ? "exception" : "exceptions"} and ${reviewed} ${reviewed === 1 ? "review" : "reviews"}?`}
              </p>
              <div className="confirm-actions">
                <button
                  ref={confirmButtonRef}
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
                  onClick={() => {
                    setConfirmingReset(false);
                    requestAnimationFrame(() => {
                      resetButtonRef.current?.focus({ preventScroll: true });
                    });
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              ref={resetButtonRef}
              className="secondary"
              disabled={!can("reset") || busy === "reset" || (!data && !busy)}
              onClick={() => setConfirmingReset(true)}
            >
              {busy === "reset" ? "Resetting…" : "Reset demo"}
            </button>
          )}
        </div>
      </section>
      <section className="company-selector" aria-label="Company demo">
        <div><label htmlFor="company-demo">Explore a company demo</label>
          <select ref={companySelector} id="company-demo" value={companyId} disabled={Boolean(busy) || active || !data} onChange={event => onCompanyChange(event.target.value as CompanyId)}>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name} · {c.industry}</option>)}
          </select>
          {(busy || active) && <p className="fine">Wait for this operation to finish before switching companies.</p>}
        </div>
        <div><p><strong>{company.industry}</strong> · {company.context}</p>
          <p className="fine">{company.examples}</p>
          <p className="fine">{companyId === "roast" ? "Fictional company and records." : "Unaffiliated hypothetical scenario. No company data or actual vendor relationships."} All amounts are synthetic USD. Each company keeps its own findings and reviews; Reset affects only the selected demo.</p>
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
        {data && <VendorInsights data={data} onReview={reviewVendor} />}
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
                reviewableRuns.length === 0 && failedRuns.length > 0 ? (
                  <>
                    {reviewed} reviewed · {failedRuns.length} failed
                  </>
                ) : (
                  <>
                    {reviewed} of {reviewableRuns.length} reviewed
                    {failedRuns.length > 0 && <span> · {failedRuns.length} failed</span>}
                  </>
                )
              ) : (
                "—"
              )}
            </strong>
            <small>Completed runs only · Acknowledgment, not payment approval or evidence verification</small>
          </div>
        </section>
      <section className="queue-section" id="investigation-queue" tabIndex={-1} aria-labelledby="queue-title">
        <div className="section-title">
          <h2 id="queue-title">Investigation queue</h2>
          <span>{data ? `${data.exceptions.length} ${data.exceptions.length === 1 ? "exception" : "exceptions"} · ${reviewed} reviewed` : "Loading…"}</span>
        </div>
        {selectedVendor && <div className="filter-notice"><p>Showing {data?.dataset.vendors.find(v => v.id === selectedVendor)?.name} · {sortedExceptions.filter(e => e.vendorId === selectedVendor).length} exceptions</p><button className="secondary" onClick={() => setVendorFilter(null)}>Show all exceptions</button></div>}
        {data?.exceptions.length === 0 && (
          <div className="empty">
            <h3>Baseline ready</h3>
            <p>Adds three October scenarios: one large increase and two pairs of same-amount payments.</p>
          </div>
        )}
        <div className="queue">
          {data && sortedExceptions.filter(e => !selectedVendor || e.vendorId === selectedVendor).map((exception) => (
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

      </div>
    </main>
  );
}
