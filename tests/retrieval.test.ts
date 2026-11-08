import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { retrievalDemoDatabase } from "./retrieval-support";
import { fixtureRetrieval } from "../src/server/retrieval/fixture";
import { databaseRetrieval } from "../src/server/retrieval/database";
import { duplicateLookbackStart } from "../src/server/retrieval/bounds";
import { periods, settings, summarize } from "../src/domain/finance";
import type { Database } from "../src/server/db/database";

const sorted = <T extends { id: string }>(rows: T[]) => rows.sort((a,b) => a.id.localeCompare(b.id));
let demo: Awaited<ReturnType<typeof retrievalDemoDatabase>>;
beforeAll(async () => { demo = await retrievalDemoDatabase(); });
afterAll(async () => { await demo.db.close(); });

describe("database scoped retrieval", () => {
  it("matches all four fixture methods for every detected exception", async () => {
    for (const exception of demo.state.exceptions) {
      const actual = demo.retrieval(exception.id);
      const fixture = fixtureRetrieval(demo.state.dataset, exception);
      expect(await actual.get_payment_summary()).toEqual(await fixture.get_payment_summary());
      expect(sorted(await actual.list_payments())).toEqual(sorted(await fixture.list_payments()));
      expect(sorted(await actual.get_invoices())).toEqual(sorted(await fixture.get_invoices()));
      expect(sorted(await actual.get_vendor_notes())).toEqual(sorted(await fixture.get_vendor_notes()));
    }
  });
  it("model IDs only narrow access; unknown, cross-vendor and SQL strings never expand it", async () => {
    const exception = demo.state.exceptions[0];
    const r = demo.retrieval(exception.id);
    const other = demo.state.dataset.payments.find(p => p.vendorId !== exception.vendorId)!;
    expect(await r.list_payments({ paymentIds: [other.id, "x' OR true; DELETE FROM payments;--", "missing"] })).toEqual([]);
    const invoices = await r.get_invoices();
    const foreign = demo.state.dataset.invoices.filter(i => !invoices.some(a => a.id === i.id));
    expect(await r.get_invoices({ invoiceIds: foreign.map(i => i.id).slice(0,50) })).toEqual([]);
    const notes = await r.get_vendor_notes();
    const foreignNotes = demo.state.dataset.notes.filter(n => !notes.some(a => a.id === n.id));
    expect(await r.get_vendor_notes({ noteIds: foreignNotes.map(n => n.id).slice(0,50) })).toEqual([]);
    expect(await r.list_payments({ paymentIds: [] })).toEqual([]);
    expect(Object.keys(r).sort()).toEqual(["get_invoices", "get_payment_summary", "get_vendor_notes", "list_payments"]);
  });
  it("rejects oversized, malformed and arbitrary-SQL inputs before database work", async () => {
    const r = demo.retrieval(demo.state.exceptions[0].id);
    await expect(r.list_payments({ paymentIds: Array(51).fill("x") })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(r.list_payments({ paymentIds: [""] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(r.list_payments({ paymentIds: null } as never)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(r.list_payments({ paymentIds: ["x".repeat(121)] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(r.get_invoices({ sql: "SELECT * FROM payments" } as never)).rejects.toMatchObject({ code: "invalid_input" });
    expect(() => databaseRetrieval({ application: demo.db }, { exceptionId: "x", generation: -1 })).toThrow("invalid_scope");
    expect(() => databaseRetrieval({ application: demo.db }, { exceptionId: "x" } as never)).toThrow("invalid_scope");
    await expect(demo.retrieval("missing").list_payments()).rejects.toMatchObject({ code: "invalid_scope" });
  });
  it("redacts driver errors and never silently falls back", async () => {
    const broken: Database = { transaction: async () => { throw new Error("secret postgres://password SQL"); }, close: async () => {} };
    const r = databaseRetrieval({ application: broken }, { exceptionId: "x", generation: 0 });
    await expect(r.get_payment_summary()).rejects.toMatchObject({ message: "Retrieval unavailable", code: "unavailable" });
  });
  it("derives duplicate lookback from domain settings", () => {
    expect(duplicateLookbackStart()).toBe("2026-09-24");
    const days = settings.duplicateDays;
    settings.duplicateDays = 8;
    try { expect(duplicateLookbackStart()).toBe("2026-09-23"); }
    finally { settings.duplicateDays = days; }
  });
  it.each([
    "INSERT INTO vendors VALUES ('forbidden','{}')",
    "UPDATE payments SET payload=payload",
    "DELETE FROM payments",
    "CREATE TABLE forbidden (id int)",
    "CREATE TEMP TABLE forbidden (id int)",
    "DROP TABLE payments",
    "SELECT * FROM demo_state",
    "SELECT * FROM exceptions",
    "SELECT * FROM investigation_runs",
  ])("reader denies %s", async sql => {
    await expect(demo.db.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE spendwise_retrieval_reader");
      await tx.exec(sql);
    })).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects stale generation even when reset reuses stable record IDs", async () => {
    const local = await retrievalDemoDatabase();
    try {
      const r = local.retrieval(local.state.exceptions[0].id);
      await local.store.reset();
      await local.store.inject();
      for (const call of [() => r.list_payments(), () => r.get_invoices(), () => r.get_vendor_notes(), () => r.get_payment_summary()])
        await expect(call()).rejects.toMatchObject({ code: "stale_generation" });
    } finally { await local.db.close(); }
  });
  it("uses domain totals rather than persisted summary assertions", async () => {
    const e = demo.state.exceptions[0];
    const changed = { ...e, summary: { ...e.summary, priorCents: 777 } };
    await demo.db.query("UPDATE exceptions SET payload=$2 WHERE id=$1", [e.id, JSON.stringify(changed)]);
    try { expect(await demo.retrieval(e.id).get_payment_summary()).toEqual(e.summary); }
    finally { await demo.db.query("UPDATE exceptions SET payload=$2 WHERE id=$1", [e.id, JSON.stringify(e)]); }
  });
  it("period boundaries, linked evidence and reversals preserve cash-by-entry-date", async () => {
    const r = demo.retrieval(demo.state.exceptions[0].id);
    const rows = await r.list_payments();
    expect(rows.every(p => p.date < periods.endExclusive)).toBe(true);
    const paymentIds = new Set(rows.map(p => p.id));
    const invoiceIds = new Set((await r.get_invoices()).map(i => i.id));
    for (const note of await r.get_vendor_notes()) {
      expect(note.paymentIds.every(id => paymentIds.has(id))).toBe(true);
      expect(note.invoiceIds.every(id => invoiceIds.has(id))).toBe(true);
    }

  });
  it("fails explicitly on record/text limits and does not return partial evidence", async () => {
    const e = demo.state.exceptions[0];
    const r = demo.retrieval(e.id);
    const p = (await r.list_payments())[0];
    const oversized = { ...p, description: "x".repeat(25000) };
    await demo.db.query("UPDATE payments SET payload=$2 WHERE id=$1", [p.id, JSON.stringify(oversized)]);
    try { await expect(r.list_payments()).rejects.toMatchObject({ code: "evidence_limit" }); }
    finally { await demo.db.query("UPDATE payments SET payload=$2 WHERE id=$1", [p.id, JSON.stringify(p)]); }
    await demo.db.transaction(async tx => {
      for (let i=0;i<101;i++) {
        const row = { ...p, id: `overflow-${i}`, date: "2026-10-01" };
        await tx.query("INSERT INTO payments (id,vendor_id,payload) VALUES ($1,$2,$3)", [row.id, row.vendorId, JSON.stringify(row)]);
      }
    });
    try {
      await expect(r.list_payments()).rejects.toMatchObject({ code: "evidence_limit" });
      await expect(r.get_payment_summary()).rejects.toMatchObject({ code: "evidence_limit" });
    } finally { await demo.db.exec("DELETE FROM payments WHERE id LIKE 'overflow-%'"); }
  });
});

it("checks exact lookback boundaries, future records, historical originals and reversal totals", async () => {
  const local = await retrievalDemoDatabase();
  try {
    const e = local.state.exceptions.find(e => e.rule === "possible_duplicate")!;
    const template = local.state.dataset.payments.find(p => p.vendorId === e.vendorId)!;
    const additions = [
      { ...template, id: "before-lookback", invoiceId: null, date: "2026-09-23" },
      { ...template, id: "on-lookback", invoiceId: null, date: "2026-09-24" },
      { ...template, id: "after-cutoff", invoiceId: null, date: "2026-11-01" },
      { ...template, id: "old-original", invoiceId: null, date: "2026-08-01" },
      { ...template, id: "completed-reversal", invoiceId: null, entryType: "reversal" as const, reversalReference: "old-original", date: "2026-10-01" },
      { ...template, id: "pending-cash", invoiceId: null, status: "pending" as const, date: "2026-10-02" },
    ];
    const exception = { ...e, paymentIds: [...e.paymentIds, "completed-reversal"] };
    await local.db.transaction(async tx => {
      for (const p of additions) await tx.query("INSERT INTO payments (id,vendor_id,payload) VALUES ($1,$2,$3)", [p.id,p.vendorId,JSON.stringify(p)]);
      await tx.query("UPDATE exceptions SET payload=$2 WHERE id=$1", [e.id,JSON.stringify(exception)]);
    });
    const r = local.retrieval(e.id);
    const ids = (await r.list_payments()).map(p => p.id);
    expect(ids).toContain("on-lookback");
    expect(ids).not.toContain("before-lookback");
    expect(ids).not.toContain("after-cutoff");
    expect(ids).toContain("old-original");
    expect(await r.list_payments({paymentIds:["before-lookback","after-cutoff"]})).toEqual([]);
    const data = { ...local.state.dataset, payments: [...local.state.dataset.payments,...additions] };
    expect(await r.get_payment_summary()).toEqual(summarize(data).find(s => s.vendorId===e.vendorId));
    expect((await r.get_payment_summary()).currentCents).toBe(e.summary.currentCents-template.amountCents);
  } finally { await local.db.close(); }
});

it("filters leaked note links, excludes future and unlinked notes, and bounds aggregate text", async () => {
  const local = await retrievalDemoDatabase();
  try {
    const e = local.state.exceptions[0];
    const payment = local.state.dataset.payments.find(p => p.vendorId===e.vendorId)!;
    const foreign = local.state.dataset.payments.find(p => p.vendorId!==e.vendorId)!;
    await local.db.transaction(async tx => {
      for (const [id,date,ids] of [["linked","2026-10-01",[payment.id,foreign.id]], ["future","2026-11-01",[payment.id]], ["unlinked","2026-10-01",[foreign.id]]] as const) {
        const note = { id,vendorId:e.vendorId,date,text:"untrusted synthetic evidence",paymentIds:ids,invoiceIds:[] };
        await tx.query("INSERT INTO vendor_notes (id,vendor_id,payload) VALUES ($1,$2,$3)",[id,e.vendorId,JSON.stringify(note)]);
        for (const paymentId of ids) await tx.query("INSERT INTO note_payments VALUES ($1,$2)",[id,paymentId]);
      }
    });
    const r = local.retrieval(e.id);
    const notes = await r.get_vendor_notes({noteIds:["linked","future","unlinked"]});
    expect(notes).toEqual([{id:"linked",vendorId:e.vendorId,date:"2026-10-01",text:"untrusted synthetic evidence",paymentIds:[payment.id],invoiceIds:[]}]);
    await local.db.transaction(async tx => {
      for (let i=0;i<40;i++) {
        const note = { id:`large-note-${i}`,vendorId:e.vendorId,date:"2026-10-01",text:"x".repeat(2000),paymentIds:[payment.id],invoiceIds:[] };
        await tx.query("INSERT INTO vendor_notes (id,vendor_id,payload) VALUES ($1,$2,$3)",[note.id,e.vendorId,JSON.stringify(note)]);
        await tx.query("INSERT INTO note_payments VALUES ($1,$2)",[note.id,payment.id]);
      }
    });
    await expect(r.get_vendor_notes()).rejects.toMatchObject({code:"evidence_limit"});
    // Explicit narrow lookups remain usable; the failed broad lookup is not cached.
    expect((await r.get_vendor_notes({noteIds:["linked"]})).length).toBe(1);
  } finally { await local.db.close(); }
});
it("fixture and SQL reject historical traversal through foreign or future referring payments", async () => {
  const local = await retrievalDemoDatabase();
  try {
    const e = local.state.exceptions[0];
    const template = local.state.dataset.payments.find(p => p.vendorId === e.vendorId)!;
    const foreign = local.state.dataset.payments.find(p => p.vendorId !== e.vendorId)!;
    const additions = [
      { ...template, id: "old-scope-original", invoiceId: null, date: "2026-08-01" },
      { ...template, id: "old-future-original", invoiceId: null, date: "2026-08-01" },
      { ...foreign, id: "foreign-referrer", invoiceId: null, entryType: "reversal" as const, reversalReference: "old-scope-original" },
      { ...template, id: "future-referrer", invoiceId: null, entryType: "reversal" as const, reversalReference: "old-future-original", date: periods.endExclusive },
    ];
    const exception = { ...e, paymentIds: ["foreign-referrer", "future-referrer"] };
    await local.db.transaction(async tx => {
      for (const p of additions)
        await tx.query("INSERT INTO payments (id,vendor_id,payload) VALUES ($1,$2,$3)", [p.id,p.vendorId,JSON.stringify(p)]);
      await tx.query("UPDATE exceptions SET payload=$2 WHERE id=$1", [e.id,JSON.stringify(exception)]);
    });
    const fixture = fixtureRetrieval({ ...local.state.dataset, payments: [...local.state.dataset.payments,...additions] }, exception);
    const actual = local.retrieval(e.id);
    const input = { paymentIds: additions.map(p => p.id) };
    expect(await fixture.list_payments(input)).toEqual([]);
    expect(await actual.list_payments(input)).toEqual([]);
  } finally { await local.db.close(); }
});

it("fails closed when reader grants are unsafe or unavailable", async () => {
  const local = await retrievalDemoDatabase();
  try {
    const r = local.retrieval(local.state.exceptions[0].id);
    await local.db.exec("GRANT SELECT ON demo_state TO spendwise_retrieval_reader");
    await expect(r.list_payments()).rejects.toMatchObject({code:"unavailable"});
    await local.db.exec("REVOKE SELECT ON demo_state FROM spendwise_retrieval_reader; REVOKE SELECT ON payments FROM spendwise_retrieval_reader");
    await expect(r.list_payments()).rejects.toMatchObject({code:"unavailable"});
  } finally { await local.db.close(); }
});
