import { InvestigationResult } from "../../contracts";
import { validateFinding } from "../../agent/validation";
import { RunError } from "../../investigation/budget";
import type { ModelClient } from "../../agent/loop";
import type { Store } from "../db/store";
import { normalizeResult } from "./result";
import { runtimeFor } from "./runtime";

/** Log only application-owned classifications, never SDK/SQL/record diagnostics. */
export function logRunFailure(error: unknown) {
  const known = error instanceof RunError;
  console.error({ name: known ? "RunError" : "InvestigationError", message: known ? error.code : "Investigation operation failed" });
}
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new RunError("deadline"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** All runs retain the acceptance deadline; concurrent claims prevent starvation. */
export async function runPending(store: Store, options: { signal?: AbortSignal; client?: ModelClient } = {}) {
  const snapshot = await store.state();
  await Promise.allSettled(snapshot.runs.filter(r => r.state === "pending").map(async run => {
    let input;
    let runtime: Awaited<ReturnType<typeof runtimeFor>> | undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ended = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => controller.abort();
    try {
      input = await store.claim(run.id);
      if (!input) return;
      const claimed = input;
      // Reserve one second for terminal persistence, inside the original 60s.
      timer = setTimeout(cancel, Math.max(0, Date.parse(input.deadlineAt) - Date.now() - 1000));
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
      // Reset in another process invalidates work, without a DB transaction held
      // during the model wait. Poll is sequential and stops when this run ends.
      const observe = async () => {
        try { if (!await store.active(run.id, claimed.generation)) cancel(); }
        catch (error) { logRunFailure(error); cancel(); }
        if (!ended && !controller.signal.aborted) poll = setTimeout(observe, 200);
      };
      poll = setTimeout(observe, 200);
      runtime = await runtimeFor(store, run.id, input, run.mode, controller.signal, options.client);
      const context = runtime;
      const work = async () => {
        let result = normalizeResult(InvestigationResult.parse(await context.investigator.investigate(claimed, controller.signal)));
        context.check();
        if (result.mode !== run.mode) throw new Error("invalid_result");
        // Sequential findings share three complete cached evidence sets. This
        // avoids redundant SQL and includes any fresh reads in the same budget.
        for (let i = 0; i < result.findings.length; i++) {
          result.findings[i] = await validateFinding(result.findings[i], claimed.exception, context.validation);
          if (run.mode === "stub") result.findings[i].supportStatus = "unverified";
          context.check();
        }
        if (result.findings.some(f => f.referenceStatus !== "valid"))
          result = { ...result, state: "incomplete", error: "invalid_evidence" };
        return { ...result, ...context.counters };
      };
      const result = await untilAborted(work(), controller.signal);
      if (result.error) logRunFailure(new RunError(result.error));
      await store.finish(run.id, input.generation, result);
    } catch (error) {
      logRunFailure(error);
      if (input) {
        const cancelled = options.signal?.aborted && Date.now() < Date.parse(input.deadlineAt) - 1000;
        const code = error instanceof RunError ? error.code : "internal";
        try {
          await store.finish(run.id, input.generation, {
            mode: run.mode, state: cancelled ? "cancelled" : code === "internal" ? "failed" : "incomplete",
            findings: [], error: cancelled ? null : code,
            toolExecutions: runtime?.counters.toolExecutions ?? 0,
            modelRequests: runtime?.counters.modelRequests ?? 0,
          });
        } catch (persistError) { logRunFailure(persistError); }
      }
    } finally {
      ended = true;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(poll);
      options.signal?.removeEventListener("abort", cancel);
    }
  }));
}
