import { PGlite } from "@electric-sql/pglite";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/db/store";
import type { Database } from "../src/server/db/database";
import { runPending } from "../src/server/investigation/run";
import { normalizeResult } from "../src/server/investigation/result";
import { stubInvestigator } from "../src/server/investigation/stub";
import { syntheticModel, message, call, draft } from "./helpers/int01-model";

const dbs: PGlite[] = [];
const folders: string[] = [];
async function setup(path?: string) {
  const db = new PGlite(path); dbs.push(db);
  const store = new Store(db); await store.initialize(); return store;
}
afterEach(async () => {
  for (const db of dbs.splice(0)) if (!db.closed) await db.close();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.restoreAllMocks();
});
async function waitFor(test: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await test()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error("condition timed out");
}
it("completes durable real runs via DB tools, keeps support unverified, reopens and reviews", async () => {
  vi.stubEnv("INVESTIGATOR_MODE", "real");
  const folder = await mkdtemp(join(tmpdir(), "int01-durable-")); folders.push(folder);
  const store = await setup(folder);
  await Promise.all([store.inject(), store.inject()]);
  const client = syntheticModel(); const create = vi.spyOn(client, "create");
  await Promise.all([runPending(store, { client }), runPending(store, { client })]);
  const state = await store.state();
  expect(create).toHaveBeenCalledTimes(8);
  expect(state.runs).toHaveLength(4);
  expect(state.runs.every(r => r.mode === "real" && r.state === "completed" && r.error === null &&
    r.modelRequests === 2 && r.toolExecutions === 3 && r.findings[0].referenceStatus === "valid" && r.findings[0].supportStatus === "unverified")).toBe(true);
  await store.review(state.runs[0].id);
  await store.db.close();
  const reopened = await setup(folder);
  expect((await reopened.state()).runs[0].reviewedAt).not.toBeNull();
  await expect(reopened.retry(state.runs[0].id)).rejects.toThrow("invalid_retry");
});
it("starts four model waits concurrently, persists attempts before waiting, and cancels without locks", async () => {
  vi.stubEnv("INVESTIGATOR_MODE", "real");
  const store = await setup(); await store.inject();
  let calls = 0;
  const controller = new AbortController();
  const task = runPending(store, { signal: controller.signal, client: { create: async (_params, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } } });
  await waitFor(async () => calls === 4);
  const active = await store.state();
  expect(active.runs.every(r => r.state === "running" && r.modelRequests === 1)).toBe(true);
  controller.abort(); await task;
  expect((await store.state()).runs.every(r => r.state === "cancelled" && r.error === null && r.modelRequests === 1)).toBe(true);
});
it("reset aborts model waits, invalidates generation, and ignores late results", async () => {
  vi.stubEnv("INVESTIGATOR_MODE", "real");
  const store = await setup(); await store.inject();
  const signals: AbortSignal[] = []; const release: Array<() => void> = [];
  const task = runPending(store, { client: { create: async (_params, options) => {
    signals.push(options.signal);
    // Deliberately ignores abort: the runner and DB guards must still stop it.
    return new Promise(resolve => release.push(() => resolve(message([call("submit_findings", {findings:[draft()]} )]))));
  } } });
  await waitFor(async () => signals.length === 4);
  await store.reset(); await store.inject();
  await task;
  expect(signals.every(s => s.aborted)).toBe(true);
  release.forEach(r => r()); await new Promise(r => setTimeout(r, 20));
  expect((await store.state()).runs.every(r => r.generation === 1 && r.state === "pending" && r.modelRequests === 0)).toBe(true);
});
it("isolates model and persistence failures; retries are predecessor-idempotent", async () => {
  vi.stubEnv("INVESTIGATOR_MODE", "real");
  const store = await setup(); await store.inject();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const client = syntheticModel(); let first = true;
  const create = client.create.bind(client);
  client.create = async (...args) => { if (first) { first = false; throw new Error("private credential marker"); } return create(...args); };
  const finish = store.finish.bind(store); let persisted = false;
  vi.spyOn(store, "finish").mockImplementation(async (...args) => {
    if (!persisted) { persisted = true; throw new Error("private SQL marker"); }
    return finish(...args);
  });
  await runPending(store, { client });
  expect((await store.state()).runs.filter(r => r.state === "completed")).toHaveLength(3);
  const failed = (await store.state()).runs.find(r => r.state === "failed")!;
  expect(failed).toBeDefined();
  expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  const retries = await Promise.all([store.retry(failed.id), store.retry(failed.id)]);
  expect(retries.map(r => r.changed).sort()).toEqual([false, true]);
  await runPending(store, { client: syntheticModel() });
  expect((await store.state()).runs.filter(r => r.state === "completed")).toHaveLength(4);
});
it("bounds validation lookups together with model dispatches; counts invalid requests too", async () => {
  vi.stubEnv("INVESTIGATOR_MODE", "real");
  const store = await setup(); await store.inject();
  const client = { create: async () => message([
    ...Array.from({length:8}, (_,i) => call(`unknown_${i}`)),
    call("submit_findings", { findings:[draft()] }),
  ]) };
  await runPending(store, { client });
  expect((await store.state()).runs.every(r => r.state === "incomplete" && r.error === "tool_limit" && r.toolExecutions === 8 && r.modelRequests === 1)).toBe(true);
});
it("caps model requests at ten, with retries disabled", async () => {
  vi.stubEnv("INVESTIGATOR_MODE", "real");
  const store = await setup(); await store.inject();
  const create = vi.fn(async (_params, options) => {
    expect(options.maxRetries).toBe(0);
    return message([call("submit_findings", {findings: []})]);
  });
  await runPending(store, { client: { create } });
  expect(create).toHaveBeenCalledTimes(40);
  expect((await store.state()).runs.every(r => r.state === "incomplete" && r.error === "model_limit" && r.modelRequests === 10)).toBe(true);
});
it("refuses a model call after the validation reserve, and retries expiry without a GET write", async () => {
  vi.stubEnv("INVESTIGATOR_MODE", "real");
  const store = await setup(); await store.inject(Date.now() - 58_800);
  await runPending(store, { client: { create: async () => new Promise(() => {}) } });
  const runs = (await store.state()).runs;
  expect(runs.every(r => r.state === "incomplete" && r.error === "deadline")).toBe(true);
  // Simulate process death, including close/reopen: raw row remains running,
  // GET derives expiry and mutation alone materializes it.
  await store.reset(); await store.inject(Date.now() - 61000);
  const rawBefore = await store.db.transaction(tx => tx.query("SELECT status,payload FROM investigation_runs ORDER BY id"));
  const expired = await store.state(); await store.state();
  expect(await store.db.transaction(tx => tx.query("SELECT status,payload FROM investigation_runs ORDER BY id"))).toEqual(rawBefore);
  expect(expired.runs.every(r => r.state === "incomplete" && r.error === "deadline")).toBe(true);
  await store.retry(expired.runs[0].id);
  expect((await store.state()).runs).toHaveLength(5);
});
it("prevents completed results with empty findings, inconsistent errors, or wrong mode", async () => {
  const store = await setup(); await store.inject(); const run = (await store.state()).runs[0];
  const input = (await store.claim(run.id))!;
  const result = await stubInvestigator.investigate(input,new AbortController().signal);
  for (const invalid of [{...result,findings:[]}, {...result,error:"unavailable" as const}, {...result,state:"failed" as const,error:null}])
    expect(normalizeResult(invalid)).toMatchObject({state:"failed",error:"internal",findings:[]});
  await expect(store.finish(run.id, run.generation,{...result,mode:"real"})).rejects.toThrow("invalid_result");
  await store.finish(run.id, run.generation,{...result, findings:[]});
  expect((await store.state()).runs[0].state).toBe("failed");
});
it("unknown mode cannot inject; missing real configuration fails without model requests or stub fallback", async () => {
  const store = await setup(); vi.stubEnv("INVESTIGATOR_MODE","typo");
  await expect(store.inject()).rejects.toThrow("mode unavailable");
  expect((await store.state()).runs).toEqual([]);
  vi.stubEnv("INVESTIGATOR_MODE","real"); vi.stubEnv("ANTHROPIC_API_KEY","");
  await store.inject(); await runPending(store);
  expect((await store.state()).runs.every(r => r.mode === "real" && r.state === "failed" && r.error === "unavailable" && r.modelRequests === 0)).toBe(true);
});
it("state uses a read-only transaction and no row locks or updates", async () => {
  const store = await setup(); const statements: string[] = [];
  const db: Database = { close: async () => {}, transaction: work => store.db.transaction(tx => work({
    exec: async sql => { statements.push(sql); return tx.exec(sql); },
    query: async (sql, params) => { statements.push(sql); return tx.query(sql, params); },
  })) };
  await new Store(db).state();
  expect(statements[0]).toContain("READ ONLY");
  expect(statements.some(sql => /FOR UPDATE|UPDATE |INSERT |DELETE /i.test(sql))).toBe(false);
});
it("recovers a killed worker's durable running counter after reopening and expiry", async () => {
  const folder = await mkdtemp(join(tmpdir(), "int01-interrupted-")); folders.push(folder);
  const store = await setup(folder); await store.inject();
  const run = (await store.state()).runs[0]; await store.claim(run.id);
  await store.charge(run.id,run.generation,"modelRequests");
  await store.db.close();
  const reopened = await setup(folder);
  await reopened.db.transaction(tx=>tx.query("UPDATE investigation_runs SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1",[run.id]));
  const recovered = (await reopened.state()).runs.find(r=>r.id===run.id)!;
  expect(recovered).toMatchObject({state:"incomplete",error:"deadline",modelRequests:1});
  await reopened.retry(run.id);
  expect((await reopened.state()).runs.filter(r=>r.exceptionId===run.exceptionId)).toHaveLength(2);
});
it("stops a hung model when the durable deadline is forced past, without accepting late output", async () => {
  vi.stubEnv("INVESTIGATOR_MODE","real"); const store = await setup(); await store.inject();
  let waiting=0;
  const task = runPending(store,{client:{create:async()=>{waiting++;return new Promise(()=>{});}}});
  await waitFor(async()=>waiting===4);
  await store.db.transaction(tx=>tx.exec("UPDATE investigation_runs SET deadline_at=clock_timestamp()-interval '1 second'"));
  await task;
  expect((await store.state()).runs.every(r=>r.state==="incomplete" && r.error==="deadline" && r.modelRequests===1)).toBe(true);
});
