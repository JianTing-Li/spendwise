import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Store } from "../src/server/db/store";
const context = vi.hoisted(() => ({ store: undefined as Store | undefined }));
vi.mock("../src/server/db/local", () => ({ getStore: async () => context.store! }));
vi.mock("../src/server/investigation/run", async importOriginal => {
  const original = await importOriginal<typeof import("../src/server/investigation/run")>();
  const { syntheticModel } = await import("./helpers/int01-model");
  return { ...original, runPending: (store: Store, options: { signal: AbortSignal }) => original.runPending(store, { ...options, client: syntheticModel() }) };
});
import { GET, POST } from "../src/app/api/demo/route";
import { POST as retry } from "../src/app/api/demo/retry/route";
let db: PGlite;
const req = (body?: object, origin = "http://127.0.0.1:3100") => new Request("http://127.0.0.1:3100/api/demo", {
  method: body ? "POST" : "GET", headers: { host: "127.0.0.1:3100", origin, "content-type":"application/json", "x-spendwise-demo":"1" },
  ...(body ? {body:JSON.stringify(body)} : {}),
});
beforeEach(async () => {
  vi.stubEnv("INVESTIGATOR_MODE","real"); vi.stubEnv("DATABASE_MODE","local"); vi.stubEnv("VERCEL",""); vi.stubEnv("AUTH_URL","");
  db = new PGlite(); context.store = new Store(db); await context.store.initialize();
});
afterEach(async () => { await db.close(); vi.unstubAllEnvs(); });
it("authorizes before executing, wires durable real fake runs, returns read/review/reset/conflict HTTP results", async () => {
  expect((await POST(req({action:"inject",scenarioId:"demo-v1"},"https://foreign.test"))).status).toBe(403);
  expect((await context.store!.state()).runs).toEqual([]);
  expect((await POST(req({action:"unknown"}))).status).toBe(400);
  const results = await Promise.all([POST(req({action:"inject",scenarioId:"demo-v1"})),POST(req({action:"inject",scenarioId:"demo-v1"}))]);
  expect(results.every(r=>r.status===200)).toBe(true);
  expect((await Promise.all(results.map(r=>r.json()))).map(r=>r.changed).sort()).toEqual([false,true]);
  const response = await GET(req()); expect(response.status).toBe(200);
  const state = await response.json(); expect(state.runs).toHaveLength(4);
  expect(state.runs.every((r: {state:string})=>r.state==="completed")).toBe(true);
  expect((await POST(req({action:"review",runId:state.runs[0].id}))).status).toBe(200);
  expect((await retry(req({predecessorId:state.runs[0].id}))).status).toBe(409);
  expect((await POST(req({action:"review",runId:"missing"}))).status).toBe(409);
  expect((await POST(req({action:"reset"}))).status).toBe(200);
  expect((await retry(req({predecessorId:state.runs[0].id}))).status).toBe(409);
  expect((await (await GET(req())).json()).runs).toEqual([]);
});
it("hosted missing identity fails 401 without accepting work; invalid configuration is 503", async () => {
  vi.stubEnv("VERCEL","1");
  expect((await POST(req({action:"inject",scenarioId:"demo-v1"}))).status).toBe(401);
  expect((await context.store!.state()).runs).toEqual([]);
  vi.stubEnv("VERCEL",""); vi.stubEnv("INVESTIGATOR_MODE","typo");
  const response = await POST(req({action:"inject",scenarioId:"demo-v1"}));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({error:"unavailable"});
});
