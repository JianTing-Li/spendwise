import { PGlite } from "@electric-sql/pglite";
import { afterEach, expect, it, vi } from "vitest";
import { stubInvestigator } from "../src/server/investigation/stub";
import { Store } from "../src/server/db/store";
import { companyDataset } from "../src/fixtures/company-scenarios";
import { baseline, injectedDataset } from "../src/fixtures/scenarios";
import { summarize, detect, validateDataset } from "../src/domain/finance";
import { runPending } from "../src/server/investigation/run";
import { databaseRetrieval } from "../src/server/retrieval/database";
import { migrations } from "../src/server/db/migrations/bundled";
import { migrate } from "../src/server/db/migrate";
import { syntheticModel } from "./helpers/int01-model";

const databases: PGlite[] = [];
async function create() { const db = new PGlite(); databases.push(db); const store = new Store(db); await store.initialize(); return store; }
afterEach(async () => { for (const db of databases.splice(0)) await db.close(); vi.unstubAllEnvs(); });

it("keeps Roast fixtures exact and gives new companies distinct contextual evidence and deterministic totals", () => {
  expect(companyDataset("roast")).toEqual(baseline);
  expect(companyDataset("roast", true)).toEqual(injectedDataset());
  const seen = new Set<string>();
  for (const [company, totals] of [["hubspot", [200000, 2600000, 2400000]], ["gxo", [400000, 2200000, 1800000]]] as const) {
    const data = validateDataset(companyDataset(company, true));
    expect(detect(data)).toHaveLength(6);
    const renewal = summarize(data).find(s => s.vendorId.endsWith(":vendor-renewal"))!;
    expect([renewal.priorCents, renewal.currentCents, renewal.differenceCents]).toEqual(totals);
    for (const record of [...data.vendors, ...data.payments, ...data.invoices, ...data.notes]) {
      expect(record.id.startsWith(`${company}:`)).toBe(true); expect(seen.has(record.id)).toBe(false); seen.add(record.id);
    }
    expect(data.payments.find(p => p.id.endsWith("pay-advisory-a"))!.invoiceId).toBe(data.payments.find(p => p.id.endsWith("pay-advisory-b"))!.invoiceId);
    expect(data.payments.find(p => p.id.endsWith("pay-design-a"))!.invoiceId).not.toBe(data.payments.find(p => p.id.endsWith("pay-design-b"))!.invoiceId);
    expect(JSON.stringify(data)).not.toMatch(/cafe|coffee|POS platform|sales tax|holiday roast/i);
  }
});

it("browses never-injected company baselines without writing any records", async () => {
  const root = await create();
  const before = await root.db.transaction(tx => tx.query("SELECT * FROM demo_state ORDER BY id"));
  for (const company of ["hubspot", "gxo"] as const) {
    const state = await root.forCompany(company).state();
    expect(state.dataset).toEqual(companyDataset(company)); expect(state.runs).toEqual([]); expect(state.injected).toBe(false);
  }
  expect(await root.db.transaction(tx => tx.query("SELECT * FROM demo_state ORDER BY id"))).toEqual(before);
  expect((await root.db.transaction(tx => tx.query("SELECT id FROM vendors"))).rows).toHaveLength(12);
});

it.each(["hubspot", "gxo"] as const)("runs %s through real orchestration with scoped DB evidence and an offline model", async company => {
  vi.stubEnv("INVESTIGATOR_MODE", "real");
  const root = await create(), store = root.forCompany(company);
  await store.inject();
  await runPending(store, { client: syntheticModel() });
  const state = await store.state();
  expect(state.runs).toHaveLength(6);
  for (const run of state.runs) {
    expect(run).toMatchObject({ mode: "real", state: "completed", error: null, toolExecutions: 3, modelRequests: 2 });
    expect(run.findings.every(f => f.referenceStatus === "valid" && f.supportStatus === "unverified" && f.evidence.every(e => e.id.startsWith(`${company}:`)))).toBe(true);
  }
  expect((await root.state()).injected).toBe(false);
});

it("independently persists inject, completion, acknowledgment and reset for all companies", async () => {
  const root = await create();
  const stores = [root, root.forCompany("hubspot"), root.forCompany("gxo")];
  await Promise.all(stores.map(async s => { const results = await Promise.all([s.inject(), s.inject()]); expect(results.map(r => r.changed).sort()).toEqual([false, true]); await runPending(s); }));
  for (const s of stores) {
    const state = await s.state(); expect(state.runs).toHaveLength(6);
    expect(state.runs.every(r => r.state === "completed" && r.modelRequests === 0 && r.findings.every(f => f.supportStatus === "unverified"))).toBe(true);
    await s.review(state.runs[0].id);
  }
  const roast = await root.state(), gxo = await stores[2].state();
  await stores[1].reset();
  expect(await root.state()).toEqual(roast); expect(await stores[2].state()).toEqual(gxo);
  expect((await stores[1].state()).generation).toBe(1); expect((await stores[1].state()).runs).toEqual([]);
  await root.initialize();
  expect(await root.state()).toEqual(roast); expect(await stores[2].state()).toEqual(gxo);
});

it("rejects foreign run IDs for claim, finish, review, retry, counters and activity even when generations match", async () => {
  const root = await create(), hub = root.forCompany("hubspot"), gxo = root.forCompany("gxo");
  await hub.inject(); await gxo.inject();
  const run = (await hub.state()).runs[0];
  expect(await gxo.claim(run.id)).toBeNull();
  await expect(gxo.retry(run.id)).rejects.toThrow("invalid_retry");
  const input = (await hub.claim(run.id))!;
  const result = await stubInvestigator.investigate(input, new AbortController().signal);
  expect(await gxo.finish(run.id, run.generation, result)).toBe(false);
  await expect(gxo.charge(run.id, run.generation, "modelRequests")).rejects.toThrow();
  expect(await gxo.activeRuns([run.id], run.generation)).toEqual([]);
  await hub.finish(run.id, run.generation, result);
  expect((await hub.state()).runs[0].state).toBe("completed");
  await expect(gxo.review(run.id)).rejects.toThrow("invalid_review");
  expect((await hub.state()).runs[0].reviewedAt).toBeNull();
});

it("reset invalidates only its own in-flight results and retrieval; other company work survives", async () => {
  const root = await create(), hub = root.forCompany("hubspot"), gxo = root.forCompany("gxo");
  await hub.inject(); await gxo.inject();
  const h = (await hub.state()).runs[0], g = (await gxo.state()).runs[0];
  await hub.claim(h.id);
  const input = (await gxo.claim(g.id))!;
  const result = await stubInvestigator.investigate(input, new AbortController().signal);
  const access = (companyId: "hubspot" | "gxo", run: typeof h) => databaseRetrieval({ application: root.db }, { companyId, exceptionId: run.exceptionId, generation: run.generation });
  const hRead = access("hubspot", h), gRead = access("gxo", g);
  await expect(access("hubspot", g).list_payments()).rejects.toMatchObject({ code: "invalid_scope" });
  expect(await gRead.list_payments({ paymentIds: ["hubspot:pay-renewal-annual"] })).toEqual([]);
  await hub.reset();
  await expect(hRead.list_payments()).rejects.toMatchObject({ code: "stale_generation" });
  expect((await gRead.list_payments()).every(p => p.vendorId.startsWith("gxo:"))).toBe(true);
  expect(await hub.finish(h.id, h.generation, result)).toBe(false);
  expect(await gxo.finish(g.id, g.generation, result)).toBe(true);
  expect((await gxo.state()).runs.find(r => r.id === g.id)!.state).toBe("completed");
});

it("a retry cannot materialize expiry in another company", async () => {
  const root = await create(), hub = root.forCompany("hubspot"), gxo = root.forCompany("gxo");
  await hub.inject(Date.now() - 61000); await gxo.inject(Date.now() - 61000);
  const h = (await hub.state()).runs[0], g = (await gxo.state()).runs[0];
  await gxo.retry(g.id);
  expect((await root.db.transaction(tx => tx.query<{ status: string }>("SELECT status FROM investigation_runs WHERE id=$1", [h.id]))).rows[0].status).toBe("pending");
});

it("migration 003 preserves populated v2 records, run review and the original reset generation", async () => {
  const db = new PGlite(); databases.push(db);
  await db.exec(migrations[0]); await db.exec(migrations[1]); await db.exec("INSERT INTO schema_migrations VALUES (2)");
  const data = injectedDataset();
  for (const v of data.vendors) await db.query("INSERT INTO vendors(id,payload) VALUES ($1,$2)", [v.id, JSON.stringify(v)]);
  for (const [table, records] of [["invoices", data.invoices], ["payments", data.payments], ["vendor_notes", data.notes]] as const)
    for (const record of records) await db.query(`INSERT INTO ${table}(id,vendor_id,payload) VALUES ($1,$2,$3)`, [record.id, record.vendorId, JSON.stringify(record)]);
  const exception = detect(data)[0];
  await db.query("INSERT INTO exceptions VALUES ($1,$2)", [exception.id, JSON.stringify(exception)]);
  const reviewedAt = "2026-11-10T16:00:00.000Z";
  await db.query("INSERT INTO investigation_runs(id,exception_id,generation,status,deadline_at,payload) VALUES ('preserved',$1,7,'completed',now(),$2)", [exception.id, JSON.stringify({ mode: "stub", findings: [], error: null, toolExecutions: 0, modelRequests: 0, reviewedAt })]);
  await db.exec("UPDATE demo_state SET generation=7,injected=true WHERE id=1");
  const before = (await db.query("SELECT id,payload FROM vendors ORDER BY id")).rows;
  await migrate(db); await migrate(db);
  expect((await db.query("SELECT id,payload FROM vendors ORDER BY id")).rows).toEqual(before);
  const store = new Store(db); await store.assertVersion();
  const state = await store.state();
  expect(state.generation).toBe(7); expect(state.injected).toBe(true); expect(state.runs[0].reviewedAt).toBe(reviewedAt);
  expect((await store.forCompany("hubspot").state()).generation).toBe(0);
  expect((await store.forCompany("gxo").state()).runs).toEqual([]);
});
