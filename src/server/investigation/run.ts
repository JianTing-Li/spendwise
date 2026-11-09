import { InvestigationResult } from "../../contracts";
import { validateFinding } from "../../agent/validation";
import { RunError } from "../../investigation/budget";
import type { ModelClient } from "../../agent/loop";
import type { Store } from "../db/store";
import { normalizeResult } from "./result";
import { runtimeFor } from "./runtime";
import { RetrievalError } from "../retrieval/bounds";
import { DatabaseConflict, DatabaseQueryError, DatabaseUnavailable } from "../db/pg";

/** Log only application-owned classifications, never SDK/SQL/record diagnostics. */
export function logRunFailure(error: unknown) {
  if (error instanceof RunError || error instanceof RetrievalError)
    console.error({ name: error instanceof RunError ? "RunError" : "RetrievalError", message: error.code });
  else if (error instanceof DatabaseUnavailable || error instanceof DatabaseConflict || error instanceof DatabaseQueryError)
    console.error({ name: error.name, message: error.message,
      ...("sqlstate" in error ? { code: error.sqlstate } : {}) });
  else console.error({ name: "InvestigationError", message: "Investigation operation failed" });
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
  const watching = new Map<string, AbortController>();
  let ended = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  // One sequential query per batch, with no transaction held during model waits.
  const observe = async () => {
    const ids = [...watching.keys()];
    if (ids.length) {
      try {
        const active = new Set(await store.activeRuns(ids, snapshot.generation));
        for (const id of ids) if (!active.has(id)) watching.get(id)?.abort();
      } catch (error) {
        // An unavailable observation is not evidence of reset or expiry.
        // Local timers and generation-guarded retrieval/persistence still apply.
        logRunFailure(error);
      }
    }
    if (!ended) poll = setTimeout(observe, 500);
  };
  poll = setTimeout(observe, 500);
  try {
    await Promise.allSettled(snapshot.runs.filter(r => r.state === "pending").map(async run => {
      let input;
      let runtime: Awaited<ReturnType<typeof runtimeFor>> | undefined;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => controller.abort();
      try {
        input = await store.claim(run.id);
        if (!input) return;
        const claimed = input;
        // Reserve one second for terminal persistence, inside the original 60s.
        timer = setTimeout(cancel, Math.max(0, Date.parse(input.deadlineAt) - Date.now() - 1000));
        options.signal?.addEventListener("abort", cancel, { once: true });
        if (options.signal?.aborted) cancel();
        watching.set(run.id, controller);
        runtime = await runtimeFor(store, run.id, input, run.mode, controller.signal, options.client);
        const context = runtime;
        const work = async (): Promise<InvestigationResult> => {
          let result = normalizeResult(InvestigationResult.parse(await context.investigator.investigate(claimed, controller.signal)));
          context.check();
          if (result.mode !== run.mode) throw new Error("invalid_result");
          // Preload serially so failed/over-budget validation leaves no reads
          // racing terminal persistence. Keep every submitted finding unchecked.
          try {
            if (result.findings.length) await context.prepareValidation();
          } catch (error) {
            const code = error instanceof RetrievalError && error.code === "unavailable" ? "unavailable" :
              error instanceof RunError && error.code === "tool_limit" ? "tool_limit" : null;
            if (!code) throw error;
            logRunFailure(error);
            return { ...result, state: "incomplete" as const, error: result.error ?? code,
              findings: result.findings.map(f => ({ ...f,
                label: f.label === "Explained" ? "Needs Review" as const : f.label,
                referenceStatus: "unchecked" as const, supportStatus: "unverified" as const })),
              ...context.counters };
          }
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
        watching.delete(run.id);
        controller.abort();
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancel);
      }
    }));
  } finally {
    ended = true;
    clearTimeout(poll);
  }
}
