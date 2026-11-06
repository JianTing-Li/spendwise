import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { migrations } from "../src/server/db/migrations/bundled";
import { Store } from "../src/server/db/store";
import { baseline, injectedDataset } from "../src/fixtures/scenarios";
import { runPending } from "../src/server/investigation/run";
import { migrate } from "../src/server/db/migrate";
it("bundles exact immutable SQL and loads without cwd filesystem access", async () => {
  for (let i = 0; i < 2; i++)
    expect(migrations[i]).toBe(await readFile(new URL(`../src/server/db/migrations/00${i + 1}_${i === 0 ? 'initial' : 'durable'}.sql`, import.meta.url), 'utf8'));
  const db = new PGlite();
  try {
    // A DB boundary which rejects file reads is unnecessary: migration imports
    // are static strings. Verify startup in another working directory in CLI demo.
    const store = new Store(db);
    await store.initialize();
    await store.initialize();
    expect((await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows).toEqual([{ version: 1 }, { version: 2 }]);
  }
  finally {
    await db.close();
  }
});
it("upgrades populated 001 in place and strips duplicated run metadata", async () => {
  const db = new PGlite();
  try {
    await db.exec(migrations[0]);
    const data = injectedDataset();
    for (const v of data.vendors)
      await db.query('INSERT INTO vendors VALUES ($1,$2)', [v.id, JSON.stringify(v)]);
    for (const [table, rows] of [['invoices', data.invoices], ['payments', data.payments], ['vendor_notes', data.notes]] as const)
      for (const row of rows)
        await db.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, [row.id, row.vendorId, JSON.stringify(row)]);
    await db.query('INSERT INTO exceptions VALUES ($1,$2)', ['e', JSON.stringify({ id: 'e' })]);
    await db.query("INSERT INTO investigation_runs VALUES ('old','e',7,'failed',now(),$1)", [JSON.stringify({ id: 'old', exceptionId: 'e', generation: 7, state: 'failed', mode: 'stub', findings: [], error: 'internal', reviewedAt: null, toolExecutions: 2, modelRequests: 0 })]);
    await migrate(db);
    expect((await db.query('SELECT id,amount_cents FROM payments ORDER BY id')).rows).toHaveLength(data.payments.length);
    expect((await db.query('SELECT * FROM note_payments')).rows).toHaveLength(data.notes.reduce((n, r) => n + r.paymentIds.length, 0));
    expect((await db.query('SELECT * FROM note_invoices')).rows).toHaveLength(data.notes.reduce((n, r) => n + r.invoiceIds.length, 0));
    const r = (await db.query<{
      payload: Record<string, unknown>;
      attempt: number;
    }>('SELECT payload,attempt FROM investigation_runs')).rows[0];
    expect(r.attempt).toBe(1);
    expect(r.payload.id).toBeUndefined();
    expect(r.payload.toolExecutions).toBe(2);
    expect((await db.query('SELECT id FROM vendors')).rows).toHaveLength(baseline.vendors.length);
  }
  finally {
    await db.close();
  }
});
it("rolls the whole 002 upgrade back on invalid legacy financial data", async () => {
  const db = new PGlite();
  try {
    await db.exec(migrations[0]);
    await db.query("INSERT INTO vendors VALUES ('v','{}')");
    await db.query("INSERT INTO payments VALUES ('bad','v',$1)", [JSON.stringify({ amountCents: 9007199254740992, currency: 'USD' })]);
    await expect(migrate(db)).rejects.toThrow();
    expect((await db.query('SELECT version FROM schema_migrations')).rows).toEqual([{ version: 1 }]);
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='payments' AND column_name='amount_cents'")).rows).toEqual([]);
  }
  finally {
    await db.close();
  }
});
it("makes retries explicit, bounded and predecessor-idempotent; reset invalidates history", async () => {
  const db = new PGlite();
  try {
    const s = new Store(db);
    await s.initialize();
    await s.inject(Date.now() - 61000);
    let r = (await s.state()).runs[0];
    const first = r.id;
    const outcomes = await Promise.all([s.retry(first), s.retry(first)]);
    expect(outcomes.map(r => r.changed).sort()).toEqual([false, true]);
    let runs = (await s.state()).runs.filter(x => x.exceptionId === r.exceptionId);
    expect(runs).toHaveLength(2);
    r = runs[1];
    expect(r.toolExecutions).toBe(0);
    expect(r.modelRequests).toBe(0);
    const input = await s.claim(r.id);
    expect(Date.parse(input!.deadlineAt) - Date.parse(input!.acceptedAt)).toBe(60000);
    await expect(s.retry(r.id)).rejects.toThrow('invalid_retry');
    await s.finish(r.id, r.generation, { mode: 'stub', state: 'cancelled', error: null, findings: [], toolExecutions: 8, modelRequests: 10 });
    await s.retry(r.id);
    runs = (await s.state()).runs.filter(x => x.exceptionId === r.exceptionId);
    expect(runs).toHaveLength(3);
    const third = runs[2];
    await s.claim(third.id);
    await s.finish(third.id, third.generation, { mode: 'stub', state: 'failed', error: 'internal', findings: [], toolExecutions: 0, modelRequests: 0 });
    await expect(s.retry(third.id)).rejects.toThrow('invalid_retry');
    expect((await s.retry(first)).changed).toBe(false);
    await s.reset();
    await s.inject();
    await expect(s.retry(first)).rejects.toThrow('invalid_retry');
    await runPending(s);
    await expect(s.retry((await s.state()).runs[0].id)).rejects.toThrow('invalid_retry');
  }
  finally {
    await db.close();
  }
});
it("initializes from another process working directory", async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { tmpdir } = await import('node:os');
  const { fileURLToPath } = await import('node:url');
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./helpers/portable-store.ts', import.meta.url))], { cwd: tmpdir() });
  expect(JSON.parse(stdout)).toEqual({ versions: [{ version: 1 }, { version: 2 }], payments: 2 });
});
