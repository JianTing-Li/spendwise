"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDemo } from "./use-demo";
import { change, dollars, percent } from "./format";
import { LearningCenter } from "./learning-center";
import { vendorRows } from "./status";
import { VendorDetail, VendorList, type Tab } from "./vendors";
import type { CompanyId } from "../contracts";
import { companies } from "../companies";
import type { Permission } from "../server/access-policy";

type DashboardProps = { permissions: readonly Permission[]; signedOut: boolean; canSignOut?: boolean; initialCompany?: CompanyId };

export default function Dashboard(props: DashboardProps) {
  const [selection, setSelection] = useState({ id: props.initialCompany ?? "roast", focus: false });
  const companyId = selection.id;
  function selectCompany(id: CompanyId) {
    setSelection({ id, focus: true });
    const url = new URL(window.location.href);
    const slug = companies.find(c => c.id === id)!.slug;
    if (id === "roast") url.searchParams.delete("company"); else url.searchParams.set("company", slug);
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  return <CompanyDashboard key={companyId} {...props} companyId={companyId} onCompanyChange={selectCompany} focusCompanyOnLoad={selection.focus} />;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const [picked, setPicked] = useState<{ generation: number; id: string } | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmingReset) confirmButtonRef.current?.focus({ preventScroll: true });
  }, [confirmingReset]);

  const can = (permission: Permission) => permissions.includes(permission);
  const rows = data ? vendorRows(data) : [];
  const flagged = rows.reduce((n, r) => n + r.flags.length, 0);
  const reviewed = rows.reduce((n, r) => n + r.runs.filter(run => run?.state === "completed" && run.reviewedAt).length, 0);
  const hasFlags = flagged > 0;
  const tab: Tab = tabChoice ?? (hasFlags ? "check" : "all");
  const inTab = rows.filter(r => tab === "all" || (tab === "checked" ? r.checked : r.flags.length > 0 && !r.checked));
  const selectedId = picked && picked.generation === data?.generation && rows.some(r => r.id === picked.id) ? picked.id : inTab[0]?.id ?? rows[0]?.id;
  const selected = rows.find(r => r.id === selectedId);
  const total = data?.summaries.reduce((n, s) => n + s.currentCents, 0) ?? 0;
  const prior = data?.summaries.reduce((n, s) => n + s.priorCents, 0) ?? 0;
  const running = rows.flatMap(r => r.runs).filter(run => run && ["pending", "running"].includes(run.state)).length;
  const company = companies.find(c => c.id === companyId)!;
  const findings = data?.runs.filter(r => r.generation === data.generation).reduce((n, r) => n + r.findings.length, 0) ?? 0;

  // A new tab keeps the selection only if that vendor is in it; otherwise its first vendor shows.
  function changeTab(next: Tab) {
    setTabChoice(next);
    const visible = rows.filter(r => next === "all" || (next === "checked" ? r.checked : r.flags.length > 0 && !r.checked));
    if (!visible.some(r => r.id === selectedId)) setPicked(null);
  }
  // Acting on a vendor pins it, so reviewing never swaps the detail to another vendor.
  function actOnSelected(action: object, path?: string) {
    if (data && selected) setPicked({ generation: data.generation, id: selected.id });
    return act(action, path);
  }
  function select(id: string) {
    if (data) setPicked({ generation: data.generation, id });
    // Side by side on wide screens; on narrow screens bring the detail into view.
    if (window.matchMedia("(max-width: 899px)").matches)
      requestAnimationFrame(() => document.getElementById("vendor-detail")?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }));
  }

  return (
    <main>
      <header>
        <div className="brand-group">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">S</span>
            <span>SpendWise</span>
          </Link>
          <span className="environment" title="All companies, vendors and amounts are made up.">Synthetic demo data</span>
        </div>
        <div className="header-actions">
          <LearningCenter />
          {canSignOut && (
            <form action="/api/auth/signout" method="get">
              <button type="submit" className="secondary">Sign out</button>
            </form>
          )}
        </div>
      </header>

      <section className="toolbar">
        <div className="company">
          <label htmlFor="company-demo">Company</label>
          <div className="select-wrap">
            <select ref={companySelector} id="company-demo" value={companyId} disabled={Boolean(busy) || active || !data} onChange={event => onCompanyChange(event.target.value as CompanyId)}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <p className="fine">{company.context}</p>
        </div>
        <div className="controls">
          <button
            disabled={!can("inject") || Boolean(busy) || Boolean(error) || !data || data.injected}
            onClick={() => { setConfirmingReset(false); setTabChoice(null); void act({ action: "inject", scenarioId: "demo-v1" }); }}
          >
            {busy === "inject" ? "Loading…" : data?.injected ? "October payments loaded" : "Load October payments"}
          </button>
          {confirmingReset ? (
            <div className="reset-confirm" role="group" aria-label="Confirm reset">
              <p className="confirm-prompt">{findings > 0 || reviewed > 0 ? `Clear ${findings} ${findings === 1 ? "finding" : "findings"} and ${reviewed} ${reviewed === 1 ? "review" : "reviews"}?` : "Reset this company?"}</p>
              <div className="confirm-actions">
                <button ref={confirmButtonRef} type="button" className="danger" disabled={!can("reset") || busy === "reset"}
                  onClick={() => { setConfirmingReset(false); setTabChoice(null); void act({ action: "reset" }); }}>Confirm reset</button>
                <button type="button" className="secondary" onClick={() => { setConfirmingReset(false); requestAnimationFrame(() => resetButtonRef.current?.focus({ preventScroll: true })); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button ref={resetButtonRef} className="secondary" disabled={!can("reset") || busy === "reset" || (!data && !busy)} onClick={() => setConfirmingReset(true)}>
              {busy === "reset" ? "Resetting…" : "Reset demo"}
            </button>
          )}
        </div>
      </section>

      <section className="title">
        <h1>October payment review</h1>
        <p>September vs October 2026 · {data ? `${rows.length} vendors` : "Loading…"}</p>
      </section>
      <section className="totals" aria-label="Company cash paid">
        <div><span>October cash paid</span><strong key={total} className="num bump">{data ? dollars(total) : "—"}</strong></div>
        <div><span>September</span><strong className="num">{data ? dollars(prior) : "—"}</strong></div>
        <div><span>Change</span><strong key={total - prior} className={`num bump${total - prior > 0 ? " up" : ""}`}>{data ? `${change(total - prior)}${prior > 0 ? ` (${percent(((total - prior) / prior) * 100, prior)})` : ""}` : "—"}</strong></div>
        <div><span>Flags reviewed</span><strong key={reviewed} className="num bump">{data ? `${reviewed} of ${flagged}` : "—"}</strong></div>
      </section>

      {signedOut && (
        <form className="notice" action="/api/auth/signin" method="get">
          <p>You&apos;re viewing read-only. Sign in to load payments and run investigations.</p>
          <button type="submit" className="secondary">Sign in with GitHub</button>
        </form>
      )}
      {!signedOut && permissions.every(permission => permission === "read") && (
        <p className="notice">This account is read-only. An authorized account can load payments and run investigations.</p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button className="secondary" onClick={() => void load()}>Reload</button>
        </div>
      )}
      {(running > 0 || busy === "inject" || busy === "retry") && !error && (
        <div className="banner" role="status">
          <span className="spinner" aria-hidden="true" />
          {busy === "inject" && running === 0 ? "Loading October payments and flagging anything unusual…" : `Investigating ${running} ${running === 1 ? "flag" : "flags"}. Follow along in each vendor below.`}
        </div>
      )}
      {busy === "reset" && <div className="banner" role="status"><span className="spinner" aria-hidden="true" />Resetting this company…</div>}

      <div className={busy === "reset" ? "workspace dimmed" : "workspace"}>
        {data && <>
          <VendorList rows={rows} tab={tab} onTab={changeTab} selected={selectedId} onSelect={select} reviewed={reviewed} flagged={flagged} />
          <VendorDetail row={selected} data={data} busy={Boolean(busy) || Boolean(error)} canRetry={can("retry")} canReview={can("review")} act={actOnSelected} />
        </>}
        {!data && !error && <p className="empty">Loading records…</p>}
      </div>
    </main>
  );
}
