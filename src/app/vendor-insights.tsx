"use client";

import { useId, useState } from "react";
import type { DemoState } from "../contracts";
import { money, percent } from "./format";

export function VendorInsights({ data, onReview }: { data: DemoState; onReview: (vendorId: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const explanationId = useId();
  const detailId = useId();
  const rows = [...data.summaries].sort((a, b) => b.currentCents - a.currentCents || a.vendorId.localeCompare(b.vendorId));
  const chosen = rows.find(row => row.vendorId === selected) ?? rows[0];
  const vendor = data.dataset.vendors.find(v => v.id === chosen?.vendorId);
  // Visual scale only. Money values and changes come directly from domain summaries.
  const scale = Math.max(1, ...rows.flatMap(row => [Math.abs(row.priorCents), Math.abs(row.currentCents)]));
  const flags = data.exceptions.filter(e => e.vendorId === chosen?.vendorId);
  return <section id="vendor-insights" tabIndex={-1} className="insights panel" aria-labelledby="insights-title">
    <div className="section-title"><div><p className="eyebrow">Cash overview · USD</p><h2 id="insights-title">Vendor payment insights</h2></div>
      <button className="secondary" popoverTarget={explanationId}>How to read this</button>
    </div>
    <div id={explanationId} popover="auto" className="info-popover"><h3>Compare cash, then inspect evidence</h3><p>Bars compare completed payments net of reversals, by entry date: September 1–30 and October 1–31, 2026. Bar length shows magnitude; signed amounts show direction. Pending and failed payments are excluded. Select any vendor for exact values and related flags.</p><p>Flags can overlap. They are not confirmed errors or recoverable amounts. Cash paid is not accounting expense.</p><button className="secondary" popoverTarget={explanationId} popoverTargetAction="hide">Got it</button></div>
    <p className="fine">Select a vendor to explore. <span className="legend prior">September</span> <span className="legend current">October</span> · Cash paid, not expense</p>
    <div className="insights-grid">
      <div className="vendor-chart" role="group" aria-label="Select a vendor to compare payments">
        {rows.map(row => <button key={row.vendorId} className="vendor-bar" aria-pressed={chosen?.vendorId === row.vendorId} aria-controls={detailId} onClick={() => setSelected(row.vendorId)}>
          <span className="bar-heading"><strong>{data.dataset.vendors.find(v => v.id === row.vendorId)?.name}</strong><span>{data.exceptions.filter(e => e.vendorId === row.vendorId).length} {data.exceptions.filter(e => e.vendorId === row.vendorId).length === 1 ? "flag" : "flags"}</span></span>
          <span className="bar-row"><span className="bar-month">Sep</span><span className="bar-track"><span className="bar-fill prior" style={{ width: `${Math.abs(row.priorCents) / scale * 100}%` }} /></span><span className="bar-value">{money(row.priorCents)}</span></span>
          <span className="bar-row"><span className="bar-month">Oct</span><span className="bar-track"><span className="bar-fill current" style={{ width: `${Math.abs(row.currentCents) / scale * 100}%` }} /></span><span className="bar-value">{money(row.currentCents)}</span></span>
        </button>)}
        {rows.length === 0 && <p>No vendor summaries available.</p>}
      </div>
      <div className="vendor-spotlight" id={detailId} aria-live="polite" aria-atomic="true">
        {chosen && <><p className="eyebrow">Selected vendor</p><h3>{vendor?.name ?? chosen.vendorId}</h3><p className="fine">{vendor?.category}</p>
          <dl><div><dt>September cash paid</dt><dd>{money(chosen.priorCents)}</dd></div><div><dt>October cash paid</dt><dd>{money(chosen.currentCents)}</dd></div><div><dt>Cash change</dt><dd>{money(chosen.differenceCents)}<small>{percent(chosen.percentChange)}</small></dd></div></dl>
          <p>{flags.length ? `${flags.length} rule-based ${flags.length === 1 ? "flag" : "flags"} to inspect. A flag is not a confirmed payment error.` : "No rule-based flags for this vendor in the current demo state."}</p>
          {flags.length > 0 && <button onClick={() => onReview(chosen.vendorId)}>Review {flags.length} {flags.length === 1 ? "exception" : "exceptions"}</button>}
          <p className="fine">Same vendor may trigger more than one rule. Do not add flagged amounts together as a loss estimate.</p>
        </>}
      </div>
    </div>
    <details><summary>All vendor values</summary><div className="table-scroll"><table><caption>Application-calculated cash paid · September and October 2026 · USD</caption><thead><tr><th scope="col">Vendor</th><th scope="col" className="num">September</th><th scope="col" className="num">October</th><th scope="col" className="num">Change</th></tr></thead><tbody>{rows.map(row => <tr key={row.vendorId}><td className="vendor-cell">{data.dataset.vendors.find(v => v.id === row.vendorId)?.name}</td><td className="num" data-label="September">{money(row.priorCents)}</td><td className="num" data-label="October">{money(row.currentCents)}</td><td className="num" data-label="Change">{money(row.differenceCents)}<small>{percent(row.percentChange)}</small></td></tr>)}</tbody></table></div></details>
  </section>;
}
