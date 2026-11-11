import type { DemoState, Exception, Finding, Run, Summary } from "../contracts";
import { isVerifiedExplanation } from "../agent/validation";

export type Outcome = "explained" | "review" | "running" | "failed" | "waiting" | "placeholder";

/** Verified only when a completed real run's finding passed the application check. */
export const isVerified = (run: Run, finding: Finding) =>
  run.mode === "real" && run.state === "completed" && isVerifiedExplanation(finding);

export function runOutcome(run: Run | undefined): Outcome {
  if (!run) return "waiting";
  if (run.state === "pending" || run.state === "running") return "running";
  if (run.state !== "completed") return "failed";
  if (run.mode === "stub") return "placeholder";
  return run.findings.length > 0 && run.findings.every(f => isVerified(run, f)) ? "explained" : "review";
}

export const outcomeLabel: Record<Outcome, string> = {
  explained: "Explained",
  review: "Follow up",
  running: "Investigating",
  failed: "Didn't finish",
  waiting: "Not started",
  placeholder: "Placeholder",
};

export type VendorRow = {
  id: string;
  name: string;
  category: string;
  summary: Summary;
  flags: Exception[];
  /** Latest attempt per flag, in flag order. */
  runs: (Run | undefined)[];
  /** Every flag has a completed, reviewed latest run. */
  checked: boolean;
  outcome: Outcome | null;
};

const rank: Outcome[] = ["running", "failed", "review", "waiting", "placeholder", "explained"];

/** One row per vendor: flagged first (largest change first), then the rest by October cash. */
export function vendorRows(data: DemoState): VendorRow[] {
  const current = data.runs.filter(r => r.generation === data.generation);
  const rows = data.summaries.map((summary): VendorRow => {
    const vendor = data.dataset.vendors.find(v => v.id === summary.vendorId);
    const flags = data.exceptions
      .filter(e => e.vendorId === summary.vendorId)
      .sort((a, b) => (a.rule === b.rule ? a.id.localeCompare(b.id) : a.rule === "payment_increase" ? -1 : 1));
    const runs = flags.map(f => current.filter(r => r.exceptionId === f.id).at(-1));
    const outcomes = runs.map(runOutcome);
    const outcome = flags.length ? rank.find(o => outcomes.includes(o)) ?? null : null;
    return {
      id: summary.vendorId,
      name: vendor?.name ?? summary.vendorId,
      category: vendor?.category ?? "",
      summary,
      flags,
      runs,
      checked: flags.length > 0 && runs.every(r => r?.state === "completed" && Boolean(r.reviewedAt)),
      outcome,
    };
  });
  return rows.sort((a, b) =>
    Number(b.flags.length > 0) - Number(a.flags.length > 0) ||
    (a.flags.length ? b.summary.differenceCents - a.summary.differenceCents : b.summary.currentCents - a.summary.currentCents) ||
    a.name.localeCompare(b.name),
  );
}

/** Explanation lines: bullets when the text has "- " lines, otherwise sentences. */
export function lines(text: string): string[] {
  const bullets = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (bullets.length > 1 || /^[-•]\s/.test(bullets[0] ?? ""))
    return bullets.map(l => l.replace(/^[-•]\s*/, ""));
  return text.split(/(?<=[.!?])\s+(?=[A-Z$])/).map(s => s.trim()).filter(Boolean);
}
