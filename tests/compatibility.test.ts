import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { verifyIsolatedCompatibility } from "../src/server/db/compatibility";
import { migrations } from "../src/server/db/migrations/bundled";
import { migrate } from "../src/server/db/migrate";
import { injectedDataset } from "../src/fixtures/scenarios";
it("runs the same isolated compatibility scenario offline with zero model requests", async () => {
  const db = new PGlite();
  try {
    expect(await verifyIsolatedCompatibility(db)).toEqual({ cycles: 3, exceptionsPerCycle: 4, modelRequests: 0 });
  } finally { await db.close(); }
});
it("rejects future/gapped migration ledgers without changing them", async () => {
  for (const version of [2, 3]) {
    const db = new PGlite();
    try {
      await db.exec('CREATE TABLE schema_migrations(version integer PRIMARY KEY)');
      await db.query('INSERT INTO schema_migrations VALUES ($1)', [version]);
      await expect(migrate(db)).rejects.toThrow('Unsupported migration version');
      expect((await db.query('SELECT version FROM schema_migrations')).rows).toEqual([{ version }]);
    } finally { await db.close(); }
  }
});
it("enforces column-authoritative run metadata and SQL filter columns at the database boundary", async () => {
  const db = new PGlite();
  try {
    await db.exec(migrations[0]);
    const data = injectedDataset();
    for (const v of data.vendors) await db.query('INSERT INTO vendors VALUES ($1,$2)', [v.id, JSON.stringify(v)]);
    for (const [table, rows] of [['invoices', data.invoices], ['payments', data.payments], ['vendor_notes', data.notes]] as const)
      for (const r of rows) await db.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, [r.id, r.vendorId, JSON.stringify(r)]);
    await migrate(db);
    const p = data.payments.find(p => p.invoiceId)!;
    const rows = await db.query(`SELECT id FROM payments WHERE payment_date=$1::date AND amount_cents=$2
      AND status=$3 AND invoice_id=$4 AND entry_type=$5 AND reversal_reference IS NOT DISTINCT FROM $6`,
      [p.date, p.amountCents, p.status, p.invoiceId, p.entryType, p.reversalReference]);
    expect(rows.rows).toContainEqual({ id: p.id });
    await db.query('UPDATE payments SET payload=$2 WHERE id=$1', [p.id, JSON.stringify({ ...p, amountCents: p.amountCents + 1 })]);
    expect((await db.query('SELECT amount_cents::text AS cents FROM payments WHERE id=$1', [p.id])).rows).toEqual([{ cents: String(p.amountCents + 1) }]);
    await db.exec(`INSERT INTO exceptions VALUES ('e','{}')`);
    for (const key of ['id','exceptionId','generation','state']) {
      await expect(db.query(`INSERT INTO investigation_runs(id,exception_id,generation,status,deadline_at,payload)
        VALUES ('r','e',0,'failed',now(),$1)`, [JSON.stringify({ [key]: 'conflict' })])).rejects.toThrow();
    }
  } finally { await db.close(); }
});
