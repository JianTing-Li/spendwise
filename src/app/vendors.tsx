"use client";

import { useId } from "react";
import type { DemoState } from "../contracts";
import { change, dollars, percent, shortDate } from "./format";
import { outcomeLabel, type VendorRow } from "./status";
import { ReviewCard } from "./review-card";

export type Tab = "check" | "checked" | "all";

export function VendorList({ rows, tab, onTab, selected, onSelect, reviewed, flagged }: {
  rows: VendorRow[];
  tab: Tab;
  onTab: (tab: Tab) => void;
  selected: string | undefined;
  onSelect: (id: string) => void;
  reviewed: number;
  flagged: number;
}) {
  const help = useId();
  const counts = {
    check: rows.filter(r => r.flags.length && !r.checked).length,
    checked: rows.filter(r => r.checked).length,
    all: rows.length,
  };
  const visible = rows.filter(r => tab === "all" || (tab === "checked" ? r.checked : r.flags.length > 0 && !r.checked));
  const tabs: [Tab, string][] = [["check", "To check"], ["checked", "Checked"], ["all", "All vendors"]];
  return <section id="vendor-list" className="panel vendor-list" tabIndex={-1} aria-labelledby="vendors-title">
    <div className="list-head">
      <h2 id="vendors-title">Vendors</h2>
      <span className="fine">{flagged ? `${reviewed} of ${flagged} flags reviewed` : "No flags yet"}</span>
      <button className="icon" popoverTarget={help} aria-label="How to read this">?</button>
      <div id={help} popover="auto" className="info-popover">
        <h3>How to read this</h3>
        <ul>
          <li>Amounts are cash paid: completed payments in September vs October.</li>
          <li>A flag is a reason to look, not a confirmed error.</li>
          <li>Explained means the records were checked and cover the change.</li>
        </ul>
        <button className="secondary" popoverTarget={help} popoverTargetAction="hide">Got it</button>
      </div>
    </div>
    <div className="tabs" role="tablist" aria-label="Filter vendors">
      {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "tab active" : "tab"} onClick={() => onTab(id)}>
        {label} <span className="count">{counts[id]}</span>
      </button>)}
    </div>
    <ul className="vendor-rows" role="list">
      {visible.map(row => <li key={row.id}>
        <button className={`vendor-row${row.id === selected ? " selected" : ""}`} aria-current={row.id === selected ? "true" : undefined} onClick={() => onSelect(row.id)}>
          <span className="vendor-name">
            <strong>{row.name}</strong>
            <small>{row.category}</small>
          </span>
          <span className="vendor-money">
            <strong className="num">{dollars(row.summary.currentCents)}</strong>
            <small className={row.summary.differenceCents > 0 ? "up" : row.summary.differenceCents < 0 ? "down" : ""}>{change(row.summary.differenceCents)}</small>
          </span>
          {row.outcome && <span className={`badge ${row.checked ? "checked" : row.outcome}`}>{row.checked ? "Reviewed" : outcomeLabel[row.outcome]}</span>}
        </button>
      </li>)}
    </ul>
    {visible.length === 0 && <p className="empty">
      {tab === "check" ? (flagged ? "All flags are reviewed." : "No flags. Load October payments to start.") : tab === "checked" ? "Nothing reviewed yet." : "No vendors."}
    </p>}
  </section>;
}

export function VendorDetail({ row, data, busy, canRetry, canReview, act }: {
  row: VendorRow | undefined;
  data: DemoState;
  busy: boolean;
  canRetry: boolean;
  canReview: boolean;
  act: (action: object, path?: string) => Promise<void>;
}) {
  if (!row) return <section id="vendor-detail" className="panel vendor-detail" tabIndex={-1}><p className="empty">Select a vendor.</p></section>;
  const s = row.summary;
  const scale = Math.max(1, Math.abs(s.priorCents), Math.abs(s.currentCents));
  const payments = data.dataset.payments.filter(p => p.vendorId === row.id);
  const invoices = data.dataset.invoices.filter(i => i.vendorId === row.id);
  const notes = data.dataset.notes.filter(n => n.vendorId === row.id);
  return <section id="vendor-detail" key={row.id} className="panel vendor-detail" tabIndex={-1} aria-labelledby="detail-title">
    <p className="eyebrow">{row.category}</p>
    <h2 id="detail-title">{row.name}</h2>
    <div className="compare" aria-label="September and October cash paid">
      {([["Sep", s.priorCents, "prior"], ["Oct", s.currentCents, "current"]] as const).map(([label, cents, kind]) =>
        <div className="compare-row" key={label}>
          <span>{label}</span>
          <span className="track"><span className={`fill ${kind}`} style={{ width: `${(Math.abs(cents) / scale) * 100}%` }} /></span>
          <strong className="num">{dollars(cents)}</strong>
        </div>)}
      <p className="fine">Change {change(s.differenceCents)}{s.differenceCents !== 0 ? ` (${percent(s.percentChange, s.priorCents)})` : ""}</p>
    </div>
    {row.flags.length === 0 && <p className="calm">No flags. October looks normal for this vendor.</p>}
    {row.flags.map(exception => <ReviewCard
      key={`${data.generation}:${exception.id}`}
      exception={exception}
      dataset={data.dataset}
      attempts={data.runs.filter(r => r.exceptionId === exception.id && r.generation === data.generation)}
      busy={busy}
      canRetry={canRetry}
      canReview={canReview}
      act={act}
    />)}
    <details className="records">
      <summary>All records for this vendor ({payments.length + invoices.length + notes.length})</summary>
      <ul>
        {payments.map(p => <li key={p.id}><strong>Payment</strong> {shortDate(p.date)} · {dollars(p.amountCents)} · {p.description}{p.status !== "completed" ? ` · ${p.status}` : ""}</li>)}
        {invoices.map(i => <li key={i.id}><strong>Invoice {i.number}</strong> {dollars(i.amountCents)} · {i.lineItems.join("; ")}</li>)}
        {notes.map(n => <li key={n.id}><strong>Note</strong> {shortDate(n.date)} · <span className="note-text">{n.text}</span></li>)}
      </ul>
    </details>
  </section>;
}
