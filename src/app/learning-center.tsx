"use client";

import { useRef, useState } from "react";
import { aboutContent } from "./about-content";
import { INVESTIGATION_LIMITS } from "../contracts";

const steps = [
  { title: "Pick a vendor", target: "vendor-list", text: "Flagged vendors are at the top. Each shows October cash paid and the change from September." },
  { title: "Read why and the answer", target: "vendor-detail", text: "Each flag says why it was flagged, then the answer in one line with a few supporting points. Tap an evidence chip to see the record." },
  { title: "Decide and mark reviewed", target: "vendor-detail", text: "“Records explain it” means the app checked the answer and the invoices account for the jump. “Needs a look” means something is unclear or looks wrong. Either way, mark it reviewed once you have looked; that never approves or pays anything." },
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
    target?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function next(value: number) {
    setStep(value);
    requestAnimationFrame(() => tourHeading.current?.focus());
  }
  return <>
    <nav className="learning-nav" aria-label="App guidance">
      <button className="secondary" onClick={() => help.current?.showModal()}>Help</button>
      <button className="secondary" onClick={() => about.current?.showModal()}>About</button>
    </nav>
    <dialog ref={help} className="guide-dialog" aria-labelledby="help-title">
      <div className="dialog-head"><h2 id="help-title">Help</h2><button className="secondary" onClick={() => help.current?.close()} autoFocus>Close</button></div>
      {step === null ? <button onClick={() => next(0)}>Take the 3-step tour</button> : <section className="tour-step" aria-label="App tour">
        <p className="eyebrow">Step {step + 1} of {steps.length}</p>
        <h3 ref={tourHeading} tabIndex={-1}>{steps[step].title}</h3>
        <p>{steps[step].text}</p>
        <div className="controls">
          <button className="secondary" disabled={step === 0} onClick={() => next(step - 1)}>Back</button>
          {step < steps.length - 1 ? <button onClick={() => next(step + 1)}>Next</button> : <button onClick={() => { setStep(null); help.current?.close(); }}>Done</button>}
          <button className="secondary" onClick={showArea}>Show me</button>
        </div>
      </section>}
      <h3>Questions</h3>
      <details><summary>Is this real data?</summary><p>No. Every company, vendor and amount is made up.</p></details>
      <details><summary>What gets flagged?</summary><p>Payments up more than $5,000 and 20% from September, or two payments of the same amount within 7 days.</p></details>
      <details><summary>What do the labels mean?</summary><ul><li><strong>Records explain it:</strong> the app checked the answer against the invoices and payments, and they account for the change.</li><li><strong>Needs a look:</strong> something is unclear, missing or looks wrong, such as a possible double payment. A person decides what to do.</li><li><strong>Mark reviewed:</strong> you looked at it. Every flag gets reviewed, whatever its label.</li></ul></details>
      <details><summary>What does the AI do?</summary><p>It reads payments, invoices and notes with read-only lookups, up to {INVESTIGATION_LIMITS.toolExecutions} per flag in {INVESTIGATION_LIMITS.runMs / 1000} seconds. It can&apos;t pay, refund or change anything. Code does all the math and checks its answer.</p></details>
      <details><summary>Why can&apos;t I click some buttons?</summary><p>Loading payments, resetting and reviewing need an authorized sign-in. Everyone can browse.</p></details>
    </dialog>
    <dialog ref={about} className="guide-dialog" aria-labelledby="about-title">
      <div className="dialog-head"><h2 id="about-title">About SpendWise</h2><button className="secondary" onClick={() => about.current?.close()} autoFocus>Close</button></div>
      <p>{aboutContent.tagline}</p>
      <p className="fine">{aboutContent.limitation}</p>
      <p className="fine">Built by Jian Ting Li &amp; Elliot Watson · <a href={aboutContent.source} target="_blank" rel="noreferrer">README</a> · <a href={aboutContent.prd} target="_blank" rel="noreferrer">Product requirements</a></p>
    </dialog>
  </>;
}
