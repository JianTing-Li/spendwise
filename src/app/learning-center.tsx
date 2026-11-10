"use client";

import { useRef, useState } from "react";
import { aboutContent } from "./about-content";
import { INVESTIGATION_LIMITS } from "../contracts";

const steps = [
  { title: "Compare cash paid", target: "vendor-insights", text: "Choose a company demo above the chart, then select a vendor to compare September and October cash paid. Values come from application-calculated summaries, net of recorded reversals. Cash paid is not accounting expense." },
  { title: "Understand the flag", target: "investigation-queue", text: "Open the investigation queue. Each card identifies the triggering rule, affected payments and amounts. Flags are reasons to investigate; similar payments do not prove a duplicate. At baseline, an authorized user can simulate payments to populate the queue." },
  { title: "Read the finding and run", target: "investigation-queue", text: "Read the short draft excerpt and next step, then expand the full note before concluding. Run details explains the mode, completion state and lookup budgets. Completed means the run finished, not that every explanation was verified. Stub results are placeholders." },
  { title: "Check sources, then acknowledge", target: "investigation-queue", text: "Follow a citation to open and focus its source record. Inspect source records also includes vendor context that may not have been retrieved or cited. An authorized reviewer can Mark reviewed: this records acknowledgment only, without approving or moving money." },
];

export function LearningCenter() {
  const help = useRef<HTMLDialogElement>(null);
  const about = useRef<HTMLDialogElement>(null);
  const tourHeading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<number | null>(null);
  function showArea() {
    help.current?.close();
    const target = document.getElementById(steps[step ?? 0].target);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function next(value: number) {
    setStep(value);
    requestAnimationFrame(() => tourHeading.current?.focus());
  }
  return <>
    <nav className="learning-nav" aria-label="App guidance">
      <button className="secondary" onClick={() => help.current?.showModal()}>Help &amp; tour</button>
      <button className="secondary" onClick={() => about.current?.showModal()}>About</button>
    </nav>
    <dialog ref={help} className="guide-dialog" aria-labelledby="help-title">
      <div className="section-title"><h2 id="help-title">Help &amp; app tour</h2><button className="secondary" onClick={() => help.current?.close()} autoFocus>Close help</button></div>
      <p>Follow the evidence from cash change to human review. Exploring this guide never starts an investigation or changes records.</p>
      {step === null ? <button onClick={() => next(0)}>Start guided tour</button> : <section className="tour-step" aria-label="App tour">
        <p className="eyebrow">Step {step + 1} of {steps.length}</p>
        <h3 ref={tourHeading} tabIndex={-1}>{steps[step].title}</h3>
        <p>{steps[step].text}</p>
        <div className="controls">
          <button className="secondary" disabled={step === 0} onClick={() => next(step - 1)}>Previous step</button>
          {step < steps.length - 1 ? <button onClick={() => next(step + 1)}>Next step</button> : <button onClick={() => { setStep(null); help.current?.close(); }}>Finish tour</button>}
          <button className="secondary" onClick={showArea}>Show this area</button>
        </div>
        <p className="fine">Reopen Help &amp; tour to continue at this step.</p>
      </section>}
      <h3>Frequently asked questions</h3>
      <details><summary>Are these real company records?</summary><p>No. Roast &amp; Co. Coffee is fictional. HubSpot and GXO Logistics are unaffiliated hypothetical scenarios with invented vendors and USD transactions, not their actual financial records or relationships. Switching companies only changes the view; an authorized simulation and Reset affect the selected company only.</p></details>
      <details><summary>What triggers a flag?</summary><p>A payment increase of at least $5,000 and 20% (dollars only when prior cash is zero or negative), or same-vendor, same-currency, same-amount completed outgoing payments within seven calendar days. Fully reversed payments are excluded from duplicate candidates. The card shows the settings saved for that exception.</p></details>
      <details><summary>What do the result labels mean?</summary><p>Explained requires a completed real investigation, valid references and application-supported evidence. Needs Review is unresolved or unverified; Insufficient Evidence means the finding reports missing or conflicting support. A completed run may contain any of these labels. Human acknowledgment never upgrades support.</p></details>
      <details><summary>Why are some controls disabled?</summary><p>Public visitors and accounts without mutation grants can explore records read-only. Simulate, Reset, Retry and Mark reviewed require an authorized GitHub account. Signing in alone does not grant permissions.</p></details>
      <details><summary>What ran, and can I retry?</summary><p>Real mode uses one read-only investigator, bounded to {INVESTIGATION_LIMITS.toolExecutions} retrievals, {INVESTIGATION_LIMITS.modelRequests} model requests and {INVESTIGATION_LIMITS.runMs / 1000} seconds per attempt. Stub mode makes no AI call and produces unverified placeholders. Failed, incomplete or cancelled attempts can be retried explicitly, up to three attempts. Completed attempts cannot retry.</p></details>
      <details><summary>Where do records come from?</summary><p>Every payment, invoice and vendor note is synthetic demo data. Citations link saved findings to record IDs in the current vendor dataset. Other visible records provide context; their presence does not prove the investigator read them. Notes are untrusted evidence, never instructions.</p></details>
      <details><summary>Can SpendWise approve payments or confirm savings?</summary><p>No. It cannot execute payments, refunds or accounting entries. Possible duplicates and amounts in question remain unconfirmed. Analyst review time, savings and usefulness relative to a rule-based baseline remain unmeasured.</p></details>
      <details><summary>What does Reset demo do?</summary><p>After confirmation, Reset clears scenario findings and human acknowledgments and restores the baseline. In-flight results from the previous reset generation cannot overwrite it. This affects only the selected company’s shared demo state. Other company demos retain their records and reviews.</p></details>
    </dialog>
    <dialog ref={about} className="guide-dialog" aria-labelledby="about-title">
      <div className="section-title"><h2 id="about-title">About SpendWise</h2><button className="secondary" onClick={() => about.current?.close()} autoFocus>Close about</button></div>
      <p className="eyebrow">Built by Elliot Watson &amp; Jian Ting Li</p>
      <p>{aboutContent.tagline}</p><p>{aboutContent.problem}</p>
      <p>Application rules calculate and detect; one read-only Claude investigator gathers evidence; application validation checks support; a human decides follow-up.</p>
      <p>Synthetic USD records only. No payment execution or accounting decisions. Analyst review time and relative usefulness of model-written next steps remain unmeasured.</p>
      <p className="fine">Based on the README and the approved product requirements on main. The repository documents the prototype’s scope and evaluation limits.</p>
      <p><a href={aboutContent.source} target="_blank" rel="noreferrer">Read the source README</a> · <a href={aboutContent.prd} target="_blank" rel="noreferrer">Product requirements</a></p>
    </dialog>
  </>;
}
