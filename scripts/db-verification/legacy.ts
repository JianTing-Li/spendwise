import type { Database } from "../../src/server/db/database";
import type { Dataset } from "../../src/contracts";
import { migrations } from "../../src/server/db/migrations/bundled";

/** Only a caller-owned empty disposable schema may be seeded. No grants/roles. */
export async function seedLegacy001(db: Database, data: Dataset) {
  await db.transaction(async tx => {
    const existing = await tx.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m','f','S') LIMIT 1`);
    if (existing.rows.length) throw new Error("Empty disposable schema required");
    await tx.exec(migrations[0]);
    for (const v of data.vendors)
      await tx.query('INSERT INTO vendors VALUES ($1,$2)', [v.id, JSON.stringify(v)]);
    for (const [table, rows] of [['invoices', data.invoices], ['payments', data.payments], ['vendor_notes', data.notes]] as const)
      for (const row of rows)
        await tx.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, [row.id, row.vendorId, JSON.stringify(row)]);
  });
}
