import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Store } from "../src/server/db/store";
const context = vi.hoisted(() => ({ store: undefined as Store | undefined }));
vi.mock("../src/server/db/local", () => ({ getStore: async () => context.store! }));
import { GET, POST } from "../src/app/api/demo/route";
import { POST as retry } from "../src/app/api/demo/retry/route";
let db: PGlite;
const req = (query = "", body?: object, origin = "http://127.0.0.1:3100") => new Request(`http://127.0.0.1:3100/api/demo${query}`, {
  method: body ? "POST" : "GET", headers: { host: "127.0.0.1:3100", origin, "content-type": "application/json", "x-spendwise-demo": "1" }, ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeEach(async () => {
  vi.stubEnv("INVESTIGATOR_MODE", "stub"); vi.stubEnv("DATABASE_MODE", "local"); vi.stubEnv("VERCEL", ""); vi.stubEnv("AUTH_URL", "");
  db = new PGlite(); context.store = new Store(db); await context.store.initialize();
});
afterEach(async () => { await db.close(); vi.unstubAllEnvs(); });

it("keeps legacy requests working and independently serves/mutates the selected company", async () => {
  expect((await POST(req("?company=hubspot", { action: "inject", scenarioId: "demo-v1" }))).status).toBe(200);
  const hub = await (await GET(req("?company=hubspot"))).json();
  expect(hub.runs).toHaveLength(4); expect(hub.runs.every((r: { modelRequests: number }) => r.modelRequests === 0)).toBe(true);
  expect(hub.dataset.vendors.every((v: { id: string }) => v.id.startsWith("hubspot:"))).toBe(true);
  expect((await (await GET(req())).json()).injected).toBe(false);
  expect((await (await GET(req("?company=gxo"))).json()).injected).toBe(false);
  expect((await POST(req("?company=gxo", { action: "review", runId: hub.runs[0].id }))).status).toBe(409);
  expect((await retry(req("?company=gxo", { predecessorId: hub.runs[0].id }))).status).toBe(409);
  expect((await POST(req("?company=hubspot", { action: "review", runId: hub.runs[0].id }))).status).toBe(200);
  const reviewed = await (await GET(req("?company=hubspot"))).json();
  expect((await POST(req("?company=gxo", { action: "reset" }))).status).toBe(200);
  expect(await (await GET(req("?company=hubspot"))).json()).toEqual(reviewed);
});

it("rejects unknown/duplicate selectors and authorizes all company mutations before storage", async () => {
  for (const query of ["?company=unknown", "?company=hubspot&company=gxo", "?company=", "?company=HUBSPOT"]) {
    expect((await GET(req(query))).status).toBe(400);
    expect((await POST(req(query, { action: "reset" }))).status).toBe(400);
    expect((await retry(req(query, { predecessorId: "r" }))).status).toBe(400);
  }
  vi.stubEnv("VERCEL", "1");
  for (const company of ["roast", "hubspot", "gxo"]) {
    expect((await POST(req(`?company=${company}`, { action: "inject", scenarioId: "demo-v1" }))).status).toBe(401);
    expect((await retry(req(`?company=${company}`, { predecessorId: "r" }))).status).toBe(401);
  }
  vi.stubEnv("VERCEL", "");
  expect((await POST(req("?company=gxo", { action: "reset" }, "https://foreign.invalid"))).status).toBe(403);
  expect((await context.store!.forCompany("hubspot").state()).injected).toBe(false);
});
