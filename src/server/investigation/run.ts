import { InvestigationResult } from "../../contracts";
import { fixtureRetrieval } from "../retrieval/fixture";
import { validateFinding } from "../../agent/validation";
import { realInvestigator } from "../../agent/real";
import { stubInvestigator } from "./stub";
import type { Store } from "../db/store";

export async function runPending(store: Store) {
  const snapshot = await store.state();
  for (const run of snapshot.runs.filter((r) => r.state === "pending")) {
    const input = await store.claim(run.id);
    if (!input) continue;
    const remaining = Math.max(1, Date.parse(input.deadlineAt) - Date.now());
    const signal = AbortSignal.timeout(remaining);
    try {
      const investigator =
        run.mode === "real" ? realInvestigator : stubInvestigator;
      const result = InvestigationResult.parse(
        await investigator.investigate(input, signal),
      );
      const retrieval = fixtureRetrieval(snapshot.dataset, input.exception);
      result.findings = await Promise.all(
        result.findings.map((f) =>
          validateFinding(f, input.exception, retrieval),
        ),
      );
      // INV-06 (docs/decisions/002): run state reports whether the investigation
      // finished with valid references; per-finding support is separate, and
      // only Explained + supported findings count as verified explanations.
      if (result.findings.some((f) => f.referenceStatus !== "valid")) {
        result.state = "incomplete";
        result.error = "invalid_evidence";
      }
      if (signal.aborted) {
        result.state = "incomplete";
        result.error = "deadline";
      }
      await store.finish(run.id, input.generation, result);
    } catch {
      await store.finish(run.id, input.generation, {
        mode: run.mode,
        state: "failed",
        findings: [],
        error: signal.aborted ? "deadline" : "internal",
        toolExecutions: 0,
        modelRequests: 0,
      });
    }
  }
}
