import type { InvestigationResult } from "../../contracts";

export function investigatorMode(): InvestigationResult["mode"] {
  const mode = process.env.INVESTIGATOR_MODE ?? "stub";
  if (mode !== "stub" && mode !== "real") throw new Error("Investigator mode unavailable");
  return mode;
}

/** Enforce honest terminal outcomes at both runner and persistence boundaries. */
export function normalizeResult(result: InvestigationResult): InvestigationResult {
  const invalid = ["pending", "running"].includes(result.state) ||
    (result.state === "completed" && (result.error !== null || result.findings.length === 0)) ||
    (["failed", "incomplete"].includes(result.state) && result.error === null);
  return invalid ? { ...result, state: "failed", findings: [], error: "internal" } : result;
}
