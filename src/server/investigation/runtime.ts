import { Activity, INVESTIGATION_LIMITS, type InvestigationInput, type InvestigationResult } from "../../contracts";
import type { Investigator, Retrieval } from "../../investigation";
import type { ModelClient } from "../../agent/loop";
import { RunError } from "../../investigation/budget";
import type { Store } from "../db/store";
import { databaseRetrieval } from "../retrieval/database";
import { stubInvestigator } from "./stub";

/** Only trusted server callers can supply a fake client. No HTTP/env fake mode. */
export async function runtimeFor(store: Store, id: string, input: InvestigationInput,
  mode: InvestigationResult["mode"], signal: AbortSignal, fakeClient?: ModelClient) {
  const retrieval = databaseRetrieval({ application: store.db, reader: store.reader },
    { exceptionId: input.exception.id, generation: input.generation, companyId: store.companyId });
  const counters = { toolExecutions: 0, modelRequests: 0 };
  const check = () => {
    if (signal.aborted) throw new RunError("deadline");
    if (Date.now() >= Date.parse(input.deadlineAt) - 1000) throw new RunError("deadline");
  };
  const charge = async (counter: keyof typeof counters, amount = 1, activity: Activity[] = []) => {
    check();
    counters[counter] = Math.max(counters[counter], await store.charge(id, input.generation, counter, amount, activity));
    check();
  };
  // Validation reuses complete scoped responses, never a model-filtered subset.
  // Repeated model lookups are still charged, including cache hits.
  const full = new Map<keyof Retrieval, unknown>();
  const call = async <K extends keyof Retrieval>(name: K, args: Parameters<Retrieval[K]>[0], reserved = false) => {
    check();
    if (!reserved) await charge("toolExecutions");
    const output = await (retrieval[name] as (args?: unknown) => Promise<unknown>)(args);
    check();
    if (!args || Object.values(args).every(value => value === undefined)) full.set(name, output);
    return output;
  };
  const tools: Retrieval = {
    get_payment_summary: async () => await call("get_payment_summary", undefined, mode === "real") as Awaited<ReturnType<Retrieval["get_payment_summary"]>>,
    list_payments: async args => await call("list_payments", args, mode === "real") as Awaited<ReturnType<Retrieval["list_payments"]>>,
    get_invoices: async args => await call("get_invoices", args, mode === "real") as Awaited<ReturnType<Retrieval["get_invoices"]>>,
    get_vendor_notes: async args => await call("get_vendor_notes", args, mode === "real") as Awaited<ReturnType<Retrieval["get_vendor_notes"]>>,
  };
  const validation: Retrieval = {
    get_payment_summary: async () => await cached("get_payment_summary") as Awaited<ReturnType<Retrieval["get_payment_summary"]>>,
    list_payments: async () => await cached("list_payments") as Awaited<ReturnType<Retrieval["list_payments"]>>,
    get_invoices: async () => await cached("get_invoices") as Awaited<ReturnType<Retrieval["get_invoices"]>>,
    get_vendor_notes: async () => await cached("get_vendor_notes") as Awaited<ReturnType<Retrieval["get_vendor_notes"]>>,
  };
  async function cached(name: keyof Retrieval) {
    if (!full.has(name)) await call(name, undefined);
    return full.get(name);
  }
  async function prepareValidation() {
    for (const name of ["list_payments", "get_invoices", "get_vendor_notes"] as const)
      await cached(name);
  }
  // Display-only progress. A failure here never fails or extends the run.
  const recordActivity = async (entries: Activity[]) => {
    try { await store.recordActivity(id, input.generation, entries); }
    catch { /* progress is cosmetic; counters and persistence carry the guarantees */ }
  };
  let investigator: Investigator = stubInvestigator;
  if (mode === "real") {
    const { createRealInvestigator, DEFAULT_MODEL } = await import("../../agent/loop");
    // SDK is never loaded by stub or fake-client tests. Missing key never falls back.
    let client = fakeClient;
    if (!client && process.env.ANTHROPIC_API_KEY?.trim()) {
      const { anthropicModelClient } = await import("../../agent/client");
      client = anthropicModelClient();
    }
    if (!client) investigator = (await import("../../agent/real")).realInvestigator;
    else {
      const model = client;
      investigator = createRealInvestigator({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        retrievalFor: () => tools,
        client: { create: async (params, options) => {
          await charge("modelRequests");
          const response = await model.create(params, options);
          check();
          // Reserve every attempted tool dispatch before returning the batch to
          // Jian's loop, including invalid inputs/unknown tools. A killed process
          // may leave a conservative reservation; it can never undercount work.
          const attempts = response.content.filter(b => b.type === "tool_use" && b.name !== "submit_findings").length;
          const amount = Math.min(attempts, INVESTIGATION_LIMITS.toolExecutions - counters.toolExecutions);
          const activity = response.content.filter(b => b.type === "tool_use").map(b => activityEntry(b.name, b.input));
          // One write per response: progress is stored with the lookup charge.
          // Only a submission-only response needs its own small display write.
          if (amount > 0) await charge("toolExecutions", amount, activity);
          else await recordActivity(activity);
          return response;
        } },
      });
    }
  }
  return { investigator, validation, counters, check, prepareValidation };
}

const TOOL_NAMES = new Set(["get_payment_summary", "list_payments", "get_invoices", "get_vendor_notes", "submit_findings"]);
/** Tool name and requested record IDs only; never model text or record content. */
export function activityEntry(name: unknown, input: unknown): Activity {
  const tool = typeof name === "string" && TOOL_NAMES.has(name) ? name : "other";
  const values = input && typeof input === "object" ? Object.values(input as Record<string, unknown>) : [];
  const ids = tool === "submit_findings" || tool === "other" ? [] :
    values.flatMap(v => Array.isArray(v) ? v : []).filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 120).slice(0, 50);
  return Activity.parse({ tool, ids });
}
